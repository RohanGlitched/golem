// Downloads the B612 and B612 Mono fonts (SIL Open Font License 1.1, by Airbus / PolarSys) into
// ui-demo/public/fonts/, where the studio's fontBaseUrl './fonts/' finds them. The files are not committed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'fonts');
const base = 'https://raw.githubusercontent.com/polarsys/b612/master/fonts/ttf/';
const files = ['B612-Regular.ttf', 'B612-Bold.ttf', 'B612Mono-Regular.ttf', '../../OFL.txt'];
fs.mkdirSync(dir, { recursive: true });
for (const f of files) {
  const target = path.join(dir, path.basename(f));
  if (fs.existsSync(target)) continue;
  const res = await fetch(new URL(f, base));
  if (!res.ok) throw new Error(`Download of ${f} failed: HTTP ${res.status}`);
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  console.log(`wrote ${target}`);
}
