import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_WALLETS } from '../createAdapter.js'

const compatibilityGuide = readFileSync(
  new URL('../../../../docs/integrations/adapters-and-wallets.md', import.meta.url),
  'utf8',
)

describe('wallet compatibility documentation', () => {
  it('documents every wallet the SDK advertises', () => {
    for (const wallet of SUPPORTED_WALLETS) {
      expect(compatibilityGuide).toContain(`\`${wallet}\``)
    }
  })
})
