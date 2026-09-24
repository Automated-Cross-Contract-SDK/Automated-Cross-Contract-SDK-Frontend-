// Plain JavaScript usage of @soroban-resurrect/sdk — no framework required.
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { TransactionBuilder, Operation, Networks, nativeToScVal } from '@stellar/stellar-sdk'

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET
const CONTRACT_ID = 'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'

// The SDK instance is the single entry point: it owns the RPC connection,
// exposes detectArchivedKeys()/submitWithRestore(), and broadcasts workflow
// state changes to any listener registered via onStateChange().
const resurrect = new SorobanResurrect({
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
})

let publicKey = null

function getFreighter() {
  if (typeof window === 'undefined' || !window.freighterApi) {
    throw new Error('Freighter wallet not found. Please install the Freighter extension.')
  }
  return window.freighterApi
}

// Adapts the Freighter browser extension API to the SDK's WalletAdapter shape.
function makeWalletAdapter() {
  const freighter = getFreighter()
  return {
    isConnected: () => freighter.isConnected().then((r) => r.isConnected ?? Boolean(r)),
    getPublicKey: async () => {
      const { address } = await freighter.getAddress()
      return address
    },
    signTransaction: async (xdr, opts) =>
      freighter
        .signTransaction(xdr, { networkPassphrase: opts?.networkPassphrase })
        .then((r) => r.signedTxXdr ?? r),
  }
}

async function buildSampleTransaction() {
  const account = await resurrect.server.getAccount(publicKey)
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: CONTRACT_ID,
        function: 'withdraw',
        args: [nativeToScVal(1000, { type: 'i128' })],
      }),
    )
    .setTimeout(30)
    .build()
}

function render() {
  const app = document.getElementById('app')
  const info = resurrect.stateInfo

  app.innerHTML = `
    <div style="max-width:600px;margin:0 auto;padding:24px;font-family:sans-serif;">
      <h2>Soroban-Resurrect – Vanilla JS Demo</h2>
      <div style="margin-bottom:16px;">
        ${
          publicKey
            ? `Connected: <code>${publicKey.slice(0, 8)}...${publicKey.slice(-4)}</code>`
            : '<button id="connect">Connect Freighter Wallet</button>'
        }
      </div>
      <button id="withdraw" ${!publicKey ? 'disabled' : ''}>Submit Withdraw</button>
      ${
        info.message
          ? `<div style="margin-top:16px;padding:12px;border:1px solid #6c757d;border-radius:4px;">
               <strong>Status:</strong> ${info.message}
             </div>`
          : ''
      }
    </div>
  `

  document.getElementById('connect')?.addEventListener('click', connectWallet)
  document.getElementById('withdraw')?.addEventListener('click', handleWithdraw)
}

async function connectWallet() {
  try {
    const freighter = getFreighter()
    const { address } = await freighter.getAddress()
    publicKey = address
    render()
  } catch (err) {
    alert(`Failed to connect wallet: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function handleWithdraw() {
  try {
    const wallet = makeWalletAdapter()
    const transaction = await buildSampleTransaction()

    // submitWithRestore transparently detects archived ledger entries,
    // restores them on-chain if needed, then submits the original
    // transaction — all state transitions are broadcast via onStateChange.
    const result = await resurrect.submitWithRestore({ transaction, wallet })

    if (result.success) {
      alert(`Success! Transaction hash: ${result.originalTxHash}`)
    } else {
      alert(`Failed: ${result.error}`)
    }
  } catch (err) {
    alert(`Error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Re-render on every workflow state transition (simulating, restore_needed,
// signing_restore, submitting_restore, confirming_restore, signing_original,
// submitting_original, success, error).
resurrect.onStateChange(() => render())

render()
