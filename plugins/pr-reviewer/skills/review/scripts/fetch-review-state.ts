/**
 * Prints, as JSON, what earlier reviews by this plugin left on a pull request: the review
 * threads that are still open, with their whole conversation, and the summaries that are
 * still visible. Nothing on GitHub is changed.
 *
 * The output also names a `reviewFile` in a new temporary directory, which is where the
 * review is to be written for submit-review.ts. Handing out the path here keeps the file
 * out of the repository without the caller having to run any other command for it.
 *
 * Usage: node fetch-review-state.ts <pull request URL>
 *        node fetch-review-state.ts <pull request number> [owner/repo]
 *
 * A URL names its repository and its host, which a number does not: with a number alone,
 * the repository of the current directory is used, on the host `gh` is configured for. To
 * name another host, such as GitHub Enterprise Server, the second form takes `host/owner/repo`.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { fetchReviewState, gh, parsePullRequestUrl, REVIEW_DIRECTORY_PREFIX } from './github.ts';

const main = (): number => {
  const [target = '', repository] = process.argv.slice(2);
  const fromUrl = parsePullRequestUrl(target);
  if (!fromUrl && !/^\d+$/.test(target)) {
    process.stderr.write(
      'Usage: node fetch-review-state.ts <pull request URL>\n       node fetch-review-state.ts <pull request number> [owner/repo]\n',
    );
    return 1;
  }

  try {
    const state = fetchReviewState(
      fromUrl?.repository ?? repository ?? gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
      fromUrl?.number ?? Number(target),
    );
    const reviewFile = path.join(mkdtempSync(path.join(tmpdir(), REVIEW_DIRECTORY_PREFIX)), 'review.json');
    process.stdout.write(`${JSON.stringify({ ...state, reviewFile }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
};

process.exitCode = main();
