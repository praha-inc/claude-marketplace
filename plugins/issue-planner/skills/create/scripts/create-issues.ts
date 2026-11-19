/**
 * Creates a parent issue and its sub-issues on GitHub from a draft Markdown file, links each
 * sub-issue to the parent, registers the "blocked by" dependencies between them, and adds
 * every issue to the GitHub Project named in the draft.
 *
 * Each created issue is recorded in the draft as a `URL:` line under its heading, so running
 * the script again after a failure continues where it stopped instead of creating duplicates.
 *
 * A body may show images that are files next to the draft, written as `![alt](./diagram.png)`.
 * They are uploaded with the issue, and GitHub CLI points the reference at the uploaded file.
 *
 * Usage: node create-issues.ts [--dry-run] <draft.md>
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Kind = 'Issue' | 'Sub-issue';

type DraftIssue = {
  kind: Kind;
  title: string;
  repository: string;
  /** Each entry is the position of a sub-issue in the draft (1 for the first), or the URL of an existing issue. */
  blockedBy: string[];
  url: string | undefined;
  body: string;
  /** The image files the body shows, each as the path written in the body, relative to the draft. */
  images: string[];
  /** Index of the line where a `URL:` line is inserted once the issue is created. */
  insertAt: number;
  /** Whether a blank line must be inserted before the `URL:` line to keep it apart from the heading. */
  needsBlankLine: boolean;
};

type Draft = {
  lines: string[];
  project: { owner: string; number: string } | undefined;
  issues: DraftIssue[];
};

const HEADING = /^# (Issue|Sub-issue):\s*(.*)$/;
const METADATA = /^(Repository|Blocked by|URL):\s*(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;
const ISSUE_URL = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/;
const PROJECT_URL = /^https:\/\/github\.com\/(?:orgs|users)\/([\w.-]+)\/projects\/(\d+)/;
const POSITION = /^\d+$/;
const IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;
/** A reference that already points somewhere on the web, or inside the page, is not a file to upload. */
const NOT_A_FILE = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i;

const gh = (args: string[], input?: string): string => {
  const result = spawnSync('gh', args, { encoding: 'utf8', input: input ?? '' });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed:\n${`${result.stderr}${result.error?.message ?? ''}`.trim()}`);
  }
  return result.stdout.trim();
};

const splitList = (value: string | undefined): string[] => {
  return (value ?? '').split(',').map((item) => item.trim()).filter((item) => 0 < item.length);
};

/**
 * Returns the local image files a body shows, leaving out references inside fenced code blocks.
 */
const findImages = (body: string): string[] => {
  const images = new Set<string>();
  let fenced = false;
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(IMAGE)) {
      if (match[1] && !NOT_A_FILE.test(match[1])) {
        images.add(match[1]);
      }
    }
  }
  return [...images];
};

const parseFrontmatter = (lines: string[]): { values: Map<string, string>; end: number } => {
  const values = new Map<string, string>();
  if (lines[0]?.trim() !== '---') {
    throw new Error('The draft must start with a frontmatter block (--- ... ---) that sets `repository`.');
  }
  const end = lines.findIndex((line, index) => 0 < index && line.trim() === '---');
  if (end === -1) {
    throw new Error('The frontmatter block is not closed with ---.');
  }
  for (const line of lines.slice(1, end)) {
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (match?.[1]) {
      values.set(match[1], (match[2] ?? '').trim());
    }
  }
  return { values, end };
};

const parseDraft = (content: string): Draft => {
  const lines = content.split('\n');
  const { values, end } = parseFrontmatter(lines);

  const defaultRepository = values.get('repository') ?? '';
  if (!REPOSITORY.test(defaultRepository)) {
    throw new Error(`\`repository\` in the frontmatter must be owner/repo, but got: ${defaultRepository || '(empty)'}`);
  }

  let project: Draft['project'];
  const projectUrl = values.get('project') ?? '';
  if (0 < projectUrl.length) {
    const match = PROJECT_URL.exec(projectUrl);
    if (!match?.[1] || !match[2]) {
      throw new Error(`\`project\` in the frontmatter must be a GitHub Project URL, but got: ${projectUrl}`);
    }
    project = { owner: match[1], number: match[2] };
  }

  // Find the headings that start an issue, ignoring ones inside fenced code blocks.
  const headings: number[] = [];
  let fenced = false;
  for (let index = end + 1; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (FENCE.test(line)) {
      fenced = !fenced;
    } else if (!fenced && HEADING.test(line)) {
      headings.push(index);
    }
  }

  const issues = headings.map((start, order): DraftIssue => {
    const match = HEADING.exec(lines[start] ?? '');
    const sectionEnd = headings[order + 1] ?? lines.length;

    // Metadata is the block of `Key: value` lines directly under the heading, ended by a blank line.
    let cursor = start + 1;
    while (cursor < sectionEnd && lines[cursor]?.trim() === '') {
      cursor++;
    }
    const metadataStart = cursor;
    const metadata = new Map<string, string>();
    while (cursor < sectionEnd) {
      const entry = METADATA.exec(lines[cursor] ?? '');
      if (!entry?.[1]) {
        break;
      }
      metadata.set(entry[1], (entry[2] ?? '').trim());
      cursor++;
    }
    const hasMetadata = metadataStart < cursor;
    const body = lines.slice(cursor, sectionEnd).join('\n').trim();

    return {
      kind: match?.[1] === 'Issue' ? 'Issue' : 'Sub-issue',
      title: (match?.[2] ?? '').trim(),
      repository: metadata.get('Repository') || defaultRepository,
      blockedBy: splitList(metadata.get('Blocked by')),
      url: metadata.get('URL') || undefined,
      body,
      images: findImages(body),
      insertAt: hasMetadata ? metadataStart : start + 1,
      needsBlankLine: !hasMetadata,
    };
  });

  return { lines, project, issues };
};

