<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { Transaction } from '@stellar/stellar-sdk'
import { isProcessingState, type RestoreStateInfo } from '@soroban-resurrect/sdk'
import { injectSorobanResurrect } from '@soroban-resurrect/vue-hook'
import WithdrawCard from './WithdrawCard.vue'
import { useWithdrawOutputs } from '../composables/useWithdrawOutputs.js'
import { buildSampleTransaction } from '../transaction.js'
import { createWalletAdapter } from '../wallet.js'
import type { NetworkConfig } from '../config.js'

const props = defineProps<{
  /** Reactive network config — applied with the SDK's in-place `switchNetwork`. */
  network: NetworkConfig
  address: string | null
}>()

const { result, notice, errorMessage, setResult, setNotice, fail, clear } = useWithdrawOutputs()

// The single instance provided by `app.use(SorobanResurrectPlugin, ...)` in
// main.ts — pulled out of the app's injection context, no prop drilling.
const resurrect = injectSorobanResurrect()

// `injectSorobanResurrect()` returns the raw SDK instance, so this component
// bridges it to refs itself: subscribe to `onStateChange` and mirror the
// composable's `isProcessing` helper. Nothing else differs from the
// composable path.
const state = ref<RestoreStateInfo>({ ...resurrect.stateInfo })
const isProcessing = computed(() => isProcessingState(state.value.state))
const unsubscribe = resurrect.onStateChange((info) => {
  state.value = info
})
onUnmounted(unsubscribe)

// The plugin constructs its instance once, at boot, from a static config, so
// network changes are applied with the SDK's in-place `switchNetwork()` (which
// keeps listeners and history intact) rather than by re-creating it.
watch(
  () => props.network,
  (network) => {
    try {
      resurrect.switchNetwork({
        rpcUrl: network.rpcUrl,
        networkPassphrase: network.networkPassphrase,
      })
      resurrect.reset()
      clear()
    } catch (err) {
      fail(err)
    }
  },
  { immediate: true },
)

async function build(): Promise<Transaction> {
  if (!props.address) throw new Error('Connect your wallet first.')
  return buildSampleTransaction(resurrect.server, resurrect.config.networkPassphrase, props.address)
}

async function handleCheckArchived(): Promise<void> {
  clear()
  try {
    const keys = await resurrect.detectArchivedKeys(await build())
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
    // The SDK instance takes a single options object instead.
    setResult(
      await resurrect.submitWithRestore({
        transaction: await build(),
        wallet: createWalletAdapter(),
      }),
    )
  } catch (err) {
    fail(err)
  }
}

function handleReset(): void {
  resurrect.reset()
  clear()
}
</script>

<template>
  <WithdrawCard
    api-label="injectSorobanResurrect()"
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
