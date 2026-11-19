// Pure checkers and the deterministic `finalizeAgent` step for the agent files (requirements 19 to 21).
export type AgentRole = 'tuner' | 'skeptic' | 'scribe';
export type AgentJson = Record<string, unknown>;
export interface PermRule { capability: string; match?: string[]; exclude?: string[]; effect: 'allow' | 'deny' | 'ask' | 'evaluate' }

export const V2_FIELDS: readonly string[] = ['name', 'description', 'prompt', 'tools', 'allowedTools', 'toolsSettings', 'mcpServers', 'hooks', 'resources'];
export const V3_FIELDS: readonly string[] = ['permissions', 'model', 'kiroUpgrade'];
export const ALLOWED_WRITE: Record<AgentRole, readonly string[]> = {
  tuner: ['controller/**', 'tuning/**'],
  skeptic: [],
  scribe: ['.kiro/specs/*/proposals.md'],
};
export const GUARD_COMMAND = 'node .kiro/hooks/golem-guard-requirements.mjs';
export const CLI = 'npx --no-install golem-spec';
export const MCP_ARGS = '["--no-install","golem-spec","mcp"]';
export const STOP_COMMAND = `${CLI} gate --kiro`;
const WRITE_CAPABILITIES = ['fs_write', 'filesystem', 'builtin', 'all'];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function rulesOf(file: AgentJson): PermRule[] {
  const p = file['permissions'];
  return isObj(p) && Array.isArray(p['rules']) ? (p['rules'] as PermRule[]) : [];
}

/** The rule `finalizeAgent` appends: deny every write except the allowed set. */
export const denyRule = (allowedWrite: readonly string[]): PermRule => ({ capability: 'fs_write', match: ['**'], exclude: [...allowedWrite], effect: 'deny' });

const ruleEquals = (a: PermRule, b: PermRule): boolean => JSON.stringify([a.capability, a.match ?? null, a.exclude ?? null, a.effect]) === JSON.stringify([b.capability, b.match ?? null, b.exclude ?? null, b.effect]);

/**
 * Appends exactly one Deny_Rule (`fs_write`, `**`, `exclude` = the allowed set) to `permissions.rules` when the allowed
 * set is non-empty and no equal rule exists. Changes nothing else. The input is not mutated.
 */
export function finalizeAgent(upgraded: AgentJson, allowedWrite: readonly string[]): AgentJson {
  const out = clone(upgraded);
  if (allowedWrite.length === 0) return out;
  const rule = denyRule(allowedWrite);
  const perms = isObj(out['permissions']) ? (out['permissions'] as Record<string, unknown>) : {};
  const rules = Array.isArray(perms['rules']) ? (perms['rules'] as PermRule[]) : [];
  if (rules.some((r) => ruleEquals(r, rule))) return out;
  perms['rules'] = [...rules, rule];
  out['permissions'] = perms;
  return out;
}

/** Union of `match` of allow rules for writes. An allow rule without `match`, or with `**`, gives `**`. */
export function effectiveWriteAllow(rules: readonly PermRule[]): string[] {
  const out: string[] = [];
  for (const r of rules) {
    if (r.effect !== 'allow' || !WRITE_CAPABILITIES.includes(r.capability)) continue;
    for (const m of r.match === undefined || r.match.length === 0 ? ['**'] : r.match) if (!out.includes(m)) out.push(m);
  }
  return out;
}

const escapeRe = (s: string): string => s.replace(/[.+^$|?(){}[\]\\]/g, '\\$&');

/**
 * `*` stays inside one path component, `**` stands for any number of whole components (also none, so `dir/**` matches
 * `dir`), and a pattern without a wildcard also matches everything below it.
 */