const validate = (draft: Draft, directory: string): void => {
  const problems: string[] = [];
  const [first, ...rest] = draft.issues;
  if (first?.kind !== 'Issue') {
    problems.push('The draft must begin with a `# Issue: <title>` section.');
  }
  if (rest.some((issue) => issue.kind === 'Issue')) {
    problems.push('The draft must contain exactly one `# Issue:` section. Use `# Sub-issue:` for the others.');
  }
  for (const [index, issue] of draft.issues.entries()) {
    const name = `${issue.kind} "${issue.title}"`;
    if (issue.title.length <= 0) {
      problems.push(`A ${issue.kind} section has no title.`);
    }
    if (issue.body.length <= 0) {
      problems.push(`${name} has no body.`);
    }
    if (!REPOSITORY.test(issue.repository)) {
      problems.push(`${name} has an invalid Repository: ${issue.repository}`);
    }
    if (issue.url && !ISSUE_URL.test(issue.url)) {
      problems.push(`${name} has an invalid URL: ${issue.url}`);
    }
    // An image is only uploaded when its issue is created, so one that is already created needs no file.
    for (const image of issue.url ? [] : issue.images) {
      if (!existsSync(path.resolve(directory, image))) {
        problems.push(`${name} shows the image ${image}, but there is no such file next to the draft. Write the path relative to the draft, or remove the image.`);
      }
    }
    for (const blocker of issue.blockedBy) {
      if (ISSUE_URL.test(blocker)) {
        continue;
      }
      // The parent is at index 0, so a sub-issue's own position equals its index. Allowing
      // only earlier positions keeps the draft workable from top to bottom and rules out cycles.
      if (!POSITION.test(blocker) || Number(blocker) < 1 || index <= Number(blocker)) {
        problems.push(
          `${name} has an invalid Blocked by entry: ${blocker}. Use the position of a sub-issue above it (1 for the first sub-issue) or the URL of an existing issue.`,
        );
      }
    }
  }

  if (0 < problems.length) {
    throw new Error(`The draft is not valid:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  }
};

const describe = (draft: Draft): string => {
  return [
    ...draft.issues.map((issue) => {
      const details = [
        issue.repository,
        0 < issue.blockedBy.length ? `blocked by: ${issue.blockedBy.join(', ')}` : '',
        0 < issue.images.length ? `images: ${issue.images.join(', ')}` : '',
        issue.url ? `created: ${issue.url}` : '',
      ].filter((detail) => 0 < detail.length);
      return `${issue.kind === 'Issue' ? '' : '  - '}${issue.kind}: ${issue.title} (${details.join('; ')})`;
    }),
    draft.project ? `Project: ${draft.project.owner}/${draft.project.number}` : 'Project: none',
  ].join('\n');
};

/**
 * Returns the API path of an issue from its URL.
 */
const apiPath = (url: string): string => {
  const match = ISSUE_URL.exec(url);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Not an issue URL: ${url}`);
  }
  return `repos/${match[1]}/issues/${match[2]}`;
};

/**
 * Returns the database id of an issue, which the sub-issue and dependency APIs take instead of its number.
 */
const issueId = (url: string): string => {
  return gh(['api', apiPath(url), '--jq', '.id']);
};

/**
 * Creates an issue whose body shows images, uploading them with it.
 *
 * GitHub CLI reads the paths in the body relative to the body file, so the body is written to a
 * file next to the draft, and the command runs there.
 */
