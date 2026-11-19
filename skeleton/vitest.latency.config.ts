import { defineConfig } from 'vitest/config';

// Wall-clock tests only, one file at a time, so that the machine is not busy with the rest of the suite.
export default defineConfig({
  test: {
    include: ['test/**/*.latency.test.ts'],
    fileParallelism: false,
  },
});
