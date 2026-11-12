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
  /** Whether the code the thread was left on has changed since. */
  isOutdated: boolean;
  /** The severity of the original finding, or null when the comment does not carry one. */
  severity: Severity | null;
  comments: { author: string; createdAt: string; body: string }[];
};

export type PreviousSummary = {
  id: string;
  url: string;
  state: string;
  submittedAt: string | null;
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
  /** Unresolved threads started by an earlier review, each of which the next review must answer. */
  openThreads: OpenThread[];
  resolvedThreadCount: number;
  /** Summaries of earlier reviews that are still visible. */
  previousSummaries: PreviousSummary[];
  /** Earlier reviews that requested changes and have not been dismissed. */
  changesRequested: { id: string; url: string }[];
};

export const SEVERITIES: Record<Severity, { emoji: string; label: string }> = {
  must: { emoji: '🔴', label: 'Must fix' },
  should: { emoji: '🟡', label: 'Should fix' },
  nit: { emoji: '🔵', label: 'Optional' },
};

export const SUMMARY_MARKER = '<!-- pr-reviewer:summary -->';

const FINDING_MARKER = /<!-- pr-reviewer:finding severity=(must|should|nit) -->/;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;
const BOT_SUFFIX = /\[bot\]$/;
const REVIEW_BOT = 'claude';

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
  const marked = FINDING_MARKER.exec(body)?.[1];
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

export const gh = (args: string[], input?: string): string => {
  const result = spawnSync('gh', args, { encoding: 'utf8', input: input ?? '', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed:\n${`${result.stderr}${result.error?.message ?? ''}`.trim()}`);
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
    response = JSON.parse(result.stdout) as GraphqlResponse<T>;
  } catch {
    // gh printed something other than a response, which is reported from stderr below.
  }

  const messages = (response.errors ?? []).map((error) => error.message ?? 'Unknown error');
  if (result.status !== 0 || 0 < messages.length || response.data === undefined || response.data === null) {
    const reason = 0 < messages.length ? messages.join('; ') : `${result.stderr}${result.error?.message ?? ''}`.trim();
    throw new Error(`GitHub GraphQL request failed: ${reason || 'no data returned'}`);
  }
  return response.data;
};

export const splitRepository = (repository: string): { owner: string; name: string } => {
  const [owner, name] = repository.split('/');
  if (!REPOSITORY.test(repository) || !owner || !name) {
    throw new Error(`Expected a repository as owner/repo, but got: ${repository || '(empty)'}`);
  }
  return { owner, name };
};

type AuthorNode = { login: string; __typename: string } | null;

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

type ThreadNode = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  comments: {
    nodes: { url: string; body: string; createdAt: string; author: AuthorNode }[];
  };
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
          id isResolved isOutdated path line
          comments(first: 50) {
            nodes { url body createdAt author { login __typename } }
          }
        }
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
 * Returns the login the token acts as. Some tokens used in CI are not allowed to ask, in
 * which case earlier reviews are recognised by the review bot's login alone.
 */
const fetchViewer = (): string | null => {
  try {
    return graphql<{ viewer: { login: string } }>('query { viewer { login } }', {}).viewer.login;
  } catch {
    return null;
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
 * A comment counts as an earlier review's when the review bot (claude[bot]) wrote it, or
 * when the current user wrote it and it carries this plugin's marker. The marker is required
 * for the current user so that a person running the skill locally never has their own
 * hand-written review threads answered and resolved for them.
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
    const author = toAuthor(node);
    if (author.isBot && normalize(author.login) === REVIEW_BOT) {
      return true;
    }
    return viewer !== null && normalize(author.login) === normalize(viewer) && hasMarker(body);
  };

  const threads = fetchAll<ThreadNode>(THREADS_QUERY, variables, (node) => node['reviewThreads']).filter((thread) => {
    const first = thread.comments.nodes[0];
    return first !== undefined && isOurs(first.author, first.body);
  });

  const reviews = fetchAll<ReviewNode>(REVIEWS_QUERY, variables, (node) => node['reviews']);

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
    openThreads: threads
      .filter((thread) => !thread.isResolved)
      .map((thread) => ({
        id: thread.id,
        url: thread.comments.nodes[0]?.url ?? '',
        path: thread.path,
        line: thread.line,
        isOutdated: thread.isOutdated,
        severity: parseSeverity(thread.comments.nodes[0]?.body ?? ''),
        comments: thread.comments.nodes.map((comment) => ({
          author: toAuthor(comment.author).login,
          createdAt: comment.createdAt,
          body: comment.body,
        })),
      })),
    resolvedThreadCount: threads.filter((thread) => thread.isResolved).length,
    previousSummaries: reviews
      .filter((review) => !review.isMinimized && review.state !== 'PENDING' && review.body.includes(SUMMARY_MARKER))
      .filter((review) => isOurs(review.author, review.body))
      .map((review) => ({ id: review.id, url: review.url, state: review.state, submittedAt: review.submittedAt })),
    changesRequested: reviews
      .filter((review) => review.state === 'CHANGES_REQUESTED' && isOurs(review.author, review.body))
      .map((review) => ({ id: review.id, url: review.url })),
  };
};

/**
 * Whether the two logins are the same account, ignoring the `[bot]` suffix that only some APIs add.
 */
export const isSameAccount = (left: string, right: string): boolean => {
  return normalize(left) === normalize(right);
};
