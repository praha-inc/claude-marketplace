/**
 * Shared helpers for the pr-reviewer scripts: calling GitHub through `gh`, the markers and
 * severity prefixes that identify this plugin's comments, and reading the state an earlier
 * review left on a pull request.
 */
import { spawnSync } from 'node:child_process';

export type Severity = 'must' | 'should' | 'nit';

export type Author = {
  login: string;
  isBot: boolean;
};

export type OpenThread = {
  id: string;
  url: string;
  path: string;
  /** The line the thread is attached to, or null when that line is no longer part of the diff. */
  line: number | null;
  /** The line the thread was left on, in the version of the file that was reviewed then. */
  originalLine: number | null;
  /** The part of the diff the finding was left on, which helps to find the code after it moved. */
  diffHunk: string;
  /** Whether the code the thread was left on has changed since. */
  isOutdated: boolean;
  /** The severity of the original finding, or null when the comment does not carry one. */
  severity: Severity | null;
  /** The finding followed by the replies. Of a very long thread, only the finding and the newest replies. */
  comments: { author: string; createdAt: string; body: string }[];
  /** How many replies between the finding and the newest ones were left out. */
  omittedComments: number;
};

export type PreviousSummary = {
  id: string;
  url: string;
  state: string;
  submittedAt: string | null;
  /** The threads this review started that are not resolved yet. */
  openThreadIds: string[];
};

export type ReviewState = {
  repository: string;
  pullRequest: {
    id: string;
    number: number;
    url: string;
    title: string;
    state: string;
    isDraft: boolean;
    author: string;
    headSha: string;
    headRef: string;
    baseRef: string;
  };
  /** The login the review will be posted as, or null when the token cannot tell. */
  viewer: string | null;
  /**
   * The paths of the files the pull request changes. GitHub only accepts a review comment on
   * one of these, so they are the only files a finding can be placed on.
   */
  changedFiles: string[];
  /** Unresolved threads started by an earlier review, each of which the next review must answer. */
  openThreads: OpenThread[];
  resolvedThreadCount: number;
  /**
   * Summaries of earlier reviews that are still visible. GitHub hides the comments of a review
   * together with its summary, so a summary is only hidden once all its threads are resolved.
   */
  previousSummaries: PreviousSummary[];
  /**
   * A review this account started on the pull request and has not submitted. GitHub allows
   * one per account, so a new review cannot be started while it exists.
   */
  pendingReview: { id: string; isBot: boolean } | null;
  /**
   * Earlier reviews by the account that posts this one which requested changes and have not been
   * dismissed. Those of another account are left alone, as an approval would leave them.
   */
  changesRequested: { id: string; url: string }[];
};

export const SEVERITIES: Record<Severity, { emoji: string; label: string }> = {
  must: { emoji: '🔴', label: 'Must fix' },
  should: { emoji: '🟡', label: 'Should fix' },
  nit: { emoji: '🔵', label: 'Optional' },
};

/** The start of the name of the temporary directory that holds a review file. */
export const REVIEW_DIRECTORY_PREFIX = 'pr-reviewer-';

export const SUMMARY_MARKER = '<!-- pr-reviewer:summary -->';

const FINDING_MARKER = /<!-- pr-reviewer:finding severity=(must|should|nit) -->/;
/** The marker `formatFinding` writes: the one that ends the comment, not one the text of the finding may quote. */
const FINAL_FINDING_MARKER = /<!-- pr-reviewer:finding severity=(must|should|nit) -->\s*$/;
const REPOSITORY = /^(?:([\w.-]+)\/)?([\w.-]+)\/([\w.-]+)$/;
const PULL_REQUEST_URL = /^https:\/\/([\w.-]+)\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;
const BOT_SUFFIX = /\[bot\]$/;
const REVIEW_BOT = 'claude';
/** What GitHub answers when a token of an app or of GitHub Actions asks for something it may not see. */
const NOT_ACCESSIBLE = /not accessible by integration/i;

