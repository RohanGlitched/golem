// JSON-safe robustness values. JSON.stringify turns NaN (unmeasurable), Infinity (vacuous) and
// -Infinity into null, which erases the difference between "no data" and "always holds".

export type EncodedNumber = number | 'NaN' | 'Infinity' | '-Infinity';

/** Finite numbers unchanged; NaN, Infinity and -Infinity as the strings of those names. */
export function encodeRobustness(x: number): EncodedNumber {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  return x;
}

/** Inverse of `encodeRobustness`. Throws on any other value, such as null. */
export function decodeRobustness(x: unknown): number {
  if (typeof x === 'number') return x;
  if (x === 'NaN') return NaN;
  if (x === 'Infinity') return Infinity;
  if (x === '-Infinity') return -Infinity;
  throw new Error(`Cannot decode robustness value ${JSON.stringify(x)}: expected a number, "NaN", "Infinity" or "-Infinity"`);
}

export interface EncodedMonitorResult { robustness: EncodedNumber; worstAt: EncodedNumber; unit: string }

/** A monitor result whose numbers survive JSON.stringify. */
export function monitorResultToJSON(r: { robustness: number; worstAt: number; unit: string }): EncodedMonitorResult {
  return { robustness: encodeRobustness(r.robustness), worstAt: encodeRobustness(r.worstAt), unit: r.unit };
}

/** Inverse of `monitorResultToJSON`. */
export function monitorResultFromJSON(r: EncodedMonitorResult): { robustness: number; worstAt: number; unit: string } {
  return { robustness: decodeRobustness(r.robustness), worstAt: decodeRobustness(r.worstAt), unit: r.unit };
}
