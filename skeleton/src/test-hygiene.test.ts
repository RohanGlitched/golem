// Source checks that catch test code that silently stops testing (golem-falsify-hardening defects 3 and 6).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p, keep));
    else if (keep(e.name)) out.push(p);
  }
  return out;
}

const isTestFile = (n: string): boolean => n.endsWith('.test.ts');
const isTestOrKit = (n: string): boolean => isTestFile(n) || n.endsWith('.testkit.ts');

describe('test hygiene', () => {
  it('finds no line comment holding a literal \\n, which would comment out the code after it', () => {
    const bad: string[] = [];
    for (const f of filesUnder(SRC, isTestFile)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('//') && line.includes('\\n')) bad.push(`${relative(SRC, f)}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