export const isSeverity = (value: unknown): value is Severity => {
  return value === 'must' || value === 'should' || value === 'nit';
};

/**
 * Formats the body of an inline comment: the severity first, so it can be read at a glance,
 * and a hidden marker last, so a later review can tell how severe the finding was.
 */
export const formatFinding = (severity: Severity, body: string): string => {
  const { emoji, label } = SEVERITIES[severity];
  return `${emoji} **${label}**\n\n${body.trim()}\n\n<!-- pr-reviewer:finding severity=${severity} -->`;
};

/**
 * Reads the severity of a finding from its comment, falling back to the leading emoji for
 * comments whose marker was lost, for example when someone edited the comment.
 */
export const parseSeverity = (body: string): Severity | null => {
  const marked = FINAL_FINDING_MARKER.exec(body)?.[1];
  if (isSeverity(marked)) {
    return marked;
  }
  const trimmed = body.trimStart();
  for (const severity of ['must', 'should', 'nit'] as const) {
    if (trimmed.startsWith(SEVERITIES[severity].emoji)) {
      return severity;
    }
  }
  return null;
};

export const hasMarker = (body: string): boolean => {
  return FINDING_MARKER.test(body) || body.includes(SUMMARY_MARKER);
};

/**
 * Says why a `gh` call failed. When gh could not be started there is no output at all, only the error.
 */
const failure = (result: { stderr: string | null; error?: Error }): string => {
  return `${result.stderr ?? ''}${result.error?.message ?? ''}`.trim();
};

export const gh = (args: string[], input?: string): string => {
  const result = spawnSync('gh', args, { encoding: 'utf8', input: input ?? '', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed:\n${failure(result)}`);
  }
  return result.stdout.trim();
};

type GraphqlResponse<T> = {
  data?: T | null;
  errors?: { message?: string }[];
};

/**
 * Runs a GraphQL query or mutation. A response that carries errors is treated as a failure
 * even when it also carries data, because a mutation that half-succeeded must not be counted.
 */
export const graphql = <T>(query: string, variables: Record<string, unknown>): T => {
  const result = spawnSync('gh', ['api', 'graphql', '--input', '-'], {
    encoding: 'utf8',
    input: JSON.stringify({ query, variables }),
    maxBuffer: 64 * 1024 * 1024,
  });

  let response: GraphqlResponse<T> = {};
  try {
    // Without output, as when gh could not be started, this parses to null and not to a response.
    response = (JSON.parse(result.stdout) as GraphqlResponse<T> | null) ?? {};
  } catch {
    // gh printed something other than a response, which is reported from stderr below.
  }

  const messages = (response.errors ?? []).map((error) => error.message ?? 'Unknown error');
  if (result.status !== 0 || 0 < messages.length || response.data === undefined || response.data === null) {
    const reason = 0 < messages.length ? messages.join('; ') : failure(result);
    throw new Error(`GitHub GraphQL request failed: ${reason || 'no data returned'}`);
  }
  return response.data;
};

/**
 * Splits a repository written as `owner/repo` or as `host/owner/repo`. A host is passed on
 * to `gh` for every later call of this process, which would otherwise ask the host it is
 * configured for (github.com, or the `GH_HOST` of the environment) about a repository that
 * lives elsewhere. Without a host, that configuration is what decides.
 */
export const splitRepository = (repository: string): { owner: string; name: string } => {
  const [, host, owner, name] = REPOSITORY.exec(repository) ?? [];
  if (!owner || !name) {
    throw new Error(`Expected a repository as owner/repo or host/owner/repo, but got: ${repository || '(empty)'}`);
  }
  if (host) {
    process.env['GH_HOST'] = host;
  }
  return { owner, name };
};

/**
 * Reads the repository and the number from the URL of a pull request on any host, with
 * the repository in the form `splitRepository` takes. The host is kept even for github.com,
 * so that a URL always decides which host is asked.
 */
export const parsePullRequestUrl = (url: string): { repository: string; number: number } | undefined => {
  const [, host, repository, number] = PULL_REQUEST_URL.exec(url) ?? [];
  if (!host || !repository || !number) {
    return undefined;
  }
  return { repository: `${host}/${repository}`, number: Number(number) };
};

type AuthorNode = { login: string; __typename: string } | null;

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

type CommentNode = { url: string; body: string; createdAt: string; author: AuthorNode };

type ThreadNode = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  finding: { nodes: (CommentNode & { diffHunk: string; pullRequestReview: { id: string } | null })[] };
  replies: { totalCount: number; nodes: CommentNode[] };
};

type ReviewNode = {
  id: string;
  url: string;
  body: string;
  state: string;
  isMinimized: boolean;
  submittedAt: string | null;
  author: AuthorNode;
};

type PullRequestNode = {
  id: string;
  number: number;
  url: string;
  title: string;
  state: string;
  isDraft: boolean;
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
  author: AuthorNode;
};

const PULL_REQUEST_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id number url title state isDraft headRefOid headRefName baseRefName
      author { login __typename }
    }
  }
}`;

const THREADS_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line originalLine
          finding: comments(first: 1) {
            nodes { url body createdAt diffHunk author { login __typename } pullRequestReview { id } }
          }
          replies: comments(last: 50) {
            totalCount
            nodes { url body createdAt author { login __typename } }
          }
        }
      }
    }
  }
}`;

const FILES_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      files(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { path }
      }
    }
  }
}`;

