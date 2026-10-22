import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProject } from "../src/index.js";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("generateProject safe overwrite and rollback", () => {
  let root: string;
  let target: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "scaffolder-test-"));
    target = join(root, "my-app");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("generates a project into an empty target directory", async () => {
    await generateProject({ name: "my-app", targetDir: target });

    expect(await exists(join(target, "package.json"))).toBe(true);
    const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-app");
  });

  it("refuses to overwrite existing files without explicit consent", async () => {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "package.json"), '{"name":"existing"}', "utf8");

    await expect(
      generateProject({ name: "my-app", targetDir: target })
    ).rejects.toThrow(/overwrite/i);

    // Existing file must be left untouched.
    const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    expect(pkg.name).toBe("existing");
  });

  it("overwrites existing files when overwrite consent is given", async () => {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "package.json"), '{"name":"existing"}', "utf8");

    await generateProject({ name: "my-app", targetDir: target, overwrite: true });

    const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-app");
  });

  it("rolls back files written during a failed generation", async () => {
    await mkdir(target, { recursive: true });

    await expect(
      generateProject({
        name: "my-app",
        targetDir: target,
        // Force a failure after some files have been written.
        onWrite: (index: number) => {
          if (index === 1) {
            throw new Error("simulated write failure");
          }
        },
      })
    ).rejects.toThrow(/simulated write failure/);

    // No partially generated project should remain.
    const remaining = await readdir(target).catch(() => [] as string[]);
    expect(remaining).toEqual([]);
  });
});
