#!/usr/bin/env node
// GOLEM requirements guard: a PreToolUse hook for the golem-tuner agent.
// It exits with code 2 when a write target is a requirements.md file, and with 0 otherwise.
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

export function decide(stdin) {
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch (e) {
    return { code: 0, stderr: `golem guard: the payload is not valid JSON (${e.message}); allowing the call` };
  }
  const targets = targetsOf(payload);
  if (targets.length === 0) return { code: 0, stderr: 'golem guard: the payload has no path, file_path or paths; allowing the call' };
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
