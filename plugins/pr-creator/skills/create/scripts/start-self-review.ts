/**
 * Marks the start of the self-review, and prints, as JSON, the `descriptionFile` the
 * description of the pull request is to be written to once the review is clean.
 *
 * The file is in a new temporary directory. Handing out the path here keeps the description,
 * and the files of a diagram written next to it, out of the repository without the caller
 * having to run any other command for it. The directory is also how stop-hook.ts tells that
 * a self-review was started: from here on, the run is not finished until the pull request
 * is opened.
 *
 * Usage: node start-self-review.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DESCRIPTION_DIRECTORY_PREFIX, DESCRIPTION_FILE_NAME } from './self-review.ts';

const main = (): number => {
  try {
    const descriptionFile = path.join(mkdtempSync(path.join(tmpdir(), DESCRIPTION_DIRECTORY_PREFIX)), DESCRIPTION_FILE_NAME);
    process.stdout.write(`${JSON.stringify({ descriptionFile }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
};

process.exitCode = main();
