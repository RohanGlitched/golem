// The kit adds only optional fields to the contracts of interfaces.md and renames or removes none (requirement 27.7).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKELETON_DIR } from './support/pack.js';

const interfaces = readFileSync(join(SKELETON_DIR, '..', '.kiro', 'steering', 'interfaces.md'), 'utf8');

/** `interface Name { ... }` blocks (one line or several) of interfaces.md, as name to field names. */
function contractFields(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^interface (\w+) \{(.*)$/.exec(lines[i] as string);
    if (m === null) continue;
    let body = m[2] as string;
    if (!/\}\s*(\/\/.*)?$/.test(body)) {
      for (i++; i < lines.length && !/^\}/.test(lines[i] as string); i++) body += `\n${lines[i] as string}`;
    }
    body = body.replace(/\/\/.*$/gm, '');
    out.set(m[1] as string, [...new Set([...body.matchAll(/(?:^|[{;\s])(\w+)\??:/g)].map((x) => x[1] as string))].filter((f) => f !== 'string' && f !== 'number'));
  }
  return out;
}
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.ts') && !p.includes('__tests__')) out.push(p); }
  return out;
};

describe('contract untouched', () => {
  const contracts = contractFields(interfaces);

  it('reads the contract interfaces of interfaces.md', () => {
    for (const n of ['Quantity', 'Dimension', 'Trace', 'CompiledRequirement', 'RobotApp', 'TrialResult', 'Verdict', 'Counterexample', 'TrialPool']) expect(contracts.has(n), n).toBe(true);
    expect(contracts.get('Trace')).toEqual(expect.arrayContaining(['t', 'signals', 'events']));
  });

  it('redeclares no contract interface in the cli or mcp sources', () => {
    for (const f of [...walk(join(SKELETON_DIR, 'src', 'cli')), ...walk(join(SKELETON_DIR, 'src', 'mcp'))]) {
      const text = readFileSync(f, 'utf8');
      for (const name of contracts.keys()) expect(text, `${f} declares ${name}`).not.toMatch(new RegExp(`^(export )?interface ${name}\\b`, 'm'));
    }
  });

  it('declares every field the kit adds as optional', () => {
    const sib = readFileSync(join(SKELETON_DIR, 'src', 'cli', 'sibling-types.ts'), 'utf8');
    expect(sib).toMatch(/predicates\?: PredicateBinding\[\]/);
    expect(sib).toMatch(/margins\?: Record<string, number>/);
    expect(sib).toMatch(/signalUnits\?: Record<string, string>/);
    expect(sib).toMatch(/trace\?: Trace/);
    const types = readFileSync(join(SKELETON_DIR, 'src', 'cli', 'types.ts'), 'utf8');
    expect(types).toMatch(/interface ReportVerdict extends Verdict \{ unit\?: string; ears\?: string; partial\?: boolean; expectation\?: Expectation; met\?: boolean; confirmation\?: Confirmation \}/);
  });

  it('keeps the kit types assignable from the contract: a plain CompiledRequirement and RobotApp need no new field', async () => {
    // A compile-time check: if the kit required a new field, tsc (npm run typecheck) would reject this file.
    const { tinyApp } = await import('./support/tiny-app.js');
    const { compileTiny } = await import('./support/tiny-app.js');
    const plain: import('../src/cli/sibling-types.js').RobotApp = { ...tinyApp };
    delete (plain as { signalUnits?: unknown }).signalUnits;
    expect(plain.id).toBe('tiny');
    expect(compileTiny().length).toBeGreaterThan(0);
  });
});
