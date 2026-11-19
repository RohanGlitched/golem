// A worker cannot be told about a requirement the user has just edited: the pool resolves `TrialSpec.reqId`
// inside the worker, from the app module. The studio therefore sends the requirement line itself in
// the reqId, as `<id>\0<line>`, and the worker compiles it (see `studioRequirements` in `worker.ts`).
// Plain ids contain no NUL, so a key never collides with an id.

const SEP = '\u0000';

export function encodeReqKey(id: string, source: string): string {
  return `${id}${SEP}${source}`;
}

export function decodeReqKey(key: string): { id: string; source: string } | undefined {
  const i = key.indexOf(SEP);
  return i < 0 ? undefined : { id: key.slice(0, i), source: key.slice(i + 1) };
}
