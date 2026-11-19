import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without declarations
import { computeTotals, tasksStatus } from '../../scripts/kiro-stats-lib.mjs';
import { loadSiteData } from '../src/build/data';

const spec = (name: string, o: Record<string, unknown> = {}) => ({
  name, type: 'feature', requirements: 2, earsCriteria: 10, properties: 3, tasksDone: 4, tasksOpen: 1, status: 'in progress', ...o,
});

describe('tasksStatus', () => {
  it('says not started for open tasks with none done, and no tasks for a file without a list', () => {
    expect(tasksStatus('- [ ] 1. a\n  - [ ] 1.1 b\n')).toBe('not started');
    expect(tasksStatus('# nothing here')).toBe('no tasks');
    expect(tasksStatus('- [x] 1. a\n- [ ] 2. b\n')).toBe('in progress');
    expect(tasksStatus('- [x] 1. a\n  - [x]* 1.1 b\n')).toBe('done');
  });
});

describe('computeTotals', () => {
  it('leaves a not-started spec out of every spec total and counts it apart', () => {
    const ws = [{ specs: [spec('a'), spec('cloud', { tasksDone: 0, tasksOpen: 65, status: 'not started', requirements: 20, earsCriteria: 177 })] }];
    expect(computeTotals(ws)).toMatchObject({ specs: 1, specsNotStarted: 1, requirements: 2, earsCriteria: 10, tasksDone: 4, tasksOpen: 1 });
  });

  it('keeps a spec with no task list (a robot requirements file) in the totals', () => {
    const t = computeTotals([{ specs: [spec('g1', { tasksDone: 0, tasksOpen: 0, status: 'no tasks' })] }]);
    expect(t).toMatchObject({ specs: 1, specsNotStarted: 0, requirements: 2 });
  });

  it('counts an agent, hook, skill or steering file once when two workspaces hold an identical copy', () => {
    const pack = { agents: ['golem-tuner:aaa', 'golem-scribe:bbb'], hooks: ['Gate|Stop|golem-spec gate --kiro'], skills: ['robot-ears:ccc'], steering: ['golem-ears.md:ddd'] };
    const ws = [
      { specs: [], keys: { agents: ['reviewer:eee'], hooks: ['Build|PostFileSave|x'], skills: [], steering: ['product.md:fff'] } },
      { specs: [], keys: pack },
      { specs: [], keys: pack },
    ];
    expect(computeTotals(ws)).toMatchObject({ agents: 3, hooks: 2, skills: 1, steering: 2 });
  });

  it('counts a copy whose content differs as a separate artefact', () => {
    const ws = [{ specs: [], keys: { agents: ['golem-tuner:aaa'] } }, { specs: [], keys: { agents: ['golem-tuner:zzz'] } }];
    expect(computeTotals(ws).agents).toBe(2);
  });

  it('never counts more than the sum over workspaces, and installing the same copy again changes nothing (property)', () => {
    fc.assert(fc.property(fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 8 }), fc.integer({ min: 1, max: 4 }), (names, copies) => {
      const keys = { agents: names, hooks: [], skills: [], steering: [] };
      const once = computeTotals([{ specs: [], keys }]).agents;
      const many = computeTotals(Array.from({ length: copies }, () => ({ specs: [], keys }))).agents;
      expect(many).toBe(once);
      expect(once).toBe(new Set(names).size);
    }));
  });
});

describe('the committed kiro.json', () => {
  const k = loadSiteData().kiro;
  it('has tasksOpen in its totals and totals that equal the counted specs', () => {
    const counted = k.workspaces.flatMap((w) => w.specs).filter((s) => s.status !== 'not started');
    expect(k.totals['tasksOpen']).toBe(counted.reduce((n, s) => n + s.tasksOpen, 0));
    expect(k.totals['tasksDone']).toBe(counted.reduce((n, s) => n + s.tasksDone, 0));
    expect(k.totals['specs']).toBe(counted.length);
  });

  it('lists golem-cloud as not started and keeps it out of the totals', () => {
    const cloud = k.workspaces.flatMap((w) => w.specs).find((s) => s.name === 'golem-cloud');
    expect(cloud?.status).toBe('not started');
    expect(k.totals['specsNotStarted']).toBeGreaterThanOrEqual(1);
  });
});
