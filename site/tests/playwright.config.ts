import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /smoke\.e2e\.ts/,
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  use: { launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
});
