# Protocol Glossary: Soroban Restoration Concepts

This glossary defines the protocol terms you'll encounter when working with
Soroban state archival and automated restoration. Each entry links the concept
to how the SDK surfaces it, so dApp developers can map protocol behavior onto
SDK calls.

## Archived entries

Ledger entries (contract data, contract code, and other persistent state) that
have been evicted from the live ledger because their TTL expired. Archived
entries are not lost — they are retained in the history archive and can be
restored. Until restored, any transaction that touches an archived entry fails.

## Footprint

A **ledger footprint** is the set of ledger entries a transaction reads and
writes. Soroban transactions declare their footprint up front so the network can
validate and charge for the entries involved. A footprint has two parts:

- **Read-only** entries — inspected but not modified.
- **Read-write** entries — read and potentially modified.

If any entry in the footprint is archived, the transaction cannot execute until
that entry is restored. The SDK derives footprints from the operations you
submit so restoration targets the right entries.

## TTL (time-to-live)

Every live ledger entry has a TTL expressed in ledgers. When the TTL reaches
zero the entry is archived. TTLs can be extended with a `BumpFootprintExpiration`
operation, which is how the SDK keeps frequently used state alive. See the
[TTL watch guidance](/guide/restore-fees) for how the SDK tracks entries that
are close to expiry.

## Restore transaction

A **restore transaction** is a Soroban transaction whose sole purpose is to move
archived entries back into the live ledger. It uses the `RestoreFootprint`
operation and must include the archived entries in its footprint. Restore
transactions consume resources (CPU, memory, and fees) just like any other
transaction — see [Restore Fees and Limits](/guide/restore-fees) for budgeting
guidance.

## Simulation preamble

Before submitting a transaction, the SDK **simulates** it against the network.
The simulation returns a *preamble* describing the resources the transaction
will consume (footprint, instructions, read/write bytes, and fees). The SDK uses
this preamble to build the final transaction with accurate resource limits and
fees. If simulation reports archived entries, the SDK can schedule a restore
transaction before retrying the original operation.

## Related terms

- **Ledger entry** — a single unit of on-chain state (contract data, code, or
  account).
- **Expiration ledger** — the ledger sequence at which an entry's TTL elapses.
- **Bump** — extending an entry's TTL via `BumpFootprintExpiration`.
- **Restoration** — the end-to-end process of detecting archived entries,
  submitting a restore transaction, and retrying the original operation.

## See also

- [Restore Fees and Limits](/guide/restore-fees)
- [History Persistence](/guide/history-persistence)
- [SDK API Reference](/api/sdk)
