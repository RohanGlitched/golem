// Single-pass parser for the five EARS patterns. Pure: tokens and robot names in, AST and
// diagnostics out. It never interprets clause words; that belongs to the matcher.
import type { Clause, ParsedRequirement } from './ast.js';
import { makeDiagnostic, type Diagnostic, type DiagnosticPosition } from './diagnostics.js';
import type { Pattern, Span, Token } from './types.js';

const LEADING: Record<string, Pattern> = {
  WHEN: 'event',
  WHILE: 'state',
  IF: 'unwanted',
  WHERE: 'optional',
  THE: 'ubiquitous',
};
const EXPECTED_START = 'WHEN, WHILE, IF, WHERE or THE';
const CONDITION_NAME: Record<Pattern, string> = {
  ubiquitous: 'condition',
  event: 'trigger',
  state: 'state',
  unwanted: 'fault',
  optional: 'feature',
};

const isKw = (t: Token | undefined, word: string): boolean =>
  t !== undefined && t.type === 'keyword' && t.text.toUpperCase() === word;

const posOf = (t: Token): DiagnosticPosition => ({
  start: t.start,
  end: t.end,
  line: t.line,
  column: t.column,
});

/** Position just after the last token, used when a line ends early. */
function endPos(tokens: readonly Token[]): DiagnosticPosition {
  const last = tokens[tokens.length - 1];
  if (!last) return { start: 0, end: 0, line: 1, column: 1 };
  return {
    start: last.end,
    end: last.end,
    line: last.line,
    column: last.column + (last.end - last.start),
  };
}

function normalise(t: Token): Token {
  return t.type === 'keyword' ? { ...t, text: t.text.toUpperCase() } : { ...t };
}

function makeClause(tokens: readonly Token[], source: string | undefined): Clause {
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  let text: string;
  if (source !== undefined) {
    text = source.slice(first.start, last.end);
  } else {
    // Rebuild from token offsets: gaps between tokens are whitespace.
    text = '';
    let at = first.start;
    for (const t of tokens) {
      text += ' '.repeat(Math.max(0, t.start - at)) + t.text;
      at = t.end;
    }
  }
  const span: Span = { start: first.start, end: last.end, line: first.line, column: first.column };
  return { text, tokens: tokens.map(normalise), span };
}

/**
 * Parse one tokenised EARS line. `source` is optional; when given, clause text is the exact
 * source substring. No AST is returned when any error diagnostic is produced.
 */
