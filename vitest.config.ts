import { defineConfig } from 'vitest/config'

// Root Vitest config: runs every package's own vitest.config.ts as a project, so
// `npx vitest run <path>` filters across the whole monorepo while each package
// keeps its own environment (jsdom for hooks, node for the SDK). Per-package
// `npm test` scripts are unaffected.
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**'],
      reportsDirectory: 'coverage',
    },
  },
})
