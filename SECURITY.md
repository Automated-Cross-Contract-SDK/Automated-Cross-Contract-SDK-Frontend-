# Security Policy

## Supported Versions

The `main` branch and the most recent published release of every
`@soroban-resurrect/*` package receive security fixes. Older releases are not
patched — please upgrade to the latest minor version.

| Package                          | Supported |
| -------------------------------- | --------- |
| `@soroban-resurrect/sdk`         | latest    |
| `@soroban-resurrect/react-hook`  | latest    |
| `@soroban-resurrect/vue-hook`    | latest    |
| `@soroban-resurrect/svelte-hook` | latest    |
| adapter packages                 | latest    |

## Reporting a Vulnerability

**Do not open a public issue for security problems.**

Report privately through one of:

- GitHub's **[Report a vulnerability](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/security/advisories/new)**
  private advisory form (preferred).
- Email the maintainers with the details, a proof of concept if available, and
  the affected package/version.

Please include:

- The affected package and version (or commit SHA).
- A description of the impact and how it can be triggered.
- Any known mitigations or workarounds.

### What to expect

| Stage                    | Target                        |
| ------------------------ | ----------------------------- |
| Acknowledgement          | within 3 business days        |
| Initial assessment       | within 7 business days        |
| Fix or mitigation plan   | within 30 days for high/critical |

### Security Triage & Release Ownership

Security triage and emergency patch approvals are coordinated directly by the primary code owners designated in [`.github/CODEOWNERS`](./.github/CODEOWNERS). Security advisories require sign-off from `@micmusjnr20` before public vulnerability disclosure or release tags are cut.

| Public disclosure        | coordinated, after a fix ships |

We ask that you give us a reasonable window to release a fix before any public
disclosure, and we will credit reporters in the release notes unless you prefer
to remain anonymous.

## Dependency Auditing

`npm audit` runs in CI against the **production** dependency trees of the
publishable packages (`packages/*`) on every pull request and on a weekly
schedule (see `.github/workflows/security-audit.yml`). The job **fails on any
`high` or `critical` advisory** in those trees so a vulnerable runtime
dependency cannot be merged or silently regress.

Advisories that only affect `devDependencies` (test runners, bundlers, example
apps) do not block CI because they never ship to consumers of the SDK. They are
still tracked and upgraded on a best-effort basis. Known transitive dev-only
advisories currently accepted:

- `vitest` / `vite` / `@vitest/mocker` — only exploitable when the Vitest UI
  server is run locally; not used in CI or by consumers.

Runtime dependency pins that exist purely for security are declared in the root
`package.json` `overrides` block (currently `undici`, `nanoid`).

## Release Rollback & Incident-Response Runbook

This runbook is the stable, referenced procedure for handling a broken or
vulnerable release. It applies to every `@soroban-resurrect/*` package and to
security incidents reported under this policy. Follow it in order; do not skip
straight to a rollback without confirming impact.

### 1. Detect and confirm

A release is considered *broken* when any of the following is true:

- A published version fails to install, build, or run for a supported consumer.
- A regression is reported against the latest release (via issue, advisory, or
  the canary/health checks in `.github/workflows/publish.yml`).
- A security advisory affects a shipped runtime dependency or package code.

Confirm the report by reproducing against the exact published version
(`npm view <pkg>@<version>` and a clean install), and record the affected
package(s), version(s), and commit SHA.

### 2. Assess impact and severity

| Severity | Criteria                                                        | Response target |
| -------- | --------------------------------------------------------------- | --------------- |
| Critical | Security vulnerability, data loss, or total breakage for all consumers | Immediate; rollback or emergency patch within hours |
| High     | Major functionality broken for most consumers                   | Same day        |
| Medium   | Partial breakage or a workaround exists                         | Within 3 business days |
| Low      | Cosmetic or edge-case issue                                     | Next scheduled release |

### 3. Decide: rollback vs. forward-fix

- **Rollback** when the broken version is the latest and a known-good prior
  version exists, and the fix is not trivial. Deprecate the broken version and
  re-point `latest` to the last good release (see step 5).
- **Forward-fix** when the defect is small, isolated, and a patch can ship
  quickly, or when rolling back would itself break consumers who already
  adopted the new version. Cut a patch release through the normal
  release-please flow.

When in doubt for Critical/High incidents, prefer rollback first to stop the
bleeding, then forward-fix.

### 4. Communicate

- Open a GitHub issue titled `[incident] <package>@<version> — <summary>` and
  pin it.
- For security incidents, coordinate disclosure per the triage section above;
  publish a GitHub Security Advisory once a fix ships.
- Post a short status update covering: affected versions, impact, current
  action (rollback/fix), and the safe version to use. Update it as the incident
  progresses and when it is resolved.

### 5. Roll back or publish a fix

- **Rollback:** `npm deprecate <pkg>@<broken-version> "Broken release — use <safe-version>"`
  and, if `latest` points at the broken version, publish/re-tag the last good
  version as `latest`. Never unpublish a version consumers may already depend
  on; deprecate instead.
- **Forward-fix:** land the fix on `main`, let release-please cut the patch
  release, and verify the published artifact (install + smoke test) before
  announcing.

### 6. Direct consumers to a safe version

State the safe version explicitly in the incident issue and advisory, e.g.:

```sh
npm install @soroban-resurrect/sdk@<safe-version>
```

Consumers can pin to a known-good version in `package.json` (exact version or
`~`/`^` range) until a fixed release is available. Deprecated versions remain
installable but emit a warning pointing at the safe version.

### 7. Post-incident follow-up

- Add a regression test that would have caught the issue.
- Record a short post-mortem in the incident issue: timeline, root cause,
  impact, and follow-up actions with owners.
- Update this runbook or the release workflows if the process itself failed.
