#!/usr/bin/env node
/**
 * Gates CI on `npm audit` for production dependencies.
 *
 * Fails the build on any high/critical advisory that isn't listed in
 * `security/audit-allowlist.json`. An allowlist entry must include a reason
 * and an `expires` date (YYYY-MM-DD); once an entry expires it stops
 * suppressing the advisory, forcing periodic re-review instead of a
 * permanent bypass.
 *
 * Usage: node scripts/check-audit.mjs
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ALLOWLIST_PATH = path.join(__dirname, '..', 'security', 'audit-allowlist.json')
const GATED_SEVERITIES = new Set(['high', 'critical'])

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
  const today = new Date().toISOString().slice(0, 10)
  const active = new Set()
  const expired = []
  for (const entry of raw) {
    if (entry.expires < today) {
      expired.push(entry)
    } else {
      active.add(entry.id)
    }
  }
  return { active, expired }
}

function runAudit() {
  try {
    const out = execSync('npm audit --omit=dev --json', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 })
    return JSON.parse(out)
  } catch (err) {
    // npm audit exits non-zero when vulnerabilities are found — stdout still has the report.
    if (err.stdout) return JSON.parse(err.stdout)
    throw err
  }
}

function collectAdvisoryIds(vuln) {
  const ids = new Set()
  for (const via of vuln.via ?? []) {
    if (typeof via === 'object' && via.url) {
      const match = via.url.match(/GHSA-[a-z0-9-]+/i)
      if (match) ids.add(match[0])
    }
  }
  return ids
}

function main() {
  const { active: allowlist, expired } = loadAllowlist()
  const report = runAudit()
  const vulnerabilities = report.vulnerabilities ?? {}

  const failures = []
  for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
    if (!GATED_SEVERITIES.has(vuln.severity)) continue

    // `via` holds either advisory objects (this package has its own GHSA
    // advisory) or plain package-name strings (this package is only
    // affected transitively — the real advisory is reported under that
    // dependency's own entry, which we gate separately). Skip pure
    // aggregator entries so we don't double-flag the same advisory.
    const advisoryIds = collectAdvisoryIds(vuln)
    const isPureAggregator = advisoryIds.size === 0 && (vuln.via ?? []).every((v) => typeof v === 'string')
    if (isPureAggregator) continue

    const unallowlisted = advisoryIds.size === 0
      ? [`${pkgName} (${vuln.severity}, no advisory id — treat as unresolved)`]
      : [...advisoryIds].filter((id) => !allowlist.has(id))

    if (unallowlisted.length > 0) {
      failures.push({ pkgName, severity: vuln.severity, ids: unallowlisted })
    }
  }

  if (expired.length > 0) {
    console.warn('⚠ Expired audit-allowlist entries (no longer suppressing their advisory):')
    for (const e of expired) {
      console.warn(`  - ${e.id} expired ${e.expires} (${e.reason})`)
    }
  }

  if (failures.length > 0) {
    console.error(`\n✖ npm audit found ${failures.length} unallowlisted high/critical production advisories:\n`)
    for (const f of failures) {
      console.error(`  - ${f.pkgName} [${f.severity}]: ${f.ids.join(', ')}`)
    }
    console.error(
      '\nRemediate (npm audit fix / upgrade) or add a time-boxed entry to security/audit-allowlist.json with a reason.',
    )
    process.exit(1)
  }

  const meta = report.metadata?.vulnerabilities ?? {}
  console.log(
    `✓ npm audit gate passed (production deps): ${meta.critical ?? 0} critical, ${meta.high ?? 0} high — all allowlisted or absent.`,
  )
}

main()
