// Regenerates the store assets of the Crew app from committed sources, so the PNG and JPG are reproducible:
//   assets/icon.png         512x512 PNG with transparent corners, drawn from site/public/favicon.svg
//   assets/screenshot-1.jpg 1200x675 (16:9) crop of site/public/hero/poster.jpg, a real GOLEM falsification render
// Sizes follow https://kiro.dev/docs/crew/apps/publishing/ ("Assets"). Run: npm run crew:assets -w golem-spec
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, '..', 'crew-app', 'assets');
mkdirSync(out, { recursive: true });

const svg = readFileSync(join(root, 'site', 'public', 'favicon.svg'), 'utf8');
const poster = readFileSync(join(root, 'site', 'public', 'hero', 'poster.jpg')).toString('base64');

const browser = await chromium.launch();
try {
  const icon = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await icon.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style>${svg}`);
  writeFileSync(join(out, 'icon.png'), await icon.screenshot({ type: 'png', omitBackground: true }));

  const shot = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  // poster.jpg is 1440x900; at 1200 px wide it is 750 px tall, so a 37.5 px offset centres the 675 px window.
  await shot.setContent(`<style>html,body{margin:0;overflow:hidden;background:#2A211C}img{display:block;width:1200px;margin-top:-37.5px}</style><img src="data:image/jpeg;base64,${poster}">`);
  await shot.waitForFunction(() => (document.querySelector('img') as HTMLImageElement).complete);
  writeFileSync(join(out, 'screenshot-1.jpg'), await shot.screenshot({ type: 'jpeg', quality: 90 }));
} finally {
  await browser.close();
}
