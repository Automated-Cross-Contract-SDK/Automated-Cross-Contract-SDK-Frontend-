# Examples

## Runnable Example App

The repository ships a full runnable example at [`examples/basic`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/basic) — a Vite + React app wired up to the SDK end-to-end.

```bash
git clone https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-.git
cd Automated-Cross-Contract-SDK-Frontend-
npm install
npm run dev:example
```

This starts a local dev server demonstrating connecting a wallet, building a transaction, and calling `submitWithRestore`.

## Interactive Playground

Want to try the flow without installing anything? The
[Interactive Playground](/examples/playground) runs the SDK's state machine in
your browser against a fake RPC client with canned responses — no wallet, no
network. Edit the snippet, pick a scenario, and watch the state transitions,
RPC calls, and result.

## Interactive Snippets

### Minimal restore check

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })

const needsRestore = await sr.needsRestore(tx)
console.log(needsRestore ? 'Restore required' : 'Ready to submit')
```

### Progress bar driven by `onStateChange`

```typescript
const STEPS: Record<string, number> = {
  idle: 0,
  simulating: 10,
  restore_needed: 20,
  signing_restore: 35,
  submitting_restore: 50,
  confirming_restore: 65,
  signing_original: 80,
  submitting_original: 90,
  success: 100,
  error: 100,
}

sr.onStateChange((info) => {
  progressBar.value = STEPS[info.state] ?? 0
  statusLabel.textContent = info.message
})
```

### Rendering archived keys detected during a restore

```tsx
function ArchivedKeysBanner({ archivedKeys }: { archivedKeys: ArchivedLedgerEntry[] }) {
  if (archivedKeys.length === 0) return null

  return (
    <div className="banner">
      {archivedKeys.length} ledger {archivedKeys.length === 1 ? 'entry needs' : 'entries need'} to
      be restored before this transaction can be submitted.
    </div>
  )
}
```

### Full submit flow with error handling

```typescript
async function withdraw(tx: Transaction, wallet: WalletAdapter) {
  const result = await sr.submitWithRestore({
    transaction: tx,
    wallet,
    onRestoreNeeded: (keys) => setBanner(`Restoring ${keys.length} archived entries…`),
    onRestoreFailed: (error) => setError(error),
  })

  if (!result.success) {
    setError(result.error ?? 'Unknown error')
    return
  }

  setSuccess(result.originalTxHash!)
}
```

## DeFi Position Recovery with Fee Review

This example restores an archived DeFi contract position (e.g. a lending
supply position) and shows how a dApp can present the recovery transaction and
its fees to the user **before** anything is signed.

### 1. Detect whether the position needs recovery

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })

// `positionTx` is the transaction that touches the archived position entry.
const needsRestore = await sr.needsRestore(positionTx)
if (!needsRestore) {
  // Position is live — submit directly.
  return
}
```

### 2. Build a recovery preview (transaction + fees) for review

```typescript
import type { RestorePreview } from '@soroban-resurrect/sdk'

// `prepareRestore` returns the unsigned restore transaction together with the
// fee breakdown, without submitting or signing anything.
const preview: RestorePreview = await sr.prepareRestore({
  transaction: positionTx,
  wallet,
})

// preview.restoreTransaction — unsigned restore tx (XDR + decoded)
// preview.fees.baseFee         — base fee for the restore tx
// preview.fees.resourceFee     — resource fee for the restore tx
// preview.fees.totalFee        — total fee the user will pay
// preview.fees.originalTxFee   — fee of the original position tx
// preview.archivedKeys         — ledger entries that will be restored
```

### 3. Present the recovery transaction and fees before signing

```tsx
function RecoveryReview({ preview, onConfirm }: {
  preview: RestorePreview
  onConfirm: () => void
}) {
  return (
    <section className="recovery-review">
      <h2>Recover DeFi position</h2>
      <p>
        {preview.archivedKeys.length} archived ledger{' '}
        {preview.archivedKeys.length === 1 ? 'entry' : 'entries'} will be restored
        before your position transaction can be submitted.
      </p>

      <dl className="fees">
        <dt>Restore base fee</dt>
        <dd>{preview.fees.baseFee} stroops</dd>
        <dt>Restore resource fee</dt>
        <dd>{preview.fees.resourceFee} stroops</dd>
        <dt>Position transaction fee</dt>
        <dd>{preview.fees.originalTxFee} stroops</dd>
        <dt>Total</dt>
        <dd>{preview.fees.totalFee} stroops</dd>
      </dl>

      <button onClick={onConfirm}>Sign recovery &amp; position</button>
    </section>
  )
}
```

### 4. Sign and submit after the user confirms

```typescript
async function confirmRecovery(preview: RestorePreview, wallet: WalletAdapter) {
  const result = await sr.submitWithRestore({
    transaction: preview.restoreTransaction,
    wallet,
    onRestoreNeeded: (keys) => setBanner(`Restoring ${keys.length} archived entries…`),
    onRestoreFailed: (error) => setError(error),
  })

  if (!result.success) {
    setError(result.error ?? 'Unknown error')
    return
  }

  setSuccess(result.originalTxHash!)
}
```

### Failure and boundary cases

- **No archived entries** — `needsRestore` returns `false`; skip the review UI
  and submit the position transaction directly.
- **User rejects signing** — `submitWithRestore` resolves with
  `success: false` and an error; the position is left untouched.
- **Restore fails on-chain** — `onRestoreFailed` fires and the original
  position transaction is never submitted.
- **Fee changes between preview and submit** — re-run `prepareRestore` and
  re-present the review before signing so the user always approves the fee
  they actually pay.

More end-to-end walkthroughs live in the [Tutorial](/guide/tutorial).
