import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ScaffoldOptions {
  /** Target directory for the generated project. */
  targetDir: string;
  /** Project name written into package.json and templates. */
  projectName: string;
  /** Template identifier to scaffold from. */
  template: string;
  /** Overwrite existing files in the target directory. */
  force?: boolean;
  /** Skip all interactive prompts; requires every option to be provided. */
  nonInteractive?: boolean;
}

export interface ScaffoldResult {
  /** Absolute path of the generated project. */
  targetDir: string;
  /** Sorted, deterministic list of generated file paths relative to targetDir. */
  files: string[];
}

export interface ParsedCliArgs {
  options: ScaffoldOptions;
  help: boolean;
}

export const AVAILABLE_TEMPLATES = ['default', 'minimal'] as const;
export type TemplateName = (typeof AVAILABLE_TEMPLATES)[number];

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScaffoldError';
  }
}

const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Parse CLI arguments for the scaffolder.
 *
 * Supported flags:
 *   --name <name>        project name (required in non-interactive mode)
 *   --template <name>    template to use (required in non-interactive mode)
 *   --dir <path>         target directory (defaults to ./<name>)
 *   --force              overwrite existing files
 *   --non-interactive    disable prompts; fail if required options are missing
 *   --help               print usage
 */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const raw: Record<string, string | boolean> = {};
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new ScaffoldError(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    switch (key) {
      case 'help':
        help = true;
        break;
      case 'force':
      case 'non-interactive':
        raw[key] = true;
        break;
      case 'name':
      case 'template':
      case 'dir': {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
          throw new ScaffoldError(`Missing value for --${key}`);
        }
        raw[key] = value;
        i += 1;
        break;
      }
      default:
        throw new ScaffoldError(`Unknown option: --${key}`);
    }
  }

  if (help) {
    return {
      help: true,
      options: {
        targetDir: '',
        projectName: '',
        template: '',
      },
    };
  }

  const nonInteractive = raw['non-interactive'] === true;
  const projectName = typeof raw.name === 'string' ? raw.name : '';
  const template = typeof raw.template === 'string' ? raw.template : '';
  const targetDir =
    typeof raw.dir === 'string' ? raw.dir : projectName ? path.join('.', projectName) : '';

  if (nonInteractive) {
    const missing: string[] = [];
    if (!projectName) missing.push('--name');
    if (!template) missing.push('--template');
    if (missing.length > 0) {
      throw new ScaffoldError(
        `Non-interactive mode requires: ${missing.join(', ')}`,
      );
    }
  }

  if (projectName && !PROJECT_NAME_PATTERN.test(projectName)) {
    throw new ScaffoldError(
      `Invalid project name "${projectName}": must match ${PROJECT_NAME_PATTERN}`,
    );
  }

  if (template && !(AVAILABLE_TEMPLATES as readonly string[]).includes(template)) {
    throw new ScaffoldError(
      `Unknown template "${template}". Available: ${AVAILABLE_TEMPLATES.join(', ')}`,
    );
  }

  return {
    help: false,
    options: {
      targetDir,
      projectName,
      template,
      force: raw.force === true,
      nonInteractive,
    },
  };
}

