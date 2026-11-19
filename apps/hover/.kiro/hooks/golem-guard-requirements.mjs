#!/usr/bin/env node
// GOLEM requirements guard: a PreToolUse hook for the golem-tuner agent.
// It exits with code 2 when a write target is a requirements.md file, or when it cannot read the payload at all (it fails closed),
// and with 0 when the call clearly touches no requirements.md file.
// It decides only from the JSON payload on stdin. It reads no environment variable and no agent name,
// uses no module except node:url, and makes no network request.
import { pathToFileURL } from 'node:url';

export const BLOCK_MESSAGE = 'golem-tuner may not edit requirements. Propose changes with propose_requirement.';
const MAX_BYTES = 1024 * 1024;

const isNonEmptyString = (x) => typeof x === 'string' && x.length > 0;

/** Every path named by `path`, `file_path` or `paths`, at the top level and in `tool_input`. */
export function targetsOf(payload) {
  const out = [];
  const scan = (o) => {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return;
    for (const k of ['path', 'file_path']) if (isNonEmptyString(o[k])) out.push(o[k]);
    if (Array.isArray(o.paths)) for (const p of o.paths) if (isNonEmptyString(p)) out.push(p);
  };
  scan(payload);
  if (typeof payload === 'object' && payload !== null) scan(payload.tool_input);
  return out;
}

/** `\` to `/`, `.` and `..` resolved, letter case folded. */
export function normalise(p) {
  const parts = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/').toLowerCase();
}

export function isRequirementsPath(p) {
  const n = normalise(p);
  return n.slice(n.lastIndexOf('/') + 1) === 'requirements.md';
}

export const UNREADABLE_MESSAGE = 'golem guard: cannot read the tool call (the payload is not a JSON object), so it is blocked in case it edits requirements. Retry the call; if it keeps failing, report it to the user.';

/** True when any key or string value, at any depth, names a file called requirements.md (not my-requirements.md or requirements.md.bak). */
export function mentionsRequirements(value, depth = 0) {
  if (depth > 20) return false;
  if (typeof value === 'string') return /(^|[^A-Za-z0-9_.-])requirements\.md(?![A-Za-z0-9_.-])/i.test(value);
  if (Array.isArray(value)) return value.some((x) => mentionsRequirements(x, depth + 1));
  if (typeof value === 'object' && value !== null) return Object.entries(value).some(([k, v]) => mentionsRequirements(k, depth + 1) || mentionsRequirements(v, depth + 1));
  return false;
}

export function decide(stdin) {
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch (e) {
    return { code: 2, stderr: `${UNREADABLE_MESSAGE} (invalid JSON: ${e.message})` };
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { code: 2, stderr: `${UNREADABLE_MESSAGE} (the JSON value is not an object)` };
  }
  const targets = targetsOf(payload);
  if (targets.length === 0) {
    if (mentionsRequirements(payload)) {
      return { code: 2, stderr: `${BLOCK_MESSAGE} (the call names requirements.md but no path field that the guard understands)` };
    }
    return { code: 0, stderr: 'golem guard: the payload has no path, file_path or paths and does not mention requirements.md; allowing the call' };
  }
  if (targets.some(isRequirementsPath)) return { code: 2, stderr: BLOCK_MESSAGE };
  return { code: 0 };
}
async function readStdin() {
  const chunks = [];
  let size = 0;
  await new Promise((done) => {
    const timer = setTimeout(done, 400);
    process.stdin.on('data', (c) => {
      if (size < MAX_BYTES) { chunks.push(c.subarray(0, MAX_BYTES - size)); size += c.length; }
    });
    process.stdin.on('end', () => { clearTimeout(timer); done(); });
    process.stdin.on('error', () => { clearTimeout(timer); done(); });
  });
  return Buffer.concat(chunks).toString('utf8');
}

const isMain = typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const r = decide(await readStdin());
  if (r.stderr !== undefined) process.stderr.write(`${r.stderr}\n`);
  process.exit(r.code);
}
