# commit-hook

A Claude Code plugin that runs the commands you configure whenever Claude is about to run `git commit`. If any of them fail, the commit is blocked and the failing output is handed back to Claude so it can fix the problems and commit again.

## Installation

```
/plugin marketplace add praha-inc/claude-marketplace
/plugin install commit-hook@praha-claude-marketplace
```

## Configuration

### With the setup skill

Run the bundled skill in your project:

```
/commit-hook:setup
```

It investigates the commands your CI runs, your task definitions such as `package.json` scripts, and any existing Git hooks, then proposes checks that verify the code without changing it. Commands that modify files, deploy, need secrets or external services, or take long (such as end-to-end tests) are left out. After you confirm the list and where to save it, the skill writes `COMMIT_HOOK_COMMANDS` with the correct escaping and runs each command once, so you know they pass before Claude's next commit.

### Manually

Set the commands to run in the `COMMIT_HOOK_COMMANDS` environment variable as a JSON array of strings. The easiest place is the `env` field of your project's `.claude/settings.json`, so everyone on the project shares the same checks. Because `env` values must be strings, the array is written as an escaped JSON string:

```json
{
  "env": {
    "COMMIT_HOOK_COMMANDS": "[\"pnpm run lint\", \"pnpm run test\"]"
  }
}
```

Use `.claude/settings.local.json` instead for checks only you want. Changes apply from the next commit without restarting Claude Code. When the variable is unset or empty, nothing runs and commits are never blocked. When it is not a JSON array of strings, every commit is blocked with an error explaining the expected format, so a broken setting never skips the checks silently.

## How it works

The plugin registers a `PreToolUse` hook on the Bash tool that fires when a command contains `git commit`. The hook then:

1. Parses `COMMIT_HOOK_COMMANDS` as a JSON array of commands.
2. Runs each command in order through a shell in the project directory (`CLAUDE_PROJECT_DIR`). Every command runs even if an earlier one fails, so Claude sees all the problems at once.
3. Blocks the commit with exit code 2 if any command fails, reporting each failed command with the last 10,000 characters of its output.

### Example

```
Commit blocked: 1 of 2 checks failed.
Fix the problems reported below, then run the commit again.

=== pnpm run lint (exit code: 1) ===
> my-app@ lint /path/to/project
> oxlint

  × eslint(no-unused-vars): Variable 'value' is declared but never used.
```

## Notes

- To run commands that depend on each other, chain them inside one entry, for example `"pnpm run build && pnpm run test"`.
- Only commits that Claude makes through the Bash tool are checked. This is not a Git hook, so commits you run yourself in a terminal are not checked.
- The commands run against the working tree, not only the staged changes.
- The hook needs Node.js 22.18 or later available as `node`, because it is a TypeScript file run with Node.js type stripping. If the hook cannot run, Claude Code reports a hook error but does not block the commit.
- The hook has a 600-second timeout.

## Disabling

```
/plugin disable commit-hook@praha-claude-marketplace
```
