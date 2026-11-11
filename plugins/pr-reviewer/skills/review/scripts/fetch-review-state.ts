/**
 * Prints, as JSON, what earlier reviews by this plugin left on a pull request: the review
 * threads that are still open, with their whole conversation, and the summaries that are
 * still visible. Nothing on GitHub is changed.
 *
 * Usage: node fetch-review-state.ts <pull request number> [owner/repo]
 */
import { fetchReviewState, gh } from './github.ts';

const main = (): number => {
  const [number, repository] = process.argv.slice(2);
  if (!number || !/^\d+$/.test(number)) {
    process.stderr.write('Usage: node fetch-review-state.ts <pull request number> [owner/repo]\n');
    return 1;
  }

  try {
    const state = fetchReviewState(
      repository ?? gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
      Number(number),
    );
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
};

process.exitCode = main();
