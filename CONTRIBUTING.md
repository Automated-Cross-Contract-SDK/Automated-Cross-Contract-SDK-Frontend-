# Contributing to Soroban-Resurrect

Thank you for your interest in contributing! This document covers everything you need to know to set up the dev environment, follow the project's code and commit standards, run tests, and get your pull request merged.

---

## Table of Contents

- [Community & Discussions](#community--discussions)
- [Triage & Issue Labels](#triage--issue-labels)
- [Dev Environment Setup](#dev-environment-setup)
- [Project Structure](#project-structure)
- [Code Style](#code-style)
- [Testing Requirements](#testing-requirements)
- [Commit Format](#commit-format)
- [Pull Request Process](#pull-request-process)
- [Dependency Updates](#dependency-updates)
- [Package Support & Deprecation](#package-support--deprecation)
- [Release Rollback & Incident Response](#release-rollback--incident-response)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

---

## Community & Discussions

The issue tracker is reserved for **bugs** and **scoped feature requests**. Everything else goes to
[GitHub Discussions](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/discussions):

| Category                                                                                                                                     | Who posts        | Use it for                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| [Q&A](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/discussions/categories/q-a)                     | Anyone           | Usage questions and troubleshooting. Mark the answer that solved your problem as accepted. |
| [Ideas](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/discussions/categories/ideas)                 | Anyone           | Early-stage proposals. Scoped, agreed ideas are converted into feature-request issues.     |
| [Show & Tell](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/discussions/categories/show-and-tell)   | Anyone           | Projects built with the SDK — candidates for the [showcase](./docs/showcase.md).           |
| [Announcements](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/discussions/categories/announcements) | Maintainers only | Releases, [roadmap](./docs/roadmap.md) updates, and project news.                          |

- The "New issue" page links to these categories; blank issues are disabled so questions don't land
  in the tracker by accident.
- Maintainers may convert an issue that is really a question into a Q&A discussion, and convert an
  agreed Idea into an issue with the appropriate `epic/*` label.
- Planned work and phase ordering are documented in the [roadmap](./docs/roadmap.md).

---

## Triage & Issue Labels

Maintainers rotate issue triage weekly. The maintainer on rotation owns new
issues for that week and should provide a first response within **5 business
days**. If that person is unavailable, another maintainer should pick up the
issue rather than letting the response window lapse.

When triaging, confirm that the issue is reproducible or sufficiently scoped,
apply the relevant area/priority labels, and identify an owner for work that
needs one. Use `help wanted` for work that needs an outside contributor or
maintainer owner. Do not label a broad epic or multi-package project as a
`good first issue`.

A `good first issue` must be independently completable and its body must name
the likely files or package to change and a command that verifies the result.
Prefer a focused documentation, test, or isolated implementation task; split
epics into smaller issues before inviting a newcomer to take them.

The stale workflow marks issues stale after **60 days** without activity and
closes them **14 days** later. Issues labelled `good first issue` or
`help wanted` are exempt while they are actively recruiting a contributor.
Pull requests are marked stale after **30 days** and closed **14 days** later;
dependency update PRs are exempt. A contributor can keep an issue or PR open
by commenting with a brief status update.

---

## Dev Environment Setup

### Prerequisites

| Tool    | Minimum version          |
| ------- | ------------------------ |
| Node.js | 18.x                     |
| npm     | 9.x (ships with Node 18) |
| Git     | any recent version       |

### Steps

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/Automated-Cross-Contract-SDK-Frontend-.git
cd Automated-Cross-Contract-SDK-Frontend-

# 2. Install all workspace dependencies (root + packages + examples)
npm install

# 3. Build all packages
npm run build

# 4. Run the example app
npm run dev:example
```

### Useful scripts

| Command                            | What it does                                                          |
| ---------------------------------- | --------------------------------------------------------------------- |
| `npm run build`                    | Build all packages                                                    |
| `npm run build:sdk`                | Build only `@soroban-resurrect/sdk`                                   |
| `npm run build:hook`               | Build only `@soroban-resurrect/react-hook`                            |
| `npm run verify`                   | Pre-PR gate: typecheck, lint, format, test, build (all packages)      |
| `npm test`                         | Run all unit tests                                                    |
| `npx vitest run <path>`            | Run tests matching a path across all packages from the repo root      |
| `npm run test:watch`               | Run tests in watch mode                                               |
| `npm run typecheck`                | Type-check all packages without emitting                              |
| `npm run lint`                     | Lint all TypeScript source files                                      |
| `npm run lint:fix`                 | Auto-fix lint issues                                                  |
| `npm run benchmark:imports`        | Measure cold import time per package entry vs. the committed baseline |
| `npm run benchmark:imports:update` | Regenerate the import-time baseline (run on a CI-class runner)        |
| `npm run format`                   | Check formatting                                                      |
| `npm run format:fix`               | Auto-fix formatting                                                   |
| `npm run clean`                    | Remove all `dist/` directories                                        |

---

## Project Structure

```
├── packages/
│   ├── sdk/                          # @soroban-resurrect/sdk (core)
│   │   └── src/
│   │       ├── SorobanResurrect.ts   # Main facade class
│   │       ├── Executor.ts           # Full restore-and-submit flow
│   │       ├── Archiver.ts           # Archive detection
│   │       ├── Restorer.ts           # Restore tx builder + polling
│   │       ├── Authorization.ts      # CAP-0046 auth utilities
│   │       ├── SorobanResurrectNetwork.ts  # Network presets
│   │       ├── types.ts              # All public interfaces & types
│   │       ├── constants.ts          # Default values
│   │       └── index.ts              # Public exports
│   └── react-hook/                   # @soroban-resurrect/react-hook
│       └── src/
│           ├── SorobanResurrectContext.tsx
│           ├── useSorobanResurrect.ts
│           └── index.ts
└── examples/
    └── basic/                        # Vite + React demo app
```

Each `packages/*` directory is an independent npm workspace with its own `tsconfig.json`, `package.json`, and `vitest.config.ts`.

---

## Release Rollback & Incident Response

This runbook is the stable, referenced procedure for handling a broken release. It applies to
both published packages (`@soroban-resurrect/sdk`, `@soroban-resurrect/react-hook`). Releases are
cut by [release-please](./.github/workflows/release-please.yml) and published by
[`publish.yml`](./.github/workflows/publish.yml) with npm provenance.

### 1. Detect and confirm

A release is considered broken when any of the following is observed against the published
version:

- The post-publish health check in `publish.yml` fails, or provenance verification fails.
- A consumer reports a regression that reproduces on the published tarball but not on `main`.
- The example app (`examples/basic`) fails to build or run against the published version.

Confirm before acting: reproduce with `npm install @soroban-resurrect/sdk@<version>` in a clean
directory, capture the failing command and output, and check whether the issue also exists on the
previous release. Record findings in the incident issue.

### 2. Assess impact and severity

| Severity | Definition                                                                 | Response target              |
| -------- | -------------------------------------------------------------------------- | ---------------------------- |
| SEV-1    | Broken install/build, data loss, or security issue in a published version  | Acknowledge within 1 hour     |
| SEV-2    | Functional regression with a workaround, or one package affected          | Acknowledge within 1 business day |
| SEV-3    | Cosmetic/docs issue, no functional impact                                  | Next scheduled release       |

Identify affected versions, affected packages, and whether a safe previous version exists.

### 3. Communicate

Open a pinned incident issue using the template below and post an announcement in
[Announcements](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/discussions/categories/announcements).

```
**Incident:** <short title>
**Severity:** SEV-<n>
**Affected versions:** <x.y.z ...>
**Safe version:** <x.y.z or "none">
**Impact:** <what breaks and for whom>
**Status:** investigating | mitigated | resolved
**Next update:** <timestamp>
```

Update the issue at each status change and at least every business day for SEV-1/SEV-2 until
resolved.

### 4. Roll back or forward-fix

Choose **rollback** (deprecate the bad version and repoint `latest`) when the fix is non-trivial,
the regression is severe, or a known-good previous version exists. Choose **forward-fix** (publish
a patch) when the fix is small, well understood, and can ship quickly.

- Rollback: `npm deprecate @soroban-resurrect/sdk@<bad> "Broken release, use <safe>"`, then publish
a corrected patch so `latest` points at a safe version. Never unpublish a version consumers may
have pinned.
- Forward-fix: branch from the release tag, apply the minimal fix, and let release-please cut a
patch release through the normal `publish.yml` flow.

### 5. Direct consumers to a safe version

State the safe version explicitly in the incident issue and announcement, and tell consumers how to
pin it:

```bash
npm install @soroban-resurrect/sdk@<safe-version>
```

For consumers on a caret range, note that `npm update` will pick up the corrected patch once
`latest` is repointed. Deprecated versions remain installable for pinned consumers but emit a
warning; see [Package Support & Deprecation](#package-support--deprecation) for the deprecation
policy and migration notes.

### 6. Post-incident follow-up

Within 5 business days of resolution, add a short post-incident note to the incident issue:
timeline, root cause, why existing tests/health checks missed it, and follow-up issues (with
owners) to add coverage or guardrails. Close the incident only after follow-ups are filed.

---

## Reporting Bugs

/* … existing content continues unchanged … */
