#!/usr/bin/env node
/**
 * Per-entry-point bundle budgets + tree-shaking fixture (#423).
 *
 * 1. For every publishable package, bundles each `exports` entry (from the
 *    built `dist/`) with esbuild — dependencies external, minified — and
 *    compares the gzipped size to `scripts/bundle-budgets.json`. Any entry
 *    over budget fails CI and is named in the output.
 * 2. Bundles a fixture that imports only `SorobanResurrect` from the SDK
 *    source and asserts hardware and authorization modules are tree-shaken.
 *
 * Usage:
 *   npm run build && node scripts/check-bundle-budgets.mjs
 *   node scripts/check-bundle-budgets.mjs --update   # rewrite budgets (+10% headroom)
 *   node scripts/check-bundle-budgets.mjs --summary out.md
 */
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const budgetsPath = join(root, 'scripts', 'bundle-budgets.json')
const args = process.argv.slice(2)
const update = args.includes('--update')
const summaryPath = args.includes('--summary') ? args[args.indexOf('--summary') + 1] : null

const budgets = existsSync(budgetsPath) ? JSON.parse(readFileSync(budgetsPath, 'utf8')) : {}
const HEADROOM = 1.1
const rows = []
const failures = []

function importPath(target) {
  if (typeof target === 'string') return target
  return target?.import ?? target?.default ?? null
}

async function bundleSize(entry, external) {
  const res = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    minify: true,
    format: 'esm',
    platform: 'browser',
    external,
    logLevel: 'silent',
  })
  const code = res.outputFiles[0].contents
  return { raw: code.length, gzip: gzipSync(code).length }
}

for (const dir of readdirSync(join(root, 'packages'))) {
  const pkgDir = join(root, 'packages', dir)
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgJsonPath)) continue
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  if (pkg.private) continue
  const external = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ].flatMap((d) => [d, `${d}/*`])
  const exportsMap =
    typeof pkg.exports === 'object' && !pkg.exports.import ? pkg.exports : { '.': pkg.exports ?? pkg.main }

  for (const [subpath, target] of Object.entries(exportsMap)) {
    const rel = importPath(target)
    if (!rel || !/\.(m?js)$/.test(rel)) continue
    const file = join(pkgDir, rel)
    const id = `${pkg.name}${subpath === '.' ? '' : subpath.slice(1)}`
    if (!existsSync(file)) {
      failures.push(`${id}: ${rel} not found — run \`npm run build\` first`)
      continue
    }
    const { raw, gzip } = await bundleSize(file, external)
    const budget = budgets[id]
    const over = budget !== undefined && gzip > budget
    rows.push({ id, raw, gzip, budget, over })
    if (update) budgets[id] = Math.ceil(gzip * HEADROOM)
    else if (over) failures.push(`${id}: ${gzip} B gzip exceeds budget ${budget} B`)
    else if (budget === undefined) console.warn(`warning: ${id} has no budget in scripts/bundle-budgets.json (run with --update)`)
  }
}

// Tree-shaking fixture: importing only SorobanResurrect must not pull in
// hardware-wallet or authorization code.
const FORBIDDEN = ['HardwareWalletAdapters.ts', 'Authorization.ts', 'MultiSigWalletAdapter.ts']
const sdkPkg = JSON.parse(readFileSync(join(root, 'packages/sdk/package.json'), 'utf8'))
const fixture = await build({
  stdin: {
    contents: "export { SorobanResurrect } from './packages/sdk/src/index.ts'",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  metafile: true,
  format: 'esm',
  platform: 'browser',
  external: Object.keys(sdkPkg.dependencies ?? {}).flatMap((d) => [d, `${d}/*`]),
  logLevel: 'silent',
})
const included = Object.values(fixture.metafile.outputs).flatMap((o) =>
  Object.entries(o.inputs)
    .filter(([, v]) => v.bytesInOutput > 0)
    .map(([k]) => k),
)
for (const mod of FORBIDDEN) {
  if (included.some((p) => p.endsWith(mod))) {
    failures.push(`tree-shaking: SorobanResurrect-only import includes ${mod}`)
  }
}

if (update) writeFileSync(budgetsPath, JSON.stringify(budgets, null, 2) + '\n')

const table = [
  '| Entry point | Raw (B) | Gzip (B) | Budget (B) | Status |',
  '| --- | ---: | ---: | ---: | --- |',
  ...rows.map(
    (r) => `| \`${r.id}\` | ${r.raw} | ${r.gzip} | ${r.budget ?? '—'} | ${r.over ? '❌ over' : '✅'} |`,
  ),
].join('\n')
console.log(table)
if (summaryPath) appendFileSync(summaryPath, `## Bundle budgets\n\n${table}\n`)

if (!update && failures.length) {
  console.error('\nBundle budget check failed:\n' + failures.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
