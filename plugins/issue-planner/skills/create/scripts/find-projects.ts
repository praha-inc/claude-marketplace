/**
 * Lists the open GitHub Projects an issue of a repository could be added to, as JSON:
 * `linked` holds the projects linked to the repository, `others` the owner's other projects.
 *
 * Usage: node find-projects.ts [owner/repo]
 */
import { spawnSync } from 'node:child_process';

type Project = {
  number: number;
  title: string;
  url: string;
  closed: boolean;
};

const PROJECT_FIELDS = 'number title url closed';

const LINKED_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 50) { nodes { ${PROJECT_FIELDS} } }
  }
}`;

const OWNER_QUERY = `
query($owner: String!) {
  repositoryOwner(login: $owner) {
    ... on ProjectV2Owner {
      projectsV2(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PROJECT_FIELDS} } }
    }
  }
}`;

const gh = (args: string[]): string => {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${result.stderr}${result.error?.message ?? ''}`.trim());
  }
  return result.stdout.trim();
};

const isProject = (value: unknown): value is Project => {
  return typeof value === 'object' && value !== null && 'number' in value && 'url' in value;
};

/**
 * Runs a query and returns the open projects found anywhere under `projectsV2.nodes` in its response.
 */
const queryProjects = (query: string, variables: Record<string, string>): Project[] => {
  const output = gh([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    ...Object.entries(variables).flatMap(([key, value]) => ['-f', `${key}=${value}`]),
    '--jq',
    '[.. | .projectsV2? | select(. != null) | .nodes[] | select(. != null)]',
  ]);
  const parsed: unknown = JSON.parse(output);
  const projects: unknown[] = Array.isArray(parsed) ? parsed : [];
  return projects.filter((project) => isProject(project)).filter((project) => !project.closed);
};

const main = (): number => {
  try {
    const repository = process.argv[2] ?? gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    const [owner, name] = repository.split('/');
    if (!owner || !name) {
      throw new Error(`Expected a repository as owner/repo, but got: ${repository}`);
    }

    const linked = queryProjects(LINKED_QUERY, { owner, name });
    const linkedUrls = new Set(linked.map((project) => project.url));
    const others = queryProjects(OWNER_QUERY, { owner }).filter((project) => !linkedUrls.has(project.url));

    const format = ({ number, title, url }: Project) => ({ number, title, url });
    process.stdout.write(`${JSON.stringify({ repository, linked: linked.map(format), others: others.map(format) }, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // GitHub repeats a scope error for every requested field, so the first line is enough.
    process.stderr.write(`Failed to list projects: ${message.split('\n')[0] ?? ''}\n`);
    if (/INSUFFICIENT_SCOPES|read:project|required scopes/i.test(message)) {
      process.stderr.write('The GitHub token lacks the project scope. The user can grant it with: gh auth refresh -s project\n');
    }
    return 1;
  }
};

process.exitCode = main();
