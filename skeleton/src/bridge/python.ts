// A controller written in Python, run unchanged as a GOLEM Controller (Node only: the CLI, the gate and the MCP server).
//
// GOLEM's trial loop calls `Controller.step` synchronously between MuJoCo steps, so the bridge is synchronous too:
// each trial worker starts the Python script once, in a helper thread that owns the child process, and every control
// step writes the observation into shared memory, wakes the helper, and blocks in `Atomics.wait` until the action
// comes back. The wire format on the child's stdin and stdout is little-endian and has no dependencies on either side:
//
//   request   u32 kind (1 = reset, 2 = step), u32 n, then n float64      (the observation; n = 0 for reset)
//   reply     u32 n, then n float64                                     (the action; n = 0 for reset)
//
// The Python side is `golem_bridge.py` (shipped with the starter): `serve(make_controller)` reads requests, calls a
// fresh `make_controller()` at every reset (one trial), and calls the controller with each observation.
import { Worker } from 'node:worker_threads';
import type { Controller, SimContext } from '../sim/types.js';

export interface PythonControllerOptions {
  /** Path of the Python file that calls `golem_bridge.serve(...)`. */
  script: string;
  /** Python interpreter. Default: `GOLEM_PYTHON`, else `python` on Windows and `python3` elsewhere. */
  python?: string;
  /** Writes the observation into `out` and returns how many numbers it wrote. Must not allocate per call. */
  observe(ctx: SimContext, out: Float64Array): number;
  /** Applies the action (the first `n` numbers of `action`), usually by writing `ctx.data.ctrl`. */
  apply(ctx: SimContext, action: Float64Array, n: number): void;
  /** Largest observation or action, in numbers. Default 256. */
  maxValues?: number;
  /** How long one step may wait for Python before the trial fails (ms). Default 10000. */
  timeoutMs?: number;
}

const IDLE = 0, REQUEST = 1, REPLY = 2, FAILED = 3;
const RESET = 1, STEP = 2;

// The helper thread. CommonJS, because it is run with `eval: true`.
const HELPER = String.raw`
const { workerData } = require('node:worker_threads');
const { spawn } = require('node:child_process');
const { sab, python, script, max } = workerData;
const h = new Int32Array(sab, 0, 4);
const d = new Float64Array(sab, 16, max);
const fail = (code) => { Atomics.store(h, 3, code); Atomics.store(h, 0, 3); Atomics.notify(h, 0); };
let child;
try { child = spawn(python, ['-u', script], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true }); } catch { fail(1); }
let buf = Buffer.alloc(0);
let waiting;
child.on('error', () => fail(2));
child.on('exit', (code) => fail(code === 0 ? 4 : 3));
child.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  if (buf.length < 4) return;
  const n = buf.readUInt32LE(0);
  if (buf.length < 4 + 8 * n || !waiting) return;
  const frame = buf.subarray(0, 4 + 8 * n);
  buf = buf.subarray(4 + 8 * n);
  const w = waiting; waiting = undefined; w(frame);
});
async function untilState(want) {
  for (;;) {
    const s = Atomics.load(h, 0);
    if (s === want || s === 3) return s;
    const r = Atomics.waitAsync(h, 0, s);
    if (r.async) await r.value;
  }
}
// After a reply the main thread sets IDLE and may set the next REQUEST before this thread looks, so wait for "not
// REPLY" rather than for IDLE.
async function untilNot(state) {
  for (;;) {
    const s = Atomics.load(h, 0);
    if (s !== state) return s;
    const r = Atomics.waitAsync(h, 0, s);
    if (r.async) await r.value;
  }
}
(async () => {
  for (;;) {
    if ((await untilState(1)) === 3) return;
    const kind = Atomics.load(h, 1), n = Atomics.load(h, 2);
    const out = Buffer.alloc(8 + 8 * n);
    out.writeUInt32LE(kind, 0); out.writeUInt32LE(n, 4);
    for (let i = 0; i < n; i++) out.writeDoubleLE(d[i], 8 + 8 * i);
    const reply = new Promise((res) => { waiting = res; });
    child.stdin.write(out);
    const frame = await reply;
    const m = frame.readUInt32LE(0);
    if (m > max) { fail(5); return; }
    for (let i = 0; i < m; i++) d[i] = frame.readDoubleLE(4 + 8 * i);
    Atomics.store(h, 2, m);
    Atomics.store(h, 0, 2);
    Atomics.notify(h, 0);
    if ((await untilNot(2)) === 3) return;
  }
})();
`;

