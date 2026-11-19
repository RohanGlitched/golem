// Reads the JSON Lines that `kiro-cli chat --output-format stream-json` writes to stdout (kiro-cli 3.5.0, ACP payloads).
// Shapes seen in the dry run (results/agent-gate.dryrun.streams):
//   {"type":"runStarted","data":{...}}
//   {"type":"sessionUpdate","data":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"..."}}}}
//   {"type":"sessionUpdate","data":{"update":{"sessionUpdate":"session_info_update","_meta":{"kiro":{"kind":"session_usage","credits":[{"usage":0.13}]}}}}}
//   {"type":"runFinished","data":{"status":"success","stopReason":"end_turn","finalText":"..."}}
export type StreamEvent = Record<string, unknown>;

export function parseStreamLine(line: string): StreamEvent | undefined {
  const t = line.trim();
  if (!t.startsWith('{')) return undefined;
  try {
    const v: unknown = JSON.parse(t);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as StreamEvent) : undefined;
  } catch {
    return undefined;
  }
}

export function parseStream(text: string): StreamEvent[] {
  return text.split('\n').map(parseStreamLine).filter((e): e is StreamEvent => e !== undefined);
}

/** Sum of every `usage` inside every `"credits": [{"usage": N}]` array found anywhere in the event. */
export function creditsOf(v: unknown): number {
  if (Array.isArray(v)) return v.reduce<number>((s, x) => s + creditsOf(x), 0);
  if (v === null || typeof v !== 'object') return 0;
  let sum = 0;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === 'credits' && Array.isArray(x)) {
      for (const c of x) if (c !== null && typeof c === 'object' && typeof (c as { usage?: unknown }).usage === 'number') sum += (c as { usage: number }).usage;
    } else sum += creditsOf(x);
  }
  return sum;
}

/**
 * Credits of a whole run. `session_usage` events carry the session total so far, so the run's credits are the
 * largest event total, not the sum of events (summing would double count if the event repeated).
 */
export function runCredits(events: readonly StreamEvent[]): number {
  return events.reduce((m, e) => Math.max(m, creditsOf(e)), 0);
}

interface Update { sessionUpdate?: string; content?: unknown; _meta?: { kiro?: { kind?: string; hook?: { name?: string; status?: string } } } }
const updateOf = (e: StreamEvent): Update | undefined => (e['data'] as { update?: Update } | undefined)?.update;

/** `sessionUpdate` of an update event, else the event's `type`. */
export function eventKind(e: StreamEvent): string {
  const u = updateOf(e);
  if (typeof u?.sessionUpdate === 'string') return u.sessionUpdate;
  return typeof e['type'] === 'string' ? (e['type'] as string) : 'unknown';
}

const kiroKind = (e: StreamEvent): string | undefined => updateOf(e)?._meta?.kiro?.kind;

function chunkText(e: StreamEvent): string {
  const c = updateOf(e)?.content;
  return c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : '';
}

const NEUTRAL = new Set(['session_info_update', 'config_option_update', 'available_commands_update', 'agent_thought_chunk', 'runStarted']);

/** Assistant messages: runs of `agent_message_chunk`, split by any tool call. */
export function messages(events: readonly StreamEvent[]): string[] {
  const out: string[] = [];
  let cur: string | undefined;
  for (const e of events) {
    const k = eventKind(e);
    if (k === 'agent_message_chunk') cur = (cur ?? '') + chunkText(e);
    else if (!NEUTRAL.has(k) && cur !== undefined) { out.push(cur); cur = undefined; }
  }
  if (cur !== undefined) out.push(cur);
  return out.filter((m) => m.trim() !== '');
}

/** The final message: `runFinished.data.finalText` when present, else the last assistant message. */
export function finalMessage(events: readonly StreamEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e['type'] === 'runFinished') {
      const t = (e['data'] as { finalText?: unknown } | undefined)?.finalText;
      if (typeof t === 'string' && t !== '') return t.trim();
    }
  }
  return (messages(events).at(-1) ?? '').trim();
}

export const countTurns = (events: readonly StreamEvent[]): number => messages(events).length;
export const countToolCalls = (events: readonly StreamEvent[]): number => events.filter((e) => eventKind(e) === 'tool_call').length;

/** Hooks that completed, as `name:status`, in order. */
export function hookEvents(events: readonly StreamEvent[]): string[] {
  return events.filter((e) => kiroKind(e) === 'hook_update').map((e) => {
    const h = updateOf(e)?._meta?.kiro?.hook;
    return `${h?.name ?? '?'}:${h?.status ?? '?'}`;
  });
}

export const stopReason = (events: readonly StreamEvent[]): string | undefined => {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!['type'] === 'runFinished') return (events[i]!['data'] as { stopReason?: string }).stopReason;
  return undefined;
};