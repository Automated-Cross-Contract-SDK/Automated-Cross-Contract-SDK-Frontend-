import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface GeneratedFile {
  /** Path relative to the target directory. */
  path: string;
  /** Full file contents to write. */
  content: string;
}

export interface GenerateOptions {
  /**
   * Allow overwriting files that already exist in the target directory.
   * When false (default), generation aborts if any target file exists.
   */
  overwrite?: boolean;
}

export interface GenerateResult {
  /** Absolute paths of files written by this run. */
  written: string[];
  /** Absolute paths of pre-existing files that were overwritten. */
  overwritten: string[];
}

export class ExistingFilesError extends Error {
  readonly existing: string[];

  constructor(existing: string[]) {
    super(
      `Refusing to overwrite existing files (pass overwrite: true to allow): ${existing.join(
        ", ",
      )}`,
    );
    this.name = "ExistingFilesError";
    this.existing = existing;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write generated files into `targetDir` with safe overwrite and rollback.
 *
 * - Detects existing files before writing anything.
 * - Requires `overwrite: true` to clobber existing files; otherwise throws
 *   {@link ExistingFilesError} without touching the filesystem.
 * - On any error mid-write, removes files created by this run and restores
 *   overwritten files to their previous contents, so no partial project is left.
 */
export async function generateProject(
  targetDir: string,
  files: GeneratedFile[],
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const overwrite = options.overwrite === true;
  const resolvedTarget = path.resolve(targetDir);

  const absolutePaths = files.map((file) => path.resolve(resolvedTarget, file.path));

  const existing: string[] = [];
  for (const absolutePath of absolutePaths) {
    if (await pathExists(absolutePath)) {
      existing.push(path.relative(resolvedTarget, absolutePath));
    }
  }

  if (existing.length > 0 && !overwrite) {
    throw new ExistingFilesError(existing);
  }

  const written: string[] = [];
  const overwritten: string[] = [];
  const backups = new Map<string, string | null>();

  try {
    for (let i = 0; i < files.length; i += 1) {
      const absolutePath = absolutePaths[i];
      const hadPrevious = await pathExists(absolutePath);

      if (hadPrevious) {
        backups.set(absolutePath, await fs.readFile(absolutePath, "utf8"));
        overwritten.push(absolutePath);
      } else {
        backups.set(absolutePath, null);
      }

      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, files[i].content, "utf8");
      written.push(absolutePath);
    }
  } catch (error) {
    await rollback(backups);
    throw error;
  }

  return { written, overwritten };
}

async function rollback(backups: Map<string, string | null>): Promise<void> {
  for (const [absolutePath, previous] of backups) {
    try {
      if (previous === null) {
        await fs.rm(absolutePath, { force: true });
      } else {
        await fs.writeFile(absolutePath, previous, "utf8");
      }
    } catch {
      // Best-effort rollback: continue restoring remaining files.
    }
  }
}