export function parse(
  tokens: readonly Token[],
  robotNames: readonly string[],
  source?: string,
): { ast?: ParsedRequirement; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const mismatch = (message: string, pos: DiagnosticPosition): void => {
    diagnostics.push(makeDiagnostic('PATTERN_MISMATCH', message, pos));
  };

  let i = 0;
  let id: string | undefined;
  if (tokens[0]?.type === 'requirementId') {
    id = tokens[0].text.replace(/\.$/, '');
    i = 1;
  }

  // Second SHALL: more than one SHALL keyword anywhere in the line.
  const shalls = tokens.filter((t) => isKw(t, 'SHALL'));
  if (shalls.length > 1) {
    mismatch(
      'Second SHALL: a requirement has exactly one SHALL, so remove this one or split the line',
      posOf(shalls[1]!),
    );
    return { diagnostics };
  }

  const lead = tokens[i];
  if (!lead) {
    mismatch(`Line has no requirement; closest pattern is ubiquitous, expected ${EXPECTED_START}`, endPos(tokens));
    return { diagnostics };
  }
  const leadWord = lead.type === 'keyword' ? lead.text.toUpperCase() : undefined;
  const pattern = leadWord !== undefined ? LEADING[leadWord] : undefined;
  if (pattern === undefined) {
    mismatch(
      `Line does not match any pattern; closest pattern is ubiquitous, expected ${EXPECTED_START} but found '${lead.text}'`,
      posOf(lead),
    );
    return { diagnostics };
  }

  // Locate THE <robot> SHALL (the "head"), after the condition for non-ubiquitous patterns.
  let theIdx = -1; // index of THE
  let condRaw: Token[] = [];
  let boundary: Token = lead; // token that ends the condition (THE, or THEN for unwanted)

  const isHead = (k: number): boolean =>
    isKw(tokens[k], 'THE') && tokens[k + 1]?.type === 'word' && isKw(tokens[k + 2], 'SHALL');

  if (pattern === 'ubiquitous') {
    theIdx = i;
    if (!isHead(i)) {
      const r = tokens[i + 1];
      if (r === undefined) {
        mismatch('Line ends early; closest pattern is ubiquitous, expected a robot name after THE', endPos(tokens));
      } else if (r.type !== 'word') {
        mismatch(`Closest pattern is ubiquitous; expected a robot name after THE but found '${r.text}'`, posOf(r));
      } else {
        const s = tokens[i + 2];
        if (s === undefined) {
          mismatch('Line ends early; closest pattern is ubiquitous, expected SHALL after the robot name', endPos(tokens));
        } else {
          mismatch(`Closest pattern is ubiquitous; expected SHALL after the robot name but found '${s.text}'`, posOf(s));
        }
      }
      return { diagnostics };
    }
  } else {
    let found = -1;
    if (pattern === 'unwanted') {
      for (let k = i + 1; k < tokens.length; k++) {
        if (!isKw(tokens[k], 'THEN')) continue;
        const j = tokens[k + 1]?.type === 'comma' ? k + 2 : k + 1;
        if (isHead(j)) {
          found = j;
          boundary = tokens[k]!;
          condRaw = tokens.slice(i + 1, k);
          break;
        }
      }
      if (found < 0) {
        let head = -1;
        for (let k = i + 1; k < tokens.length; k++) {
          if (isHead(k)) { head = k; break; }
        }
        if (head >= 0) {
          mismatch(
            `Closest pattern is unwanted (IF ... THEN THE <robot> SHALL ...); expected THEN before THE`,
            posOf(tokens[head]!),
          );
        } else {
          reportNoHead(pattern, tokens, i, mismatch);
        }
        return { diagnostics };
      }
    } else {
      for (let k = i + 1; k < tokens.length; k++) {
        if (isHead(k)) {
          found = k;
          boundary = tokens[k]!;
          condRaw = tokens.slice(i + 1, k);
          break;
        }
      }
      if (found < 0) {
        reportNoHead(pattern, tokens, i, mismatch);
        return { diagnostics };
      }
    }
    theIdx = found;
  }

  // Condition clause (one trailing comma before THE or THEN is allowed).
  let condition: Clause | undefined;
  if (pattern !== 'ubiquitous') {
    const cond = condRaw[condRaw.length - 1]?.type === 'comma' ? condRaw.slice(0, -1) : condRaw;
    if (cond.length === 0) {
      mismatch(
        `Missing ${CONDITION_NAME[pattern]} clause after ${leadWord}; closest pattern is ${pattern}`,
        posOf(condRaw[0] ?? boundary),
      );
    } else {
      condition = makeClause(cond, source);
    }
  }

  // Robot name.
  const robotTok = tokens[theIdx + 1]!;
  const known = robotNames.some((n) => n.toLowerCase() === robotTok.text.toLowerCase());
  if (!known) {
    const allowed = robotNames.join(', ');
    diagnostics.push(
      makeDiagnostic(
        'UNKNOWN_ROBOT',
        `Unknown robot '${robotTok.text}'; allowed names: ${allowed.length > 0 ? allowed : '(none)'}`,
        posOf(robotTok),
        { suggestion: allowed },
      ),
    );
  }

  // Response clause.
  const shallTok = tokens[theIdx + 2]!;
  const respTokens = tokens.slice(theIdx + 3);
  let response: Clause | undefined;
  if (respTokens.length === 0) {
    mismatch(`Missing response clause after SHALL; closest pattern is ${pattern}`, {
      start: shallTok.end,
      end: shallTok.end,
      line: shallTok.line,
      column: shallTok.column + (shallTok.end - shallTok.start),
    });
  } else {
    response = makeClause(respTokens, source);
  }

  if (diagnostics.some((d) => d.severity === 'error') || !response) {
    return { diagnostics };
  }
  const ast: ParsedRequirement = {
    pattern,
    robot: {
      name: robotTok.text,
      span: { start: robotTok.start, end: robotTok.end, line: robotTok.line, column: robotTok.column },
    },
    response,
  };
  if (id !== undefined) ast.id = id;
  if (condition) ast.condition = condition;
  return { ast: reorder(ast), diagnostics };
}

/** Stable key order: id, pattern, condition, robot, response. */
function reorder(a: ParsedRequirement): ParsedRequirement {
  return {
    ...(a.id !== undefined ? { id: a.id } : {}),
    pattern: a.pattern,
    ...(a.condition ? { condition: a.condition } : {}),
    robot: a.robot,
    response: a.response,
  };
}

function reportNoHead(
  pattern: Pattern,
  tokens: readonly Token[],
  lead: number,
  mismatch: (m: string, p: DiagnosticPosition) => void,
): void {
  const kw = tokens[lead]!.text.toUpperCase();
  const shall = tokens.find((t) => isKw(t, 'SHALL'));
  const after = pattern === 'unwanted' ? 'THEN THE <robot> SHALL' : 'THE <robot> SHALL';
  if (shall) {
    mismatch(
      `Closest pattern is ${pattern} (${kw} ... ${after} ...); expected ${after} before the response, with a robot name after THE`,
      posOf(shall),
    );
  } else {
    mismatch(
      `Line ends early; closest pattern is ${pattern} (${kw} ... ${after} ...), expected ${after}`,
      endPos(tokens),
    );
  }
}
