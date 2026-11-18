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
 *   last. Only the output of that command is read, not the rest of the transcript, which
 *   holds text written by the author of the pull request.
 * - The file system: submit-review.ts deletes the directory of the review file once the
 *   review is posted, so a directory that is still there means it was not.
 *
 * A stop is blocked at most `MAX_BLOCKS` times for one review file, so a stop that is meant
 * (the pull request is closed, the working tree has uncommitted changes) goes through after
 * Claude has said why, and a run that cannot post never loops.
 *
 * Any failure in here lets the stop through: a hook that cannot tell must not hold a session.
 */
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { REVIEW_DIRECTORY_PREFIX, REVIEW_FILE_NAME, STOP_BLOCKS_FILE_NAME } from './github.ts';

const MAX_BLOCKS = 2;

const FETCH_SCRIPT = 'fetch-review-state.ts';

/** The `reviewFile` property as fetch-review-state.ts prints it, with its value as a JSON string literal. */
const REVIEW_FILE_PROPERTY = /"reviewFile":\s*("(?:[^"\\]|\\.)*")/;

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

const parseReviewFile = (output: string): string | undefined => {
  const literal = REVIEW_FILE_PROPERTY.exec(output)?.[1];
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
 * The review file that the last run of fetch-review-state.ts in this session handed out.
 * An earlier one was given up when the skill went back to its first step.
 */
const findReviewFile = (transcript: string): string | undefined => {
  const fetchCalls = new Set<string>();
  let reviewFile: string | undefined;
  for (const line of transcript.split('\n')) {
    // Most lines are neither, and parsing every one of a long transcript is slow.
    if (!line.includes(FETCH_SCRIPT) && !line.includes('reviewFile')) {
      continue;
    }
    for (const block of blocksOf(line)) {
      if (block['type'] === 'tool_use' && block['name'] === 'Bash' && typeof block['id'] === 'string') {
        const command = isRecord(block['input']) ? block['input']['command'] : undefined;
        if (typeof command === 'string' && command.includes(FETCH_SCRIPT)) {
          fetchCalls.add(block['id']);
        }
      } else if (
        block['type'] === 'tool_result'
        && typeof block['tool_use_id'] === 'string'
        && fetchCalls.has(block['tool_use_id'])
      ) {
        // A run that failed printed no review file, and the one before it still counts.
        reviewFile = parseReviewFile(textOf(block['content'])) ?? reviewFile;
      }
    }
  }
  return reviewFile;
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
  const transcriptPath = isRecord(input) ? input['transcript_path'] : undefined;
  if (typeof transcriptPath !== 'string') {
    return;
  }

  const reviewFile = findReviewFile(readFileSync(transcriptPath, 'utf8'));
  const directory = reviewFile === undefined ? undefined : pendingDirectory(reviewFile);
  if (reviewFile === undefined || directory === undefined) {
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
      `The review of the pull request has not been posted: ${reviewFile} was handed out by ${FETCH_SCRIPT} and submit-review.ts has not posted it.`,
      'A report from the code-review or security-review skill is not the end of the pr-reviewer:review skill. Go on from the step you stopped at, in this turn: run the review skill that has not reported yet, then decide what to post (step 4), write the review file (step 5) and post it with submit-review.ts (step 6).',
      'If the skill itself told you to stop, or the review cannot be posted, say why in one or two sentences and stop.',
    ].join('\n\n'),
  })}\n`);
};

try {
  main();
} catch {
  // See the note at the top: a failure lets the stop through.
}
