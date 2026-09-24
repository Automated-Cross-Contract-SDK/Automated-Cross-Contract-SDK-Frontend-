#!/usr/bin/env node
/**
 * Measures cold import wall-time for every public package entry point and
 * gates CI against a checked-in baseline.
 *
 * Why: bundle-size checks measure bytes, not the cost of parsing and
 * evaluating a module graph. A hook or wallet adapter can pull a heavy
 * dependency into its entry point and regress cold start without moving the
 * bundle-size needle much.
 *
 * How: each entry is imported by its published specifier inside a *fresh*
 * Node process, so the module registry is empty and the measurement reflects
 * real cold-start parse/eval cost rather than a cache hit. The reported number
 * is the minimum across iterations — the closest we get to the pure import
 * cost, with scheduler/GC noise filtered out.
 *
 * Baseline caveat: absolute timings are machine-dependent. The baseline is a
 * coarse tripwire, not a precise perf gate — the threshold deliberately has a
 * large absolute floor so CI runner variance doesn't produce false failures.
 * Regenerate the baseline on the same class of runner used in CI.
 *
 * Usage:
 *   node scripts/benchmark-imports.mjs                 # measure + compare
 *   node scripts/benchmark-imports.mjs --update        # rewrite the baseline
 *   node scripts/benchmark-imports.mjs --summary out.md
 *   node scripts/benchmark-imports.mjs --entry @soroban-resurrect/sdk
 *
 * Exit code is 1 when any entry exceeds the threshold or fails to import.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PACKAGES_DIR = path.join(ROOT, 'packages')
const BASELINE_PATH = path.join(ROOT, 'benchmarks', 'import-baseline.json')
const CHILD_MARKER = '__IMPORT_BENCH__='
const BASELINE_VERSION = 1

function parseArgs(argv) {
  const args = {
    update: false,
    summary: null,
    json: null,
    iterations: 5,
    maxDeltaMs: 5,
    maxDeltaRatio: 0.5,
    entries: [],
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--update') args.update = true
    else if (arg === '--summary') args.summary = argv[++i]
    else if (arg === '--json') args.json = argv[++i]
    else if (arg === '--iterations') args.iterations = Number(argv[++i])
    else if (arg === '--max-delta-ms') args.maxDeltaMs = Number(argv[++i])
    else if (arg === '--max-delta-ratio') args.maxDeltaRatio = Number(argv[++i])
    else if (arg === '--entry') args.entries.push(argv[++i])
    else if (arg.startsWith('--')) throw new Error(`Unknown flag: ${arg}`)
  }
  return args
}

/** Map a package's `exports` map to `{ specifier, file }` entry descriptors. */
function entryPoints(pkgDir) {
  const pkgPath = path.join(pkgDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const { name, exports } = pkg
  if (!name) return []

  const entries = []
  if (typeof exports === 'string') {
    entries.push({ specifier: name, file: path.join(pkgDir, exports) })
  } else if (exports && typeof exports === 'object') {
    for (const [subpath, target] of Object.entries(exports)) {
      const resolved = typeof target === 'string' ? target : target?.import
      if (typeof resolved !== 'string') continue
      const specifier = subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`
      entries.push({ specifier, file: path.join(pkgDir, resolved) })
    }
  }
  return entries
}

function discoverEntries() {
  if (!existsSync(PACKAGES_DIR)) return []
  const entries = []
  for (const dir of readdirSync(PACKAGES_DIR).sort()) {
    const pkgDir = path.join(PACKAGES_DIR, dir)
    if (!existsSync(path.join(pkgDir, 'package.json'))) continue
    entries.push(...entryPoints(pkgDir))
  }
  return entries
}

/**
 * Child mode: import one specifier and report wall-time. Run in its own
 * process so every measurement starts from an empty module registry.
 */
async function runChild(specifier) {
  const start = performance.now()
  try {
    await import(specifier)
    const ms = performance.now() - start
    process.stdout.write(`${CHILD_MARKER}${JSON.stringify({ ok: true, ms })}\n`)
  } catch (err) {
    process.stdout.write(
      `${CHILD_MARKER}${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`,
    )
    process.exitCode = 1
  }
}

/** Spawn a fresh process per iteration and collect its timing. */
function measureEntry(specifier, iterations) {
  const samples = []
  let error = null
  for (let i = 0; i < iterations; i += 1) {
    try {
      const out = execFileSync(
        process.execPath,
        [fileURLToPath(import.meta.url), '--child', specifier],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      const line = out.split('\n').find((l) => l.startsWith(CHILD_MARKER))
      if (!line) throw new Error('child produced no result')
      const result = JSON.parse(line.slice(CHILD_MARKER.length))
      if (!result.ok) {
        error = result.error
        break
      }
      samples.push(result.ms)
    } catch (err) {
      // A non-zero exit still carries the child's stdout on the error object.
      const out = err.stdout ?? ''
      const line = out.split('\n').find((l) => l.startsWith(CHILD_MARKER))
      if (line) {
        const result = JSON.parse(line.slice(CHILD_MARKER.length))
        error = result.error ?? 'import failed'
      } else {
        error = err.message
      }
      break
    }
  }
  return { samples, error }
}

function median(nums) {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

const round = (n, places = 2) => (n == null ? null : Number(n.toFixed(places)))

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
}

/** Fail when `measured - baseline` clears both the absolute and relative allowance. */
function evaluate(measured, baseline, maxDeltaMs, maxDeltaRatio) {
  if (baseline == null) return { status: 'new' }
  const delta = measured - baseline
  const allowance = Math.max(maxDeltaMs, baseline * maxDeltaRatio)
  return { status: delta > allowance ? 'fail' : 'pass', delta, allowance }
}

function formatTable(rows) {
  const header = ['entry', 'baseline', 'min', 'median', 'delta', 'status']
  const cells = rows.map((r) => [
    r.specifier,
    r.baseline == null ? '—' : r.baseline.toFixed(1),
    r.min == null ? '—' : r.min.toFixed(1),
    r.median == null ? '—' : r.median.toFixed(1),
    r.delta == null ? '—' : `${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(1)}`,
    r.error ? 'ERROR' : r.status,
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)))
  const line = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join('  ')
  const sep = widths.map((w) => '─'.repeat(w)).join('  ')
  return [line(header), sep, ...cells.map(line)].join('\n')
}

function markdownSummary(rows, failed) {
  const lines = ['## Import cold-start benchmark', '']
  lines.push('Cold import wall-time per package entry (min of iterations, milliseconds).', '')
  lines.push('| Entry | Baseline | Min | Median | Δ | Status |')
  lines.push('| --- | ---: | ---: | ---: | ---: | :--- |')
  for (const r of rows) {
    const delta = r.delta == null ? '—' : `${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(1)}`
    const status = r.error
      ? `❌ ${r.error}`
      : r.status === 'fail'
        ? '❌ over threshold'
        : r.status === 'new'
          ? 'new'
          : '✅'
    lines.push(
      `| \`${r.specifier}\` | ${r.baseline?.toFixed(1) ?? '—'} | ${r.min?.toFixed(1) ?? '—'} | ${
        r.median?.toFixed(1) ?? '—'
      } | ${delta} | ${status} |`,
    )
  }
  lines.push('')
  lines.push(
    failed
      ? 'One or more entries regressed past the import-time threshold or failed to import. Investigate before merging.'
      : 'All entries within threshold.',
  )
  return lines.join('\n')
}

async function main() {
  const argv = process.argv.slice(2)
  const childIndex = argv.indexOf('--child')
  if (childIndex !== -1) {
    await runChild(argv[childIndex + 1])
    return
  }

  const args = parseArgs(argv)
  if (!Number.isInteger(args.iterations) || args.iterations < 1) {
    throw new Error(`--iterations must be a positive integer, got: ${args.iterations}`)
  }
  let entries = discoverEntries()
  if (args.entries.length > 0) {
    entries = entries.filter((e) => args.entries.includes(e.specifier))
  }

  const missing = entries.filter((e) => !existsSync(e.file))
  if (missing.length > 0) {
    console.error('✖ Missing built entry points — run `npm run build` first:')
    for (const m of missing) console.error(`  - ${m.specifier} (${path.relative(ROOT, m.file)})`)
    process.exit(1)
  }

  const baseline = loadBaseline()
  const baselineEntries = baseline?.entries ?? {}
  const maxDeltaMs = args.maxDeltaMs
  const maxDeltaRatio = args.maxDeltaRatio

  const rows = []
  for (const entry of entries) {
    const { samples, error } = measureEntry(entry.specifier, args.iterations)
    const min = samples.length > 0 ? Math.min(...samples) : null
    const baselineMs = baselineEntries[entry.specifier] ?? null
    const verdict =
      error || min == null
        ? { status: 'error' }
        : evaluate(min, baselineMs, maxDeltaMs, maxDeltaRatio)
    rows.push({
      specifier: entry.specifier,
      baseline: baselineMs,
      min: round(min),
      median: round(median(samples)),
      iterations: samples.length,
      delta: verdict.delta == null ? null : round(verdict.delta),
      allowance: verdict.allowance == null ? null : round(verdict.allowance),
      status: verdict.status,
      error,
    })
  }

  const errored = rows.some((r) => r.status === 'error')
  const regressed = rows.some((r) => r.status === 'fail')
  const failed = errored || regressed

  if (args.update) {
    const sortedEntries = Object.fromEntries(
      rows.filter((r) => r.min != null).map((r) => [r.specifier, round(r.min)]),
    )
    const next = {
      version: BASELINE_VERSION,
      generatedAt: new Date().toISOString(),
      node: process.version,
      config: { iterations: args.iterations, maxDeltaMs, maxDeltaRatio },
      entries: { ...baselineEntries, ...sortedEntries },
    }
    mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`)
    console.log(
      `✓ Wrote baseline for ${Object.keys(sortedEntries).length} entries to ${path.relative(ROOT, BASELINE_PATH)}`,
    )
  } else if (!baseline) {
    console.warn(
      '⚠ No baseline found — reporting measurements only. Run with --update to create one.',
    )
  }

  console.log(`\n${formatTable(rows)}\n`)

  const erroredRows = rows.filter((r) => r.error)
  if (erroredRows.length > 0) {
    console.error('Import failures:')
    for (const r of erroredRows) console.error(`  - ${r.specifier}: ${r.error}`)
    console.error('')
  }

  console.log(
    `Threshold: fail when delta > max(${maxDeltaMs}ms, baseline × ${maxDeltaRatio}). ` +
      `Iterations per entry: ${args.iterations}.`,
  )

  if (args.summary) {
    const summary = markdownSummary(rows, failed)
    mkdirSync(path.dirname(path.resolve(args.summary)), { recursive: true })
    writeFileSync(args.summary, summary)
  }

  if (args.json) {
    mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true })
    writeFileSync(
      args.json,
      `${JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, failed, entries: rows }, null, 2)}\n`,
    )
  }

  // An import that throws always fails, even while regenerating the baseline:
  // otherwise we would silently keep a stale baseline for an entry we could not
  // measure. A threshold breach only fails the normal (non-update) run.
  if (errored || (regressed && !args.update)) {
    console.error(
      errored
        ? '\n✖ One or more package entries failed to import.'
        : '\n✖ Import cold-start regression detected.',
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