const REVIEWS_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id url body state isMinimized submittedAt
          author { login __typename }
        }
      }
    }
  }
}`;

const normalize = (login: string): string => {
  return login.replace(BOT_SUFFIX, '').toLowerCase();
};

const toAuthor = (node: AuthorNode): Author => {
  return { login: node?.login ?? 'ghost', isBot: node?.__typename === 'Bot' };
};

/**
 * Returns the login the token acts as, or null for a token that GitHub does not let ask,
 * in which case earlier reviews are recognised by the review bot's login alone.
 *
 * Any other failure is thrown. Carrying on without the login would make a person's own
 * earlier review invisible, and the run would post the same findings a second time.
 */
const fetchViewer = (): string | null => {
  try {
    return graphql<{ viewer: { login: string } }>('query { viewer { login } }', {}).viewer.login;
  } catch (error) {
    if (error instanceof Error && NOT_ACCESSIBLE.test(error.message)) {
      return null;
    }
    throw error;
  }
};

/**
 * Collects every node of a connection on the pull request, following its cursors.
 */
const fetchAll = <N>(
  query: string,
  variables: Record<string, unknown>,
  pick: (pullRequest: Record<string, { pageInfo: PageInfo; nodes: (N | null)[] }>) => { pageInfo: PageInfo; nodes: (N | null)[] } | undefined,
): N[] => {
  const nodes: N[] = [];
  let cursor: string | null = null;
  for (;;) {
    const data: { repository: { pullRequest: Record<string, { pageInfo: PageInfo; nodes: (N | null)[] }> | null } | null } = graphql(
      query,
      { ...variables, cursor },
    );
    const connection = data.repository?.pullRequest ? pick(data.repository.pullRequest) : undefined;
    if (!connection) {
      return nodes;
    }
    nodes.push(...connection.nodes.filter((node) => node !== null));
    if (!connection.pageInfo.hasNextPage) {
      return nodes;
    }
    cursor = connection.pageInfo.endCursor;
  }
};

/**
 * Reads what earlier reviews left on a pull request: the threads that are still open and
 * the summaries that are still visible.
 *
 * A comment counts as an earlier review's when it carries this plugin's marker and was
 * written by the review bot (claude[bot]) or by the current user. The marker is required
 * because both write other comments too: the bot is shared with other Claude integrations,
 * and a person running the skill locally must never have their own hand-written review
 * threads answered and resolved for them.
 */
export const fetchReviewState = (repository: string, number: number): ReviewState => {
  const { owner, name } = splitRepository(repository);
  const variables = { owner, name, number };

  const pullRequest = graphql<{ repository: { pullRequest: PullRequestNode | null } | null }>(PULL_REQUEST_QUERY, variables)
    .repository?.pullRequest;
  if (!pullRequest) {
    throw new Error(`Pull request #${number} was not found in ${repository}.`);
  }

  const viewer = fetchViewer();
  const isOurs = (node: AuthorNode, body: string): boolean => {
    if (!hasMarker(body)) {
      return false;
    }
    const author = toAuthor(node);
    if (author.isBot && normalize(author.login) === REVIEW_BOT) {
      return true;
    }
    return viewer !== null && normalize(author.login) === normalize(viewer);
  };

  const allThreads = fetchAll<ThreadNode>(THREADS_QUERY, variables, (node) => node['reviewThreads']);
  const threads = allThreads.filter((thread) => {
    const finding = thread.finding.nodes[0];
    return finding !== undefined && isOurs(finding.author, finding.body);
  });

  const reviews = fetchAll<ReviewNode>(REVIEWS_QUERY, variables, (node) => node['reviews']);
  // GitHub only shows a pending review to the account that started it, so one in the list is this account's.
  const pending = reviews.find((review) => review.state === 'PENDING');

  return {
    repository,
    pullRequest: {
      id: pullRequest.id,
      number: pullRequest.number,
      url: pullRequest.url,
      title: pullRequest.title,
      state: pullRequest.state,
      isDraft: pullRequest.isDraft,
      author: toAuthor(pullRequest.author).login,
      headSha: pullRequest.headRefOid,
      headRef: pullRequest.headRefName,
      baseRef: pullRequest.baseRefName,
    },
    viewer,
    changedFiles: fetchAll<{ path: string }>(FILES_QUERY, variables, (node) => node['files']).map((file) => file.path),
    openThreads: threads
      .filter((thread) => !thread.isResolved)
      .map((thread) => {
        // The newest comments matter most for a follow-up, so those are what a long thread keeps besides its finding.
        const finding = thread.finding.nodes[0];
        const replies = thread.replies.nodes.filter((comment) => comment.url !== finding?.url);
        return {
          id: thread.id,
          url: finding?.url ?? '',
          path: thread.path,
          line: thread.line,
          originalLine: thread.originalLine,
          diffHunk: finding?.diffHunk ?? '',
          isOutdated: thread.isOutdated,
          severity: parseSeverity(finding?.body ?? ''),
          comments: [...(finding ? [finding] : []), ...replies].map((comment) => ({
            author: toAuthor(comment.author).login,
            createdAt: comment.createdAt,
            body: comment.body,
          })),
          omittedComments: thread.replies.totalCount - 1 - replies.length,
        };
      }),
    resolvedThreadCount: threads.filter((thread) => thread.isResolved).length,
    previousSummaries: reviews
      .filter((review) => !review.isMinimized && review.state !== 'PENDING' && review.body.includes(SUMMARY_MARKER))
      .filter((review) => isOurs(review.author, review.body))
      .map((review) => ({
        id: review.id,
        url: review.url,
        state: review.state,
        submittedAt: review.submittedAt,
        openThreadIds: allThreads
          .filter((thread) => !thread.isResolved && thread.finding.nodes[0]?.pullRequestReview?.id === review.id)
          .map((thread) => thread.id),
      })),
    pendingReview: pending ? { id: pending.id, isBot: toAuthor(pending.author).isBot } : null,
    changesRequested: reviews
      .filter((review) => review.state === 'CHANGES_REQUESTED' && isOurs(review.author, review.body))
      // Without a login to compare with, the token is the review bot's, whose reviews are the ones that passed above.
      .filter((review) => viewer === null || normalize(toAuthor(review.author).login) === normalize(viewer))
      .map((review) => ({ id: review.id, url: review.url })),
  };
};

/**
 * Whether the two logins are the same account, ignoring the `[bot]` suffix that only some APIs add.
 */
export const isSameAccount = (left: string, right: string): boolean => {
  return normalize(left) === normalize(right);
};
