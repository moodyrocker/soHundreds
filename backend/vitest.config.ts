import { defineConfig } from 'vitest/config';

/**
 * Test configuration.
 *
 * Tests live next to the code as `*.test.ts`. tsconfig excludes them from the
 * build (see `exclude`), so nothing test-related ships in the image.
 *
 * The first suites deliberately target pure functions — the eleven LLM-JSON
 * parsers and the spend guards. Those are the code most likely to break silently
 * when a model's output drifts, and the cheapest to cover: no database, no HTTP,
 * no mocking.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Nothing here touches the network or a database, so failures should be
    // instant rather than hanging.
    testTimeout: 5_000,
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/lib/**', 'src/executors/**'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'html'],
    },
  },
});
