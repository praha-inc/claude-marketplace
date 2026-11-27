/**
 * Deletes the directory of a description file that start-self-review.ts handed out, with
 * everything in it. That ends the run for stop-hook.ts: it is called once the pull request
 * is opened, and when the run is given up without one.
 *
 * Usage: node end-self-review.ts <descriptionFile>
 */
import { lstatSync, rmSync } from 'node:fs';
import path from 'node:path';

import { DESCRIPTION_DIRECTORY_PREFIX, DESCRIPTION_FILE_NAME, MARKER_FILE_NAME } from './self-review.ts';

const main = (): number => {
  const [file] = process.argv.slice(2);
  if (file === undefined) {
    process.stderr.write('Usage: node end-self-review.ts <descriptionFile>\n');
    return 1;
  }

  const directory = path.dirname(path.resolve(file));
  try {
    // Run a second time, such as at the end of step 11 after the hook asked for it: nothing is left to do.
    if (
      path.basename(file) === DESCRIPTION_FILE_NAME
      && path.basename(directory).startsWith(DESCRIPTION_DIRECTORY_PREFIX)
      && lstatSync(directory, { throwIfNoEntry: false }) === undefined
    ) {
      process.stdout.write(`Already deleted: ${directory}\n`);
      return 0;
    }
    // Only a directory start-self-review.ts made, which holds its marker: everything in it
    // is deleted, and a directory of the same name can exist in a repository. Where the
    // temporary directory is does not say, because it can differ from one command to the next.
    if (
      path.basename(file) !== DESCRIPTION_FILE_NAME
      || !path.basename(directory).startsWith(DESCRIPTION_DIRECTORY_PREFIX)
      || lstatSync(path.join(directory, MARKER_FILE_NAME), { throwIfNoEntry: false })?.isFile() !== true
    ) {
      process.stderr.write(`Not a description file that start-self-review.ts handed out: ${file}\n`);
      return 1;
    }
    rmSync(directory, { recursive: true, force: true });
    process.stdout.write(`Deleted ${directory}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
};

process.exitCode = main();