export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/');
  if (!g.includes('*')) return new RegExp('^' + escapeRe(g) + '(?:/.*)?$');
  const segs = g.split('/');
  if (segs.length === 1 && segs[0] === '**') return /^.*$/;
  let re = '^';
  let skipSlash = true;
  segs.forEach((seg, i) => {
    if (seg === '**') {
      re += i === 0 ? '(?:[^/]+/)*' : '(?:/[^/]+)*';
      skipSlash = i === 0;
      return;
    }
    re += (skipSlash ? '' : '/') + seg.split('*').map(escapeRe).join('[^/]*');
    skipSlash = false;
  });
  return new RegExp(re + '$');
}
const globMatches = (globs: readonly string[] | undefined, path: string): boolean => (globs === undefined || globs.length === 0 ? true : globs.some((g) => globToRegExp(g).test(path)));

/** The documented model: deny overrides allow; `match` and `exclude` globs. No allow rule means not pre-approved. */
export function isWriteAllowed(rules: readonly PermRule[], path: string): boolean {
  const p = path.replace(/\\/g, '/');
  const applies = (r: PermRule): boolean => WRITE_CAPABILITIES.includes(r.capability)
    && globMatches(r.match, p) && !(r.exclude !== undefined && r.exclude.length > 0 && globMatches(r.exclude, p));
  if (rules.some((r) => r.effect === 'deny' && applies(r))) return false;
  return rules.some((r) => r.effect === 'allow' && applies(r));
}

