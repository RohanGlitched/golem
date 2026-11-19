import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    // Wall-clock tests run alone, in `npm run test:latency`.
    exclude: [...configDefaults.exclude, '**/*.latency.test.ts'],
    passWithNoTests: true,
  },
});
