// Playwright browser tests of the studio (skeleton/src/ui/e2e) against the ui-demo page.
// Tests tagged @perf run on the reference integrated-GPU laptop: `npm run e2e:perf`. Default runs skip them.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../src/ui/e2e',
  outputDir: './test-results',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  grepInvert: process.env['GOLEM_PERF'] || process.argv.some((a) => a.includes('@perf')) ? undefined : /@perf/,
  use: {
    baseURL: 'http://127.0.0.1:5199/',
    launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npx vite --config ui-demo/vite.config.ts --host 127.0.0.1',
    cwd: '..',
    url: 'http://127.0.0.1:5199/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
