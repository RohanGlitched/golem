import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const skeleton = (p: string): string => fileURLToPath(new URL(`../../skeleton/src/${p}`, import.meta.url));

// Until golem-spec is built to dist/, tests resolve its public entry points to the skeleton sources.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^golem-spec\/node$/, replacement: skeleton('node.ts') },
      { find: /^golem-spec\/ui$/, replacement: skeleton('ui/index.ts') },
      { find: /^golem-spec$/, replacement: skeleton('index.ts') },
    ],
  },
  test: { include: ['test/**/*.test.ts'], passWithNoTests: true, testTimeout: 60000 },
});
