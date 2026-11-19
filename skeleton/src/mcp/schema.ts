// Tool definitions and a 60-line input validator (no zod, see design D5).
import type { KitDeps } from '../cli/deps.js';
import type { LocatedApp } from '../cli/config.js';
import type { RobotApp, TrialPool } from '../cli/sibling-types.js';
import type { CompileOutcome } from '../cli/types.js';
import type { FifoQueue, WriteQueue } from './queue.js';
import type { ToolResult } from './result.js';

export interface JsonSchemaProp {
  type: 'string' | 'integer';
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: number;
  description: string;
}

export interface InputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProp>;
  required?: string[];
  additionalProperties: false;
}

export interface McpAppContext {
  /** A ConfigError message becomes an error Tool_Result (10.7, 10.10). */
  located: LocatedApp | { error: string };
  robotApp?: RobotApp;
  toolTimeCapS: number;
}

export interface ToolCtx {
  /** Aborts on a client cancel or when the time cap fires. */
  signal: AbortSignal;
  /** True when the Tool_Time_Cap (and not a client cancel) ended the call. */
  capFired(): boolean;
  deps: KitDeps;
  app: McpAppContext;
  /** The located app and loaded RobotApp (the server answers with an error before a tool runs when they are missing). */
  located: LocatedApp;
  robotApp: RobotApp;
  /** Creates the pool at the first call, reuses it, and retries after a failure (requirements 10.3, 10.9). */
  getPool(): Promise<TrialPool>;
  /** Compiles the Requirements_Files on every call, so edits are seen at once. */
  compile(): Promise<CompileOutcome>;
  /** One falsification at a time, in arrival order (12.8). */
  runQueue: FifoQueue;
  /** Serialises proposal writes (14.11). */
  writeQueue: WriteQueue;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: InputSchema;
  handler(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult>;
  /** `run_requirement` and `falsify` return a partial result when the time cap ends them. */
  partialOnCap?: boolean;
}

export class SchemaError extends Error {
  override name = 'SchemaError';
  constructor(readonly field: string, message: string) { super(message); }
}

export type ValidationResult = { ok: true; value: Record<string, unknown> } | { ok: false; field: string; message: string };

export function validateInput(def: InputSchema, args: unknown): ValidationResult {
  const input = args === undefined || args === null ? {} : args;
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, field: '(arguments)', message: 'arguments must be an object' };
  const o = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    if (!Object.prototype.hasOwnProperty.call(def.properties, k)) {
      return { ok: false, field: k, message: `unknown field "${k}"; accepted fields: ${Object.keys(def.properties).join(', ') || 'none'}` };
    }
  }
  for (const [name, p] of Object.entries(def.properties)) {
    const has = Object.prototype.hasOwnProperty.call(o, name) && o[name] !== undefined;
    if (!has) {
      if (def.required?.includes(name) === true) return { ok: false, field: name, message: `${name} is required` };
      if (p.default !== undefined) out[name] = p.default;
      continue;
    }
    const v = o[name];
    if (p.type === 'string') {
      const lo = p.minLength ?? 0;
      const hi = p.maxLength ?? Infinity;
      if (typeof v !== 'string' || v.length < lo || v.length > hi) {
        return { ok: false, field: name, message: `${name} must be a string of ${lo} to ${hi === Infinity ? 'any number of' : hi} characters` };
      }
    } else {
      const lo = p.minimum ?? -Infinity;
      const hi = p.maximum ?? Infinity;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
        const range = p.minimum !== undefined && p.maximum !== undefined ? ` from ${lo} to ${hi}` : '';
        return { ok: false, field: name, message: `${name} must be an integer${range}, got ${JSON.stringify(v) ?? 'undefined'}` };
      }
    }
    out[name] = v;
  }
  return { ok: true, value: out };
}
