export type DiagnosticKind =
  | 'PATTERN_MISMATCH' | 'MISSING_UNIT' | 'UNKNOWN_PHRASE'
  | 'BAD_RANGE' | 'UNKNOWN_ROBOT' | 'NON_EARS_LINE';

export interface Diagnostic {
  kind: DiagnosticKind;
  severity: 'error' | 'warning';
  message: string;
  /** 1-based. */
  line: number;
  /** 1-based, UTF-16 code units. */
  column: number;
  /** 0-based offset. */
  start: number;
  /** Exclusive, end >= start. */
  end: number;
  suggestion?: string;
}

export interface DiagnosticPosition { start: number; end: number; line: number; column: number }

/**
 * Builds a well-formed diagnostic: line and column are at least 1, start is
 * at least 0, end is at least start, and the message is never empty.
 * Severity defaults to 'warning' for NON_EARS_LINE and 'error' otherwise.
 */
export function makeDiagnostic(
  kind: DiagnosticKind,
  message: string,
  pos: DiagnosticPosition,
  opts: { severity?: 'error' | 'warning'; suggestion?: string } = {},
): Diagnostic {
  const start = Math.max(0, pos.start);
  const d: Diagnostic = {
    kind,
    severity: opts.severity ?? (kind === 'NON_EARS_LINE' ? 'warning' : 'error'),
    message: message.length > 0 ? message : kind,
    line: Math.max(1, pos.line),
    column: Math.max(1, pos.column),
    start,
    end: Math.max(start, pos.end),
  };
  if (opts.suggestion !== undefined) d.suggestion = opts.suggestion;
  return d;
}

/** Ascending by start. Stable: equal starts keep input order. Input is not mutated. */
export function sortDiagnostics(d: readonly Diagnostic[]): Diagnostic[] {
  return d
    .map((x, i) => ({ x, i }))
    .sort((a, b) => a.x.start - b.x.start || a.i - b.i)
    .map((e) => e.x);
}

export function hasError(d: readonly Diagnostic[]): boolean {
  return d.some((x) => x.severity === 'error');
}
