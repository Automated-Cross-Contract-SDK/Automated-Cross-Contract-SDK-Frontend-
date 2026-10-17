import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    typecheck: {
      include: ['src/**/*.test-d.ts'],
      ignoreSourceErrors: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        'src/Archiver.ts': { branches: 45, lines: 65 },
        'src/Restorer.ts': { branches: 35, lines: 35 },
        'src/Executor.ts': { branches: 40, lines: 50 },
      },
    },
  },
})
