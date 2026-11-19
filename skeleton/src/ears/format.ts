// Formatter: prints a ParsedRequirement as canonical text. Pure; never mutates the AST.
import type { Clause, ParsedRequirement } from './ast.js';
import type { Pattern } from './types.js';

const LEAD: Readonly<Record<Pattern, string>> = {
  ubiquitous: '',
  event: 'WHEN',
  state: 'WHILE',
  unwanted: 'IF',
  optional: 'WHERE',
};

/** ID as stored has no trailing period; the tokenizer needs it, except for `<n>.<m>`. */
function printId(id: string): string {
  return /^\d+\.\d+$/.test(id) ? id : `${id}.`;
}

/** One space between tokens, a comma attached to the previous token. Quantity text is kept. */
function printClause(clause: Clause, field: string): string {
  if (!clause || !Array.isArray(clause.tokens) || clause.tokens.length === 0) {
    throw new Error(`format: invalid AST field '${field}': expected a clause with tokens`);
  }
  let out = '';
  for (const t of clause.tokens) {
    if (t.type === 'comma') out += ',';
    else out += (out === '' ? '' : ' ') + t.text;
  }
  return out;
}

export function format(ast: ParsedRequirement): string {
  const pattern = (ast as { pattern?: unknown } | null | undefined)?.pattern;
  if (typeof pattern !== 'string' || !Object.prototype.hasOwnProperty.call(LEAD, pattern)) {
    throw new Error(
      `format: invalid AST field 'pattern': ${pattern === undefined ? 'missing' : `unrecognised value ${JSON.stringify(pattern)}`}`,
    );
  }
  const p = pattern as Pattern;
  if (typeof ast.robot?.name !== 'string' || ast.robot.name === '') {
    throw new Error("format: invalid AST field 'robot.name': missing");
  }
  const head = `THE ${ast.robot.name} SHALL ${printClause(ast.response, 'response')}`;
  const parts: string[] = [];
  if (ast.id !== undefined) parts.push(printId(ast.id));
  if (p === 'ubiquitous') {
    parts.push(head);
  } else {
    const cond = printClause(ast.condition as Clause, 'condition');
    parts.push(`${LEAD[p]} ${cond},${p === 'unwanted' ? ' THEN' : ''} ${head}`);
  }
  return parts.join(' ');
}
