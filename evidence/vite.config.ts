import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const skeleton = (p: string): string => fileURLToPath(new URL(`../skeleton/src/${p}`, import.meta.url));

// Evidence scripts import the apps and the skeleton sources directly, as the app tests do.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^golem-spec\/node$/, replacement: skeleton('node.ts') },
      { find: /^golem-spec\/ui$/, replacement: skeleton('ui/index.ts') },
      { find: /^golem-spec$/, replacement: skeleton('index.ts') },
    ],
  },
});
