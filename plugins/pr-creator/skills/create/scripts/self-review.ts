/**
 * What start-self-review.ts and stop-hook.ts have to agree on.
 */

/** The start of the name of the temporary directory that holds a description file. */
export const DESCRIPTION_DIRECTORY_PREFIX = 'pr-creator-';

/** The name of the description file in that directory. */
export const DESCRIPTION_FILE_NAME = 'description.md';

/**
 * The name of an empty file in that directory, which says that start-self-review.ts made
 * it: end-self-review.ts deletes the directory, and a directory of the same name can exist
 * anywhere.
 */
export const MARKER_FILE_NAME = 'self-review';

/** The name of the file in that directory where stop-hook.ts counts the stops it blocked. */
export const STOP_BLOCKS_FILE_NAME = 'stop-blocks';