export function usage(): string {
  return [
    'Usage: create-project [options]',
    '',
    'Options:',
    '  --name <name>        Project name (required with --non-interactive)',
    '  --template <name>    Template to use (required with --non-interactive)',
    '  --dir <path>         Target directory (defaults to ./<name>)',
    '  --force              Overwrite existing files',
    '  --non-interactive    Disable prompts; fail if required options are missing',
    '  --help               Show this help message',
    '',
    `Templates: ${AVAILABLE_TEMPLATES.join(', ')}`,
  ].join('\n');
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function renderTemplate(template: string, projectName: string): Record<string, string> {
  const pkg = {
    name: projectName,
    version: '0.1.0',
    private: true,
  };
  const files: Record<string, string> = {
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    'README.md': `# ${projectName}\n`,
  };
  if (template === 'default') {
    files['src/index.ts'] = `export const name = '${projectName}';\n`;
  }
  return files;
}

/**
 * Detect which of the rendered files already exist in the target directory.
 * Returns the sorted list of relative paths that would be overwritten.
 */
export async function detectExistingFiles(
  targetDir: string,
  files: Record<string, string>,
): Promise<string[]> {
  const resolvedTarget = path.resolve(targetDir);
  const existing: string[] = [];
  for (const relative of Object.keys(files).sort()) {
    if (await pathExists(path.join(resolvedTarget, relative))) {
      existing.push(relative);
    }
  }
  return existing;
}

/**
 * Scaffold a project. In non-interactive mode all options must be supplied
 * up front; the returned file list is sorted for deterministic output.
 *
 * Safe overwrite: if any rendered file already exists in the target directory
 * and `force` is not set, the scaffold aborts before writing anything.
 *
 * Rollback: if a write fails partway through, every file written during this
 * run is removed (and any pre-existing files overwritten under `force` are
 * restored) so no partially generated project is left behind.
 */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const { targetDir, projectName, template, force, nonInteractive } = options;

  if (nonInteractive) {
    if (!projectName || !template || !targetDir) {
      throw new ScaffoldError(
        'Non-interactive mode requires projectName, template, and targetDir',
      );
    }
  }

  if (!projectName || !template || !targetDir) {
    throw new ScaffoldError('projectName, template, and targetDir are required');
  }

  if (!(AVAILABLE_TEMPLATES as readonly string[]).includes(template)) {
    throw new ScaffoldError(
      `Unknown template "${template}". Available: ${AVAILABLE_TEMPLATES.join(', ')}`,
    );
  }

  const resolvedTarget = path.resolve(targetDir);
  const rendered = renderTemplate(template, projectName);

  const existing = await detectExistingFiles(resolvedTarget, rendered);
  if (existing.length > 0 && !force) {
    throw new ScaffoldError(
      `Target contains existing files: ${existing.join(', ')}. ` +
        'Use --force to overwrite.',
    );
  }

  const written: string[] = [];
  const createdDirs: string[] = [];
  const backups = new Map<string, string>();

  try {
    for (const relative of Object.keys(rendered).sort()) {
      const absolute = path.join(resolvedTarget, relative);
      const dir = path.dirname(absolute);
      if (!(await pathExists(dir))) {
        await fs.mkdir(dir, { recursive: true });
        createdDirs.push(dir);
      }
      if (await pathExists(absolute)) {
        backups.set(absolute, await fs.readFile(absolute, 'utf8'));
      }
      await fs.writeFile(absolute, rendered[relative], 'utf8');
      written.push(relative);
    }
  } catch (error) {
    await rollback(written, backups, createdDirs, resolvedTarget);
    const message = error instanceof Error ? error.message : String(error);
    throw new ScaffoldError(`Scaffolding failed and was rolled back: ${message}`);
  }

  return { targetDir: resolvedTarget, files: written.sort() };
}

async function rollback(
  written: string[],
  backups: Map<string, string>,
  createdDirs: string[],
  resolvedTarget: string,
): Promise<void> {
  for (const relative of written) {
    const absolute = path.join(resolvedTarget, relative);
    try {
      const previous = backups.get(absolute);
      if (previous !== undefined) {
        await fs.writeFile(absolute, previous, 'utf8');
      } else {
        await fs.rm(absolute, { force: true });
      }
    } catch {
      // Best-effort cleanup; continue restoring remaining files.
    }
  }
  for (const dir of createdDirs.reverse()) {
    try {
      await fs.rmdir(dir);
    } catch {
      // Directory not empty or already gone; leave it in place.
    }
  }
}

/**
 * Format a deterministic summary of generated files for non-interactive runs.
 */
export function formatSummary(result: ScaffoldResult): string {
  const lines = [`Created ${result.files.length} file(s) in ${result.targetDir}:`];
  for (const file of result.files) {
    lines.push(`  ${file}`);
  }
  return lines.join('\n');
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseCliArgs(argv);
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await scaffold(parsed.options);
  process.stdout.write(`${formatSummary(result)}\n`);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  });
}
