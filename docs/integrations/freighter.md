# Freighter wallet

Install the typed adapter and SDK:

```bash
npm install @soroban-resurrect/adapter-freighter @soroban-resurrect/sdk
```

`getPublicKey()` requests account access when needed. The adapter can then sign
transactions using the network selected in the Freighter extension:

```typescript
import { FreighterAdapter } from '@soroban-resurrect/adapter-freighter'

const wallet = new FreighterAdapter()
const publicKey = await wallet.getPublicKey()
const selectedPassphrase = await wallet.getNetwork()

const signedXdr = await wallet.signTransaction(transactionXdr, {
  networkPassphrase: selectedPassphrase,
})
```

## Network selection

Select the network in Freighter's network selector. Freighter API v3 does not
provide a programmatic network-switch operation, so the adapter does not change
the extension's setting. `getNetwork()` reports its current passphrase.
`signTransaction` checks a supplied `networkPassphrase` against that selection
before calling Freighter; the optional `network` value may be a Freighter network
label such as `testnet` or `public`, the `mainnet` alias, or the passphrase
itself. A mismatch throws `WalletError` with code `NETWORK_MISMATCH`.

Without either network option, Freighter signs on its currently selected
network. Supplying the passphrase from the SDK's active network is recommended
to prevent accidental cross-network signing.

## Signing and errors

Transaction signing passes both the expected passphrase and selected account
address to Freighter. The adapter also supports `signAuthEntry` with explicit
`networkPassphrase` and `address` options.

If the user declines account access or a signature, the adapter throws
`WalletError` with code `USER_REJECTED`. Missing permissions or connectivity
are reported as `NOT_CONNECTED`; unclassified wallet errors use `UNKNOWN`.

## Minimal plain JavaScript example

A dependency-light browser example that connects Freighter, builds a
transaction, and demonstrates both the restore and no-restore paths. It uses
only the browser globals and the SDK's ESM build — no framework or bundler
required.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Freighter + Soroban Resurrect</title>
  </head>
  <body>
    <button id="connect">Connect wallet</button>
    <button id="build">Build transaction</button>
    <button id="restore">Sign (restore)</button>
    <button id="no-restore">Sign (no restore)</button>
    <pre id="log"></pre>

    <script type="module">
      import { FreighterAdapter } from '@soroban-resurrect/adapter-freighter'
      import { SorobanResurrect } from '@soroban-resurrect/sdk'

      const log = (msg) => {
        document.getElementById('log').textContent += msg + '\n'
      }

      const wallet = new FreighterAdapter()
      let publicKey
      let transactionXdr

      document.getElementById('connect').onclick = async () => {
        try {
          publicKey = await wallet.getPublicKey()
          log('Connected: ' + publicKey)
        } catch (err) {
          log('Connect failed: ' + err.code + ' ' + err.message)
        }
      }

      document.getElementById('build').onclick = async () => {
        try {
          const networkPassphrase = await wallet.getNetwork()
          const sdk = new SorobanResurrect({ networkPassphrase })
          const tx = await sdk.buildTransaction({ source: publicKey })
          transactionXdr = tx.toXDR()
          log('Built transaction: ' + transactionXdr)
        } catch (err) {
          log('Build failed: ' + err.code + ' ' + err.message)
        }
      }

      const sign = async (restore) => {
        try {
          const networkPassphrase = await wallet.getNetwork()
          const sdk = new SorobanResurrect({ networkPassphrase })
          const prepared = await sdk.prepareTransaction(transactionXdr, { restore })
          const signedXdr = await wallet.signTransaction(prepared.toXDR(), {
            networkPassphrase,
          })
          log((restore ? 'Restore' : 'No-restore') + ' signed: ' + signedXdr)
        } catch (err) {
          log('Sign failed: ' + err.code + ' ' + err.message)
        }
      }

      document.getElementById('restore').onclick = () => sign(true)
      document.getElementById('no-restore').onclick = () => sign(false)
    </script>
  </body>
</html>
```

### Restore vs. no-restore

- **Restore** (`restore: true`): `prepareTransaction` detects archived ledger
  entries and includes the required restore operations before signing, so the
  transaction can be submitted successfully.
- **No-restore** (`restore: false`): `prepareTransaction` leaves archived entries
  untouched. Use this when the caller handles restoration separately or wants to
  inspect the transaction before any restore operations are added.

### Compatibility notes

- Requires a browser with native ES module support and Freighter API v3.
- The example imports the SDK's ESM build directly; if you use a bundler, the
  same imports resolve through the package's `exports` map.
- Errors surface as `WalletError` with codes such as `USER_REJECTED`,
  `NOT_CONNECTED`, `NETWORK_MISMATCH`, and `UNKNOWN`; handle them as shown above.
