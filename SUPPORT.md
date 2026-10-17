# Package support policy

This policy applies to packages in this repository. A package's support status
describes the project's maintenance commitment; it does not guarantee that a
third-party wallet, RPC provider, or framework will remain available or
compatible.

## Package status

| Package | Status | Scope |
| --- | --- | --- |
| `@soroban-resurrect/sdk` | Active, supported | Core restore workflow and public SDK API. |
| `@soroban-resurrect/react-hook` | Active, supported | React integration. |
| `@soroban-resurrect/vue-hook` | Active, supported | Vue integration. |
| `@soroban-resurrect/svelte-hook` | Active, supported | Svelte integration. |
| `@soroban-resurrect/adapter-albedo` | Active, supported | Albedo wallet integration, subject to Albedo's API. |
| `@soroban-resurrect/adapter-freighter` | Active, supported | Freighter wallet integration, subject to Freighter's API. |
| `@soroban-resurrect/adapter-lobstr` | Active, supported | Lobstr wallet integration, subject to Lobstr's API. |
| `@soroban-resurrect/adapter-rabet` | Active, supported | Rabet wallet integration, subject to Rabet's API. |
| `@soroban-resurrect/adapter-walletconnect` | Active, supported | WalletConnect integration, subject to WalletConnect's API. |
| `@soroban-resurrect/adapter-walletkit` | Active, supported | Stellar Wallets Kit integration, subject to its API. |
| `@soroban-resurrect/adapter-xbull` | Active, supported | xBull wallet integration, subject to xBull's API. |
| `create-soroban-resurrect` | Active, supported | Project scaffolding and its generated template. |
| `@soroban-resurrect/testing` | Preview, best-effort | Test utilities; not a production runtime dependency or stable application API. |

The support list is reviewed when packages are added, archived, or transferred.
An adapter may be marked best-effort or retired if its upstream wallet is
unmaintained; such a change will be announced in the changelog and release
notes.

## Version compatibility

All currently published `0.x` packages are pre-1.0. Before `1.0.0`, a minor
release (`0.y.0`) may include breaking changes; patch releases are intended for
backward-compatible fixes. Breaking changes will be called out in release
notes, and migration guidance will be added when a change requires consumer
action. Consumers should pin versions and review the changelog before updating.

After a package reaches `1.0.0`, the project follows Semantic Versioning:
breaking API changes require a major release, while minor releases add
backward-compatible functionality and patch releases fix bugs.

For each supported release line, the project aims to accept and publish
security and critical bug fixes for the current minor and the two immediately
preceding minor versions when those versions exist. This is a maintenance
window, not a promise that every older minor receives every feature or fix.
Support for an older line may end earlier when an upstream dependency or
protocol version is no longer viable; that change will be announced.

## API boundary

Only symbols exported from a package's documented entry point are public API.
Implementation modules and unexported helpers are internal and may change
without notice. See [DEPRECATION.md](./DEPRECATION.md) for the procedure used
when a public API is scheduled for removal.
