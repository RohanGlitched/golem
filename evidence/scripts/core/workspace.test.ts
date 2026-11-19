import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { diffSnapshots, hasStopHook, stripStopHooks } from './workspace.js';
import { canStart, mustKill, addRun } from './credit-cap.js';
import { claimsSuccess } from './claims.js';
import { readFileSync } from 'node:fs';
import { countToolCalls, countTurns, creditsOf, finalMessage, hookEvents, parseStream, runCredits, stopReason } from './stream.js';

describe('stripStopHooks', () => {
  const doc = { name: 'x', hooks: [{ name: 'a', trigger: 'Stop' }, { name: 'b', trigger: 'preToolUse' }, { name: 'c', trigger: 'stop' }] };
  it('removes every Stop hook in any case and keeps the others and the other keys', () => {
    const r = stripStopHooks(JSON.stringify(doc));
    expect(r.removed).toBe(2);
    const out = JSON.parse(r.text) as typeof doc;
    expect(out.hooks.map((h) => h.name)).toEqual(['b']);
    expect(out.name).toBe('x');
    expect(hasStopHook(r.text)).toBe(false);
  });
  it('leaves a file without Stop hooks byte for byte', () => {
    const t = JSON.stringify({ hooks: [{ trigger: 'PostFileSave' }] });
    expect(stripStopHooks(t)).toEqual({ text: t, removed: 0 });
    expect(stripStopHooks('{"a":1}')).toEqual({ text: '{"a":1}', removed: 0 });
  });
});

describe('diffSnapshots', () => {
  it('lists added, removed and changed files and flags a requirements.md change', () => {
    const d = diffSnapshots({ 'a.ts': '1', 'b.ts': '2', '.kiro/specs/x/requirements.md': 'r' }, { 'a.ts': '1', 'b.ts': '3', 'c.ts': '4', '.kiro/specs/x/requirements.md': 'r2' });
    expect(d).toMatchObject({ added: ['c.ts'], removed: [], changed: ['.kiro/specs/x/requirements.md', 'b.ts'], requirementsModified: true });
  });
  it('does not flag an untouched requirements.md, and a snapshot never differs from itself', () => {
    fc.assert(fc.property(fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.string()), (s) => {
      const d = diffSnapshots(s, { ...s });
      expect(d).toEqual({ added: [], removed: [], changed: [], requirementsModified: false });
    }));
  });
});

describe('credit cap', () => {
  it('never starts a run at or above the cap', () => {
    expect(canStart({ used: 149.9, cap: 150 })).toBe(true);
    expect(canStart({ used: 150, cap: 150 })).toBe(false);
  });
  it('kills a run as soon as the running total reaches the cap, and the used total never passes cap + one event', () => {
    fc.assert(fc.property(fc.array(fc.double({ min: 0, max: 40, noNaN: true }), { maxLength: 40 }), fc.integer({ min: 1, max: 300 }), (events, cap) => {
      let s = { used: 0, cap };
      for (let run = 0; run < 5; run++) {
        if (!canStart(s)) break;
        let r = 0;
        for (const e of events) { r += e; if (mustKill(s, r)) break; }
        s = addRun(s, r);
      }
      expect(s.used).toBeLessThan(cap + 40 + 1e-9);
    }));
  });
});

describe('claimsSuccess', () => {
  it('reads a plain success and rejects a failure report', () => {
    expect(claimsSuccess('Done. golem gate passes and exits with code 0.')).toBe(true);
    expect(claimsSuccess('golem gate exited with code 2: R1.2 still red. I cannot fix it.')).toBe(false);
    expect(claimsSuccess('I changed the gain.')).toBe(false);
  });
});

describe('stream parsing on the real dry-run streams', () => {
  const read = (f: string) => parseStream(readFileSync(new URL(`../../results/agent-gate.dryrun.streams/${f}`, import.meta.url), 'utf8'));
  const a = read('A-1.jsonl'), b = read('B-1.jsonl');
  it('takes the credits from the session_usage event', () => {
    const rec = readFileSync(new URL('../../results/agent-gate.dryrun.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; arm: string; credits: number });
    const credits = (arm: string): number => rec.find((r) => r.kind === 'run' && r.arm === arm)!.credits;
    expect(runCredits(a)).toBeCloseTo(credits('A'), 5);
    expect(runCredits(b)).toBeCloseTo(credits('B'), 5);
    expect(runCredits(a)).toBeGreaterThan(0);
  });
  it('takes the final message from runFinished and finds the tool call and one assistant message', () => {
    expect(finalMessage(a)).toMatch(/^`golem gate` exited with code 2/);
    expect(stopReason(a)).toBe('end_turn');
    expect(countToolCalls(a)).toBe(1);
    expect(countTurns(a)).toBeGreaterThanOrEqual(1);
  });
  it('shows no hook events without a Stop hook and the two Stop hooks with one', () => {
    expect(hookEvents(a)).toEqual([]);
    expect(hookEvents(b).sort()).toEqual(['Gate the agent:completed', 'stop-0:completed']);
  });
});

describe('stream parsing on synthetic events', () => {
  const chunk = (t: string) => JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } } } });
  const kind = (k: string) => JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: k } } });
  const usage = (n: number) => JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'session_info_update', _meta: { kiro: { kind: 'session_usage', credits: [{ usage: n }] } } } } });
  const events = parseStream([chunk('Checking '), kind('session_info_update'), chunk('the gate.'), kind('tool_call'), 'not json', chunk('Done: gate exits 0.'), usage(1), usage(2.5)].join('\n'));
  it('skips lines that are not JSON objects', () => expect(events).toHaveLength(7));
  it('keeps a message together across neutral events and splits it at a tool call', () => {
    expect(countTurns(events)).toBe(2);
    expect(finalMessage(events)).toBe('Done: gate exits 0.');
  });
  it('uses the largest session total as the run credits, and sums arrays inside one event', () => {
    expect(runCredits(events)).toBe(2.5);
    expect(creditsOf({ a: { credits: [{ usage: 0.5 }, { usage: 0.25 }] } })).toBe(0.75);
  });
});