// Converts the TTF fonts in public/fonts to WOFF2 next to them (the site uses WOFF2; the studio still loads the TTFs). Usage: node scripts/fonts.mjs
import wawoff2 from 'wawoff2';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/fonts');
for (const f of readdirSync(dir).filter((x) => x.endsWith('.ttf'))) {
  const out = await wawoff2.compress(readFileSync(path.join(dir, f)));
  writeFileSync(path.join(dir, f.replace(/\.ttf$/, '.woff2')), out);
  console.log(f, '->', out.length, 'bytes');
}
