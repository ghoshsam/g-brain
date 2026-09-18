import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{packages,apps,tests}/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // core/guards and core/store are where a bug loses data or leaks a
      // credential. They are held to a higher bar than the rest.
      thresholds: {
        'packages/core/src/guards/**': { lines: 95, functions: 95 },
        'packages/core/src/store/**': { lines: 95, functions: 95 },
      },
    },
  },
})
