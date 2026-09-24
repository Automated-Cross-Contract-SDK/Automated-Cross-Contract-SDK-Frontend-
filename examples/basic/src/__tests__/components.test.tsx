import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressIndicator } from '../components/ProgressIndicator'
import { ErrorDisplay } from '../components/ErrorDisplay'

describe('ProgressIndicator', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<ProgressIndicator state="idle" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('marks earlier steps complete and the current step active', () => {
    render(<ProgressIndicator state="signing_original" message="Signing..." />)
    const steps = screen.getAllByRole('listitem')
    expect(steps[0].className).toContain('sr-progress__step--done')
    expect(steps[1].className).toContain('sr-progress__step--done')
    expect(steps[2].className).toContain('sr-progress__step--active')
    expect(screen.getByText('Signing...')).toBeInTheDocument()
  })

  it('shows every step complete on success', () => {
    render(<ProgressIndicator state="success" />)
    for (const step of screen.getAllByRole('listitem')) {
      expect(step.className).toContain('sr-progress__step--done')
    }
  })
})

describe('ErrorDisplay', () => {
  it('classifies a wallet error and lists recovery hints', () => {
    render(<ErrorDisplay message="Freighter wallet not found. Please install the Freighter extension." />)
    expect(screen.getByText('Wallet not detected')).toBeInTheDocument()
    expect(screen.getByText(/freighter\.app/i)).toBeInTheDocument()
  })

  it('falls back to a generic message for an unknown error', () => {
    render(<ErrorDisplay message="totally unexpected failure xyz" />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('totally unexpected failure xyz')).toBeInTheDocument()
  })

  it('renders a retry button when onRetry is provided', () => {
    render(<ErrorDisplay message="rpc timeout" onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
