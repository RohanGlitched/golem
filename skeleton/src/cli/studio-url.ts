// Studio_URL: the scenario and seed travel in the URL hash.
import type { GolemConfig } from './config.js';
import { formatNumber } from './csv.js';
import type { Scenario } from './sibling-types.js';

export interface StudioHash { reqId: string; seed: number; scenario: Scenario }

const NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** `#r=<id>&seed=<n>&d.<name>=<value>...`, dimensions sorted by name in code unit order. */
export function encodeStudioHash(h: StudioHash): string {
  if (!Number.isInteger(h.seed) || h.seed < 0 || h.seed > 0xffffffff) throw new RangeError(`seed must be a uint32, got ${String(h.seed)}`);
  const parts = [`r=${encodeURIComponent(h.reqId)}`, `seed=${h.seed}`];
  const names = Object.keys(h.scenario).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const n of names) {
    const v = h.scenario[n] as number;
    if (!Number.isFinite(v)) throw new RangeError(`scenario value ${n} must be finite, got ${String(v)}`);
    parts.push(`d.${encodeURIComponent(n)}=${formatNumber(v)}`);
  }
  return `#${parts.join('&')}`;
}

export function decodeStudioHash(hash: string): StudioHash {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const fail = (why: string): never => { throw new Error(`malformed studio hash "${hash}": ${why}`); };
  const parts = body.split('&');
  if (parts.length < 2 || !parts[0]?.startsWith('r=')) return fail('it must start with r=<id>');
  if (!parts[1]?.startsWith('seed=')) return fail('it must hold seed=<n> after r=');
  let reqId: string;
  try { reqId = decodeURIComponent(parts[0].slice(2)); } catch { return fail('bad escape in the requirement id'); }
  const seedText = parts[1].slice(5);
  if (!/^\d+$/.test(seedText)) return fail('seed must be an unsigned integer');
  const seed = Number(seedText);
  if (seed > 0xffffffff) return fail('seed is above 4294967295');
  const scenario: Scenario = {};
  for (const p of parts.slice(2)) {
    const eq = p.indexOf('=');
    if (!p.startsWith('d.') || eq < 0) return fail(`unexpected item "${p}"`);
    let name: string;
    try { name = decodeURIComponent(p.slice(2, eq)); } catch { return fail('bad escape in a dimension name'); }
    const vt = p.slice(eq + 1);
    if (!NUMBER.test(vt)) return fail(`value of ${name} is not a number`);
    Object.defineProperty(scenario, name, { value: Number(vt), enumerable: true, writable: true, configurable: true });
  }
  return { reqId, seed, scenario };
}

/** Relative fallback `apps/<appId>/web/index.html` when the Config_File has no `studioUrl` (6.6). */
export function studioUrl(cfg: Pick<GolemConfig, 'studioUrl'>, appId: string, h: StudioHash): string {
  const base = (cfg.studioUrl ?? `apps/${appId}/web/index.html`).replace(/#.*$/, '');
  return base + encodeStudioHash(h);
}
