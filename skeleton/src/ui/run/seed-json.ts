// "Copy seed" JSON: stable key order, 2-space indent, non-finite robustness as strings.
import type { Counterexample } from '../types.js';

const nz = (x: number): number => (x === 0 ? 0 : x);

function encodeNumber(x: number): number | string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  return nz(x);
}

function decodeNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return nz(v);
  if (v === 'NaN') return Number.NaN;
  if (v === 'Infinity') return Infinity;
  if (v === '-Infinity') return -Infinity;
  return undefined;
}

export function seedToJson(ce: Counterexample): string {
  const scenario: Record<string, number> = {};
  for (const k of Object.keys(ce.scenario).sort()) scenario[k] = nz(ce.scenario[k] as number);
  return JSON.stringify({
    reqId: ce.reqId,
    scenario,
    seed: nz(ce.seed),
    robustness: encodeNumber(ce.robustness),
    shrunk: ce.shrunk,
    foundAfter: nz(ce.foundAfter),
  }, null, 2);
}

/** Validates an unknown value as a Counterexample. Returns the error text or the value. */
export function counterexampleFrom(o: unknown): { ok: true; value: Counterexample } | { ok: false; error: string } {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'the seed is not a JSON object' };
  const r = o as Record<string, unknown>;
  if (typeof r['reqId'] !== 'string') return { ok: false, error: 'reqId must be a string' };
  const sc = r['scenario'];
  if (sc === null || typeof sc !== 'object' || Array.isArray(sc)) return { ok: false, error: 'scenario must be an object of numbers' };
  const scenario: Record<string, number> = {};
  for (const [k, v] of Object.entries(sc as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `scenario value ${k} must be a finite number` };
    scenario[k] = nz(v);
  }
  if (typeof r['seed'] !== 'number' || !Number.isInteger(r['seed'])) return { ok: false, error: 'seed must be an integer' };
  const robustness = decodeNumber(r['robustness']);
  if (robustness === undefined) return { ok: false, error: 'robustness must be a number' };
  if (typeof r['shrunk'] !== 'boolean') return { ok: false, error: 'shrunk must be true or false' };
  if (typeof r['foundAfter'] !== 'number' || !Number.isFinite(r['foundAfter'])) return { ok: false, error: 'foundAfter must be a number' };
  return {
    ok: true,
    value: { reqId: r['reqId'], scenario, seed: nz(r['seed']), robustness, shrunk: r['shrunk'], foundAfter: nz(r['foundAfter']) },
  };
}

export function seedFromJson(text: string): { ok: true; value: Counterexample } | { ok: false; error: string } {
  let o: unknown;
  try { o = JSON.parse(text); } catch (e) {
    return { ok: false, error: `The seed is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  return counterexampleFrom(o);
}
