import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_DIR, SKELETON_DIR } from './support/pack.js';

const SRC = join(SKELETON_DIR, 'src');

function walk(dir: string, accept: (p: string) => boolean, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, accept, out);
    else if (accept(p)) out.push(p);
  }
  return out;
}

/** Source files of the kit proper: no tests. */
const kitSources = (sub: string): string[] => walk(join(SRC, sub), (p) => p.endsWith('.ts') && !p.includes('__tests__') && !p.endsWith('.test.ts'));
const pkg = JSON.parse(readFileSync(join(SKELETON_DIR, 'package.json'), 'utf8')) as Record<string, any>;

describe('source scans', () => {
  it('uses no Math.random in the cli and mcp sources (requirement 27.1)', () => {
    const files = [...kitSources('cli'), ...kitSources('mcp')];
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(readFileSync(f, 'utf8'), relative(SKELETON_DIR, f)).not.toMatch(/Math\.random/);
  });

  it('writes files in src/mcp only through proposals.ts and the shared store (requirement 14.4)', () => {
    for (const f of kitSources('mcp')) {
      const text = readFileSync(f, 'utf8');
      if (f.endsWith('proposals.ts')) continue;
      expect(text, relative(SKELETON_DIR, f)).not.toMatch(/\.writeFile\(|atomicWriteFile|\.rename\(|\.remove\(|writeFileSync|appendFile/);
    }
  });

  it('imports no network module in the cli and mcp sources (requirement 27.3)', () => {
    for (const f of [...kitSources('cli'), ...kitSources('mcp')]) {
      expect(readFileSync(f, 'utf8'), relative(SKELETON_DIR, f)).not.toMatch(/from 'node:(http|https|net|dgram|tls|http2)'|\bfetch\(|XMLHttpRequest|WebSocket/);
    }
  });
});

describe('package scans', () => {
  it('lists only the MCP SDK and MuJoCo as runtime dependencies (requirement 27.4)', () => {
    expect(Object.keys(pkg['dependencies']).sort()).toEqual(['@modelcontextprotocol/sdk', '@mujoco/mujoco']);
  });

  it('states Apache-2.0 and exposes the golem bin and its golem-spec alias (requirements 27.5, 1.8)', () => {
    expect(pkg['license']).toBe('Apache-2.0');
    expect(pkg['bin']).toEqual({ golem: 'dist/cli/main.js', 'golem-spec': 'dist/cli/main.js' });
  });

  it('has no skeleton/src import specifier in any file under kiro-pack, power or crew-app (requirement 27.8)', () => {
    for (const d of [PACK_DIR, join(SKELETON_DIR, 'power'), join(SKELETON_DIR, 'crew-app')]) {
      for (const f of walk(d, (p) => !p.endsWith('.png'))) {
        expect(readFileSync(f, 'utf8'), relative(SKELETON_DIR, f)).not.toContain('skeleton/src');
      }
    }
  });
});
