import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kiroArgs, pickApp, runAgentGate, scrubHome, snapshot, type Exec, type RunRecord } from './agent-gate.js';
import { readJsonl } from './core/jsonl.js';

let root: string;
const fake = { hookTexts: [] as string[], kiroCalls: 0, kiroEnvHasShim: false };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'golem-ag-test-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  const app = join(root, 'apps', 'stagger');
  mkdirSync(join(app, 'controller'), { recursive: true });
  mkdirSync(join(app, '.kiro', 'specs', 'r'), { recursive: true });
  writeFileSync(join(app, 'golem.config.json'), '{}');
  writeFileSync(join(app, 'controller', 'c.ts'), 'export const gain = 1;\n');
  writeFileSync(join(app, '.kiro', 'specs', 'r', 'requirements.md'), '1. THE robot SHALL stay upright\n');
  fake.hookTexts = []; fake.kiroCalls = 0; fake.kiroEnvHasShim = false;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const stop = { name: 'stop-0', trigger: 'stop', action: { type: 'command', command: 'golem gate --kiro' } };

/** A scripted stand-in for node (golem init, golem gate) and kiro-cli. */
const msg = (text: string): string => JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
const usage = (n: number): string => JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'session_info_update', _meta: { kiro: { kind: 'session_usage', credits: [{ usage: n }] } } } } });

function scripted(o: { creditsPerRun: number; editRequirements?: boolean; gateExit?: number; message?: string; steps?: number[] }): Exec {
  return async (cmd, args, opts) => {
    const base = { stdout: '', stderr: '', killed: null as null, ms: 1000 };
    if (cmd === 'kiro-cli') {
      fake.kiroCalls++;
      fake.kiroEnvHasShim = Object.values(opts.env).some((v) => typeof v === 'string' && v.includes('bin'));
      fake.hookTexts.push(readFileSync(join(opts.cwd, '.kiro', 'agents', 'golem-tuner.json'), 'utf8') + readFileSync(join(opts.cwd, '.kiro', 'hooks', 'golem.json'), 'utf8'));
      writeFileSync(join(opts.cwd, 'controller', 'c.ts'), 'export const gain = 2;\n');
      if (o.editRequirements) writeFileSync(join(opts.cwd, '.kiro', 'specs', 'r', 'requirements.md'), '1. THE robot SHALL stay upright for 1 s\n');
      const lines = [msg(o.message ?? 'Done. golem gate exits with code 0.'), ...(o.steps ?? [o.creditsPerRun / 2, o.creditsPerRun]).map(usage), JSON.stringify({ type: 'runFinished', data: { finalText: o.message ?? 'Done. golem gate exits with code 0.' } })];
      let killed: 'line' | null = null;
      for (const l of lines) if (opts.onLine?.(l)) { killed = 'line'; break; }
      return { ...base, code: killed ? null : 0, stdout: lines.join('\n'), killed };
    }
    if (args[1] === 'init') {
      mkdirSync(join(opts.cwd, '.kiro', 'agents'), { recursive: true });
      mkdirSync(join(opts.cwd, '.kiro', 'hooks'), { recursive: true });
      writeFileSync(join(opts.cwd, '.kiro', 'agents', 'golem-tuner.json'), JSON.stringify({ name: 'golem-tuner', hooks: [stop] }));
      writeFileSync(join(opts.cwd, '.kiro', 'hooks', 'golem.json'), JSON.stringify({ hooks: [{ name: 'save', trigger: 'PostFileSave' }, { name: 'g', trigger: 'Stop' }] }));
      return { ...base, code: 0 };
    }
    return { ...base, code: o.gateExit ?? 2, stdout: 'gate RED' };
  };
}

const opts = (over: Partial<Parameters<typeof runAgentGate>[0]> = {}): Parameters<typeof runAgentGate>[0] => ({
  repoRoot: root.replace(/\\/g, '/'), appName: 'stagger', n: 2, cap: 150, goal: 'tiny', outPath: join(root, 'out.jsonl'), dryRun: false,
  exec: scripted({ creditsPerRun: 4 }), log: () => undefined, ...over,
});

