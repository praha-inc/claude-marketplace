/**
 * Stop hook that keeps a review from ending before it is posted.
 *
 * The review skill runs other skills on the way, and the instructions one of them loads
 * end with "Your final reply must contain the markdown report and nothing else". The turn
 * tends to end there, with nothing posted, and in CI the end of the turn is the end of the
 * job. Wording in the skill did not prevent it, so this checks the outcome instead: when
 * this session ran fetch-review-state.ts and the review file it handed out was never
 * posted, the stop is blocked and Claude is told to go on.
 *
 * Whether a review is pending is read from two places:
 * - The transcript of the session, for the `reviewFile` that fetch-review-state.ts printed
 *   last, and for a review that submit-review.ts posted. Only the output of those two
 *   commands is read, not the rest of the transcript, which holds text written by the
 *   author of the pull request.
 * - The file system: submit-review.ts deletes the directory of the review file once the
 *   review is posted, so a directory that is still there means it was not.
 *
 * The hook would rather miss a review that was cut short than push for one that is not
 * wanted, because what it pushes for is posted to the pull request:
 * - Once the session has posted a review, it does nothing more. A directory can be left
 *   over after that (fetch-review-state.ts was run again to look at the result, or the
 *   directory could not be deleted), and blocking then would ask for a second review.
 * - A stop that follows a blocked one directly (`stop_hook_active`) goes through, so a
 *   stop that is meant costs one more round, in which Claude says why. Stops that are
 *   meant: the working tree has uncommitted changes, a review skill is still running in
 *   the background, or the script was run by hand without the skill.
 * - A stop is blocked at most `MAX_BLOCKS` times for one review file, so a run that keeps
 *   coming back without posting never loops.
 *
 * Any failure in here lets the stop through: a hook that cannot tell must not hold a session.
 */
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { POSTED_LINE_PREFIX, REVIEW_DIRECTORY_PREFIX, REVIEW_FILE_NAME, STOP_BLOCKS_FILE_NAME } from './github.ts';

/**
 * More than the one stop this hook is for, because each stop to wait for a review skill
 * that runs in the background uses one up as well.
 */
const MAX_BLOCKS = 3;

const FETCH_SCRIPT = 'fetch-review-state.ts';
const SUBMIT_SCRIPT = 'submit-review.ts';

/**
 * A command that runs one of the scripts with node, as the skill does. A command that only
 * names the file, such as `git diff` or `cat` on a pull request that changes it, prints
 * text written by the author of the pull request, and is not read.
 */
const runs = (command: string, script: string): boolean => {
  return new RegExp(String.raw`\bnode\b[^|;&\n]*${script.replaceAll('.', String.raw`\.`)}`).test(command);
};

/**
 * The `reviewFile` property as fetch-review-state.ts prints it, with its value as a JSON
 * literal: a string, or `null` when the pull request is not open.
 */
const REVIEW_FILE_PROPERTY = /"reviewFile":\s*("(?:[^"\\]|\\.)*"|null)/;

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

/**
 * The review file in the output of fetch-review-state.ts: `null` when it handed out none,
 * and `undefined` when the output is not that of a run that succeeded.
 */
const parseReviewFile = (output: string): string | null | undefined => {
  const literal = REVIEW_FILE_PROPERTY.exec(output)?.[1];
  if (literal === undefined) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(literal);
    return typeof value === 'string' || value === null ? value : undefined;
  } catch {
    return undefined;
  }
};

const isPosted = (output: string): boolean => {
  return output.split('\n').some((line) => line.startsWith(POSTED_LINE_PREFIX));
};

/**
 * What the session did about a review: the review file that the last run of
 * fetch-review-state.ts handed out (an earlier one was given up when the skill went back
 * to its first step), and whether submit-review.ts posted a review.
 */
