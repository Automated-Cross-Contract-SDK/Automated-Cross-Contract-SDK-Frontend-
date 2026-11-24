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
        lines: 70,
        branches: 65,
        'src/Executor.ts': { branches: 60, lines: 70 },
        'src/SorobanResurrectExecution.ts': { branches: 60, lines: 70 },
        'src/Authorization.ts': { branches: 55, lines: 75 },
        'src/submission.ts': { branches: 60, lines: 75 },
      },
    },
  },
})
