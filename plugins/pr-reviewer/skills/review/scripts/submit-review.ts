/**
 * Posts a review to a pull request from a JSON file, as one review:
 *
 * 1. answers every thread an earlier review left open, saying whether it was addressed,
 * 2. leaves each new finding as a comment on its line, prefixed with its severity (or on its
 *    file, when the line is not in the diff),
 * 3. submits the review as "Approve" or "Request changes" with a short summary,
 * 4. resolves the threads that were addressed, and
 * 5. hides the summary of each earlier review whose threads are now all resolved, as outdated.
 *
 * When GitHub does not accept the verdict from this account, the review is posted as a
 * comment that states it, and an approval dismisses the account's earlier requests for changes.
 *
 * The verdict is derived from the findings rather than taken from the file: the review
 * requests changes when a new finding, or a thread that is still open, must be fixed.
 *
 * Once the review is posted, the file is deleted, since running the script on it a second
 * time would post everything again.
 *
 * Usage: node submit-review.ts [--dry-run] <review.json>
 */
import { readFileSync, rmdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { fetchReviewState, formatFinding, REVIEW_DIRECTORY_PREFIX, graphql, isSameAccount, isSeverity, SEVERITIES, SUMMARY_MARKER } from './github.ts';

import type { OpenThread, ReviewState, Severity } from './github.ts';

type Finding = {
  path: string;
  line: number;
  startLine: number | undefined;
  side: 'LEFT' | 'RIGHT';
  severity: Severity;
  body: string;
};

type ThreadAnswer = {
  id: string;
  status: 'resolved' | 'open';
  severity: Severity | undefined;
  body: string;
};

type Review = {
  repository: string;
  pullRequest: number;
  headSha: string;
  summary: string;
  findings: Finding[];
  threads: ThreadAnswer[];
};

type Verdict = 'APPROVE' | 'REQUEST_CHANGES';

const VERDICTS: Record<Verdict, string> = {
  APPROVE: 'Approve',
  REQUEST_CHANGES: 'Request changes',
};

const THREAD_PREFIXES: Record<ThreadAnswer['status'], string> = {
  resolved: '✅ **Resolved**',
  open: '🔁 **Still open**',
};

/**
 * What GitHub answers when the account may not give a verdict on the pull request: its own
 * pull request, GitHub Actions without the setting that lets it approve, or an app without the permission.
 */
const VERDICT_REFUSED = /can ?not (?:approve|request changes)|not permitted to (?:approve|request changes)|not accessible by integration/i;

const SUGGESTION_FENCE = /^(\s*(?:`{3,}|~{3,}))suggestion\b.*$/gm;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isLine = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value) && 0 < value;
};

const isText = (value: unknown): value is string => {
  return typeof value === 'string' && 0 < value.trim().length;
};

/**
 * Checks the shape of the review file, collecting every problem so they can be fixed in one pass.
 */
const parseReview = (content: string): Review => {
  const problems: string[] = [];
  const data: unknown = JSON.parse(content);
  if (!isRecord(data)) {
    throw new Error('The review file must contain a JSON object.');
  }

  const { repository, pullRequest, headSha, summary } = data;
  if (!isText(repository)) {
    problems.push('`repository` must be the repository as reported by fetch-review-state.ts.');
  }
  if (!isLine(pullRequest)) {
    problems.push('`pullRequest` must be the number of the pull request.');
  }
  if (!isText(headSha)) {
    problems.push('`headSha` must be the commit that was reviewed, as reported by fetch-review-state.ts.');
  }
  if (!isText(summary)) {
    problems.push('`summary` must be a short summary of the review.');
  }

  // The verdict is derived from these lists, so a missing or misspelled key must not pass as "nothing found".
  for (const key of ['findings', 'threads']) {
    if (!Array.isArray(data[key])) {
      problems.push(`\`${key}\` must be an array. Use an empty array when there are none.`);
    }
  }

  const findings: Finding[] = [];
  const rawFindings: unknown[] = Array.isArray(data['findings']) ? data['findings'] : [];
  for (const [index, finding] of rawFindings.entries()) {
    const name = `findings[${index}]`;
    if (!isRecord(finding)) {
      problems.push(`${name} must be an object.`);
      continue;
    }
    const { path, line, startLine, side, severity, body } = finding;
    if (!isText(path)) {
      problems.push(`${name}.path must be the path of a file, relative to the repository root.`);
    }
    if (!isLine(line)) {
      problems.push(`${name}.line must be a line number.`);
    }
    if (startLine !== undefined && (!isLine(startLine) || !isLine(line) || line < startLine)) {
      problems.push(`${name}.startLine must be a line number not after \`line\`.`);
    }
    if (side !== undefined && side !== 'LEFT' && side !== 'RIGHT') {
      problems.push(`${name}.side must be RIGHT (the new code, the default) or LEFT (a removed line).`);
    }
    if (!isSeverity(severity)) {
      problems.push(`${name}.severity must be must, should or nit.`);
    }
    if (!isText(body)) {
      problems.push(`${name}.body must describe the finding.`);
    }
    if (isText(path) && isLine(line) && isSeverity(severity) && isText(body)) {
      findings.push({
        path,
        line,
        startLine: isLine(startLine) && startLine < line ? startLine : undefined,
        side: side === 'LEFT' ? 'LEFT' : 'RIGHT',
        severity,
        body,
      });
    }
  }

  const threads: ThreadAnswer[] = [];
  const rawThreads: unknown[] = Array.isArray(data['threads']) ? data['threads'] : [];
  for (const [index, thread] of rawThreads.entries()) {
    const name = `threads[${index}]`;
    if (!isRecord(thread)) {
      problems.push(`${name} must be an object.`);
      continue;
    }
    const { id, status, severity, body } = thread;
    if (!isText(id)) {
      problems.push(`${name}.id must be the id of a thread reported by fetch-review-state.ts.`);
    }
    if (status !== 'resolved' && status !== 'open') {
      problems.push(`${name}.status must be resolved or open.`);
    }
    if (severity !== undefined && !isSeverity(severity)) {
      problems.push(`${name}.severity must be must, should or nit.`);
    }
    if (!isText(body)) {
      problems.push(`${name}.body must say what was checked and what was found.`);
    }
    if (isText(id) && (status === 'resolved' || status === 'open') && isText(body)) {
      threads.push({ id, status, severity: isSeverity(severity) ? severity : undefined, body });
    }
  }

  if (0 < problems.length || !isText(repository) || !isLine(pullRequest) || !isText(headSha) || !isText(summary)) {
    throw new Error(`The review file is not valid:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  }
  return { repository, pullRequest, headSha, summary, findings, threads };
};

/**
 * Checks the review against the pull request as it is now, and returns each answered
 * thread with the severity of its original finding.
 */
const reconcile = (review: Review, state: ReviewState): Answered[] => {
  const problems: string[] = [];
  if (state.pullRequest.state !== 'OPEN') {
    problems.push(`The pull request is ${state.pullRequest.state.toLowerCase()}, so there is nothing to review.`);
  }
  if (state.pullRequest.headSha !== review.headSha) {
    problems.push(
      `The pull request has new commits since it was reviewed (reviewed ${review.headSha}, now ${state.pullRequest.headSha}). Review the new commits and write the file again.`,
    );
  }

  // A bot never drafts a review by hand, so its pending review is what an interrupted run left behind and is
  // discarded before posting. A person's may hold comments they have not sent yet, so that is theirs to decide.
  if (state.pendingReview && !state.pendingReview.isBot) {
    problems.push(
      `You have a pending review on this pull request, and GitHub allows only one at a time. Submit or discard it on ${state.pullRequest.url}/files, then run this again. If you did not start one, an interrupted run of this script left it behind and it can be discarded.`,
    );
  }

  // GitHub has nowhere to put a comment on a file the pull request does not change, and a finding
  // posted anywhere else would not be a thread that the next review can follow up on and resolve.
  const changed = new Set(state.changedFiles);
  for (const [index, finding] of review.findings.entries()) {
    if (!changed.has(finding.path)) {
      problems.push(
        `findings[${index}].path: ${finding.path} is not a file this pull request changes. Place the finding on the changed line it follows from, or on the changed file closest to it, and name the code it is about in the body.`,
      );
    }
  }

  const answers = new Map(review.threads.map((answer) => [answer.id, answer]));
  const open = new Map(state.openThreads.map((thread) => [thread.id, thread]));
  for (const id of answers.keys()) {
    if (!open.has(id)) {
      problems.push(`threads: ${id} is not an open thread of an earlier review on this pull request.`);
    }
  }

  const answered: Answered[] = [];
  for (const thread of state.openThreads) {
    const answer = answers.get(thread.id);
    if (!answer) {
      problems.push(`threads: the open thread ${thread.id} (${thread.path}) has no answer. Every open thread must be answered.`);
      continue;
    }
    const severity = thread.severity ?? answer.severity;
    if (!severity && answer.status === 'open') {
      problems.push(
        `threads: ${thread.id} stays open but its comment does not say how severe it is. Add \`severity\` (must, should or nit) to its answer.`,
      );
      continue;
    }
    answered.push({ thread, answer, severity: severity ?? 'nit' });
  }

  if (0 < problems.length) {
    throw new Error(`The review cannot be posted:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  }
  return answered;
};

const count = (severities: Severity[]): string => {
  return (['must', 'should', 'nit'] as const)
    .map((severity) => `${SEVERITIES[severity].emoji} ${SEVERITIES[severity].label}: ${severities.filter((item) => item === severity).length}`)
    .join(' · ');
};

const location = (finding: Finding): string => {
  return `${finding.path}:${finding.startLine ? `${finding.startLine}-` : ''}${finding.line}`;
};

/**
 * Rewrites a finding for a place other than its line: a suggestion block there could not
 * be applied to anything, so it is shown as the plain code it contains.
 */
const withoutSuggestions = (body: string): string => {
  return body.trim().replaceAll(SUGGESTION_FENCE, '$1');
};

type Answered = { thread: OpenThread; answer: ThreadAnswer; severity: Severity };

const composeSummary = (review: Review, answered: Answered[], commentOnly: Verdict | undefined): string => {
  const resolved = answered.filter(({ answer }) => answer.status === 'resolved').length;
  return [
    ...(commentOnly ? [`**Verdict: ${VERDICTS[commentOnly]}** (posted as a comment, because GitHub did not accept this account's verdict on this pull request)`] : []),
    review.summary.trim(),
    [
      `New findings — ${count(review.findings.map((finding) => finding.severity))}`,
      ...(0 < answered.length ? [`Earlier findings — ✅ Resolved: ${resolved} · 🔁 Still open: ${answered.length - resolved}`] : []),
    ].join('\n'),
    SUMMARY_MARKER,
  ].join('\n\n');
};

const ADD_REVIEW = `
mutation($pullRequestId: ID!, $commitOID: GitObjectID!) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, commitOID: $commitOID }) {
    pullRequestReview { id }
  }
}`;

const ADD_THREAD = `
mutation($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) {
    thread { id }
  }
}`;

const ADD_REPLY = `
mutation($reviewId: ID!, $threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewId: $reviewId, pullRequestReviewThreadId: $threadId, body: $body }) {
    comment { id }
  }
}`;

const SUBMIT_REVIEW = `
mutation($reviewId: ID!, $event: PullRequestReviewEvent!, $body: String!) {
  submitPullRequestReview(input: { pullRequestReviewId: $reviewId, event: $event, body: $body }) {
    pullRequestReview { url }
  }
}`;

const DELETE_REVIEW = `
mutation($reviewId: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $reviewId }) {
    pullRequestReview { id }
  }
}`;

const RESOLVE_THREAD = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { isResolved }
  }
}`;

const DISMISS_REVIEW = `
mutation($reviewId: ID!, $message: String!) {
  dismissPullRequestReview(input: { pullRequestReviewId: $reviewId, message: $message }) {
    pullRequestReview { state }
  }
}`;

const MINIMIZE = `
mutation($subjectId: ID!) {
  minimizeComment(input: { subjectId: $subjectId, classifier: OUTDATED }) {
    minimizedComment { isMinimized }
  }
}`;

/**
 * Adds a thread to the pending review and returns whether GitHub placed it. GitHub answers
 * a place that is not part of the diff with no thread and no error, so `false` means exactly
 * that, and a real failure (rate limit, network, permissions) throws and fails the run
 * instead of being mistaken for it.
 */
const addThread = (input: Record<string, unknown>): boolean => {
  const data = graphql<{ addPullRequestReviewThread: { thread: { id: string } | null } | null }>(ADD_THREAD, { input });
  return Boolean(data.addPullRequestReviewThread?.thread);
};

/**
 * Attaches a finding to the review at the most precise place GitHub accepts: its range of
 * lines, then its last line alone (a range that crosses into unchanged code is refused as
 * a whole), then the file. Every finding is on a file the pull request changes, which
 * `reconcile` checked, and GitHub accepts a comment on any such file, so each one ends up
 * in a thread.
 */
const placeFinding = (reviewId: string, finding: Finding): 'line' | 'file' => {
  const onLine = { pullRequestReviewId: reviewId, path: finding.path, line: finding.line, side: finding.side };
  const body = formatFinding(finding.severity, finding.body);
  if (finding.startLine && addThread({ ...onLine, startLine: finding.startLine, startSide: finding.side, body })) {
    return 'line';
  }
  if (addThread({ ...onLine, body })) {
    return 'line';
  }
  const onFile = addThread({
    pullRequestReviewId: reviewId,
    path: finding.path,
    subjectType: 'FILE',
    body: formatFinding(finding.severity, `\`${location(finding)}\`\n\n${withoutSuggestions(finding.body)}`),
  });
  if (!onFile) {
    throw new Error(`GitHub did not accept a comment on ${finding.path}, although the pull request changes that file.`);
  }
  return 'file';
};

