import React, { useEffect, useRef } from 'react'
import type { RestoreState } from '@soroban-resurrect/sdk'

/**
 * Ordered list of the user-visible stages of the restore-and-submit workflow.
 * Several fine-grained SDK states are folded into a single displayed step via
 * `aliases` (e.g. all three restore sub-steps map to "Restore archived state").
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

const rank = (s: RestoreState): number => Math.max(0, ORDER.indexOf(s))

export interface ProgressIndicatorProps {
  /** Current workflow state. */
  state: RestoreState
  /** Optional status message shown beneath the steps. */
  message?: string
}

/**
 * Visual step-by-step progress indicator for the restore workflow. Completed
 * steps show a checkmark, the in-flight step pulses, and — if the workflow
 * errors — the step that was in progress is flagged with an "!".
 */
export function ProgressIndicator({
  state,
  message,
}: ProgressIndicatorProps): React.JSX.Element | null {
  // Remember how far the workflow got so an `error` state (which carries no
  // position of its own) can still point at the step that failed.
  const furthestRank = useRef(0)
  useEffect(() => {
    if (state === 'idle') furthestRank.current = 0
    else if (state !== 'error') furthestRank.current = Math.max(furthestRank.current, rank(state))
  }, [state])

  if (state === 'idle') return null

  const isError = state === 'error'
  const activeRank = isError ? furthestRank.current : rank(state)

  // Rank at which each displayed step begins; a step is complete once the
  // following step has begun (or the workflow succeeded).
  const startRanks = STEPS.map((step) => Math.min(...step.states.map(rank)))

  return (
    <div className="sr-card" aria-label="Restore workflow progress">
      <ol className="sr-progress">
        {STEPS.map((step, i) => {
          const startRank = startRanks[i]
          const nextStartRank = startRanks[i + 1] ?? Infinity
          const started = activeRank >= startRank
          const isDone = state === 'success' ? true : started && activeRank >= nextStartRank
          const isActive = !isError && !isDone && started
          const erroredHere = isError && !isDone && started

          const cls = [
            'sr-progress__step',
            isDone && 'sr-progress__step--done',
            isActive && 'sr-progress__step--active',
            erroredHere && 'sr-progress__step--error',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <li key={step.label} className={cls}>
              <span className="sr-progress__marker" aria-hidden="true">
                {isDone ? '✓' : erroredHere ? '!' : ''}
              </span>
              <span>{step.label}</span>
            </li>
          )
        })}
      </ol>
      {message && (
        <p style={{ margin: '10px 0 0', fontSize: '0.85rem', color: 'var(--sr-text-muted)' }}>
          {message}
        </p>
      )}
    </div>
  )
}
