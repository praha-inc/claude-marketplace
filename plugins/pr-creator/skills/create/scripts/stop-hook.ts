/**
 * Stop hook that keeps a run of the create skill from ending before its pull request is opened.
 *
 * The self-review of the skill runs other skills, and the instructions one of them loads
 * end with "Your final reply must contain the markdown report and nothing else". The turn
 * tends to end there, with the findings not judged and no pull request opened. Wording in
 * the skill did not prevent it, so this checks the outcome instead: when this session ran
 * start-self-review.ts and has not opened a pull request since, the stop is blocked and
 * Claude is told to go on.
 *
 * Whether a run is unfinished is read from two places:
 * - The transcript of the session, for the `descriptionFile` that start-self-review.ts
 *   printed last, and for a pull request that `gh pr create` opened after it. Only the
 *   output of those two commands is read, not the rest of the transcript.
 * - The file system: the directory of the description file is still there. end-self-review.ts
 *   deletes it, once the pull request is opened and when the run is given up.
 *
 * The hook cannot tell why a turn ended, so it lets a stop through rather than hold a session:
 * - A stop that follows a blocked one with no tool use in between goes through: Claude
 *   did not go on, it said why it stopped. So a stop that is meant costs one more round.
 *   Stops that are meant: the review does not converge, a question to the user, a review
 *   skill that is still running in the background. When Claude did go on and then stops
 *   again without a pull request, such as after the report of a later round, that stop is
 *   blocked like the first.
 * - A stop is blocked at most `MAX_BLOCKS` times for one description file, so a run that
 *   keeps coming back without opening a pull request never loops.
 * - Any failure in here lets the stop through.
 */
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DESCRIPTION_DIRECTORY_PREFIX, DESCRIPTION_FILE_NAME, MARKER_FILE_NAME, STOP_BLOCKS_FILE_NAME } from './self-review.ts';

/**
 * Only a guard against a loop, so it is generous. The self-review runs the review skills
 * again after every fix, up to five rounds, and in each round the turn can end three times
 * before it should: to wait for a skill that runs in the background, and after the report
 * of each of the two skills.
 */
const MAX_BLOCKS = 20;

const START_SCRIPT = 'start-self-review.ts';
const END_SCRIPT = 'end-self-review.ts';

/**
 * A command that runs the script with node, as the skill does: `node` is the first word of
 * the command or of one of its parts, with or without variables set in front of it. A command that only names the file, such as `cat` or
 * `git diff`, is not read.
 */
const RUNS_START_SCRIPT = /(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*node\s[^|;&\n]*start-self-review\.ts/;

/** The same for end-self-review.ts, which ends the run. */
const RUNS_END_SCRIPT = /(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*node\s[^|;&\n]*end-self-review\.ts/;

/** A command, or a part of one, that creates a pull request, with or without variables set in front of it. */
const CREATES_PULL_REQUEST = /(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*gh\s+pr\s+create(?:\s|$)/;

/** The `descriptionFile` property as start-self-review.ts prints it, with its value as a JSON string literal. */
const DESCRIPTION_FILE_PROPERTY = /"descriptionFile":\s*("(?:[^"\\]|\\.)*")/;

/**
 * The URL of the pull request on a line of its own, which is how `gh pr create` prints it
 * when it created one, also when it then fails to attach a file. A URL inside other text,
 * such as a description printed by another part of the command, is not that.
 */
const PULL_REQUEST_URL = /^https?:\/\/\S+\/pull\/\d+\s*$/m;

type Block = Record<string, unknown>;

const isRecord = (value: unknown): value is Block => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * The content blocks of the message on one line of the transcript.
 */
const blocksOf = (line: string): Block[] => {
  try {
    const entry: unknown = JSON.parse(line);
    if (!isRecord(entry) || !isRecord(entry['message'])) {
      return [];
    }
    const content = entry['message']['content'];
    return Array.isArray(content) ? content.filter((block) => isRecord(block)) : [];
  } catch {
    // A line that is not JSON, such as one that is still being written, holds nothing to read.
    return [];
  }
};

/**
 * The text of a tool result, which is a string or a list of text blocks.
 */
const textOf = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => (isRecord(part) && typeof part['text'] === 'string' ? part['text'] : ''))
    .join('\n');
};

