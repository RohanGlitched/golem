import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The built package (skeleton/dist): Node worker threads need its compiled worker entry. Run `npm run build -w skeleton` first.
const skeleton = (p: string): string => fileURLToPath(new URL(`../skeleton/dist/${p.replace(/.ts$/, '.js')}`, import.meta.url));

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
