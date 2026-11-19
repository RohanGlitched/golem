// TypeScript port of Unitree's G1 walking policy (unitree_rl_gym deploy/pre_train/g1/motion.pt):
// LSTM(47 -> 64), then Linear 64 -> 32, ELU (alpha 1), Linear 32 -> 12. Float64 throughout.
// The TorchScript module keeps h and c between calls; so does this class.

export const OBS_DIM = 47;
export const ACT_DIM = 12;
export const HIDDEN = 64;
const MLP_HIDDEN = 32;

/** Tensor names and shapes, as in policy.bin (Requirement 4.2). */
export const POLICY_SHAPES: Readonly<Record<string, readonly number[]>> = {
  W1: [32, 64], b1: [32], W2: [12, 32], b2: [12],
  Wih: [256, 47], Whh: [256, 64], bih: [256], bhh: [256],
};

export interface LstmWeights {
  Wih: Float64Array; Whh: Float64Array; bih: Float64Array; bhh: Float64Array;
  input: number; hidden: number;
}

/** y = W x + b, with W row-major rows x cols. */
export function linear(W: Float64Array, b: Float64Array, rows: number, cols: number, x: Float64Array, y: Float64Array): void {
  for (let r = 0; r < rows; r++) {
    let s = b[r] as number;
    const o = r * cols;
    for (let c = 0; c < cols; c++) s += (W[o + c] as number) * (x[c] as number);
    y[r] = s;
  }
}

/** In place ELU with alpha 1 on the first n entries. */
export function elu(x: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const v = x[i] as number;
    if (v <= 0) x[i] = Math.expm1(v);
  }
}

const sigmoid = (v: number): number => 1 / (1 + Math.exp(-v));

/**
 * One LSTM step in PyTorch gate order i, f, g, o. Updates h and c in place.
 * gates is scratch of length 4 * hidden.
 */
export function lstmStep(w: LstmWeights, x: Float64Array, h: Float64Array, c: Float64Array, gates: Float64Array): void {
  const H = w.hidden, I = w.input;
  for (let r = 0; r < 4 * H; r++) {
    let s = (w.bih[r] as number) + (w.bhh[r] as number);
    const oi = r * I, oh = r * H;
    for (let k = 0; k < I; k++) s += (w.Wih[oi + k] as number) * (x[k] as number);
    for (let k = 0; k < H; k++) s += (w.Whh[oh + k] as number) * (h[k] as number);
    gates[r] = s;
  }
  for (let j = 0; j < H; j++) {
    const i = sigmoid(gates[j] as number);
    const f = sigmoid(gates[H + j] as number);
    const g = Math.tanh(gates[2 * H + j] as number);
    const o = sigmoid(gates[3 * H + j] as number);
    const cn = f * (c[j] as number) + i * g;
    c[j] = cn;
    h[j] = o * Math.tanh(cn);
  }
}

const sameShape = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export class Policy {
  readonly h = new Float64Array(HIDDEN);
  readonly c = new Float64Array(HIDDEN);
  private readonly lstm: LstmWeights;
  private readonly W1: Float64Array; private readonly b1: Float64Array;
  private readonly W2: Float64Array; private readonly b2: Float64Array;
  private readonly gates = new Float64Array(4 * HIDDEN);
  private readonly hidden1 = new Float64Array(MLP_HIDDEN);

  /** @param weights float32 tensors by name; converted to Float64 once. */
  constructor(weights: Record<string, ArrayLike<number>>) {
    const get = (name: string): Float64Array => {
      const t = weights[name];
      const shape = POLICY_SHAPES[name] as readonly number[];
      const n = shape.reduce((a, b) => a * b, 1);
      if (t === undefined) throw new Error(`policy weights are missing tensor ${name}`);
      if (t.length !== n) throw new Error(`policy tensor ${name} has ${t.length} values, expected ${n} (shape ${shape.join('x')})`);
      return Float64Array.from(t);
    };
    this.lstm = { Wih: get('Wih'), Whh: get('Whh'), bih: get('bih'), bhh: get('bhh'), input: OBS_DIM, hidden: HIDDEN };
    this.W1 = get('W1'); this.b1 = get('b1'); this.W2 = get('W2'); this.b2 = get('b2');
  }

  /** h := 0, c := 0 */
  reset(): void { this.h.fill(0); this.c.fill(0); }

  /** One policy call: obs (47) -> action (12). Allocates nothing. */
  step(obs: Float64Array, out: Float64Array): void {
    if (obs.length !== OBS_DIM || out.length !== ACT_DIM) {
      throw new Error(`policy step needs an input of length ${OBS_DIM} and an output of length ${ACT_DIM}, got input ${obs.length} and output ${out.length}`);
    }
    lstmStep(this.lstm, obs, this.h, this.c, this.gates);
    linear(this.W1, this.b1, MLP_HIDDEN, HIDDEN, this.h, this.hidden1);
    elu(this.hidden1, MLP_HIDDEN);
    linear(this.W2, this.b2, ACT_DIM, MLP_HIDDEN, this.hidden1, out);
  }

  /** Reads policy.bin (see scripts/lib/pack.mjs) and validates every tensor shape. */
  static fromBytes(bin: Uint8Array): Policy {
    return new Policy(readPolicyFile(bin));
  }
}

interface PolicyHeader { commit: string; gateOrder: string; tensors: { name: string; shape: number[]; offset: number; bytes: number }[] }

/** Parses policy.bin into float32 tensors. Throws a named error on a bad shape or layout. */
export function readPolicyFile(bin: Uint8Array): Record<string, Float32Array> {
  if (bin.length < 4) throw new Error('policy.bin is shorter than its 4-byte header length');
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const hlen = dv.getUint32(0, true);
  if (4 + hlen > bin.length) throw new Error(`policy.bin header length ${hlen} exceeds the file size ${bin.length}`);
  const header = JSON.parse(new TextDecoder().decode(bin.subarray(4, 4 + hlen))) as PolicyHeader;
  if (header.gateOrder !== 'ifgo') throw new Error(`policy.bin gate order is ${header.gateOrder}, expected ifgo`);
  const out: Record<string, Float32Array> = {};
  for (const t of header.tensors) {
    const expected = POLICY_SHAPES[t.name];
    if (expected === undefined) continue;
    if (!sameShape(expected, t.shape)) {
      throw new Error(`policy tensor ${t.name} has shape [${t.shape.join(', ')}], expected [${expected.join(', ')}]`);
    }
    if (t.offset % 4 !== 0 || t.offset + t.bytes > bin.length || t.bytes !== 4 * expected.reduce((a, b) => a * b, 1)) {
      throw new Error(`policy tensor ${t.name} has offset ${t.offset} and ${t.bytes} bytes, which do not fit a ${bin.length}-byte file`);
    }
    const copy = new Uint8Array(t.bytes);
    copy.set(bin.subarray(t.offset, t.offset + t.bytes));
    out[t.name] = new Float32Array(copy.buffer);
  }
  for (const name of Object.keys(POLICY_SHAPES)) {
    if (out[name] === undefined) throw new Error(`policy.bin is missing tensor ${name}`);
  }
  return out;
}