const parseDescriptionFile = (output: string): string | undefined => {
  const literal = DESCRIPTION_FILE_PROPERTY.exec(output)?.[1];
  if (literal === undefined) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(literal);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * What the session did about a pull request: the description file that the last run of
 * start-self-review.ts handed out, and whether the run it started is over: `gh pr create`
 * opened a pull request after that, or end-self-review.ts ended the run. Either of them
 * before it belongs to an earlier run of the skill in the same session.
 *
 * That end-self-review.ts ran is read here as well as from the directory being gone, so that
 * a directory of the same name that appears later is not taken for the run.
 */
const readTranscript = (transcript: string): { descriptionFile: string | undefined; over: boolean } => {
  // The calls of each command by the id of the tool use, which is what its result refers to.
  const startCalls = new Set<string>();
  const createCalls = new Set<string>();
  const endCalls = new Set<string>();
  let descriptionFile: string | undefined;
  let over = false;
  for (const line of transcript.split('\n')) {
    // Most lines are about none of the commands or what they print, and parsing every line of a long transcript is slow.
    if (!line.includes(START_SCRIPT) && !line.includes(END_SCRIPT) && !line.includes('descriptionFile') && !line.includes('pr create') && !line.includes('/pull/') && !line.includes('eleted')) {
      continue;
    }
    for (const block of blocksOf(line)) {
      // Whichever tool ran the command: the shell tool has another name on Windows.
      if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
        const command = isRecord(block['input']) ? block['input']['command'] : undefined;
        if (typeof command !== 'string') {
          continue;
        }
        if (RUNS_START_SCRIPT.test(command)) {
          startCalls.add(block['id']);
        }
        if (CREATES_PULL_REQUEST.test(command)) {
          createCalls.add(block['id']);
        }
        if (RUNS_END_SCRIPT.test(command)) {
          endCalls.add(block['id']);
        }
      } else if (block['type'] === 'tool_result' && typeof block['tool_use_id'] === 'string') {
        const output = textOf(block['content']);
        if (startCalls.has(block['tool_use_id'])) {
          // A run that failed printed no description file, and the one before it still counts.
          const handedOut = parseDescriptionFile(output);
          if (handedOut !== undefined) {
            descriptionFile = handedOut;
            over = false;
          }
        }
        if (createCalls.has(block['tool_use_id']) && PULL_REQUEST_URL.test(output)) {
          over = true;
        }
        // What end-self-review.ts prints when it deleted the directory, or found it deleted.
        if (endCalls.has(block['tool_use_id']) && /^(?:Deleted|Already deleted:) /m.test(output)) {
          over = true;
        }
      }
    }
  }
  return { descriptionFile, over };
};

/**
 * The directory of a description file, when start-self-review.ts made it and it is still there.
 */
const pendingDirectory = (descriptionFile: string): string | undefined => {
  const directory = path.dirname(descriptionFile);
  if (
    !path.isAbsolute(descriptionFile)
    || path.basename(descriptionFile) !== DESCRIPTION_FILE_NAME
    || !path.basename(directory).startsWith(DESCRIPTION_DIRECTORY_PREFIX)
  ) {
    return undefined;
  }
  // Not followed when it is a link, because the count of blocks is written into it. With the
  // marker of start-self-review.ts, as end-self-review.ts asks for, so that a run the hook
  // takes as unfinished is one that script can end.
  const isDirectory = lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() === true;
  const hasMarker = lstatSync(path.join(directory, MARKER_FILE_NAME), { throwIfNoEntry: false })?.isFile() === true;
  return isDirectory && hasMarker ? directory : undefined;
};

