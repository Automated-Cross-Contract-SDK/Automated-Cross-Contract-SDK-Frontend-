import { test, expect } from '@playwright/test'

test.describe('wallet extension restore flow', () => {
  test.skip(
    !process.env.FREIGHTER_E2E,
    'Set FREIGHTER_E2E=1 and provide a funded testnet wallet to run extension tests.',
  )

  test('connects Freighter and submits a restore-requiring transaction', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /connect/i }).click()
    await expect(page.getByText(/connected/i)).toBeVisible()
    await page.getByRole('button', { name: /restore|submit/i }).click()
    await expect(page.getByText(/success|submitted/i)).toBeVisible({ timeout: 120_000 })
  })
})
