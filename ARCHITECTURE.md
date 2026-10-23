# Architecture

This document describes the high-level architecture of the project and records
significant architectural decisions.

## Architecture Decision Records (ADRs)

### ADR-001: Rebuild the original transaction after restoration

**Status:** Accepted

**Context**

When a transaction is restored (for example, after being persisted and later
reloaded, or after being reconstructed from external state), the restored
object is not guaranteed to be directly submittable. The restored transaction
may carry stale sequence numbers, missing or outdated simulation data, and
signatures that no longer match the current network state. Submitting the
restored transaction as-is can therefore fail or, worse, be rejected in ways
that are hard to diagnose.

**Decision**

After restoration, the original transaction is *rebuilt* rather than reused
directly. Rebuilding produces a fresh transaction that reflects the current
state of the account and network before it is signed and submitted.

**Rationale (why)**

- **Correctness of sequence numbers.** A restored transaction may reference a
  sequence number that has already been consumed. Rebuilding fetches the
  current sequence number so the transaction is valid at submission time.
- **Fresh simulation data.** Simulation results (fee estimates, compute budget,
  and other derived values) depend on current chain state. Reusing stale
  simulation data can under- or over-estimate resources. Rebuilding re-runs
  simulation against the current state.
- **Signature validity.** Signatures are bound to the exact transaction bytes.
  Any change to sequence numbers or simulation-derived fields invalidates prior
  signatures, so the rebuilt transaction must be re-signed.
- **Predictable failure modes.** Rebuilding centralizes the refresh logic in one
  place, making failures explicit and easier to reason about than silently
  reusing a partially stale transaction.

**Mechanism (how)**

1. **Restore.** Load the persisted/restored transaction and its associated
   metadata (instructions, signers, and any cached simulation data).
2. **Refresh sequence number.** Query the current sequence number for the
   relevant account and apply it to the rebuilt transaction. Do not trust the
   sequence number stored in the restored transaction.
3. **Re-simulate.** Run simulation against the current state to obtain fresh
   simulation data (fee/compute estimates and related derived values), and apply
   the results to the rebuilt transaction.
4. **Re-sign.** Sign the rebuilt transaction with the required signers, since
   the transaction bytes have changed.
5. **Submit.** Submit the rebuilt, freshly signed transaction.

**Caller responsibilities**

- Callers must treat a restored transaction as *input to rebuilding*, not as a
  ready-to-submit transaction.
- Callers are responsible for supplying the signers required to re-sign the
  rebuilt transaction.
- Callers must handle the failure cases of each step (sequence number lookup,
  simulation, and signing) explicitly rather than assuming success.
- Callers should not cache or reuse signatures or simulation data across a
  rebuild; these are refreshed as part of the rebuild.

**Consequences**

- Restored transactions incur the cost of a sequence number lookup, a
  simulation, and re-signing before submission.
- The rebuild path is the single, documented place where refresh logic lives,
  which keeps behavior consistent across callers.