/**
 * What the hook keeps in the directory of the description file: how many stops it blocked, and
 * how long the transcript was at the last one, to tell what happened since.
 */
const readBlocks = (file: string): { blocks: number; transcriptLength: number } => {
  try {
    const [blocks = Number.NaN, transcriptLength = Number.NaN] = readFileSync(file, 'utf8').split(' ').map(Number);
    if (Number.isInteger(blocks) && 0 <= blocks && Number.isInteger(transcriptLength) && 0 <= transcriptLength) {
      return { blocks, transcriptLength };
    }
  } catch {
    // Nothing was blocked yet.
  }
  return { blocks: 0, transcriptLength: 0 };
};

const hasToolUse = (transcript: string): boolean => {
  return transcript.split('\n').some((line) => {
    return line.includes('"tool_use"') && blocksOf(line).some((block) => block['type'] === 'tool_use');
  });
};

/**
 * A path as one word of a shell command, whatever characters it holds.
 */
const quote = (value: string): string => {
  return `'${value.replaceAll('\'', String.raw`'\''`)}'`;
};

const main = (): void => {
  const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
  const transcriptPath = isRecord(input) ? input['transcript_path'] : undefined;
  if (!isRecord(input) || typeof transcriptPath !== 'string') {
    return;
  }

  const transcript = readFileSync(transcriptPath, 'utf8');
  const { descriptionFile, over } = readTranscript(transcript);
  const directory = descriptionFile === undefined || over ? undefined : pendingDirectory(descriptionFile);
  if (descriptionFile === undefined || directory === undefined) {
    return;
  }

  const blocksFile = path.join(directory, STOP_BLOCKS_FILE_NAME);
  const { blocks, transcriptLength } = readBlocks(blocksFile);
  if (MAX_BLOCKS <= blocks) {
    return;
  }
  // Claude is going on because a stop was blocked, and has used no tool since this hook
  // blocked one: it answered instead of going on, and asking again would get the same answer.
  // A transcript shorter than it was is another file, of a session that was resumed: all of it is new.
  const sinceLastBlock = transcriptLength <= transcript.length ? transcript.slice(transcriptLength) : transcript;
  if (input['stop_hook_active'] === true && 0 < blocks && !hasToolUse(sinceLastBlock)) {
    return;
  }
  // Written before the stop is blocked: if the count cannot be kept, blocking could repeat without end.
  writeFileSync(blocksFile, `${blocks + 1} ${transcript.length}`);

  // In full, because the skill's text, which says where the script is, may be long gone from the context.
  const endCommand = `node ${quote(path.join(import.meta.dirname, 'end-self-review.ts'))} ${quote(descriptionFile)}`;
  process.stdout.write(`${JSON.stringify({
    decision: 'block',
    reason: [
      `This session started the self-review of the pr-creator:create skill (${START_SCRIPT}) and has not opened the pull request. This check runs whenever the turn ends in that state, and cannot tell why it ended.`,
      'If you ended the turn after the report of a skill the create skill runs (code-review, security-review, or the diagram skill): that report is not the end of the create skill. Go on from the step where you stopped, in this turn. In step 6 that is: run the review skill that has not run yet in this round, judge every finding, fix the valid ones and review again until a round is clean. Then go on through the steps that follow, up to step 11, and open the draft pull request.',
      `If you stopped on purpose, do not go on because of this message. If a review skill is still running in the background, say that you are waiting for its report and stop: you go on when it arrives. If you need an answer from the user, say so and stop. If the pull request of this run already exists, do not open another: end the run with the command below, and finish step 11. If the run is given up, or step 6 told you to stop because the review does not converge, end the run with the command below, say why in one sentence and stop.`,
      endCommand,
    ].join('\n\n'),
  })}\n`);
};

try {
  main();
} catch {
  // See the note at the top: a failure lets the stop through.
}
