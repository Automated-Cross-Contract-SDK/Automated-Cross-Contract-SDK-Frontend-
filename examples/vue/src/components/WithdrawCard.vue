<script setup lang="ts">
import { computed } from 'vue'
import type { RestoreStateInfo } from '@soroban-resurrect/sdk'
import ProgressIndicator from './ProgressIndicator.vue'
import ErrorDisplay from './ErrorDisplay.vue'

/**
 * Presentational half of the withdraw flow: buttons, progress, errors and the
 * raw result. It knows nothing about which hook produced `state`, which is what
 * lets the composable and plugin paths render identical UI.
 */
const props = defineProps<{
  /** Vue API this card is driven by — surfaced so the demo makes its point. */
  apiLabel: string
  /** Reactive workflow snapshot (from the composable, or bridged for the plugin). */
  state: RestoreStateInfo
  isProcessing: boolean
  /** Connected account, or `null` while disconnected. */
  address: string | null
  /** Informational line, e.g. the outcome of an archive check. */
  notice?: string | null
  /** Pretty-printed `ResurrectResult`, when a submit produced one. */
  result?: string | null
  /** Error caught outside the SDK state machine (wallet/RPC failures). */
  error?: string | null
}>()

const emit = defineEmits<{
  check: []
  withdraw: []
  reset: []
  retry: []
}>()

// Prefer the SDK-reported error, fall back to a locally caught one.
const shownError = computed(() =>
  props.state.state === 'error'
    ? (props.state.error ?? props.state.message)
    : (props.error ?? null),
)

const archivedCount = computed(() => props.state.archivedKeys?.length ?? 0)
const canAct = computed(() => Boolean(props.address) && !props.isProcessing)
const hasOutput = computed(() => Boolean(props.notice || props.result || shownError.value))
</script>

<template>
  <section class="sr-card">
    <header class="sr-card__header">
      <h2>Withdraw with automatic restore</h2>
      <code class="sr-code">{{ apiLabel }}</code>
    </header>

    <p v-if="!address" class="sr-hint">Connect Freighter to run the flow.</p>

    <div class="sr-actions">
      <button class="sr-btn" :disabled="!canAct" @click="emit('check')">Check Archived Keys</button>
      <button class="sr-btn sr-btn--primary" :disabled="!canAct" @click="emit('withdraw')">
        {{ isProcessing ? 'Processing…' : 'Submit Withdraw' }}
      </button>
      <button v-if="hasOutput" class="sr-btn" :disabled="isProcessing" @click="emit('reset')">
        Reset
      </button>
    </div>

    <p v-if="notice" class="sr-notice">{{ notice }}</p>

    <p v-if="archivedCount > 0" class="sr-hint">
      {{ archivedCount }} archived ledger {{ archivedCount === 1 ? 'entry' : 'entries' }} detected
    </p>

    <ProgressIndicator :state="state.state" :message="state.message" />

    <ErrorDisplay v-if="shownError" :message="shownError" @retry="emit('retry')" />

    <pre v-if="result" class="sr-result">{{ result }}</pre>
  </section>
</template>
