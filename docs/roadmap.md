# Roadmap

This page maps the project's epic backlog to three release phases so contributors can see what is
being worked on now, what comes next, and where their help has the most impact.

- **Project board:** [GitHub Projects — Automated-Cross-Contract-SDK](https://github.com/orgs/Automated-Cross-Contract-SDK/projects)
- **Epic labels:** every backlog issue carries exactly one `epic/*` label (listed below)
- **Discussion:** roadmap changes are announced in
  [Discussions → Announcements](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/discussions/categories/announcements);
  propose changes in [Discussions → Ideas](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/discussions/categories/ideas)

> The roadmap is a plan, not a promise. Phases are ordered by dependency and risk; dates are set
> as milestones when a phase starts.

## Phases at a glance

| Phase | Milestone  | Goal                                                                                           | Primary epics                                                                       |
| ----- | ---------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1     | `v0.2`     | `main` compiles, every documented API behaves as documented, and the test suite is trustworthy | `epic/sdk-core`, `epic/framework-hooks`, `epic/testing`, `epic/security`, `epic/ci` |
| 2     | `v1.0`     | Stable, fully documented public API with complete wallet coverage and release automation       | `epic/docs`, `epic/adapters`, `epic/performance`, `epic/security`, `epic/ci`        |
| 3     | `post-1.0` | Grow adoption: richer examples, contributor tooling, and ecosystem presence                    | `epic/example-apps`, `epic/dx`, `epic/ecosystem`, `epic/performance`                |

Some epics span phases: the phase an individual issue belongs to is decided by the rules in each
section below, and recorded on the project board's **Phase** field.

## Phase 1 — v0.2 Hardening

**Exit criteria:** the monorepo builds and type-checks cleanly, all correctness bugs against the
documented API are fixed, core modules have unit tests, and security-relevant validation runs
before any wallet signature is requested.

| Epic label             | Scope in this phase                                                                              | Representative issues                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `epic/sdk-core`        | Compile fixes, config resolution/validation, documented-but-unimplemented behavior, error shapes | #363, #364, #365, #366, #368, #369, #370, #371, #374, #376, #377, #382 |
| `epic/framework-hooks` | Compile fixes, SSR safety, render-time instantiation, config-change and teardown correctness     | #383, #384, #385, #390, #392, #394                                     |
| `epic/testing`         | Unit coverage for core modules and flows                                                         | #297, #298, #299, #300, #302, #303, #304                               |
| `epic/security`        | Pre-signing validation and bounded fan-out                                                       | #315, #316, #429, #430, #432                                           |
| `epic/ci`              | Every PR proves the repo still works                                                             | #290, #292                                                             |

## Phase 2 — v1.0 Production Readiness

**Exit criteria:** every public API is documented with examples, all supported wallets pass a
shared adapter harness, performance budgets are enforced in CI, and releases are published with
provenance.

| Epic label             | Scope in this phase                                                                                 | Representative issues                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `epic/docs`            | Complete API reference, conceptual guides, error-code reference, published docs site                | #276, #277, #278, #280, #287, #395, #396, #397, #398, #399, #400, #401, #402, #403, #404 |
| `epic/adapters`        | Capability flags, standard errors, network checks, test harness (all delivered — verify before 1.0) | #261, #262, #263, #265, #267                                                             |
| `epic/framework-hooks` | API parity across React, Vue, and Svelte                                                            | #386, #387, #388, #389, #391, #393                                                       |
| `epic/performance`     | Bounded caches and history, bundle and cold-start budgets                                           | #419, #420, #423, #425, #426                                                             |
| `epic/security`        | Supply chain, provenance, threat model, storage of sensitive data                                   | #314, #317, #427, #428, #431                                                             |
| `epic/ci`              | Release safety and cross-platform coverage                                                          | #288, #289, #293, #294                                                                   |
| `epic/testing`         | Public API type tests and property-based tests                                                      | #296, #301, #305                                                                         |
| `epic/ecosystem`       | Support-window policy that 1.0 commits to                                                           | #437                                                                                     |

## Phase 3 — Post-1.0 Scale

**Exit criteria:** none — this phase is continuous. Work is prioritised by community demand
(Discussions upvotes and showcase feedback).

| Epic label          | Scope in this phase                                           | Representative issues                                                  |
| ------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `epic/example-apps` | Examples for every framework, wallet, and advanced flow       | #268, #270, #274, #275, #411, #412, #413, #414, #415, #416, #417, #418 |
| `epic/dx`           | Onboarding and contributor tooling                            | #318, #319, #405, #406, #407, #408, #409, #410                         |
| `epic/ecosystem`    | Community channels, discoverability, governance, and adoption | #322, #323, #324, #325, #433, #434, #435, #436, #438                   |
| `epic/performance`  | Further RPC and detection optimisations                       | #306, #307, #308, #309, #310, #311, #421, #422, #424                   |
| `epic/docs`         | Deep-dives and long-form guides                               | #279, #281, #282, #283, #284, #285, #286                               |
| `epic/sdk-core`     | New capabilities beyond the 1.0 surface                       | See the `epic/sdk-core` label for open feature issues                  |

## Epic label index

| Label                  | Area                                           | Phases | Issues                                                                                                                        |
| ---------------------- | ---------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `epic/sdk-core`        | Core restore flow, config, TTL, fees, errors   | 1, 3   | [label](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/labels/epic%2Fsdk-core)        |
| `epic/framework-hooks` | React, Vue, Svelte, and React Native bindings  | 1, 2   | [label](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/labels/epic%2Fframework-hooks) |
| `epic/adapters`        | Wallet adapter packages                        | 2      | [label](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/labels/epic%2Fadapters)        |
| `epic/testing`         | Unit, integration, property, and type tests    | 1, 2   | [label](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/labels/epic%2Ftesting)         |
| `epic/security`        | Signing safety, supply chain, threat model     | 1, 2   | [label](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/labels/epic%2Fsecurity)        |
| `epic/ci`              | Workflows, release pipeline, platform coverage | 1, 2   | [label](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/labels/epic%2Fci)              |
| `epic/docs`            | Guides, API reference, docs site               | 2, 3   | [label](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/labels/epic%2Fdocs)            |
| `epic/performance`     | Caching, bundle size, cold start, RPC budget   | 2, 3   | [label](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/labels/epic%2Fperformance)     |
| `epic/example-apps`    | Runnable example applications                  | 3      | [label](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/labels/epic%2Fexample-apps)    |
| `epic/dx`              | Developer and contributor experience           | 3      | [label](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/labels/epic%2Fdx)              |
| `epic/ecosystem`       | Community, discoverability, governance         | 2, 3   | [label](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/labels/epic%2Fecosystem)       |

## Project board layout

The GitHub Project board is the live view of this document. It is configured as follows:

- **Items:** every issue carrying an `epic/*` label is added automatically (Project workflow:
  _Auto-add to project_, filter `label:epic/*`).
- **Fields:**
  - **Epic** — single-select mirroring the `epic/*` label.
  - **Phase** — single-select: `Phase 1 — v0.2 Hardening`, `Phase 2 — v1.0 Production Readiness`,
    `Phase 3 — Post-1.0 Scale`.
  - **Status** — `Todo`, `In Progress`, `In Review`, `Done`.
- **Views:**
  - _Roadmap_ — board grouped by **Phase**, columns by **Status**.
  - _By epic_ — board grouped by **Epic**, sorted by **Phase**.
  - _Good first issues_ — table filtered to `label:"good first issue"`.
- **Milestones:** each phase has a matching repository milestone (`v0.2`, `v1.0`, `post-1.0`);
  assigning an issue to a milestone and setting its **Phase** field should always agree.

## How to propose a change to the roadmap

1. Open a thread in
   [Discussions → Ideas](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/discussions/categories/ideas)
   describing the change and the problem it solves.
2. Once a maintainer agrees, open (or re-label) an issue with the right `epic/*` label.
3. Update the tables on this page in the same PR that moves the issue between phases.
