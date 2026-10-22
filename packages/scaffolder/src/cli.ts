#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

export interface ScaffoldOptions {
  /** Target project directory (relative or absolute). */
  projectName: string;
  /** Template identifier to scaffold from. */
  template: string;
  /** Wallet integration to include, if any. */
  wallet?: string;
  /** Skip all prompts; fail instead of asking. */
  nonInteractive: boolean;
  /** Overwrite existing files in the target directory. */
  force: boolean;
}

export interface GeneratedFile {
  path: string;
  contents: string;
}

export const SUPPORTED_TEMPLATES = ["basic", "react", "next"] as const;
export const SUPPORTED_WALLETS = ["freighter", "rabet", "none"] as const;

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldError";
  }
}

/**
 * Parse and validate CLI arguments. Throws {@link ScaffoldError} on invalid or
 * conflicting combinations so callers (and CI) get a clear, deterministic error.
 */
export function parseScaffoldArgs(argv: string[]): ScaffoldOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      template: { type: "string", short: "t" },
      wallet: { type: "string", short: "w" },
      "non-interactive": { type: "boolean", short: "y" },
      force: { type: "boolean", short: "f" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    throw new ScaffoldError(usage());
  }

  const projectName = values._?.[0] ?? argv.find((a) => !a.startsWith("-"));
  const positional = (values as { _?: string[] })._ ?? [];
  const name = positional[0];

  const nonInteractive = Boolean(values["non-interactive"]);
  const force = Boolean(values.force);
  const template = values.template;
  const wallet = values.wallet;

  if (nonInteractive) {
    if (!name) {
      throw new ScaffoldError(
        "Non-interactive mode requires a project name: scaffolder <name> --non-interactive --template <template>",
      );
    }
    if (!template) {
      throw new ScaffoldError(
        "Non-interactive mode requires --template. Supported: " +
          SUPPORTED_TEMPLATES.join(", "),
      );
    }
  }

  if (template && !SUPPORTED_TEMPLATES.includes(template as never)) {
    throw new ScaffoldError(
      `Unknown template "${template}". Supported: ${SUPPORTED_TEMPLATES.join(", ")}`,
    );
  }

  if (wallet && !SUPPORTED_WALLETS.includes(wallet as never)) {
    throw new ScaffoldError(
      `Unknown wallet "${wallet}". Supported: ${SUPPORTED_WALLETS.join(", ")}`,
    );
  }

  if (wallet && wallet !== "none" && template === "basic") {
    throw new ScaffoldError(
      `Template "basic" does not support wallet integration "${wallet}". Use --template react or next.`,
    );
  }

  return {
    projectName: name ?? projectName ?? "",
    template: template ?? "basic",
    wallet: wallet === "none" ? undefined : wallet,
    nonInteractive,
    force,
  };
}

/** Build the deterministic set of files for the given options. */
export function generateFiles(options: ScaffoldOptions): GeneratedFile[] {
  const files: GeneratedFile[] = [
    {
      path: "package.json",
      contents: JSON.stringify(
        { name: options.projectName, private: true, version: "0.0.0" },
        null,
        2,
      ) + "\n",
    },
    {
      path: "README.md",
      contents: `# ${options.projectName}\n\nGenerated with the ${options.template} template.\n`,
    },
  ];

  if (options.wallet) {
    files.push({
      path: join("src", "wallet.ts"),
      contents: `export const wallet = "${options.wallet}";\n`,
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Write generated files to disk, honoring the force flag. */
export function writeFiles(
  targetDir: string,
  files: GeneratedFile[],
  force: boolean,
): void {
  const root = resolve(targetDir);
  for (const file of files) {
    const dest = join(root, file.path);
    if (existsSync(dest) && !force) {
      throw new ScaffoldError(
        `Refusing to overwrite existing file: ${file.path}. Re-run with --force to overwrite.`,
      );
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.contents, "utf8");
  }
}

/** Deterministic, human-readable summary of generated files. */
export function formatSummary(
  options: ScaffoldOptions,
  files: GeneratedFile[],
): string {
  const lines = [
    `Scaffolded ${options.projectName} (template: ${options.template})`,
    options.wallet ? `Wallet: ${options.wallet}` : "Wallet: none",
    `Files (${files.length}):`,
    ...files.map((f) => `  ${f.path}`),
  ];
  return lines.join("\n") + "\n";
}

function usage(): string {
  return [
    "Usage: scaffolder <name> [options]",
    "",
    "Options:",
    "  -t, --template <name>   Template to use (basic, react, next)",
    "  -w, --wallet <name>     Wallet integration (freighter, rabet, none)",
    "  -y, --non-interactive   Skip prompts; requires <name> and --template",
    "  -f, --force             Overwrite existing files",
    "  -h, --help              Show this help",
  ].join("\n");
}

export function run(argv: string[]): number {
  try {
    const options = parseScaffoldArgs(argv);
    const files = generateFiles(options);
    writeFiles(options.projectName, files, options.force);
    process.stdout.write(formatSummary(options, files));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(message + "\n");
    return 1;
  }
}

if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}
