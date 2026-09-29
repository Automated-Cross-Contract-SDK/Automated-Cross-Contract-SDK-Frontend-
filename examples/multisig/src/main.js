// 2-of-3 multisig restore: build → collect signatures → submit.
import { SorobanResurrect, MultiSigWalletAdapter } from '@soroban-resurrect/sdk'
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk'

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET

const $ = (id) => document.getElementById(id)
const log = (msg) => ($('log').textContent += `${msg}\n`)

// Demo-only signers backed by local keypairs. In a real app each would be a
// separate wallet (Freighter, Ledger, WalletConnect…) held by a different person.
const SIGNERS = ['Alice', 'Bob', 'Carol'].map((name) => ({ name, keypair: Keypair.random() }))
const status = new Map()

function renderSigners() {
  $('signers').innerHTML = SIGNERS.map(
    ({ name }) => `<li>${name}: ${status.get(name) ?? 'missing'}</li>`,
  ).join('')
}

// Wraps a keypair as a WalletAdapter that reports per-signer progress. A
// refusing signer returns the envelope unchanged, so it adds no signature and
// no weight — MultiSigWalletAdapter then decides whether the threshold is met.
function makeSigner({ name, keypair }, refuses) {
  return {
    isConnected: async () => true,
    getPublicKey: async () => keypair.publicKey(),
    signTransaction: async (xdr) => {
      status.set(name, 'waiting…')
      renderSigners()
      if (refuses()) {
        status.set(name, 'refused ✗')
        renderSigners()
        log(`${name} refused to sign`)
        return xdr
      }
      const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE)
      tx.sign(keypair)
      status.set(name, 'signed ✓')
      renderSigners()
      return tx.toXDR()
    },
  }
}

const multisig = new MultiSigWalletAdapter({
  signers: SIGNERS.map((s) => ({
    adapter: makeSigner(s, () => s.name === 'Carol' && $('refuse').checked),
    weight: 1,
  })),
  threshold: 2,
  networkPassphrase: NETWORK_PASSPHRASE,
  parallel: false, // one prompt at a time so progress is easy to follow
})

// 1. Build — a restore-bearing transaction for the shared multisig account.
function buildTransaction() {
  const source = new Account(SIGNERS[0].keypair.publicKey(), '0')
  return new TransactionBuilder(source, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(300)
    .build()
}

$('run').addEventListener('click', async () => {
  $('log').textContent = ''
  status.clear()
  renderSigners()
  try {
    const tx = buildTransaction()
    log('1. Built transaction')

    // 2. Collect — inspect progress without enforcing the threshold yet.
    const result = await multisig.collectSignatures(tx.toXDR())
    $('progress').textContent =
      `${result.signerCount} of ${SIGNERS.length} signatures collected ` +
      `(weight ${result.weight}/${multisig.threshold})`
    if (!result.thresholdMet) {
      log('2. Threshold NOT met — restore will not be submitted')
      return
    }
    log('2. Threshold met')

    // 3. Submit — MultiSigWalletAdapter is a WalletAdapter, so it plugs
    //    straight into submitWithRestore / restoreKeys.
    if ($('mock').checked) {
      log(`3. [mock RPC] would submit signed envelope:\n${result.signedXdr}`)
      return
    }
    const resurrect = new SorobanResurrect({
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
    const res = await resurrect.submitWithRestore({ transaction: tx, wallet: multisig })
    log(`3. Submitted: ${JSON.stringify(res)}`)
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`)
  }
})

renderSigners()
