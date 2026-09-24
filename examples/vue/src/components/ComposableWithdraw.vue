<script setup lang="ts">
import type { Transaction } from '@stellar/stellar-sdk'
import { useSorobanResurrect } from '@soroban-resurrect/vue-hook'
import WithdrawCard from './WithdrawCard.vue'
import { useWithdrawOutputs } from '../composables/useWithdrawOutputs.js'
import { buildSampleTransaction } from '../transaction.js'
import { createWalletAdapter } from '../wallet.js'
import type { NetworkConfig } from '../config.js'

const props = defineProps<{
  /** Reactive network config — changing it re-creates the SDK instance. */
  config: NetworkConfig
  address: string | null
}>()

const { result, notice, errorMessage, setResult, setNotice, fail, clear } = useWithdrawOutputs()

// The composable accepts a config *getter*, so the SDK instance follows the
// network picker: `state` is reset to `idle` and a fresh instance (with a new
// RPC client) is created whenever `config` changes. It also subscribes to the
// instance's state, exposes derived flags, and cleans up on unmount.
const { state, isProcessing, submitWithRestore, detectArchivedKeys, reset, resurrect } =
  useSorobanResurrect(() => props.config)

async function build(): Promise<Transaction> {
  if (!props.address) throw new Error('Connect your wallet first.')
  const instance = resurrect.value
  if (!instance) throw new Error('The SDK instance is not ready yet.')
  return buildSampleTransaction(instance.server, props.config.networkPassphrase, props.address)
}

async function handleCheckArchived(): Promise<void> {
  clear()
  try {
    const keys = await detectArchivedKeys(await build())
    setNotice(
      keys.length === 0
        ? 'No archived keys detected — every ledger entry this call touches is live.'
        : `${keys.length} archived ledger ${
            keys.length === 1 ? 'entry' : 'entries'
          } must be restored before this call can succeed.`,
    )
  } catch (err) {
    fail(err)
  }
}

async function handleWithdraw(): Promise<void> {
  clear()
  try {
    // The composable takes the transaction and wallet as two arguments.
    setResult(await submitWithRestore(await build(), createWalletAdapter()))
  } catch (err) {
    fail(err)
  }
}

function handleReset(): void {
  reset()
  clear()
}
</script>

<template>
  <WithdrawCard
    api-label="useSorobanResurrect(config)"
    :state="state"
    :is-processing="isProcessing"
    :address="props.address"
    :notice="notice"
    :result="result"
    :error="errorMessage"
    @check="handleCheckArchived"
    @withdraw="handleWithdraw"
    @reset="handleReset"
    @retry="handleWithdraw"
  />
</template>
