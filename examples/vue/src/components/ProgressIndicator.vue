<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RestoreState } from '@soroban-resurrect/sdk'

/**
 * Ordered list of the user-visible stages of the restore-and-submit workflow.
 * Several fine-grained SDK states are folded into a single displayed step via
 * `states` (e.g. all three restore sub-steps map to "Restore archived state").
 */
const STEPS: { label: string; states: RestoreState[] }[] = [
  { label: 'Simulate transaction', states: ['simulating'] },
  {
    label: 'Restore archived state',
    states: ['restore_needed', 'signing_restore', 'submitting_restore', 'confirming_restore'],
  },
  {
    label: 'Sign & submit transaction',
    states: ['signing_original', 'submitting_original'],
  },
  { label: 'Confirmed', states: ['success'] },
]

/** Linear ordering of workflow states, used to compare progress. */
const ORDER: RestoreState[] = [
  'idle',
  'simulating',
  'restore_needed',
  'signing_restore',
  'submitting_restore',
  'confirming_restore',
  'signing_original',
  'submitting_original',
  'success',
]

const rank = (state: RestoreState): number => Math.max(0, ORDER.indexOf(state))

const props = defineProps<{
  /** Current workflow state — `state.state` from the SDK snapshot. */
  state: RestoreState
  /** Optional status message shown beneath the steps. */
  message?: string
}>()

// Remember how far the workflow got so an `error` state (which carries no
// position of its own) can still point at the step that failed.
const furthestRank = ref(0)
watch(
  () => props.state,
  (state) => {
    if (state === 'idle') furthestRank.value = 0
    else if (state !== 'error') furthestRank.value = Math.max(furthestRank.value, rank(state))
  },
  { immediate: true },
)

const isError = computed(() => props.state === 'error')
const activeRank = computed(() => (isError.value ? furthestRank.value : rank(props.state)))

// Rank at which each displayed step begins; a step is complete once the
// following step has begun (or the workflow succeeded).
const startRanks = STEPS.map((step) => Math.min(...step.states.map(rank)))

const steps = computed(() =>
  STEPS.map((step, index) => {
    const started = activeRank.value >= startRanks[index]
    const isDone =
      props.state === 'success'
        ? true
        : started && activeRank.value >= (startRanks[index + 1] ?? Infinity)
    const isActive = !isError.value && !isDone && started
    const erroredHere = isError.value && !isDone && started

    return {
      label: step.label,
      marker: isDone ? '✓' : erroredHere ? '!' : '',
      class: [
        'sr-progress__step',
        isDone && 'sr-progress__step--done',
        isActive && 'sr-progress__step--active',
        erroredHere && 'sr-progress__step--error',
      ]
        .filter(Boolean)
        .join(' '),
    }
  }),
)
</script>

<template>
  <section
    v-if="state !== 'idle'"
    class="sr-card sr-progress-card"
    aria-label="Restore workflow progress"
  >
    <ol class="sr-progress">
      <li v-for="step in steps" :key="step.label" :class="step.class">
        <span class="sr-progress__marker" aria-hidden="true">{{ step.marker }}</span>
        <span>{{ step.label }}</span>
      </li>
    </ol>
    <p v-if="message" class="sr-progress__message">{{ message }}</p>
  </section>
</template>
