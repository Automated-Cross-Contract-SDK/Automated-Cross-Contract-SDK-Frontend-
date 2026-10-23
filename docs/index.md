---
layout: home

hero:
  name: Soroban-Resurrect
  text: Automated Cross-Contract State Restoration SDK
  tagline: Detects archived Soroban ledger entries and restores them automatically before submitting your transaction.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/sdk
    - theme: alt
      text: View on GitHub
      link: https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-

features:
  - title: Automatic Restoration
    details: Implements the full CAP-0066 restore flow — simulate, detect, build restore tx, sign, submit, then resubmit the original transaction.
  - title: Proactive TTL Management
    details: Watch ledger entry TTLs and extend them before they expire with watchTTL, thresholdLedgers, and autoExtend.
  - title: Wallet-Agnostic
    details: Works with any wallet through a small WalletAdapter interface (Freighter, xBull, custom signers, etc.).
  - title: React-Ready
    details: Ship a context provider and a standalone hook so React dApps get progress state (idle → simulating → signing → success) for free.
  - title: Typed End-to-End
    details: Written in TypeScript with a fully typed public API — config, results, callbacks, and state machine are all exported types.
---

## Documentation Versions

This site serves documentation for each supported package release. Use the
**version selector** in the navigation bar to switch between versions; the
active version is shown next to the selector.

| Version | Status | Notes |
| --- | --- | --- |
| `latest` | Current release | Tracks the most recent published package. |
| `v1.x` | Supported | Stable public API; see migration notes when upgrading from `v0.x`. |
| `v0.x` | Legacy | No longer receiving features; upgrade to `v1.x`. |

Version identifiers match the published package releases. If you are unsure
which version applies to your project, check the `soroban-resurrect` dependency
version in your `package.json`.

### Migration notes

- `v0.x` → `v1.x`: the restore flow and TTL helpers are unchanged, but several
  config fields were renamed. Consult the `v1.x` API reference for the current
  names before upgrading.
- Documentation for a version is only available while that release is
  supported. Unsupported versions are removed from the selector.
