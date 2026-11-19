// Pure checker for hooks/golem.json (requirement 17). No file or process access.
export const HOOK_TRIGGERS = ['PostFileSave', 'PostTaskExec', 'Stop', 'Manual'] as const;
export const GUARD_SCRIPT = 'golem-guard-requirements';

/** True when the regular expression `matcher` accepts `path`. An invalid expression accepts nothing. */
export function matcherAccepts(matcher: string, path: string): boolean {
  try {
    return new RegExp(matcher).test(path);
  } catch {
    return false;
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

/** The list of violations of requirement 17; empty for a valid file. `minTimeoutS` is the measured Quick_Budget wall time. */
export function checkHookFile(file: unknown, minTimeoutS: number): string[] {
  const v: string[] = [];
  if (!isObj(file)) return ['the hook file must be a JSON object'];
  if (file['version'] !== 'v1') v.push(`version must be "v1", got ${JSON.stringify(file['version'])}`);
  const hooks = file['hooks'];
  if (!Array.isArray(hooks)) return [...v, 'hooks must be an array'];
  if (hooks.length !== 5) v.push(`hooks must hold exactly 5 hooks, got ${hooks.length}`);
  const names = new Set<string>();
  hooks.forEach((h, i) => {
    const at = `hooks[${i}]`;
    if (!isObj(h)) { v.push(`${at} must be an object`); return; }
    if (!nonEmpty(h['name'])) v.push(`${at}.name must be a non-empty string`);
    else {
      const k = h['name'].toLowerCase();
      if (names.has(k)) v.push(`${at}.name "${h['name']}" repeats another hook name (ignoring case)`);
      names.add(k);
    }
    const trigger = h['trigger'];
    if (!nonEmpty(trigger)) v.push(`${at}.trigger must be a non-empty string`);
    else if (trigger.toLowerCase() === 'pretooluse') v.push(`${at} is a PreToolUse hook; the workspace hook file may not hold one`);
    else if (!(HOOK_TRIGGERS as readonly string[]).includes(trigger)) v.push(`${at}.trigger "${trigger}" is not one of ${HOOK_TRIGGERS.join(', ')} (exact casing)`);
    const action = h['action'];
    if (!isObj(action) || action['type'] !== 'command' || !nonEmpty(action['command'])) v.push(`${at}.action must be { "type": "command", "command": <non-empty string> }`);
    if (trigger === 'PostFileSave') {
      if (!nonEmpty(h['matcher'])) v.push(`${at}.matcher must be a non-empty regular expression for a PostFileSave hook`);
      else {
        try { new RegExp(h['matcher']); } catch (e) { v.push(`${at}.matcher is not a valid regular expression: ${(e as Error).message}`); }
      }
    }
    const t = h['timeout'];
    if (typeof t !== 'number' || !Number.isInteger(t)) v.push(`${at}.timeout must be a whole number of seconds`);
    else if (t < minTimeoutS) v.push(`${at}.timeout ${t} s is below the measured quick-budget wall time of ${minTimeoutS} s`);
    if (JSON.stringify(h).includes(GUARD_SCRIPT)) v.push(`${at} references the requirements guard; only the golem-tuner agent may`);
  });
  return v;
}