const createIssueWithImages = (issue: DraftIssue, directory: string): string => {
  const bodyFile = path.join(directory, `.issue-body-${process.pid}.md`);
  try {
    writeFileSync(bodyFile, `${issue.body}\n`);
    const args = ['issue', 'create', '--repo', issue.repository, '--title', issue.title, '--body-file', bodyFile];
    const result = spawnSync('gh', [...args, ...issue.images.flatMap((image) => ['--attach', image])], { encoding: 'utf8', cwd: directory });
    const url = result.stdout.split('\n').map((line) => line.trim()).find((line) => ISSUE_URL.test(line));
    if (!url) {
      throw new Error(`gh issue create failed:\n${`${result.stderr}${result.error?.message ?? ''}`.trim()}`);
    }
    // When an upload fails, the issue exists all the same. It is recorded like any other, so that
    // running the script again does not create it twice, and the failure is reported.
    if (result.status !== 0) {
      process.stdout.write(
        `Not every image of ${url} was uploaded, so its body still shows a path that leads nowhere:\n${result.stderr.trim()}\nUpload it with \`gh issue edit ${url} --body-file <body> --attach <image>\`, or remove the image from the body of the issue.\n`,
      );
    }
    return url;
  } finally {
    rmSync(bodyFile, { force: true });
  }
};

const createIssue = (issue: DraftIssue, directory: string): string => {
  if (0 < issue.images.length) {
    return createIssueWithImages(issue, directory);
  }
  const payload = { title: issue.title, body: issue.body };
  return gh(['api', `repos/${issue.repository}/issues`, '--input', '-', '--jq', '.html_url'], JSON.stringify(payload));
};

/**
 * Adds each of the given issues to a relation of an issue (its sub-issues or the issues blocking it),
 * skipping the ones a previous run already added.
 */
const relate = (path: string, parameter: string, urls: string[], label: string): void => {
  const existing = new Set(gh(['api', path, '--paginate', '--jq', '.[].html_url']).split('\n'));
  for (const url of urls.filter((candidate) => !existing.has(candidate))) {
    gh(['api', path, '-F', `${parameter}=${issueId(url)}`, '--silent']);
    process.stdout.write(`${label}: ${url}\n`);
  }
};

const main = (): number => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const draftPath = args.find((arg) => !arg.startsWith('--'));
  if (!draftPath) {
    process.stderr.write('Usage: node create-issues.ts [--dry-run] <draft.md>\n');
    return 1;
  }

  try {
    const directory = path.dirname(path.resolve(draftPath));
    let draft = parseDraft(readFileSync(draftPath, 'utf8'));
    validate(draft, directory);
    if (dryRun) {
      process.stdout.write(`The draft is valid. Nothing was created.\n${describe(draft)}\n`);
      return 0;
    }

    // Create the issues one at a time, recording each URL in the draft before moving on.
    for (;;) {
      const next = draft.issues.find((issue) => !issue.url);
      if (!next) {
        break;
      }
      const url = createIssue(next, directory);
      draft.lines.splice(next.insertAt, 0, ...(next.needsBlankLine ? ['', `URL: ${url}`] : [`URL: ${url}`]));
      writeFileSync(draftPath, draft.lines.join('\n'));
      process.stdout.write(`Created ${next.kind.toLowerCase()}: ${url}\n`);
      draft = parseDraft(readFileSync(draftPath, 'utf8'));
    }

    const urls = draft.issues.map((issue) => issue.url ?? '');
    const [parentUrl, ...subIssueUrls] = urls;
    if (!parentUrl) {
      throw new Error('The draft has no issues.');
    }

    if (0 < subIssueUrls.length) {
      relate(`${apiPath(parentUrl)}/sub_issues`, 'sub_issue_id', subIssueUrls, `Linked sub-issue to ${parentUrl}`);
    }

    for (const [index, issue] of draft.issues.entries()) {
      if (issue.blockedBy.length <= 0) {
        continue;
      }
      const url = urls[index] ?? '';
      const blockers = issue.blockedBy.map((blocker) => (POSITION.test(blocker) ? (urls[Number(blocker)] ?? '') : blocker));
      relate(`${apiPath(url)}/dependencies/blocked_by`, 'issue_id', blockers, `Marked ${url} as blocked by`);
    }

    // Adding an issue that is already in the project returns the existing item, so this is safe to repeat.
    if (draft.project) {
      for (const url of urls) {
        gh(['project', 'item-add', draft.project.number, '--owner', draft.project.owner, '--url', url]);
        process.stdout.write(`Added to project: ${url}\n`);
      }
    }

    process.stdout.write(`Done.\n${describe(draft)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (!dryRun) {
      process.stderr.write(
        'Issues created so far are recorded as `URL:` lines in the draft. Fix the cause and run the same command again to continue.\n',
      );
    }
    return 1;
  }
};

process.exitCode = main();