const submit = (reviewId: string, event: Verdict | 'COMMENT', body: string): string => {
  return graphql<{ submitPullRequestReview: { pullRequestReview: { url: string } } }>(SUBMIT_REVIEW, { reviewId, event, body })
    .submitPullRequestReview.pullRequestReview.url;
};

const message = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

/**
 * Deletes a posted review file, and its directory when fetch-review-state.ts made it.
 */
const discard = (file: string): void => {
  try {
    rmSync(file);
    const directory = path.dirname(path.resolve(file));
    if (path.basename(directory).startsWith(REVIEW_DIRECTORY_PREFIX)) {
      rmdirSync(directory);
    }
  } catch {
    // The review is posted either way, and a leftover file in a temporary directory does no harm.
  }
};

const main = (): number => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = args.find((arg) => !arg.startsWith('--'));
  if (!file) {
    process.stderr.write('Usage: node submit-review.ts [--dry-run] <review.json>\n');
    return 1;
  }

  try {
    const review = parseReview(readFileSync(file, 'utf8'));
    const state = fetchReviewState(review.repository, review.pullRequest);
    const answered = reconcile(review, state);

    // GitHub hides a review's comments along with its summary, so a summary stays up while one of its threads is open.
    const resolving = new Set(answered.filter(({ answer }) => answer.status === 'resolved').map(({ thread }) => thread.id));
    const finished = state.previousSummaries.filter((summary) => summary.openThreadIds.every((id) => resolving.has(id)));

    const blocking = [
      ...review.findings.map((finding) => finding.severity),
      ...answered.filter(({ answer }) => answer.status === 'open').map(({ severity }) => severity),
    ].includes('must');
    const verdict: Verdict = blocking ? 'REQUEST_CHANGES' : 'APPROVE';
    // GitHub rejects a verdict on your own pull request, which happens when the skill is run locally by the author.
    const isAuthor = state.viewer !== null && isSameAccount(state.viewer, state.pullRequest.author);

    if (dryRun) {
      process.stdout.write(
        [
          'The review is valid. Nothing was posted.',
          `Pull request: ${state.pullRequest.url}`,
          `Verdict: ${VERDICTS[verdict]}${isAuthor ? ' (will be posted as a comment, because the pull request is your own)' : ''}`,
          `New findings: ${review.findings.length}`,
          ...review.findings.map((finding) => `  - ${SEVERITIES[finding.severity].emoji} ${location(finding)}`),
          `Earlier threads answered: ${answered.length}`,
          ...answered.map(({ thread, answer }) => `  - ${answer.status === 'resolved' ? '✅ resolve' : '🔁 keep open'} ${thread.path} (${thread.id})`),
          `Earlier summaries to hide as outdated: ${finished.length} of ${state.previousSummaries.length}${finished.length < state.previousSummaries.length ? ' (the others still have open threads)' : ''}`,
          ...(state.pendingReview ? ['A pending review left behind by an interrupted run will be discarded first.'] : []),
          '',
        ].join('\n'),
      );
      return 0;
    }

    if (state.pendingReview) {
      graphql(DELETE_REVIEW, { reviewId: state.pendingReview.id });
    }

    // Everything goes into one pending review, so the author gets a single notification.
    const reviewId = graphql<{ addPullRequestReview: { pullRequestReview: { id: string } } }>(ADD_REVIEW, {
      pullRequestId: state.pullRequest.id,
      commitOID: review.headSha,
    }).addPullRequestReview.pullRequestReview.id;

    const warnings: string[] = [];
    let url = '';
    let event: Verdict | 'COMMENT' = isAuthor ? 'COMMENT' : verdict;
    try {
      for (const { thread, answer } of answered) {
        graphql(ADD_REPLY, { reviewId, threadId: thread.id, body: `${THREAD_PREFIXES[answer.status]}\n\n${answer.body.trim()}` });
      }
      for (const finding of review.findings) {
        if (placeFinding(reviewId, finding) === 'file') {
          warnings.push(`${location(finding)} is not part of the diff, so the finding was posted on the file.`);
        }
      }
      try {
        url = submit(reviewId, event, composeSummary(review, answered, isAuthor ? verdict : undefined));
      } catch (error) {
        // Only a refusal of the verdict itself falls back. Any other failure, such as a rate limit, fails the run,
        // because posting it as a comment would quietly turn a blocking review into one that does not block.
        if (event === 'COMMENT' || !VERDICT_REFUSED.test(message(error))) {
          throw error;
        }
        // Some tokens may comment but not approve or request changes. The comments still matter, so fall back.
        warnings.push(`GitHub did not accept "${VERDICTS[verdict]}" (${message(error)}), so the review was posted as a comment.`);
        event = 'COMMENT';
        url = submit(reviewId, event, composeSummary(review, answered, verdict));
      }
    } catch (error) {
      // Leave no half-written pending review behind, as it would block the next run.
      try {
        graphql(DELETE_REVIEW, { reviewId });
      } catch {
        process.stderr.write(`A pending review was left on the pull request and must be discarded by hand: ${state.pullRequest.url}\n`);
      }
      throw error;
    }

    const unresolved = new Set<string>();
    for (const { thread, answer } of answered) {
      if (answer.status !== 'resolved') {
        continue;
      }
      try {
        graphql(RESOLVE_THREAD, { threadId: thread.id });
      } catch (error) {
        unresolved.add(thread.id);
        warnings.push(`Could not resolve the thread ${thread.url}: ${message(error)}`);
      }
    }

    // A comment does not replace this account's earlier request for changes, which would keep blocking the
    // pull request under a summary that says "Approve". Dismissing it is what an approval would have done,
    // and no more than that: a request for changes by another account, such as the review bot's, stays.
    if (verdict === 'APPROVE' && event === 'COMMENT') {
      for (const earlier of state.changesRequested) {
        try {
          graphql(DISMISS_REVIEW, { reviewId: earlier.id, message: `Superseded by ${url}, which found nothing left that must be fixed.` });
        } catch (error) {
          warnings.push(`The earlier request for changes ${earlier.url} still blocks the pull request and could not be dismissed: ${message(error)}`);
        }
      }
    }

    // Hidden only now that the new summary is up, so the pull request is never left without one.
    const hidden = finished.filter((summary) => !summary.openThreadIds.some((id) => unresolved.has(id)));
    for (const summary of hidden) {
      try {
        graphql(MINIMIZE, { subjectId: summary.id });
      } catch (error) {
        warnings.push(`Could not hide the earlier summary ${summary.url}: ${message(error)}`);
      }
    }

    discard(file);
    process.stdout.write(
      [
        `Posted: ${url}`,
        `Verdict: ${VERDICTS[verdict]}${event === 'COMMENT' ? ' (posted as a comment)' : ''}`,
        `New findings: ${review.findings.length}`,
        `Earlier threads resolved: ${answered.filter(({ answer }) => answer.status === 'resolved').length} of ${answered.length}`,
        `Earlier summaries hidden: ${hidden.length} of ${state.previousSummaries.length}`,
        ...warnings.map((warning) => `Warning: ${warning}`),
        '',
      ].join('\n'),
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${message(error)}\n`);
    return 1;
  }
};

process.exitCode = main();
