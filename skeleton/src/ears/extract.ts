import { makeDiagnostic } from './diagnostics.js';
import type { Diagnostic } from './diagnostics.js';

/**
 * One physical line contributing to a criterion's joined text.
 * `textIndex` is the index in `RawCriterion.text` where this piece starts,
 * `offset` / `line` / `column` give the position of that piece in the file.
 * Compilers use it to map a position in `text` back to file coordinates.
 */
export interface CriterionSegment {
  textIndex: number;
  length: number;
  offset: number;
  line: number;
  column: number;
}

export interface RawCriterion {
  /** "<n>.<m>" or "R0.<m>". */
  id: string;
  /** Without the number prefix; continuation lines joined with one space. */
  text: string;
  /** 1-based line of the numbered line. */
  line: number;
  /** 1-based column of the first character of text (UTF-16 units). */
  column: number;
  /** 0-based file offset of the first character of text. */
  offset: number;
  /** Offset map for joined continuation lines; the first segment is the numbered line. */
  segments: CriterionSegment[];
}

const HEADING = /^#{1,4} /;
const AC_HEADING = /^#### Acceptance Criteria\s*$/;
const REQ_HEADING = /^### Requirement (\d+)\b/;
const NUMBERED = /^[ \t]*(\d+)[.)][ \t]+(?=\S)/;
const EARS_START = /^(?:WHEN|WHILE|IF|WHERE|THE)(?![\p{L}\p{N}_])/iu;
const FOR_ALL = /^FOR[ \t]+ALL(?![\p{L}\p{N}_])/iu;

interface Open {
  crit: RawCriterion;
  qualifies: boolean;
}

export function extractCriteria(text: string): { criteria: RawCriterion[]; diagnostics: Diagnostic[] } {
  const criteria: RawCriterion[] = [];
  const diagnostics: Diagnostic[] = [];

  // Line table: text and start offset of each line, split on \r?\n.
  const lines: { s: string; start: number }[] = [];
  {
    const re = /\r?\n/g;
    let from = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      lines.push({ s: text.slice(from, m.index), start: from });
      from = m.index + m[0].length;
    }
    lines.push({ s: text.slice(from), start: from });
  }

  let reqNumber: string | undefined;
  let inCriteria = false;
  let cur: Open | null = null;

  const close = (): void => {
    if (cur !== null && cur.qualifies) criteria.push(cur.crit);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const { s, start } = lines[i]!;
    const lineNo = i + 1;

    if (HEADING.test(s)) {
      close();
      const req = REQ_HEADING.exec(s);
      if (req !== null && s.startsWith('### ')) {
        reqNumber = req[1];
        inCriteria = false;
      } else if (AC_HEADING.test(s)) {
        inCriteria = true;
      } else {
        inCriteria = false;
      }
      continue;
    }
    if (!inCriteria) continue;

    if (s.trim() === '') {
      close();
      continue;
    }

    const num = NUMBERED.exec(s);
    if (num !== null) {
      close();
      const idx = num[0].length;
      const body = s.slice(idx).replace(/\s+$/, '');
      const column = idx + 1;
      const offset = start + idx;
      const id = `${reqNumber ?? 'R0'}.${num[1]}`;
      const qualifies = EARS_START.test(body);
      if (reqNumber === undefined) {
        diagnostics.push(makeDiagnostic(
          'NON_EARS_LINE',
          `Criterion ${id} appears before any "### Requirement <n>" heading, so it is numbered under R0.`,
          { start: start, end: start + s.length, line: lineNo, column: 1 },
          { severity: 'warning' },
        ));
      }
      if (!qualifies) {
        const forAll = FOR_ALL.test(body);
        diagnostics.push(makeDiagnostic(
          'NON_EARS_LINE',
          forAll
            ? `Skipped "${body}": a FOR ALL line is a property statement, not an EARS criterion.`
            : `Skipped "${body}": a criterion must start with WHEN, WHILE, IF, WHERE or THE.`,
          { start: offset, end: offset + body.length, line: lineNo, column },
          { severity: 'warning' },
        ));
      }
      cur = {
        qualifies,
        crit: {
          id,
          text: body,
          line: lineNo,
          column,
          offset,
          segments: [{ textIndex: 0, length: body.length, offset, line: lineNo, column }],
        },
      };
      continue;
    }

    if (cur !== null && /^[ \t]/.test(s)) {
      const lead = /^[ \t]*/.exec(s)![0].length;
      const piece = s.slice(lead).replace(/\s+$/, '');
      const c = cur.crit;
      const textIndex = c.text.length + 1;
      c.text = `${c.text} ${piece}`;
      c.segments.push({ textIndex, length: piece.length, offset: start + lead, line: lineNo, column: lead + 1 });
      continue;
    }

    // Bullets, prose and other lines end any open criterion and are ignored.
    close();
  }
  close();

  // Diagnostics ascending by start (R0 warning precedes the non-EARS one on the same line).
  diagnostics.sort((a, b) => a.start - b.start);
  return { criteria, diagnostics };
}
