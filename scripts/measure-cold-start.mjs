#!/usr/bin/env node
/**
 * Cold-start import measurement for @soroban-resurrect/sdk.
 *
 * Usage:
 *   node scripts/measure-cold-start.mjs [path/to/sdk-entry.js] [--samples N]
 *
 * Defaults to the built dist entry (packages/sdk/dist/index.js).
 *
 * Spawns a fresh Node process per sample and reports:
 *   - wall-clock time for `await import('<sdk-entry>')` (p50/p90/min/max)
 *   - whether `@stellar/stellar-sdk` was evaluated during that import
 *   - process RSS as a rough memory proxy
 *
 * Eager-load detection is exact for this dependency tree: the Stellar SDK is
 * CommonJS (lib/index.js), and Node evaluates CJS modules through the CJS
 * loader even when they are reached via ESM `import()`, so a module that was
 * evaluated is present in `require.cache`.
 */

import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { resolve, dirname, sep } from 'node:path'

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const entryArg = args.find((a) => !a.startsWith('--')) ?? 'packages/sdk/dist/index.js'
const samplesFlagIdx = args.indexOf('--samples')
const samples = Math.max(
  1,
  Number(samplesFlagIdx !== -1 ? args[samplesFlagIdx + 1] : process.env.SAMPLES) || 10,
)

const entryPath = resolve(entryArg)
const entryUrl = pathToFileURL(entryPath).href

// The probe runs as a child so every sample gets a cold loader, cold JIT and
// (on Linux) a fresh page cache for the module files.
const probe = `
const { performance } = require('node:perf_hooks')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const { dirname } = require('node:path')

const ENTRY_URL = ${JSON.stringify(entryUrl)}

async function main() {
  // Require-resolve from a real file inside the workspace so package
  // resolution walks the same node_modules as the SDK does.
  createRequire(ENTRY_URL)

  const t0 = performance.now()
  await import(ENTRY_URL)
  const t1 = performance.now()

  let eagerLoaded = false
  try {
    const req = createRequire(ENTRY_URL)
    const pkgJsonPath = req.resolve('@stellar/stellar-sdk/package.json')
    const sdkDir = dirname(pkgJsonPath) + require('node:path').sep
    eagerLoaded = Object.keys(req.cache).some((k) => k.startsWith(sdkDir))
  } catch {
    // stellar-sdk not resolvable from the entry — nothing to detect.
  }

  process.stdout.write(
    JSON.stringify({ importMs: t1 - t0, eagerLoaded, rss: process.memoryUsage().rss }) + '\\n',
  )
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ error: String((e && e.message) || e) }) + '\\n')
  process.exit(1)
})
`

function runOnce() {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120_000,
  })
  const line = (res.stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .pop()
  if (!line) {
    throw new Error(`probe failed: ${(res.stderr || res.stdout || 'no output').slice(0, 400)}`)
  }
  const parsed = JSON.parse(line)
  if (parsed.error) throw new Error(`probe error: ${parsed.error}`)
  return parsed
}

// ---------------------------------------------------------------------------
// Run + aggregate
// ---------------------------------------------------------------------------

const results = []
let consecutiveFailures = 0
for (let i = 0; i < samples; i++) {
  try {
    results.push(runOnce())
    consecutiveFailures = 0
  } catch (e) {
    consecutiveFailures++
    console.error(`sample ${i + 1} failed: ${e.message}`)
    if (consecutiveFailures >= 2) {
      console.error('\nAborting — is dist built? Run: npm run build:sdk')
      process.exit(1)
    }
  }
}

if (results.length === 0) process.exit(1)

const times = results.map((r) => r.importMs).sort((a, b) => a - b)
const median = (arr) => {
  const n = arr.length
  return n % 2 ? arr[(n - 1) / 2] : (arr[n / 2 - 1] + arr[n / 2]) / 2
}
const pct = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))]
const eagerCount = results.filter((r) => r.eagerLoaded).length
const rssSorted = results.map((r) => r.rss ?? 0).sort((a, b) => a - b)

console.log('─'.repeat(66))
console.log(`SDK entry : ${entryPath}`)
console.log(`Node      : ${process.version}`)
console.log(`Samples   : ${results.length}/${samples} ok`)
console.log('─'.repeat(66))
console.log(`import time  p50 : ${median(times).toFixed(2)} ms`)
console.log(`import time  p90 : ${pct(0.9).toFixed(2)} ms`)
console.log(`import time  min : ${times[0].toFixed(2)} ms`)
console.log(`import time  max : ${times[times.length - 1].toFixed(2)} ms`)
console.log(`rss (p50)        : ${(median(rssSorted) / 1024 / 1024).toFixed(1)} MiB`)
console.log(
  `@stellar/stellar-sdk eagerly evaluated : ${
    eagerCount === results.length ? 'YES' : eagerCount > 0 ? `SOMETIMES (${eagerCount}/${results.length})` : 'NO'
  }`,
)
console.log('─'.repeat(66))
