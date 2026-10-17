## Summary

- Publish a root `ROADMAP.md` with all 11 epics, representative issues, explicit out-of-scope boundaries, and links to GitHub Projects and repository milestones.
- Add a Stellar ecosystem listing tracker with a consistent project description, documentation/example links, submission status, and a next-major-release re-check reminder.
- Add deterministic active, near-expiry, archived, missing, and unsupported ledger-entry fixtures and verify their TTL behavior.
- Enforce explicit coverage thresholds for the SDK's transaction construction, archival detection, and execution orchestration modules.
- Repair SDK restore/facade regressions in RPC rebinding, fee diagnostics, input validation, and compatibility exports.

Resolves #434, #551, and #552; prepares the documentation and submission tracker for #435.

- Publish a compatibility matrix for all supported wallet adapters, including signing behavior, required setup/options, limitations, and the locked provider API versions.
- Validate SDK URLs, timing values, fee settings, and incompatible archive-detection options at construction time with field-specific errors.
- Add `getEffectiveConfig()` to return validated settings with defaults applied, without constructing runtime RPC/cache resources.
- Add validated per-request restore workflow overrides while keeping the instance configuration frozen and unchanged.

## Behavior notes

- `npm run test -w packages/sdk -- --coverage --reporter=dot` — 978 tests passed and module coverage floors met.
- Prettier checks on changed files and `git diff --check` passed.
- `npm run typecheck -w packages/sdk` remains blocked by unresolved SDK TypeScript errors in archival-entry, executor, restore-machine, restorer, configuration, and result types.
- Repository-wide `npm run format` remains blocked by unrelated baseline formatting issues and a syntax error in `src/react/index.ts`; changed files are formatted.

## External listing status

The official Stellar ecosystem directory, `stellar/awesome-stellar`, and the SDF community listing are documented as submission targets. No external listing is claimed as complete until its maintainers accept the entry; the tracker records the follow-up required.
