# Showcase: Who Uses Soroban-Resurrect

Soroban-Resurrect is used to keep Soroban dApps working when persistent ledger entries are archived.
This page lists projects that use the SDK so newcomers can see real integration patterns and
maintainers can prioritise what matters to users.

**Using Soroban-Resurrect in your project? [Add it to the showcase](#add-your-project).**

## Community projects

Projects built by teams and individuals outside this repository. Listings are added with the
project owner's permission.

| Project             | Category | Description                                                    | Links |
| ------------------- | -------- | -------------------------------------------------------------- | ----- |
| _Your project here_ | —        | Be the first! See [Add your project](#add-your-project) below. | —     |

## Reference integrations

Maintained in this repository and kept in sync with every release. Use them as starting points or
as a reference when reporting integration issues.

| Project                | Category                | Description                                                                                            | Links                                                                                                                                |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Basic React dApp       | Example · React / Vite  | Minimal Vite + React app wiring `SorobanResurrectProvider` and a single restore-aware transaction.     | [Source](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/basic)            |
| Multi-contract dApp    | Example · DeFi / React  | One shared provider driving several independent contracts through a single restore workflow.           | [Source](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/multi-contract)   |
| Next.js App Router     | Example · Next.js / SSR | SDK + React hook in a Next.js 14 App Router app, split across the server/client boundary.              | [Source](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/nextjs-app)       |
| React Native wallet    | Example · Mobile        | `@soroban-resurrect/react-hook` in a bare React Native app, including the required Node polyfills.     | [Source](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/react-native)     |
| Vanilla JS             | Example · No framework  | Direct `SorobanResurrect` usage with `onStateChange` subscriptions and no UI framework.                | [Source](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/vanilla-js)       |
| Interactive playground | Docs · Sandbox          | In-browser restore flow against a fake RPC client with canned responses — no wallet or testnet needed. | [Docs](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/blob/main/docs/examples/playground.md) |

## Categories

Use one of these categories (optionally with a sub-type, e.g. `DeFi · Lending`) so the list stays
easy to scan:

| Category        | Examples                                                  |
| --------------- | --------------------------------------------------------- |
| DeFi            | Lending, DEXs, yield vaults, stablecoins                  |
| Wallet          | Browser, mobile, and hardware wallets integrating restore |
| Payments        | Remittance, invoicing, point-of-sale                      |
| NFT & Gaming    | Marketplaces, games, collectibles                         |
| Infrastructure  | Indexers, relayers, RPC services, TTL monitoring bots     |
| Developer Tools | Libraries, templates, CLIs built on top of the SDK        |
| Example         | Tutorials and demo apps                                   |

## Add your project

We welcome any public project that uses a `@soroban-resurrect/*` package — production dApps,
hackathon entries, and open-source tools alike.

1. **Check eligibility.** The project must be publicly accessible (live URL or public repository)
   and must use at least one `@soroban-resurrect/*` package. You must own the project or have the
   owner's permission to list it.
2. **Edit this file.** Open a pull request that adds one row to the
   [Community projects](#community-projects) table in
   [`docs/showcase.md`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/blob/main/docs/showcase.md)
   (remove the _Your project here_ placeholder row when adding the first entry):

   ```markdown
   | [Project name](https://project.example) | DeFi · Lending | One sentence on what it does and how it uses the SDK. | [Site](https://project.example) · [Source](https://github.com/org/repo) |
   ```

   - Keep the description to a single sentence (max ~120 characters) and focused on what the
     project does and how it uses the SDK.
   - Link text should be `Site`, `Source`, `Docs`, or `Demo`.
   - Keep rows sorted alphabetically by project name.
   - Optionally add a short testimonial under the table as a quote attributed to the project.
3. **Use the commit format.** Title your PR `docs(showcase): add <project name>`, following the
   [commit conventions](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/blob/main/CONTRIBUTING.md#commit-format).
4. **Prefer not to open a PR?** Post in
   [Discussions → Show & Tell](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/discussions/categories/show-and-tell)
   and tick "I'm happy for maintainers to feature this project" — a maintainer will add it for you.

Maintainers review submissions for eligibility and working links. Entries whose links stop
resolving, or that no longer use the SDK, may be removed; the owner can re-submit at any time.
