// Splits docs/cli-transcript.md into its numbered sections: title, the verbatim code block and the prose after it.
export interface TranscriptSection { n: number; title: string; command: string; code: string; note: string }

export function parseTranscript(md: string): TranscriptSection[] {
  const out: TranscriptSection[] = [];
  const parts = md.split(/^### /m).slice(1);
  for (const part of parts) {
    const head = part.split('\n', 1)[0] as string;
    const m = /^(\d+)\.\s+(.*)$/.exec(head.trim());
    if (!m) continue;
    const body = part.slice(head.length + 1);
    const code = /```text\n([\s\S]*?)\n```/.exec(body);
    const rest = code ? body.replace(code[0], '') : body;
    out.push({
      n: Number(m[1]),
      title: (m[2] as string).trim(),
      command: ((code?.[1] ?? '').split('\n').find((l) => l.startsWith('$ ')) ?? '').replace(/^\$ /, ''),
      code: code?.[1] ?? '',
      note: rest.trim().replace(/\n{2,}/g, '\n\n'),
    });
  }
  return out;
}

/** Keeps the first `max` lines of a block and says how many were left out. Never cuts a line. */
export function excerpt(code: string, max: number): { text: string; omitted: number } {
  const lines = code.split('\n');
  if (lines.length <= max) return { text: code, omitted: 0 };
  return { text: lines.slice(0, max).join('\n'), omitted: lines.length - max };
}

/** Truncates a JSON line longer than `width` characters at a character boundary and marks it, as the transcript itself does. */
export function clip(line: string, width: number): string {
  return line.length <= width ? line : `${line.slice(0, width)} ... [${line.length - width} more characters not shown]`;
}
