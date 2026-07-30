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
  - title: Wallet-Agnostic
    details: Works with any wallet through a small WalletAdapter interface (Freighter, xBull, custom signers, etc.).
  - title: React-Ready
    details: Ship a context provider and a standalone hook so React dApps get progress state (idle → simulating → signing → success) for free.
  - title: Typed End-to-End
    details: Written in TypeScript with a fully typed public API — config, results, callbacks, and state machine are all exported types.
---
