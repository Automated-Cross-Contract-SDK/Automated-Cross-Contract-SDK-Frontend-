import React from 'react'

/**
 * Maps a substring found in an error message to a human-readable title and a
 * list of concrete recovery actions. The first matching rule wins; order rules
 * from most specific to least specific.
 */
const RULES: { match: RegExp; title: string; hints: string[] }[] = [
  {
    match: /freighter|wallet not found|install the freighter/i,
    title: 'Wallet not detected',
    hints: [
      'Install the Freighter browser extension from freighter.app.',
      'Unlock Freighter and reload this page.',
      'Make sure the extension is enabled for this site.',
    ],
  },
  {
    match: /user (declined|rejected)|denied|cancell?ed/i,
    title: 'Signature request rejected',
    hints: [
      'Re-run the action and approve the signature prompt in your wallet.',
      'Check that the correct account is selected in Freighter.',
    ],
  },
  {
    match: /insufficient|underfunded|balance|not enough/i,
    title: 'Insufficient balance',
    hints: [
      'Fund your testnet account with Friendbot (friendbot.stellar.org).',
      'Archive restoration costs extra fees — top up and try again.',
    ],
  },
  {
    match: /network|passphrase|wrong network/i,
    title: 'Wrong network',
    hints: [
      'Switch Freighter to the Test network.',
      'Confirm VITE_NETWORK_PASSPHRASE matches the RPC you are targeting.',
    ],
  },
  {
    match: /rpc|fetch|timeout|econnrefused|failed to load|network error/i,
    title: 'Cannot reach the RPC server',
    hints: [
      'Check your internet connection.',
      'Verify VITE_RPC_URL points at a reachable Soroban RPC endpoint.',
      'The public testnet RPC may be rate-limiting — wait a moment and retry.',
    ],
  },
  {
    match: /account not found|missing account/i,
    title: 'Account not found on the network',
    hints: [
      'Create/fund the account with Friendbot before submitting a transaction.',
      'Double-check the public key returned by your wallet.',
    ],
  },
  {
    match: /contract|invokehostfunction|hostfunction|not a valid contract/i,
    title: 'Contract call failed',
    hints: [
      'Confirm VITE_CONTRACT_ID is deployed on the target network.',
      'Ensure the `withdraw` function and its arguments match the deployed contract.',
    ],
  },
]

/** Fallback when no rule matches. */
const GENERIC = {
  title: 'Something went wrong',
  hints: [
    'Retry the action — many failures are transient.',
    'Open the browser console for the full error and stack trace.',
    'If it persists, file an issue with the message below.',
  ],
}

function classify(message: string): { title: string; hints: string[] } {
  return RULES.find((r) => r.match.test(message)) ?? GENERIC
}

export interface ErrorDisplayProps {
  /** Raw error message (e.g. from `state.error` or a caught exception). */
  message: string
  /** Optional callback to retry the failed operation. */
  onRetry?: () => void
}

/**
 * Renders a caught error as a human-readable title plus a short list of
 * suggested recovery actions, with the raw message kept visible for debugging.
 */
export function ErrorDisplay({ message, onRetry }: ErrorDisplayProps): React.JSX.Element {
  const { title, hints } = classify(message)

  return (
    <div className="sr-error" role="alert">
      <p className="sr-error__title">{title}</p>
      <p className="sr-error__message">{message}</p>
      <p className="sr-error__hint-label">Try this</p>
      <ul className="sr-error__hints">
        {hints.map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ul>
      {onRetry && (
        <button type="button" className="sr-btn" style={{ marginTop: 10 }} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