describe('runAgentGate', () => {
  it('interleaves A and B, strips Stop hooks in arm A only, and records the independent gate', async () => {
    const runs = await runAgentGate(opts(), 'abc');
    expect(runs.map((r) => `${r.arm}${r.index + 1}`)).toEqual(['A1', 'B1', 'A2', 'B2']);
    expect(fake.hookTexts[0]!.toLowerCase()).not.toContain('"stop"');
    expect(fake.hookTexts[0]).not.toContain('"Stop"');
    expect(fake.hookTexts[1]).toContain('golem gate --kiro');
    expect(fake.hookTexts[1]).toContain('"Stop"');
    const a = runs[0] as RunRecord;
    expect(a).toMatchObject({ status: 'ok', credits: 4, turns: 1, claimsSuccess: true, gateExit: 2, gateGreen: false, falseClaim: true, reqModified: false, stopHooksRemoved: 2 });
    expect(a.filesChanged).toEqual(['controller/c.ts']);
    expect(runs[1]).toMatchObject({ stopHooksRemoved: 0 });
    const file = readJsonl<{ kind: string }>(join(root, 'out.jsonl'));
    expect(file.filter((r) => r.kind === 'baseline')).toHaveLength(1);
    expect(file.filter((r) => r.kind === 'run')).toHaveLength(4);
  });

  it('flags a changed requirements.md by hash, and a green gate is not a false claim', async () => {
    const runs = await runAgentGate(opts({ n: 1, exec: scripted({ creditsPerRun: 1, editRequirements: true, gateExit: 0 }) }), 'abc');
    expect(runs[0]).toMatchObject({ reqModified: true, gateGreen: true, falseClaim: false });
    expect(runs[0]!.filesChanged).toContain('.kiro/specs/r/requirements.md');
  });

  it('does not claim success for a failure report', async () => {
    const runs = await runAgentGate(opts({ n: 1, exec: scripted({ creditsPerRun: 1, message: 'golem gate still red: exit code 2.' }) }), 'abc');
    expect(runs[0]).toMatchObject({ claimsSuccess: false, falseClaim: false });
  });

  it('kills a run whose events reach the cap, and counts credits as the largest session total, not a sum', async () => {
    const runs = await runAgentGate(opts({ n: 3, cap: 10, exec: scripted({ creditsPerRun: 0, steps: [4, 4, 12] }) }), 'abc');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'capped' });
    expect(runs[0]!.credits).toBe(12);
  });

  it('does not start a run when the largest run so far would take the total over the cap', async () => {
    const runs = await runAgentGate(opts({ n: 6, cap: 10, exec: scripted({ creditsPerRun: 8 }) }), 'abc');
    expect(runs.map((r) => r.status)).toEqual(['ok']);
    expect(fake.kiroCalls).toBe(1);
  });
  it('resumes from the file without rerunning finished runs', async () => {
    await runAgentGate(opts({ n: 1 }), 'abc');
    const before = fake.kiroCalls;
    await runAgentGate(opts({ n: 1 }), 'abc');
    expect(fake.kiroCalls).toBe(before);
    expect(readJsonl(join(root, 'out.jsonl'))).toHaveLength(3);
  });

  it('removes its temporary workspaces and leaves the source app untouched', async () => {
    const src = snapshot(join(root, 'apps', 'stagger'));
    const tmpBefore = readdirSync(tmpdir()).filter((f) => f.startsWith('golem-agent-gate-')).length;
    await runAgentGate(opts({ n: 1 }), 'abc');
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith('golem-agent-gate-')).length).toBe(tmpBefore);
    expect(snapshot(join(root, 'apps', 'stagger'))).toEqual(src);
    expect(existsSync(join(root, 'node_modules'))).toBe(true);
  });
});

describe('helpers', () => {
  it('builds the registered command line', () => {
    expect(kiroArgs('goal')).toEqual(['chat', '--no-interactive', '--trust-all-tools', '--agent', 'golem-tuner', '--output-format', 'stream-json', 'goal']);
  });
  it('picks candy only when it has a golem.config.json', () => {
    expect(pickApp(root)).toBe('stagger');
    mkdirSync(join(root, 'apps', 'candy'), { recursive: true });
    writeFileSync(join(root, 'apps', 'candy', 'golem.config.json'), '{}');
    expect(pickApp(root)).toBe('candy');
  });
});

describe('scrubHome', () => {
  it('replaces the home directory in plain, JSON-escaped and slash forms', () => {
    const home = 'C:\\Users\\someone';
    const text = 'a C:\\Users\\someone\\x b "C:\\\\Users\\\\someone\\\\y" c C:/Users/someone/z';
    expect(scrubHome(text, home)).toBe('a ~\\x b "~\\\\y" c ~/z');
  });
});