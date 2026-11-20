// The Python bridge against the real interpreter (skipped when none is installed): a reset gives a fresh controller,
// steps round-trip floats exactly, and a crashing or silent script fails the trial with a message instead of hanging.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultPython, pythonController } from './python.js';
import type { SimContext } from '../sim/types.js';

const PY = defaultPython();
const hasPython = spawnSync(PY, ['--version'], { encoding: 'utf8' }).status === 0;
const BRIDGE = fileURLToPath(new URL('../../starter/golem_bridge.py', import.meta.url));

function scriptDir(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'golem-py-'));
  copyFileSync(BRIDGE, join(dir, 'golem_bridge.py'));
  writeFileSync(join(dir, 'ctl.py'), body);
  return join(dir, 'ctl.py');
}

const ctx = {} as SimContext;

describe.skipIf(!hasPython)('pythonController', () => {
  it('round-trips floats exactly and starts a fresh controller at every reset', () => {
    const script = scriptDir([
      'from golem_bridge import serve',
      'def make():',
      '    n = [0]',
      '    def step(obs):',
      '        n[0] += 1',
      '        return [obs[0] * 3.0 + obs[1], float(n[0])]',
      '    return step',
      'serve(make)',
      '',
    ].join('\n'));
    let obs = [0.1, 1e-300];
    const got: number[][] = [];
    const make = pythonController({
      script,
      observe(_c, out) { out[0] = obs[0] as number; out[1] = obs[1] as number; return 2; },
      apply(_c, a, n) { got.push(Array.from(a.subarray(0, n))); },
    });
    const c1 = make(ctx);
    c1.step(ctx, 0); c1.step(ctx, 0.02);
    obs = [-2.5, 0.75];
    const c2 = make(ctx); // reset: the step counter starts again
    c2.step(ctx, 0);
    expect(got).toEqual([[0.1 * 3.0 + 1e-300, 1], [0.1 * 3.0 + 1e-300, 2], [-2.5 * 3.0 + 0.75, 1]]);
  });

  it('fails the trial with the reason when the script raises', () => {
    const script = scriptDir('from golem_bridge import serve\ndef make():\n    def step(obs):\n        raise RuntimeError("boom")\n    return step\nserve(make)\n');
    const make = pythonController({ script, observe: (_c, out) => { out[0] = 1; return 1; }, apply: () => undefined });
    const c = make(ctx);
    expect(() => c.step(ctx, 0)).toThrow(/exited with an error/);
  });

  it('gives up after the timeout when the script never answers', () => {
    const script = scriptDir('import time\nwhile True:\n    time.sleep(1)\n');
    const make = pythonController({ script, timeoutMs: 800, observe: () => 0, apply: () => undefined });
    expect(() => make(ctx)).toThrow(/no answer within 800 ms/);
  });
});
