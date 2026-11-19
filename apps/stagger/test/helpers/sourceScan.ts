// Finds allocation sites in a function or method body by source text. A heuristic: it flags
// `new`, array and object literals, closures, spreads and allocating array methods. Throw statements are ignored.
import { readFileSync } from 'node:fs';

export function functionBody(file: string, signature: RegExp): string {
  const src = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const m = signature.exec(src);
  if (m === null) throw new Error(`${file}: ${signature} not found`);
  let i = src.indexOf('{', m.index + m[0].length - 1);
  // skip a return type annotation containing braces, e.g. `): { a: number } {`
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start + 1, i);
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['new', /\bnew\s+[A-Z]/],
  ['array literal', /(^|[=(,:]\s*)\[(?!\s*\])/m],
  ['empty array literal', /[=(,]\s*\[\s*\]/],
  ['object literal', /[=(,]\s*\{\s*[A-Za-z_]+\s*:/],
  ['closure', /=>|\bfunction\b/],
  ['spread', /\.\.\.[A-Za-z_]/],
  ['allocating method', /\.(slice|map|filter|concat|subarray|from|of|split|join|flat|flatMap|reduce)\(/],
  ['template string', /`/],
  ['Math.random', /Math\.random/],
];

export function allocations(body: string): string[] {
  const code = body.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, "''")
    // error paths may allocate their Error: drop `throw ...;` statements
    .replace(/\bthrow\b[\s\S]*?\);/g, '');
  return FORBIDDEN.filter(([, re]) => re.test(code)).map(([name]) => name);
}