const readTranscript = (transcript: string): { reviewFile: string | null | undefined; posted: boolean } => {
  // The calls of each script by the id of the tool use, which is what its result refers to.
  const fetchCalls = new Set<string>();
  const submitCalls = new Set<string>();
  let reviewFile: string | null | undefined;
  let posted = false;
  for (const line of transcript.split('\n')) {
    // Most lines are about neither script, and parsing every line of a long transcript is slow.
    if (!line.includes(FETCH_SCRIPT) && !line.includes(SUBMIT_SCRIPT) && !line.includes('reviewFile') && !line.includes(POSTED_LINE_PREFIX)) {
      continue;
    }
    for (const block of blocksOf(line)) {
      // Whichever tool ran the command: the shell tool has another name on Windows.
      if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
        const command = isRecord(block['input']) ? block['input']['command'] : undefined;
        if (typeof command !== 'string') {
          continue;
        }
        if (runs(command, FETCH_SCRIPT)) {
          fetchCalls.add(block['id']);
        }
        // A dry run is not left out: it prints no line that says a review was posted.
        if (runs(command, SUBMIT_SCRIPT)) {
          submitCalls.add(block['id']);
        }
      } else if (block['type'] === 'tool_result' && typeof block['tool_use_id'] === 'string') {
        const output = textOf(block['content']);
        if (fetchCalls.has(block['tool_use_id'])) {
          // A run that failed printed no review file, and the one before it still counts.
          const handedOut = parseReviewFile(output);
          reviewFile = handedOut === undefined ? reviewFile : handedOut;
        }
        if (submitCalls.has(block['tool_use_id']) && isPosted(output)) {
          posted = true;
        }
      }
    }
  }
  return { reviewFile, posted };
};

/**
 * The directory of a review file that was not posted, when fetch-review-state.ts made it
 * and it is still there.
 */
const pendingDirectory = (reviewFile: string): string | undefined => {
  const directory = path.dirname(reviewFile);
  if (
    !path.isAbsolute(reviewFile)
    || path.basename(reviewFile) !== REVIEW_FILE_NAME
    || !path.basename(directory).startsWith(REVIEW_DIRECTORY_PREFIX)
  ) {
    return undefined;
  }
  // Not followed when it is a link, because the count of blocks is written into it.
  return lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() ? directory : undefined;
};

const readBlocks = (file: string): number => {
  try {
    const count = Number(readFileSync(file, 'utf8'));
    return Number.isInteger(count) && 0 <= count ? count : 0;
  } catch {
    return 0;
  }
};

const main = (): void => {
  const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
  if (!isRecord(input) || input['stop_hook_active'] === true) {
    return;
  }
  const transcriptPath = input['transcript_path'];
  if (typeof transcriptPath !== 'string') {
    return;
  }

  const { reviewFile, posted } = readTranscript(readFileSync(transcriptPath, 'utf8'));
  const directory = typeof reviewFile !== 'string' || posted ? undefined : pendingDirectory(reviewFile);
  if (typeof reviewFile !== 'string' || directory === undefined) {
    return;
  }

  const blocksFile = path.join(directory, STOP_BLOCKS_FILE_NAME);
  const blocks = readBlocks(blocksFile);
  if (MAX_BLOCKS <= blocks) {
    return;
  }
  // Written before the stop is blocked: if the count cannot be kept, blocking could repeat without end.
  writeFileSync(blocksFile, String(blocks + 1));

  process.stdout.write(`${JSON.stringify({
    decision: 'block',
    reason: [
      `This session started a review of a pull request and has not posted it: ${FETCH_SCRIPT} handed out ${reviewFile}, and ${SUBMIT_SCRIPT} has not posted a review. This check runs whenever the turn ends in that state, and cannot tell why it ended.`,
      'If you are running the pr-reviewer:review skill and ended the turn after the report of the code-review or security-review skill: that report is not the end of the skill. Go on from where you stopped, in this turn: run the review skill that has not run yet, then decide what to post (step 4), write the review file (step 5) and post it with submit-review.ts (step 6).',
      'Otherwise do not post anything because of this message. If a review skill is still running in the background, say that you are waiting for its report and stop: you go on when it arrives. If the skill told you to stop (the working tree is not the code of the pull request, you need an answer from the user), if the review cannot be posted, or if nobody asked for a review in this session, say why in one sentence and stop.',
    ].join('\n\n'),
  })}\n`);
};

try {
  main();
} catch {
  // See the note at the top: a failure lets the stop through.
}
