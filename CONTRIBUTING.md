# Contributing to Soroban-Resurrect

Thank you for your interest in contributing! This document covers everything you need to know to set up the dev environment, follow the project's code and commit standards, run tests, and get your pull request merged.

---

## Table of Contents

- [Dev Environment Setup](#dev-environment-setup)
- [Project Structure](#project-structure)
- [Code Style](#code-style)
- [Testing Requirements](#testing-requirements)
- [Commit Format](#commit-format)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

---

## Dev Environment Setup

### Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 18.x |
| npm | 9.x (ships with Node 18) |
| Git | any recent version |

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

| Command | What it does |
|---------|-------------|
| `npm run build` | Build all packages |
| `npm run build:sdk` | Build only `@soroban-resurrect/sdk` |
| `npm run build:hook` | Build only `@soroban-resurrect/react-hook` |
| `npm test` | Run all unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check all packages without emitting |
| `npm run lint` | Lint all TypeScript source files |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Check formatting |
| `npm run format:fix` | Auto-fix formatting |
| `npm run clean` | Remove all `dist/` directories |

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

## Code Style

### TypeScript

- All source must be written in TypeScript with `strict: true`.
- Avoid `any` where possible. The ESLint rule is set to `off` but using `any` still requires a comment explaining why.
- Prefer explicit return types on exported functions and class methods.
- Use `interface` for object shapes, `type` for unions and aliases.
- Exported symbols must have JSDoc comments explaining purpose, parameters, and return values.

### Formatting (Prettier)

Formatting is enforced by Prettier with these settings (`.prettierrc`):

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

Run `npm run format:fix` before committing to auto-fix any formatting issues.

### Linting (ESLint)

The project uses `typescript-eslint` with `eslint:recommended` and `@typescript-eslint/recommended` rules, relaxed only where documented. Run `npm run lint:fix` to auto-fix what can be fixed automatically.

CI runs `npm run lint` and `npm run format` on every push. Both must pass.

### File and naming conventions

- **Files**: PascalCase for classes (`SorobanResurrect.ts`), camelCase for utilities (`constants.ts`).
- **Exports**: All public exports go through the package `index.ts`. Do not rely on deep imports.
- **Tests**: Co-located in `src/__tests__/`, named `<SourceFile>.test.ts`.

---

## Testing Requirements

This project uses [Vitest](https://vitest.dev/) for unit tests.

### Running tests

```bash
# Run all tests once
npm test

# Watch mode during development
npm run test:watch
```

### Expectations

- **Every new public function or exported class method must have at least one test.**
- Tests must cover the happy path and at least one error/edge-case path.
- Tests must not make real network calls. Use `vi.mock` or manual stubs for the Soroban RPC server and wallet adapters.
- All tests must pass before a PR can be merged. CI runs the full test suite on every push.

### Test file conventions

```typescript
// packages/sdk/src/__tests__/MyModule.test.ts
import { describe, it, expect, vi } from 'vitest'
import { myFunction } from '../MyModule.js'

describe('myFunction', () => {
  it('returns expected result', () => {
    expect(myFunction('input')).toBe('output')
  })

  it('throws on invalid input', () => {
    expect(() => myFunction('')).toThrow('reason')
  })
})
```

---

## Commit Format

This project follows the [Conventional Commits](https://www.conventionalcommits.org/) specification. Every commit message must match:

```
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Use for |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that is neither a fix nor a feature |
| `test` | Adding or fixing tests |
| `chore` | Build process, tooling, dependency updates |
| `perf` | Performance improvement |
| `ci` | CI/CD configuration changes |

### Scopes

Use the package or module being changed:

| Scope | Covers |
|-------|--------|
| `sdk` | `packages/sdk` |
| `react-hook` | `packages/react-hook` |
| `example` | `examples/basic` |
| `ci` | `.github/workflows` |
| `deps` | Dependency updates |

### Examples

```
feat(sdk): add onRestoreStart lifecycle callback

fix(sdk): fix missing RESTORE_FEE_MULTIPLIER import in SorobanResurrect

docs: add CONTRIBUTING.md

test(sdk): add unit tests for Authorization module

chore(deps): bump @stellar/stellar-sdk from 12.0.0 to 12.1.0
```

**Breaking changes** must be indicated with `!` after the scope and a `BREAKING CHANGE:` footer:

```
feat(sdk)!: remove deprecated buildRestoreTx overload

BREAKING CHANGE: The two-argument overload of buildRestoreTx has been
removed. Use the three-argument form instead.
```

---

## Pull Request Process

### Before opening a PR

1. **Branch off `main`** — never commit directly to `main`.
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. **Make your changes** — keep PRs focused on a single concern.
3. **Run the full quality gate locally:**
   ```bash
   npm run typecheck
   npm run lint
   npm run format
   npm test
   ```
4. **Ensure all checks pass** before pushing.

### Opening the PR

- **Title**: follow the Conventional Commits format (same as commit messages).
  Keep it under 70 characters.
- **Description** must include:
  - A summary of what changed and why.
  - Any relevant issue numbers (`Closes #N`).
  - What was tested (commands run, scenarios covered).
  - Any limitations or follow-up work.
- **Draft PRs** are encouraged for work-in-progress to get early feedback.

### Review expectations

- At least **one approving review** from a maintainer is required before merging.
- Maintainers may request changes — address each comment or explain why it should not change.
- Once approved and CI is green, a maintainer will merge using **squash merge** to keep the history clean.

### After merge

Delete your feature branch from your fork. The maintainer will delete the branch from the upstream repo.

---

## Reporting Bugs

Before opening an issue:

1. Search [existing issues](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/issues) to avoid duplicates.
2. Reproduce the bug against the latest version on `main`.

When opening a bug report, include:

- A clear title describing what goes wrong.
- **Steps to reproduce** — minimal code snippet or test case that demonstrates the problem.
- **Expected behavior** — what you expected to happen.
- **Actual behavior** — what actually happened (include error messages and stack traces).
- **Environment** — SDK version, `@stellar/stellar-sdk` version, Node.js version, browser (if applicable).

---

## Requesting Features

Feature requests are welcome. When opening a feature request:

- Describe the problem you are trying to solve, not just the solution.
- Explain the use case — who benefits and how often?
- If you have a proposed API design, include a code example.
- Note any alternatives you considered.

For large or potentially breaking features, it is a good idea to open a discussion issue first before investing time in implementation.

---

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
