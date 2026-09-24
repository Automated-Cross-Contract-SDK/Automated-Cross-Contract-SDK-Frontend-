import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'

// Mock the react-hook package so these component tests don't depend on a real SDK/network.
vi.mock('@soroban-resurrect/react-hook', () => {
  const state = { state: 'idle', message: undefined, archivedKeys: [] }
  return {
    SorobanResurrectProvider: ({ children }: { children: React.ReactNode }) => children,
    useSorobanResurrectContext: () => ({
      submitWithRestore: vi.fn().mockResolvedValue({ success: true }),
      state,
      isProcessing: false,
      detectArchivedKeys: vi.fn().mockResolvedValue([]),
      reset: vi.fn(),
      resurrect: undefined,
    }),
  }
})

beforeEach(() => {
  ;(window as unknown as { stellar?: unknown }).stellar = {
    connect: vi.fn().mockResolvedValue(undefined),
    getPublicKey: vi.fn().mockResolvedValue('GABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    signTransaction: vi.fn().mockResolvedValue('signed-xdr'),
  }
})

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />)
    expect(screen.getByText('Soroban-Resurrect Demo')).toBeInTheDocument()
  })
})

describe('WalletButton', () => {
  it('shows the connect button when no wallet is connected', () => {
    render(<App />)
    expect(screen.getByText('Connect Freighter Wallet')).toBeInTheDocument()
  })

  it('shows the truncated public key after connecting', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('Connect Freighter Wallet'))
    await waitFor(() => expect(screen.getByText(/Connected:/)).toBeInTheDocument())
  })
})

describe('WithdrawButton', () => {
  it('renders the submit withdraw and check archived keys buttons', () => {
    render(<App />)
    expect(screen.getByText('Submit Withdraw')).toBeInTheDocument()
    expect(screen.getByText('Check Archived Keys')).toBeInTheDocument()
  })

  it('disables the withdraw button while processing', () => {
    render(<App />)
    const button = screen.getByText('Submit Withdraw') as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })
})

describe('StatusDisplay', () => {
  it('does not render a status message when state is idle', () => {
    render(<App />)
    expect(screen.queryByText(/Status:/)).not.toBeInTheDocument()
  })
})
