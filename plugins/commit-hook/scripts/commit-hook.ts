/**
 * PreToolUse hook that runs the commands in `COMMIT_HOOK_COMMANDS` (a JSON array of strings)
 * before Claude runs `git commit`, and blocks the commit (exit code 2) when any of them fail.
 */
import { spawnSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

const ENV_NAME = 'COMMIT_HOOK_COMMANDS';

// Keep only the tail of each failed command's output so the feedback stays readable.
const MAX_OUTPUT_LENGTH = 10_000;

const parseCommands = (value: string): string[] | undefined => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((command) => typeof command === 'string')) {
      return parsed;
    }
  } catch {
    // Reported by the caller as an invalid value.
  }
  return undefined;
};

/**
 * Runs a command through a shell in the project directory, and returns a report of
 * its output when it fails.
 */
const runCommand = (command: string): string | undefined => {
  const result = spawnSync(command, {
    cwd: process.env['CLAUDE_PROJECT_DIR'],
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status === 0) {
    return undefined;
  }

  const output = stripVTControlCharacters(`${result.stdout}${result.stderr}${result.error?.message ?? ''}`).trim();
  return [
    `=== ${command} (exit code: ${result.status ?? 'unknown'}) ===`,
    output.length > MAX_OUTPUT_LENGTH ? `... (truncated)\n${output.slice(-MAX_OUTPUT_LENGTH)}` : output,
  ].join('\n');
};

const main = (): number => {
  const value = process.env[ENV_NAME] ?? '';
  if (value.trim().length <= 0) {
    return 0;
  }

  const commands = parseCommands(value);
  if (!commands) {
    process.stderr.write(
      `Commit blocked: ${ENV_NAME} must be a JSON array of command strings, such as ["pnpm run lint", "pnpm run test"], but got: ${value}\n`,
    );
    return 2;
  }

  const failures = commands
    .map((command) => runCommand(command))
    .filter((failure) => failure !== undefined);

  if (0 < failures.length) {
    process.stderr.write([
      `Commit blocked: ${failures.length} of ${commands.length} checks failed.`,
      'Fix the problems reported below, then run the commit again.',
      '',
      ...failures,
      '',
    ].join('\n'));
    return 2;
  }

  return 0;
};

process.exitCode = main();
