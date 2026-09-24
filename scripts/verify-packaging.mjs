#!/usr/bin/env node
/**
 * Packaging verification.
 *
 * CI builds and tests the source tree, but never checks what actually ships.
 * This script guards the release artifact for every publishable workspace:
 *
 *   1. `npm pack --dry-run` each package and assert the tarball contains the
 *      dist output plus every path referenced from package.json (main / types /
 *      exports), and that nothing unwanted leaks in.
 *   2. `npm pack` the real tarballs into a fresh temp project, install them in
 *      isolation, import them and run `tsc --noEmit` against the published
 *      `.d.ts` files.
 *
 * Usage: node scripts/verify-packaging.mjs
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Files npm always includes for every package regardless of the `files` field. */
const ALWAYS_INCLUDED = [
  /^package\.json$/,
  /^readme(\..+)?$/i,
  /^licen[cs]e(\..+)?$/i,
  /^changelog(\..+)?$/i,
  /^notice(\..+)?$/i,
  /^authors(\..+)?$/i,
]

/** Patterns that must never appear in a published tarball. */
const FORBIDDEN = [
  { test: (f) => /(^|\/)node_modules\//.test(f), why: 'node_modules must never be published' },
  { test: (f) => /^src\//.test(f), why: 'source files must not be published, only dist output' },
  { test: (f) => /(^|\/)__tests__\//.test(f), why: 'test files must not be published' },
  { test: (f) => /\.test\.[cm]?[jt]sx?$/.test(f), why: 'test files must not be published' },
  {
    test: (f) => /(^|\/)(vitest|jest)\.config\.[cm]?[jt]s$/.test(f),
    why: 'test config must not be published',
  },
  { test: (f) => /^tsconfig(\..+)?\.json$/.test(f), why: 'tsconfig files must not be published' },
  { test: (f) => /(^|\/)\.env(\.|$)/.test(f), why: 'env files must not be published' },
  {
    test: (f) => /(^|\/)\.(git|github|vscode)\//.test(f),
    why: 'repository metadata must not be published',
  },
  { test: (f) => /(^|\/)package-lock\.json$/.test(f), why: 'lockfiles must not be published' },
  {
    test: (f) => /\.tsx?$/.test(f) && !/\.d\.[cm]?ts$/.test(f),
    why: 'raw TypeScript must not be published, only compiled .d.ts',
  },
]

const PACKAGE_JSON_PATH_FIELDS = ['main', 'module', 'types', 'typings', 'browser']

function log(message = '') {
  process.stdout.write(`${message}\n`)
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function parsePackJson(raw) {
  const jsonStart = raw.indexOf('[')
  if (jsonStart === -1) throw new Error(`Unexpected "npm pack" output:\n${raw}`)
  const [entry] = JSON.parse(raw.slice(jsonStart))
  if (!entry) throw new Error('"npm pack" returned an empty result')
  return entry
}

/** Expand the simple `dir/*` workspace globs used by this repo. */
function expandWorkspaceGlob(glob) {
  if (!glob.includes('*')) return [glob]
  const base = path.dirname(glob) || '.'
  const dir = path.join(repoRoot, base)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(base, entry.name))
}

function discoverPublishablePackages() {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const dirs = (rootPkg.workspaces ?? []).flatMap(expandWorkspaceGlob)

  return dirs
    .map((dir) => {
      const manifestPath = path.join(repoRoot, dir, 'package.json')
      if (!fs.existsSync(manifestPath)) return null
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      return { dir, manifestPath, manifest }
    })
    .filter((pkg) => pkg && pkg.manifest.private !== true && typeof pkg.manifest.name === 'string')
}

/** Collect relative file paths (without leading `./`) referenced by package.json. */
function collectReferencedFiles(manifest) {
  const refs = new Set()

  for (const field of PACKAGE_JSON_PATH_FIELDS) {
    const value = manifest[field]
    if (typeof value === 'string' && value.startsWith('./')) refs.add(value.slice(2))
  }

  const walk = (node) => {
    if (typeof node === 'string') {
      if (node.startsWith('./')) refs.add(node.slice(2))
      return
    }
    if (node && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value)
    }
  }
  walk(manifest.exports)

  return [...refs]
}

/** Each `exports` subpath must expose a `types` condition (or a top-level `types`). */
function collectExportsTypesIssues(manifest) {
  const issues = []
  const hasTopLevelTypes = typeof manifest.types === 'string' || typeof manifest.typings === 'string'

  const walk = (node, subpath) => {
    if (node === null || typeof node !== 'object') return
    const keys = Object.keys(node)
    const isConditionMap = keys.some((key) => !key.startsWith('.'))
    if (isConditionMap && !keys.includes('types') && !hasTopLevelTypes) {
      issues.push(
        `exports["${subpath}"] has no "types" condition and package.json has no top-level "types"`,
      )
    }
    for (const [key, value] of Object.entries(node)) {
      walk(value, key.startsWith('.') ? key : subpath)
    }
  }
  walk(manifest.exports, '.')

  return issues
}

function dryRunPack(pkg) {
  return parsePackJson(run('npm', ['pack', '--dry-run', '--json'], path.join(repoRoot, pkg.dir)))
}

function verifyTarballContents(pkg, entries) {
  const errors = []
  const { manifest } = pkg
  const files = entries.map((file) => file.path)
  const fileSet = new Set(files)

  const allowedPrefixes = (manifest.files ?? []).map((entry) =>
    entry.replace(/^\.\//, '').replace(/\/$/, ''),
  )
  const isAllowed = (file) =>
    ALWAYS_INCLUDED.some((re) => re.test(file)) ||
    allowedPrefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`))

  // 1. Every file declared in `files` must actually be packed.
  for (const entry of manifest.files ?? []) {
    const normalized = entry.replace(/^\.\//, '').replace(/\/$/, '')
    const present = files.some((file) => file === normalized || file.startsWith(`${normalized}/`))
    if (!present) errors.push(`"files" entry "${entry}" produced nothing in the tarball`)
  }

  // 2. Every path referenced from package.json must be packed (main/types/exports).
  for (const ref of collectReferencedFiles(manifest)) {
    if (!fileSet.has(ref)) {
      errors.push(`package.json references "${ref}" but it is missing from the tarball`)
    }
  }

  // 3. Published types and runtime must both exist.
  const hasRuntime = files.some((file) => /\.[cm]?js$/.test(file) && !/\.d\.[cm]?ts$/.test(file))
  const hasDeclaration = files.some((file) => /\.d\.[cm]?ts$/.test(file))
  if (!hasRuntime) errors.push('tarball contains no compiled JavaScript')
  if (!hasDeclaration) errors.push('tarball contains no TypeScript declarations (.d.ts)')

  // 4. exports must advertise a types condition.
  errors.push(...collectExportsTypesIssues(manifest))

  // 5. Nothing unwanted may leak in.
  for (const file of files) {
    const forbidden = FORBIDDEN.find((rule) => rule.test(file))
    if (forbidden) {
      errors.push(`unwanted file "${file}" is published: ${forbidden.why}`)
    } else if (allowedPrefixes.length > 0 && !isAllowed(file)) {
      errors.push(
        `unexpected file "${file}" is published (not covered by "files": ${JSON.stringify(manifest.files)})`,
      )
    }
  }

  return errors
}

/** Import specifiers, derived from the packages being verified (sorted for stable output). */
function buildConsumerSource(packages) {
  const lines = ['/* Generated by scripts/verify-packaging.mjs */', '']
  for (const pkg of packages) {
    lines.push(`import * as ${ident(pkg.manifest.name)} from ${JSON.stringify(pkg.manifest.name)}`)
  }
  lines.push('')
  for (const pkg of packages) {
    lines.push(`export type ${typeName(pkg.manifest.name)} = typeof ${ident(pkg.manifest.name)}`)
  }
  return `${lines.join('\n')}\n`
}

function ident(name) {
  return name.replace(/^@/, '').replace(/[^a-zA-Z0-9]+/g, '_')
}

function typeName(name) {
  return `Package_${ident(name)}`
}

function installAndTypecheck(packages) {
  const tscBin = require.resolve('typescript/bin/tsc')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soroban-pack-verify-'))
  const tarballDir = path.join(tempDir, 'tarballs')
  const projectDir = path.join(tempDir, 'consumer')
  fs.mkdirSync(tarballDir, { recursive: true })
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })

  const captured = (error) =>
    error?.stderr?.toString?.().trim() || error?.stdout?.toString?.().trim() || error.message

  try {
    // 1. Produce the real tarballs and remember where each package landed.
    const tarballByPackage = new Map()
    for (const pkg of packages) {
      const entry = parsePackJson(
        run('npm', ['pack', '--json', '--pack-destination', tarballDir], path.join(repoRoot, pkg.dir)),
      )
      tarballByPackage.set(pkg.manifest.name, path.join(tarballDir, entry.filename))
    }

    // 2. Build an isolated consumer project.
    const dependencies = {}
    for (const [name, tarball] of tarballByPackage) dependencies[name] = `file:${tarball}`

    const internalNames = new Set(tarballByPackage.keys())
    for (const pkg of packages) {
      for (const field of ['dependencies', 'peerDependencies']) {
        for (const [name, range] of Object.entries(pkg.manifest[field] ?? {})) {
          if (!internalNames.has(name) && !(name in dependencies)) dependencies[name] = range
        }
      }
    }

    const overrides = {}
    for (const [name, tarball] of tarballByPackage) overrides[name] = `file:${tarball}`

    const consumerManifest = {
      name: 'soroban-pack-consumer',
      private: true,
      version: '0.0.0',
      type: 'module',
      dependencies,
      devDependencies: { '@types/react': '^18.3.0' },
      overrides,
    }
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      `${JSON.stringify(consumerManifest, null, 2)}\n`,
    )

    fs.writeFileSync(
      path.join(projectDir, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            esModuleInterop: true,
            forceConsistentCasingInFileNames: true,
            jsx: 'react-jsx',
            lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          },
          include: ['src'],
        },
        null,
        2,
      )}\n`,
    )
    fs.writeFileSync(path.join(projectDir, 'src', 'index.ts'), buildConsumerSource(packages))

    // 3. Install the tarballs in isolation, then typecheck against their .d.ts.
    log('    installing published tarballs into a fresh project...')
    run(
      'npm',
      ['install', '--no-audit', '--no-fund', '--no-package-lock', '--ignore-scripts'],
      projectDir,
    )

    log('    typechecking against published .d.ts files...')
    run('node', [tscBin, '--project', projectDir, '--noEmit'], projectDir)

    return []
  } catch (error) {
    return [`fresh-project verification failed:\n      ${captured(error).split('\n').join('\n      ')}`]
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function main() {
  const packages = discoverPublishablePackages()
  if (packages.length === 0) {
    log('No publishable workspace packages found.')
    return
  }

  log(`Verifying ${packages.length} publishable package(s): ${packages.map((p) => p.manifest.name).join(', ')}`)
  log('')

  const packFailures = new Map()
  for (const pkg of packages) {
    log(`  ${pkg.manifest.name}`)
    let errors
    try {
      const entry = dryRunPack(pkg)
      log(`    npm pack --dry-run: ${entry.entryCount} files, ${entry.unpackedSize} bytes unpacked`)
      errors = verifyTarballContents(pkg, entry.files)
    } catch (error) {
      errors = [`npm pack --dry-run failed: ${error.message}`]
    }
    if (errors.length > 0) packFailures.set(pkg.manifest.name, errors)
  }

  if (packFailures.size > 0) {
    log('')
    for (const [name, errors] of packFailures) {
      log(`  ✖ ${name}`)
      for (const error of errors) log(`      - ${error}`)
    }
  }

  log('')
  log('  fresh project (install tarballs + tsc --noEmit)')
  const isolationErrors = installAndTypecheck(packages)

  if (packFailures.size === 0 && isolationErrors.length === 0) {
    log('')
    log('✔ Packaging verification passed.')
    return
  }

  if (isolationErrors.length > 0) {
    log('')
    log('  ✖ fresh-project verification')
    for (const error of isolationErrors) log(`      - ${error}`)
  }

  log('')
  log('✖ Packaging verification failed.')
  process.exitCode = 1
}

main()
