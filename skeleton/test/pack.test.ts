import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileRequirement } from '../src/ears/index.js';
import { buildManifest } from '../scripts/build-pack.js';
import { createHarness } from './support/harness.js';
import { PACK_DIR, packFile, packJson } from './support/pack.js';
import { tinyLexicon } from './support/tiny-app.js';

const front = (text: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text) as RegExpExecArray;
  return Object.fromEntries(m[1]!.split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
};

describe('steering/golem-ears.md', () => {
  const t = packFile('steering/golem-ears.md');

  it('has front matter that includes it when a requirements.md is open', () => {
    expect(front(t)).toEqual({ inclusion: 'fileMatch', fileMatchPattern: '"**/requirements.md"' });
  });

  it('describes the five patterns with a shape and an example each', () => {
    for (const row of ['Ubiquitous', 'Event', 'State', 'Unwanted', 'Optional']) expect(t).toMatch(new RegExp(`\\| ${row} \\| \`[^\`]+\` \\| \`[^\`]+\` \\|`));
  });

  it('lists exactly the accepted units', () => {
    const line = /accepted units are exactly:\n\n`([^`]+)`/.exec(t);
    expect(line?.[1]).toBe('N, kN, m, cm, mm, s, ms, m/s, cm/s, deg, °, rad, kg, g, %');
  });

  it('names propose_requirement, the proposals path, golem check, the ranges and the no-edit rule', () => {
    expect(t).toContain('propose_requirement');
    expect(t).toContain('.kiro/specs/<robot>/proposals.md');
    expect(t).toContain('npx --no-install golem-spec check');
    expect(t).toMatch(/Ranges in triggers define the search space/);
    expect(t).toMatch(/Never edit a requirement to make a test pass/);
    expect(t).toContain('Every number carries a unit');
  });

  it('states every hook timeout with its reason and shows the npx replacement for the MCP entry', () => {
    for (const s of ['30 s', '300 s', '1800 s']) expect(t).toContain(s);
    expect(t).toContain('{ "command": "npx", "args": ["--no-install", "golem-spec", "mcp"] }');
    expect(t).toContain('once per user turn');
  });
});

describe('skills', () => {
  const skills = ['robot-ears', 'falsify-and-fix'];

  it.each(skills)('%s has a name equal to its directory and a description of at most 500 characters naming a trigger', (name) => {
    const f = front(packFile(`skills/${name}/SKILL.md`));
    expect(f['name']).toBe(name);
    expect(f['description']?.length).toBeGreaterThan(0);
    expect(f['description']?.length).toBeLessThanOrEqual(500);
    expect(f['description']).toMatch(/\b(Use it when|when)\b/);
  });

  it('robot-ears shows at least three examples over at least three patterns, each compiling with no error', () => {
    const t = packFile('skills/robot-ears/SKILL.md');
    const examples = [...t.matchAll(/```ears\n([^\n]+)\n```/g)].map((m) => m[1] as string);
    expect(examples.length).toBeGreaterThanOrEqual(3);
    const patterns = new Set<string>();
    for (const line of examples) {
      const r = compileRequirement(line, tinyLexicon);
      expect(r.diagnostics.filter((d) => d.severity === 'error'), line).toEqual([]);
      patterns.add((r.requirement as NonNullable<typeof r.requirement>).pattern);
    }
    expect(patterns.size).toBeGreaterThanOrEqual(3);
    for (const p of ['Ubiquitous', 'Event', 'State', 'Unwanted', 'Optional']) expect(t).toContain(p);
    expect(t).toContain('N, kN, m, cm, mm, s, ms, m/s, cm/s, deg, °, rad, kg, g and %');
  });

  it('falsify-and-fix lists the six steps in order, ends at gate exit 0 and forbids editing requirements', () => {
    const t = packFile('skills/falsify-and-fix/SKILL.md');
    const steps = ['1. Falsify.', '2. Read the counterexample.', '3. Explain the margin.', '4. Fix.', '5. Re-run.', '6. Gate.'].map((s) => t.indexOf(s));
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(t).toContain('until `npx --no-install golem-spec gate` exits with code 0');
    expect(t).toContain('Requirement files are never edited to make a test pass');
    expect(t).toContain('The controller is changed instead');
  });
});

describe('settings/mcp.json', () => {
  it('has exactly one golem entry that runs golem mcp, with no env, url, secret or address', () => {
    const j = packJson('settings/mcp.json');
    expect(Object.keys(j)).toEqual(['mcpServers']);
    expect(Object.keys(j.mcpServers)).toEqual(['golem']);
    expect(j.mcpServers.golem).toEqual({ command: 'npx', args: ['--no-install', 'golem-spec', 'mcp'] });
    expect(packFile('settings/mcp.json')).not.toContain('://');
  });
});

describe('workflows/falsify-and-fix.workflow.json', () => {
  const w = packJson('workflows/falsify-and-fix.workflow.json');
  const repeat = w.nodes[0];

  it('pins the shape the design assumes: one repeat node, six iterations, pause, the report stop condition', () => {
    expect(w.nodes).toHaveLength(1);
    expect(repeat).toMatchObject({ type: 'repeat', id: 'repair_loop', maxIterations: 6, onMaxIterations: 'pause' });
    expect(repeat.stopCondition).toEqual({ fileCheck: { path: '.golem/report.json', jsonPath: 'meta.lastGateExitCode', value: 0 } });
    expect(JSON.stringify(w).match(/"type": ?"repeat"/g)).toHaveLength(1);
  });

  it('runs the tuner then the gate once each per iteration, both as golem-tuner, the gate without --kiro', () => {
    expect(repeat.nodes.map((n: { id: string; agent: string }) => [n.id, n.agent])).toEqual([['tune', 'golem-tuner'], ['gate', 'golem-tuner']]);
    const gate = repeat.nodes[1].prompt as string;
    expect(gate).toContain('`npx --no-install golem-spec gate`');
    expect(gate).toContain('without --kiro');
    expect(gate).toMatch(/exits 1[^.]*stop and report the output unchanged/);
  });

  /** A hand-written interpreter of the declared semantics, to pin the exit-code behaviour (requirements 24.2 to 24.6). */
  const interpret = (exits: number[]): { status: 'success' | 'paused'; iterations: number } => {
    let i = 0;
    for (; i < repeat.maxIterations; ) {
      const code = exits[i++] ?? 2;
      if (code === 0) return { status: 'success', iterations: i };
      if (code === 1) return { status: 'paused', iterations: i };
    }
    return { status: repeat.onMaxIterations === 'pause' ? 'paused' : 'success', iterations: i };
  };

  it.each([
    [[0], 'success', 1], [[2, 2, 0], 'success', 3], [[2, 1], 'paused', 2], [[1], 'paused', 1], [[2, 2, 2, 2, 2, 2, 0], 'paused', 6],
  ] as const)('with gate exits %j the run is %s after %i iterations', (exits, status, n) => {
    expect(interpret([...exits])).toEqual({ status, iterations: n });
  });
});

describe('manifest and init with the real pack', () => {
  it('lists every shipped file except agent-src, README and itself, with the sha256 of its bytes', () => {
    const m = packJson('manifest.json');
    expect(m).toEqual(buildManifest(PACK_DIR));
    for (const f of m.files) expect(f.sha256).toBe(createHash('sha256').update(readFileSync(`${PACK_DIR}${f.rel}`)).digest('hex'));
    expect(m.files.map((f: { rel: string }) => f.rel)).toEqual([
      'agents/golem-scribe.json', 'agents/golem-skeptic.json', 'agents/golem-tuner.json', 'hooks/golem-guard-requirements.mjs', 'hooks/golem.json',
      'settings/mcp.json', 'skills/falsify-and-fix/SKILL.md', 'skills/robot-ears/SKILL.md', 'steering/golem-ears.md', 'workflows/falsify-and-fix.workflow.json',
    ]);
  });

  it('parses every shipped JSON file', () => {
    for (const rel of ['hooks/golem.json', 'settings/mcp.json', 'agents/golem-tuner.json', 'agents/golem-skeptic.json', 'agents/golem-scribe.json', 'workflows/falsify-and-fix.workflow.json', 'manifest.json']) {
      expect(() => JSON.parse(packFile(rel)), rel).not.toThrow();
    }
  });

  it('is installed by golem init byte for byte, including the guard and the steering file', async () => {
    const h = createHarness({ seed: false });
    const manifest = packJson('manifest.json') as { files: { rel: string }[] };
    h.fs.put('/pack/manifest.json', packFile('manifest.json'));
    for (const f of manifest.files) h.fs.put(`/pack/${f.rel}`, readFileSync(`${PACK_DIR}${f.rel}`));
    expect(await h.run('init')).toBe(0);
    for (const f of manifest.files) {
      expect([...(h.fs.files.get(h.path(`.kiro/${f.rel}`)) as Uint8Array)], f.rel).toEqual([...readFileSync(`${PACK_DIR}${f.rel}`)]);
    }
    expect(h.fs.text(h.path('.kiro/hooks/golem-guard-requirements.mjs'))).toBe(packFile('hooks/golem-guard-requirements.mjs'));
    expect(h.fs.text(h.path('.kiro/steering/golem-ears.md'))).toBe(packFile('steering/golem-ears.md'));
    expect(h.io.stdoutText().trim().split('\n').every((l) => l.startsWith('wrote '))).toBe(true);
  });
});
