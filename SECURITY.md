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