const FAILURES: Record<number, string> = {
  1: 'could not start the interpreter',
  2: 'the interpreter could not be started (is it on PATH? set GOLEM_PYTHON)',
  3: 'the Python controller exited with an error (its traceback is above)',
  4: 'the Python controller exited before answering',
  5: 'the Python controller returned more numbers than maxValues',
};

/** One Python process and its helper thread, shared by every trial in this worker. */
class Bridge {
  readonly h: Int32Array;
  readonly d: Float64Array;
  private readonly worker: Worker;

  constructor(readonly python: string, readonly script: string, readonly max: number, readonly timeoutMs: number) {
    const sab = new SharedArrayBuffer(16 + 8 * max);
    this.h = new Int32Array(sab, 0, 4);
    this.d = new Float64Array(sab, 16, max);
    this.worker = new Worker(HELPER, { eval: true, workerData: { sab, python, script, max } });
    this.worker.unref();
  }

  /** Sends `n` numbers of `d` as `kind` and blocks until the reply is in `d`. Returns the reply's length. */
  call(kind: number, n: number): number {
    const h = this.h;
    if (Atomics.load(h, 0) === FAILED) throw this.error();
    Atomics.store(h, 1, kind);
    Atomics.store(h, 2, n);
    Atomics.store(h, 0, REQUEST);
    Atomics.notify(h, 0);
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const s = Atomics.load(h, 0);
      if (s === REPLY) break;
      if (s === FAILED) throw this.error();
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Python controller ${this.script}: no answer within ${this.timeoutMs} ms`);
      Atomics.wait(h, 0, s, left);
    }
    const m = Atomics.load(h, 2);
    Atomics.store(h, 0, IDLE);
    Atomics.notify(h, 0);
    return m;
  }

  private error(): Error {
    return new Error(`Python controller ${this.script}: ${FAILURES[Atomics.load(this.h, 3)] ?? 'failed'}`);
  }
}

const bridges = new Map<string, Bridge>();

export function defaultPython(): string {
  const env = typeof process !== 'undefined' ? process.env['GOLEM_PYTHON'] : undefined;
  return env && env.length > 0 ? env : process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * A `makeController` for a RobotApp whose controller is a Python script. Each trial sends a reset (the script makes a
 * fresh controller) and then one request per control step. The Python process is started on the first trial in each
 * worker and lives until the worker exits.
 */
export function pythonController(o: PythonControllerOptions): (ctx: SimContext) => Controller {
  const python = o.python ?? defaultPython();
  const max = o.maxValues ?? 256;
  const timeoutMs = o.timeoutMs ?? 10000;
  return (ctx) => {
    const key = `${python}\0${o.script}`;
    let b = bridges.get(key);
    if (b === undefined) { b = new Bridge(python, o.script, max, timeoutMs); bridges.set(key, b); }
    const bridge = b;
    bridge.call(RESET, 0);
    return {
      step(c: SimContext) {
        const n = o.observe(c, bridge.d);
        if (!(n >= 0 && n <= max)) throw new Error(`Python controller ${o.script}: observe returned ${n} numbers (max ${max})`);
        const m = bridge.call(STEP, n);
        o.apply(c, bridge.d, m);
      },
    };
  };
}
