import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const earsDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const FUNCTIONS = [
  'compileRequirement', 'compileRequirementsFile', 'extractCriteria', 'tokenize',
  'parse', 'format', 'parseQuantity', 'toSI', 'fromSI', 'tokenEditDistance',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('golem-spec public entry', () => {
  it('exposes every public ears function', async () => {
    const entry: Record<string, unknown> = await import('../../index.js');
    for (const name of FUNCTIONS) expect(typeof entry[name], name).toBe('function');
  });
});

describe('ears purity', () => {
  const forbidden = /Math\.random|Date\.now|performance\.now|\bfetch\b|node:fs/;
  it('no ears source file mentions nondeterministic or I/O APIs', () => {
    const offenders = sourceFiles(earsDir).filter((f) => forbidden.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders).toEqual([]);
  });
  it('reports sources whose comments mention forbidden APIs', () => {
    const inComments = sourceFiles(earsDir).filter((f) => {
      const raw = readFileSync(f, 'utf8');
      return forbidden.test(raw) && !forbidden.test(stripComments(raw));
    });
    // Informational: comment-only mentions are tolerated but must stay visible.
    expect(Array.isArray(inComments)).toBe(true);
    if (inComments.length) console.warn('Comment-only mentions in:', inComments);
  });
});