/** String values that start with `/`, `\`, `~` or a drive letter and colon, or contain `/home/`, `/Users/` or `\Users\`. */
export function findAbsolutePaths(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (/^([/\\~]|[A-Za-z]:)/.test(v) || v.includes('/home/') || v.includes('/Users/') || v.includes('\\Users\\')) out.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (isObj(v)) Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

/** Hooks in either form (V2 object keyed by trigger, V3 array). */
export function hookList(file: AgentJson): { trigger: string; matcher?: string; command: string }[] {
  const h = file['hooks'];
  const out: { trigger: string; matcher?: string; command: string }[] = [];
  if (Array.isArray(h)) {
    for (const e of h) if (isObj(e)) out.push({ trigger: String(e['trigger']), ...(typeof e['matcher'] === 'string' ? { matcher: e['matcher'] } : {}), command: String((isObj(e['action']) ? e['action']['command'] : e['command']) ?? '') });
  } else if (isObj(h)) {
    for (const [trigger, list] of Object.entries(h)) if (Array.isArray(list)) for (const e of list) if (isObj(e)) out.push({ trigger, ...(typeof e['matcher'] === 'string' ? { matcher: e['matcher'] } : {}), command: String(e['command'] ?? '') });
  }
  return out;
}

const TUNER_MCP = ['list_requirements', 'check_requirement', 'run_requirement', 'falsify', 'get_counterexample', 'replay', 'explain_margin', 'propose_requirement'];
const SKEPTIC_MCP = ['falsify', 'propose_requirement', 'list_requirements', 'check_requirement', 'get_counterexample', 'explain_margin'];

/** Violations of requirements 19, 20, 21 and 28.21 for one agent file; empty for a valid one. */
export function checkAgent(role: AgentRole, file: unknown, form: 'source' | 'upgraded'): string[] {
  if (!isObj(file)) return ['the agent file must be a JSON object'];
  const v: string[] = [];
  const allowed = form === 'source' ? V2_FIELDS : [...V2_FIELDS, ...V3_FIELDS];
  for (const k of Object.keys(file)) if (!allowed.includes(k)) v.push(`field "${k}" is not allowed in a ${form} agent file`);
  if (file['name'] !== `golem-${role}`) v.push(`name must be "golem-${role}"`);
  const d = file['description'];
  if (typeof d !== 'string' || d.length < 1 || d.length > 200) v.push('description must be 1 to 200 characters');
  for (const k of ['prompt', 'tools', 'mcpServers']) if (file[k] === undefined) v.push(`field "${k}" is required`);
  const servers = file['mcpServers'];
  const golem = isObj(servers) ? servers['golem'] : undefined;
  if (!isObj(golem) || golem['command'] !== 'npx' || JSON.stringify(golem['args']) !== MCP_ARGS) v.push('mcpServers.golem must run `npx --no-install golem-spec mcp`');
  for (const a of findAbsolutePaths(file)) v.push(`absolute path or home directory in a value: ${JSON.stringify(a)}`);

  const hooks = hookList(file);
  const guard = hooks.filter((h) => h.command.includes('golem-guard-requirements'));
  if (role === 'tuner') {
    if (!guard.some((h) => h.trigger.toLowerCase() === 'pretooluse' && h.command === GUARD_COMMAND)) v.push(`the tuner needs a preToolUse hook with the command "${GUARD_COMMAND}"`);
    if (!hooks.some((h) => h.trigger.toLowerCase() === 'stop' && h.command === STOP_COMMAND)) v.push(`the tuner needs a stop hook with the command "${STOP_COMMAND}"`);
  } else if (guard.length > 0) v.push(`only golem-tuner may reference the requirements guard (found in golem-${role})`);

  const tools = Array.isArray(file['tools']) ? (file['tools'] as string[]) : [];
  const allowedTools = Array.isArray(file['allowedTools']) ? (file['allowedTools'] as string[]) : [];
  const wantTools = role === 'tuner' ? TUNER_MCP : role === 'skeptic' ? SKEPTIC_MCP : ['check_requirement'];
  for (const t of wantTools) if (!allowedTools.includes(`@golem/${t}`)) v.push(`allowedTools must list @golem/${t}`);
  const writeTools = (xs: string[]): string[] => xs.filter((x) => /^(write|fs_write|edit|str_replace)$/i.test(x));
  if (role === 'skeptic') {
    for (const t of [...writeTools(tools), ...writeTools(allowedTools)]) v.push(`the skeptic may not list the file-writing tool "${t}"`);
  } else if (!tools.includes('write')) v.push('tools must list the write tool');

  const want = ALLOWED_WRITE[role];
  const ts = isObj(file['toolsSettings']) ? (file['toolsSettings'] as Record<string, unknown>) : {};
  const w = isObj(ts['write']) ? (ts['write'] as Record<string, unknown>) : {};
  const allowedPaths = Array.isArray(w['allowedPaths']) ? (w['allowedPaths'] as string[]) : [];
  if (!sameList(allowedPaths, want)) v.push(`toolsSettings.write.allowedPaths must equal ${JSON.stringify(want)}, got ${JSON.stringify(allowedPaths)}`);
  if (role === 'skeptic' && JSON.stringify(w['deniedPaths']) !== '["**"]') v.push('the skeptic needs toolsSettings.write.deniedPaths ["**"]');

  if (form === 'upgraded') {
    const rules = rulesOf(file);
    if (file['permissions'] === undefined) v.push('an upgraded agent file needs permissions');
    if (file['kiroUpgrade'] === undefined) v.push('an upgraded agent file needs the kiroUpgrade marker');
    const eff = effectiveWriteAllow(rules);
    if (!sameList(eff, want)) v.push(`the pre-approved write paths must equal ${JSON.stringify(want)}, got ${JSON.stringify(eff)}`);
    const denies = rules.filter((r) => r.effect === 'deny' && r.capability === 'fs_write' && sameList(r.match ?? [], ['**']));
    if (denies.length === 0) v.push('a Deny_Rule for fs_write on ** is missing');
    else if (!denies.some((r) => sameList(r.exclude ?? [], want))) v.push(`the Deny_Rule for fs_write on ** must exclude exactly ${JSON.stringify(want)}`);
    for (const p of want) if (!isWriteAllowed(rules, p.replace(/\*+/g, 'x'))) v.push(`a write to ${p} is not allowed by the effective rules`);
    if (isWriteAllowed(rules, 'src/other.ts')) v.push('a write outside the allowed set is allowed by the effective rules');
    if (role === 'skeptic' && rules.some((r) => r.effect === 'allow' && WRITE_CAPABILITIES.includes(r.capability))) v.push('the skeptic may have no allow rule for writes');
  }
  return v;
}
