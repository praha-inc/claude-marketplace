/**
 * Prints, as JSON, what is needed to implement a GitHub issue and to decide how the pull
 * request should refer to it: the issue with its latest comments, its parent, its sub-issues,
 * the issues that block it, and the open pull requests that already close it. Nothing on
 * GitHub is changed.
 *
 * Usage: node fetch-issue.ts <issue URL>
 *        node fetch-issue.ts <issue number> [owner/repo]
 *
 * With a number alone, the repository of the current directory is used.
 */
import { spawnSync } from 'node:child_process';

type RelatedIssue = {
  number: number;
  title: string;
  state: string;
  url: string;
};

type Comment = {
  author: { login: string } | null;
  createdAt: string;
  body: string;
};

type PullRequest = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  headRefName: string;
  author: { login: string } | null;
};

type Issue = RelatedIssue & {
  body: string;
  stateReason: string | null;
  author: { login: string } | null;
  labels: { nodes: { name: string }[] };
  comments: { totalCount: number; nodes: Comment[] };
  parent: RelatedIssue | null;
  subIssues: { totalCount: number; nodes: RelatedIssue[] };
  blockedBy: { totalCount: number; nodes: RelatedIssue[] };
  closedByPullRequestsReferences: { nodes: PullRequest[] };
};

type Response = {
  data?: {
    repository: {
      nameWithOwner: string;
      defaultBranchRef: { name: string } | null;
      issue: Issue | null;
    } | null;
  };
  errors?: { message: string }[];
};

/** The newest comments are the ones kept, because decisions made in a thread come last. */
const COMMENT_LIMIT = 30;
const RELATED_LIMIT = 100;

const RELATED_FIELDS = 'number title state url';

const QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    defaultBranchRef { name }
    issue(number: $number) {
      ${RELATED_FIELDS}
      body
      stateReason
      author { login }
      labels(first: 50) { nodes { name } }
      comments(last: ${COMMENT_LIMIT}) { totalCount nodes { author { login } createdAt body } }
      parent { ${RELATED_FIELDS} }
      subIssues(first: ${RELATED_LIMIT}) { totalCount nodes { ${RELATED_FIELDS} } }
      blockedBy(first: ${RELATED_LIMIT}) { totalCount nodes { ${RELATED_FIELDS} } }
      closedByPullRequestsReferences(first: 20, includeClosedPrs: false) {
        nodes { number title url isDraft headRefName author { login } }
      }
    }
  }
}`;

const ISSUE_URL = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/issues\/(\d+)(?:[/?#].*)?$/;

const USAGE = 'Usage: node fetch-issue.ts <issue URL>\n       node fetch-issue.ts <issue number> [owner/repo]\n';

const gh = (args: string[]): string => {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`Could not run gh: ${result.error.message}`);
  }
  // A GraphQL error comes with a response on stdout, which says more than the exit status.
  if (result.status !== 0 && !result.stdout.trim()) {
    throw new Error(result.stderr.trim() || `gh exited with status ${result.status}`);
  }
  return result.stdout.trim();
};

/**
 * The repository of the current directory, with its host, which `gh` finds through the git
 * remote.
 */
const currentRepository = (): { host: string; repository: string } => {
  const url = new URL(gh(['repo', 'view', '--json', 'url', '--jq', '.url']));
  return { host: url.host, repository: url.pathname.slice(1) };
};

const resolveTarget = (target: string, repository?: string): { host?: string; repository: string; number: number } | null => {
  const [, host, fromUrl, number] = ISSUE_URL.exec(target) ?? [];
  if (host && fromUrl && number) {
    return { host, repository: fromUrl, number: Number(number) };
  }
  if (!/^\d+$/.test(target)) {
    return null;
  }
  return { ...(repository ? { repository } : currentRepository()), number: Number(target) };
};

const fetchIssue = (repository: string, number: number) => {
  const [owner, name] = repository.split('/');
  if (!owner || !name) {
    throw new Error(`Expected a repository as owner/repo, but got: ${repository}`);
  }

  const response = JSON.parse(
    gh(['api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`]),
  ) as Response;
  if (response.errors?.length) {
    throw new Error(response.errors.map((error) => error.message).join('\n'));
  }
  const found = response.data?.repository;
  if (!found?.issue) {
    throw new Error(`Issue #${number} was not found in ${repository}. A pull request is not an issue.`);
  }

  const { issue } = found;
  return {
    repository: found.nameWithOwner,
    defaultBranch: found.defaultBranchRef?.name ?? null,
    issue: {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      stateReason: issue.stateReason,
      url: issue.url,
      author: issue.author?.login ?? null,
      labels: issue.labels.nodes.map((label) => label.name),
      body: issue.body,
      comments: issue.comments.nodes.map((comment) => ({
        author: comment.author?.login ?? null,
        createdAt: comment.createdAt,
        body: comment.body,
      })),
      omittedComments: issue.comments.totalCount - issue.comments.nodes.length,
    },
    parent: issue.parent,
    subIssues: issue.subIssues.nodes,
    omittedSubIssues: issue.subIssues.totalCount - issue.subIssues.nodes.length,
    openBlockers: issue.blockedBy.nodes.filter((blocker) => blocker.state === 'OPEN'),
    omittedBlockers: issue.blockedBy.totalCount - issue.blockedBy.nodes.length,
    openPullRequests: issue.closedByPullRequestsReferences.nodes.map((pullRequest) => ({
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      isDraft: pullRequest.isDraft,
      headRef: pullRequest.headRefName,
      author: pullRequest.author?.login ?? null,
    })),
  };
};

const main = (): number => {
  const [target = '', repository] = process.argv.slice(2);
  try {
    const resolved = resolveTarget(target, repository);
    if (!resolved) {
      process.stderr.write(USAGE);
      return 1;
    }
    if (resolved.host) {
      // The host of the issue decides where to ask, not the one gh defaults to.
      process.env['GH_HOST'] = resolved.host;
    }
    process.stdout.write(`${JSON.stringify(fetchIssue(resolved.repository, resolved.number), null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
};

process.exitCode = main();
