#!/usr/bin/env node
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

/**
 * Supported application frameworks for the generated project.
 */
export type Framework = "vanilla" | "react" | "next";

/**
 * Supported languages for the generated project.
 */
export type Language = "typescript" | "javascript";

/**
 * Stable, documented options accepted by the scaffolder.
 */
export interface ScaffoldOptions {
  /** Target directory for the new project. */
  projectDir: string;
  /** Project name used in package.json. Defaults to the directory basename. */
  projectName?: string;
  /** Application framework. Defaults to "vanilla". */
  framework?: Framework;
  /** Source language. Defaults to "typescript". */
  language?: Language;
}

/**
 * Result returned by {@link scaffold}.
 */
export interface ScaffoldResult {
  projectDir: string;
  framework: Framework;
  language: Language;
  files: string[];
}

export const SUPPORTED_FRAMEWORKS: readonly Framework[] = ["vanilla", "react", "next"];

export const SUPPORTED_LANGUAGES: readonly Language[] = ["typescript", "javascript"];

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldError";
  }
}

interface TemplateFile {
  path: string;
  content: string;
}

interface TemplateContext {
  projectName: string;
  framework: Framework;
  language: Language;
}

function assertFramework(value: string): Framework {
  if (!(SUPPORTED_FRAMEWORKS as readonly string[]).includes(value)) {
    throw new ScaffoldError(
      `Unsupported framework "${value}". Choose one of: ${SUPPORTED_FRAMEWORKS.join(", ")}.`,
    );
  }
  return value as Framework;
}

function assertLanguage(value: string): Language {
  if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(value)) {
    throw new ScaffoldError(
      `Unsupported language "${value}". Choose one of: ${SUPPORTED_LANGUAGES.join(", ")}.`,
    );
  }
  return value as Language;
}

function dependenciesFor(framework: Framework): Record<string, string> {
  const base: Record<string, string> = {
    "@soroban-resurrect/sdk": "^0.1.0",
  };
  switch (framework) {
    case "react":
      return { ...base, react: "^18.2.0", "react-dom": "^18.2.0" };
    case "next":
      return { ...base, next: "^14.1.0", react: "^18.2.0", "react-dom": "^18.2.0" };
    case "vanilla":
    default:
      return base;
  }
}

function devDependenciesFor(framework: Framework, language: Language): Record<string, string> {
  const dev: Record<string, string> = {};
  if (language === "typescript") {
    dev.typescript = "^5.4.0";
  }
  switch (framework) {
    case "react":
      dev.vite = "^5.1.0";
      if (language === "typescript") {
        dev["@types/react"] = "^18.2.0";
        dev["@types/react-dom"] = "^18.2.0";
      }
      break;
    case "next":
      if (language === "typescript") {
        dev["@types/react"] = "^18.2.0";
        dev["@types/node"] = "^20.11.0";
      }
      break;
    case "vanilla":
    default:
      dev.vite = "^5.1.0";
      break;
  }
  return dev;
}

function scriptsFor(framework: Framework): Record<string, string> {
  switch (framework) {
    case "next":
      return { dev: "next dev", build: "next build", start: "next start" };
    case "react":
    case "vanilla":
    default:
      return { dev: "vite", build: "vite build", preview: "vite preview" };
  }
}

function packageJson(ctx: TemplateContext): string {
  const pkg = {
    name: ctx.projectName,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: scriptsFor(ctx.framework),
    dependencies: dependenciesFor(ctx.framework),
    devDependencies: devDependenciesFor(ctx.framework, ctx.language),
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function sourceExtension(language: Language): string {
  return language === "typescript" ? "ts" : "js";
}

function appSource(ctx: TemplateContext): string {
  const ext = sourceExtension(ctx.language);
  const typeImport = ctx.language === "typescript" ? "import type { SorobanClient } from \"@soroban-resurrect/sdk\";\n" : "";
  const annotation = ctx.language === "typescript" ? ": SorobanClient" : "";
  return `${typeImport}import { createClient } from "@soroban-resurrect/sdk";\n\nexport const client${annotation} = createClient({\n  rpcUrl: "https://soroban-testnet.stellar.org",\n  networkPassphrase: "Test SDF Network ; September 2015",\n});\n\nexport default client;\n// entry: src/main.${ext}\n`;
}

function templateFiles(ctx: TemplateContext): TemplateFile[] {
  const ext = sourceExtension(ctx.language);
  const files: TemplateFile[] = [
    { path: "package.json", content: packageJson(ctx) },
    { path: `src/client.${ext}`, content: appSource(ctx) },
    {
      path: "README.md",
      content: `# ${ctx.projectName}\n\nGenerated with create-soroban-resurrect.\n\n- Framework: ${ctx.framework}\n- Language: ${ctx.language}\n\n## Getting started\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
    },
  ];
  if (ctx.language === "typescript") {
    files.push({
      path: "tsconfig.json",
      content: `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2,
      )}\n`,
    });
  }
  return files;
}

/**
 * Scaffold a new project into `options.projectDir`.
 *
 * Throws {@link ScaffoldError} for unsupported framework or language values.
 */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const framework = assertFramework(options.framework ?? "vanilla");
  const language = assertLanguage(options.language ?? "typescript");
  const projectDir = path.resolve(options.projectDir);
  const projectName = options.projectName ?? path.basename(projectDir);

  const ctx: TemplateContext = { projectName, framework, language };
  const files = templateFiles(ctx);

  await fs.mkdir(projectDir, { recursive: true });
  for (const file of files) {
    const target = path.join(projectDir, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf8");
  }

  return { projectDir, framework, language, files: files.map((f) => f.path) };
}

interface ParsedArgs {
  projectDir?: string;
  framework?: string;
  language?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--framework" || arg === "-f") {
      parsed.framework = argv[++i];
    } else if (arg === "--language" || arg === "-l") {
      parsed.language = argv[++i];
    } else if (!arg.startsWith("-") && !parsed.projectDir) {
      parsed.projectDir = arg;
    }
  }
  return parsed;
}

async function prompt(question: string, fallback: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (${fallback}): `, (answer) => {
      rl.close();
      resolve(answer.trim() || fallback);
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = args.projectDir ?? (await prompt("Project directory", "my-soroban-app"));
  const framework = args.framework ?? (await prompt(`Framework [${SUPPORTED_FRAMEWORKS.join("/")}]`, "vanilla"));
  const language = args.language ?? (await prompt(`Language [${SUPPORTED_LANGUAGES.join("/")}]`, "typescript"));

  try {
    const result = await scaffold({ projectDir, framework: framework as Framework, language: language as Language });
    console.log(`Created ${result.projectName ?? result.projectDir} (${result.framework}, ${result.language})`);
    console.log(`Files: ${result.files.join(", ")}`);
  } catch (error) {
    if (error instanceof ScaffoldError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (require.main === module) {
  void main();
}
