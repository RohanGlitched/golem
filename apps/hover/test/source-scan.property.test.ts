// Property: the source hygiene scan flags exactly the imports and calls that the rules forbid
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { badSkeletonImports, deepImports, usesClock, usesRandom } from './helpers/sourceScan';

const name = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,8}$/);
const quote = fc.constantFrom("'", '"');
const OK = ['golem-spec', 'golem-spec/ui', 'golem-spec/node'];
const BAD = ['../../skeleton/src/index', 'skeleton/src/sim/types', '../skeleton/src/ears/compile.js', 'golem-spec/dist/ears', 'golem-spec/testing', '../../skeleton/dist/index'];
const importLine = (n: string, spec: string, q: string, form: number): string => {
  switch (form) {
    case 0: return `import ${n} from ${q}${spec}${q};`;
    case 1: return `import { ${n} } from ${q}${spec}${q};`;
    case 2: return `import type { ${n} } from ${q}${spec}${q};`;
    case 3: return `export { ${n} } from ${q}${spec}${q};`;
    default: return `const m = await import(${q}${spec}${q});`;
  }
};

describe('source hygiene scan', () => {
  it('flags exactly the imports that reach into skeleton/src or past the public entry points', () => {
    fc.assert(fc.property(name, quote, fc.integer({ min: 0, max: 4 }), fc.constantFrom(...OK, 'vitest', './constants', 'node:fs'), fc.constantFrom(...BAD), (n, q, form, ok, bad) => {
      expect(badSkeletonImports(importLine(n, ok, q, form))).toEqual([]);
      expect(deepImports(importLine(n, ok, q, form))).toEqual([]);
      expect(badSkeletonImports(importLine(n, bad, q, form))).toEqual([bad]);
      expect(deepImports(importLine(n, bad, q, form)).length).toBe(bad.includes('skeleton/src') ? 1 : 0);
      // mixed file: only the bad line is reported
      expect(badSkeletonImports([importLine(n, ok, q, form), importLine(n + 'x', bad, q, form)].join('\n'))).toEqual([bad]);
    }), { numRuns: 300 });
  });

  it('flags a Math.random call or a clock read unless it sits in a comment', () => {
    fc.assert(fc.property(name, fc.constantFrom('Math.random()', 'Date.now()', 'performance.now()', 'new Date()'), (n, call) => {
      const code = `const ${n} = ${call};`;
      const flagged = usesRandom(code) || usesClock(code);
      expect(flagged).toBe(true);
      expect(usesRandom(`// ${call}\nconst a = 1;`) || usesClock(`// ${call}\nconst a = 1;`)).toBe(false);
      expect(usesRandom(`/* ${call} */ const a = 1;`) || usesClock(`/* ${call} */ const a = 1;`)).toBe(false);
      expect(usesRandom(code)).toBe(call.startsWith('Math'));
      expect(usesClock(code)).toBe(!call.startsWith('Math'));
    }), { numRuns: 200 });
  });

  it('accepts code without either', () => {
    fc.assert(fc.property(name, name, (a, b) => {
      const code = `const ${a} = rng();\nconst ${b} = ${a} * 2;`;
      expect(usesRandom(code) || usesClock(code)).toBe(false);
    }), { numRuns: 100 });
  });
});
