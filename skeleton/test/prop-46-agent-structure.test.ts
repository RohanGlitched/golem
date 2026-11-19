import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkAgent, type AgentRole } from '../scripts/pack-checks/agents.js';
import { agentFile } from './support/pack.js';
import { propConfig } from './support/prop.js';

type A = Record<string, any>;
interface Mutation { role: AgentRole | 'any'; apply(f: A): void }
const M: Record<string, Mutation> = {
  guardOnOther: { role: 'scribe', apply: (f) => { f['hooks'] = [{ name: 'g', trigger: 'preToolUse', matcher: 'write', action: { type: 'command', command: 'node .kiro/hooks/golem-guard-requirements.mjs' }, timeout: 5 }]; } },
  noStopHook: { role: 'tuner', apply: (f) => { f['hooks'] = f['hooks'].filter((h: { trigger: string }) => h.trigger !== 'stop'); } },
  skepticWriteTool: { role: 'skeptic', apply: (f) => { f['tools'] = [...f['tools'], 'write']; } },
  extraWritePath: { role: 'tuner', apply: (f) => { f['permissions'].rules.find((r: A) => r['capability'] === 'fs_write' && r['effect'] === 'allow')['match'].push('src/**'); } },
  missingDeny: { role: 'scribe', apply: (f) => { f['permissions'].rules = f['permissions'].rules.filter((r: A) => r['effect'] !== 'deny'); } },
  wrongExclude: { role: 'tuner', apply: (f) => { f['permissions'].rules.find((r: A) => r['effect'] === 'deny' && r['capability'] === 'fs_write')['exclude'] = ['controller/**']; } },
  foreignField: { role: 'any', apply: (f) => { f['bogus'] = 1; } },
  skepticExclude: { role: 'skeptic', apply: (f) => { f['permissions'].rules.find((r: A) => r['effect'] === 'deny' && r['capability'] === 'fs_write')['exclude'] = ['x/**']; } },
};
const roles: AgentRole[] = ['tuner', 'skeptic', 'scribe'];

describe('Property 46: agent structural invariants', () => {
  // Feature: golem-kit, Property 46: Agent structural invariants
  it('accepts the three committed agents', () => {
    for (const r of roles) expect(checkAgent(r, agentFile(r), 'upgraded')).toEqual([]);
  });

  it('accepts an agent if and only if no mutation that applies to its role is made', () => {
    fc.assert(fc.property(fc.constantFrom(...roles), fc.subarray(Object.keys(M)), (role, names) => {
      const f = JSON.parse(JSON.stringify(agentFile(role))) as A;
      const applied = names.filter((n) => (M[n] as Mutation).role === role || (M[n] as Mutation).role === 'any');
      for (const n of applied) (M[n] as Mutation).apply(f);
      expect(checkAgent(role, f, 'upgraded').length === 0).toBe(applied.length === 0);
    }), propConfig);
  });
});
