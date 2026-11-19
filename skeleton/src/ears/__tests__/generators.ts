// Shared fast-check generators for the ears tests (design: "Generators").
// Everything here is pure and uses only fast-check's seeded randomness.
import * as fc from 'fast-check';
import { UNIT_TABLE, ACCEPTED_UNITS } from '../units.js';
import { compileTemplate } from '../matcher.js';
import type {
  Kind, Lexicon, Pattern, PerturbationTemplate, PredicateTemplate, Quantity, SlotDimension,
} from '../types.js';

export { SEED, propConfig } from './support.js';

// ---------- units and quantities ----------

/** Any accepted unit spelling. */
export const arbUnit: fc.Arbitrary<string> = fc.constantFrom(...ACCEPTED_UNITS);

const arbDecimalText = (maxInt: number): fc.Arbitrary<string> =>
  fc.oneof(
    fc.integer({ min: 0, max: maxInt }).map(String),
    fc
      .tuple(
        fc.integer({ min: 0, max: maxInt - 1 }),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 3 }),
      )
      .map(([i, d]) => `${i}.${d.join('')}`),
  );

const arbSpace: fc.Arbitrary<string> = fc.constantFrom('', ' ');

/** Kinds that are written with a unit. */
export const UNIT_KINDS: readonly Kind[] = [
  'force', 'duration', 'length', 'speed', 'angle', 'mass', 'ratio',
];

function unitsOfKind(kind: Kind): string[] {
  return UNIT_TABLE.filter((u) => u.kind === kind).map((u) => u.spelling);
}

function factorOf(unit: string): number {
  const spec = UNIT_TABLE.find((u) => u.spelling === unit);
  if (!spec) throw new Error(`Unknown unit "${unit}"`);
  return spec.factor;
}

function numberFor(unit: string): fc.Arbitrary<string> {
  return unit === '%' ? arbDecimalText(100) : arbDecimalText(1000);
}

function makeQuantity(kind: Kind, num: string, space: string, unit: string): Quantity {
  return { kind, si: Number(num) * factorOf(unit), text: `${num}${space}${unit}` };
}

/**
 * A quantity as written in a requirement: a non-negative number, zero or one
 * space, and a unit. Without `kind`, any unit-bearing kind. `count` is a bare
 * integer. `phase` has no written form and is rejected.
 */
export function arbQuantity(kind?: Kind): fc.Arbitrary<Quantity> {
  if (kind === 'phase') throw new Error('arbQuantity: phase has no written form');
  if (kind === 'count') {
    return fc.integer({ min: 0, max: 99 }).map((n) => ({ kind: 'count' as Kind, si: n, text: String(n) }));
  }
  const units = kind ? unitsOfKind(kind) : [...ACCEPTED_UNITS];
  return fc
    .constantFrom(...units)
    .chain((unit) =>
      fc.tuple(numberFor(unit), arbSpace).map(([num, sp]) => {
        const k = UNIT_TABLE.find((u) => u.spelling === unit)!.kind;
        return makeQuantity(k, num, sp, unit);
      }),
    );
}

// ---------- lexicon ----------

const PERT_FIRST_WORDS = [
  'pushed', 'shoved', 'nudged', 'kicked', 'dropped', 'lifted',
  'tilted', 'pulled', 'struck', 'jostled', 'rattled', 'shaken',
];
const PRED_FIRST_WORDS = [
  'keep', 'hold', 'stay', 'remain', 'maintain', 'preserve',
  'retain', 'sustain', 'follow', 'track', 'reach', 'clear',
];
// Never a keyword, a unit spelling, "for", "within", "to", "up" or "any".
const FILLER_WORDS = [
  'with', 'against', 'toward', 'near', 'over', 'under', 'around', 'beyond', 'along', 'above',
];
const ROBOT_WORDS = ['robot', 'golem', 'G1', 'walker', 'arm'];
const FEATURE_WORDS = ['stairs', 'payload', 'camera', 'gripper', 'cooling', 'lights', 'battery'];
/** Every feature arbFeature can write (ordered selections of 1 to 3 distinct words); arbLexicon declares them all. */
export const ALL_FEATURES: readonly string[] = (() => {
  const out: string[] = [];
  const grow = (prefix: string[]): void => {
    if (prefix.length > 0) out.push(prefix.join(' '));
    if (prefix.length === 3) return;
    for (const w of FEATURE_WORDS) if (!prefix.includes(w)) grow([...prefix, w]);
  };
  grow([]);
  return out;
})();

const PERT_SLOTS = [
  'range:force', 'range:length', 'range:speed', 'range:mass', 'range:angle', 'range:duration',
  'duration', 'direction', 'force', 'angle', 'mass', 'length', 'speed', 'ratio', 'count',
] as const;
const PRED_SLOTS = ['force', 'length', 'speed', 'mass', 'angle', 'duration', 'ratio', 'count'] as const;

const arbFillers = (min: number, max: number): fc.Arbitrary<string[]> =>
  fc.array(fc.constantFrom(...FILLER_WORDS), { minLength: min, maxLength: max });

function buildPhrase(first: string, slots: readonly string[], fillers: readonly string[][], tail: readonly string[]): string {
  const parts = [first];
  slots.forEach((slot, i) => {
    // `from {direction}` reads naturally and keeps one literal before every slot.
    parts.push(...(slot === 'direction' ? ['from'] : fillers[i] ?? ['with']), `{${slot}}`);
  });
  parts.push(...tail);
  return parts.join(' ');
}

function arbPerturbation(first: string): fc.Arbitrary<PerturbationTemplate> {
  return fc
    .tuple(
      fc.uniqueArray(fc.constantFrom(...PERT_SLOTS), { minLength: 1, maxLength: 3 }),
      fc.array(arbFillers(1, 2), { minLength: 3, maxLength: 3 }),
      arbFillers(0, 1),
    )
    .map(([slots, fillers, tail]) => {
      const phrase = buildPhrase(first, slots, fillers, tail);
      // Every slot declares its Dimension (golem-ears-hardening defect 1): `<first>.<slot>`.
      const declared: Record<string, SlotDimension> = {};
      for (const el of compileTemplate(phrase, 0).pattern) {
        if (typeof el === 'string') continue;
        declared[el.name] = { dim: `${first}.${el.name}`, severity: el.slot === 'range' ? 'up' : 'none' };
      }
      return { phrase, slots: declared, apply: () => undefined };
    });
}

function arbPredicate(first: string): fc.Arbitrary<PredicateTemplate> {
  const signal = `sig_${first}`;
  return fc
    .tuple(fc.constantFrom(...PRED_SLOTS), fc.array(arbFillers(1, 2), { minLength: 1, maxLength: 1 }), arbFillers(0, 1))
    .map(([slot, fillers, tail]) => ({
      phrase: buildPhrase(first, [slot], fillers, tail),
      signals: [signal],
      // `above`: positive while the signal is above the single bound slot.
      margin: (s: Record<string, number>, slots: Record<string, number>): number => {
        let bound = 0;
        for (const k in slots) {
          bound = slots[k] ?? 0;
          break;
        }
        return (s[signal] ?? NaN) - bound;
      },
      unit: 'm',
    }));
}

function arbTemplates<T>(pool: readonly string[], make: (first: string) => fc.Arbitrary<T>): fc.Arbitrary<T[]> {
  return fc
    .uniqueArray(fc.constantFrom(...pool), { minLength: 1, maxLength: 6 })
    .chain((firsts) => fc.tuple(...firsts.map(make)))
    .map((t) => t as T[]);
}

/**
 * A small Lexicon: 1 to 6 perturbation and 1 to 6 predicate templates, unique
 * first words within each class, mixed slot kinds, and an `above` margin.
 */
export const arbLexicon: fc.Arbitrary<Lexicon> = fc
  .tuple(
    fc.uniqueArray(fc.constantFrom(...ROBOT_WORDS), { minLength: 1, maxLength: 3 }),
    arbTemplates(PERT_FIRST_WORDS, arbPerturbation),
    arbTemplates(PRED_FIRST_WORDS, arbPredicate),
  )
  .map(([robotNames, perturbations, predicates]) => ({ robotNames, perturbations, predicates, features: [...ALL_FEATURES] }));

// ---------- valid lines ----------

export interface SlotBinding {
  /** Slot name as written in the phrase, such as `force` or `range:force`. */
  slot: string;
  /** Source text of the filled value. */
  text: string;
  /** SI value for a single quantity. */
  si?: number;
  /** SI [min, max] for a range slot. */
  range?: [number, number];
}
export interface GeneratedClause { text: string; phrase: string; bindings: SlotBinding[] }
export interface GeneratedSpan { start: number; end: number }

export interface GeneratedLine {
  text: string;
  pattern: Pattern;
  /** ID without its trailing period, if the line has one. */
  id?: string;
  /** ID as written, with any trailing period. */
  idText?: string;
  /** Robot name as written. */
  robot: string;
  /** Trigger, state, fault or feature clause. */
  condition?: GeneratedClause;
  response: GeneratedClause;
  /** Keywords as written (mixed case), in order. */
  keywordsAsWritten: string[];
  commaBeforeThe: boolean;
  commaAfterThen: boolean;
  spans: { condition?: GeneratedSpan; robot: GeneratedSpan; response: GeneratedSpan };
}

const arbRangeFill = (kind: Kind): fc.Arbitrary<{ text: string; binding: Omit<SlotBinding, 'slot'> }> =>
  fc
    .constantFrom(...unitsOfKind(kind))
    .chain((unit) =>
      fc
        .tuple(numberFor(unit), numberFor(unit), arbSpace, arbSpace, fc.boolean())
        .map(([a, b, sp1, sp2, upTo]) => {
          const [lo, hi] = Number(a) <= Number(b) ? [a, b] : [b, a];
          const f = factorOf(unit);
          if (upTo) {
            return { text: `up to ${hi}${sp1}${unit}`, binding: { text: `up to ${hi}${sp1}${unit}`, range: [0, Number(hi) * f] as [number, number] } };
          }
          const text = `${lo}${sp1}${unit} to ${hi}${sp2}${unit}`;
          return { text, binding: { text, range: [Number(lo) * f, Number(hi) * f] as [number, number] } };
        }),
    );

function arbFill(slot: string): fc.Arbitrary<{ text: string; binding: SlotBinding }> {
  if (slot === 'direction') {
    return fc.constantFrom('any direction', 'behind').map((text) => ({ text, binding: { slot, text } }));
  }
  if (slot.startsWith('range:')) {
    return arbRangeFill(slot.slice('range:'.length) as Kind).map((r) => ({
      text: r.text,
      binding: { slot, ...r.binding },
    }));
  }
  return arbQuantity(slot as Kind).map((q) => ({ text: q.text, binding: { slot, text: q.text, si: q.si } }));
}

/** Fills every `{slot}` of a template phrase with a written value. */
function arbFillPhrase(phrase: string): fc.Arbitrary<GeneratedClause> {
  const parts = phrase.split(' ').map((w) => {
    const m = /^\{(.+)\}$/.exec(w);
    return m ? arbFill(m[1]!) : fc.constant({ text: w, binding: undefined as SlotBinding | undefined });
  });
  return fc.tuple(...parts).map((filled) => ({
    phrase,
    text: filled.map((f) => f.text).join(' '),
    bindings: filled.flatMap((f) => (f.binding ? [f.binding] : [])),
  }));
}

const arbFeature: fc.Arbitrary<GeneratedClause> = fc
  .uniqueArray(fc.constantFrom(...FEATURE_WORDS), { minLength: 1, maxLength: 3 })
  .map((w) => ({ phrase: w.join(' '), text: w.join(' '), bindings: [] }));

const arbCase = (word: string): fc.Arbitrary<string> =>
  fc.oneof(
    fc.constant(word.toUpperCase()),
    fc.constant(word.toLowerCase()),
    fc
      .array(fc.boolean(), { minLength: word.length, maxLength: word.length })
      .map((flags) => [...word].map((c, i) => (flags[i] ? c.toUpperCase() : c.toLowerCase())).join('')),
  );

const arbIdText: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.integer({ min: 0, max: 999999 }).map((n) => `R${n}.`),
  fc.integer({ min: 0, max: 999999 }).map((n) => `${n}.`),
  fc.tuple(fc.integer({ min: 0, max: 999999 }), fc.integer({ min: 0, max: 999999 })).map(([n, m]) => `${n}.${m}`),
);

const arbTemporal: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  arbQuantity('duration').map((q) => ` for ${q.text}`),
  arbQuantity('duration').map((q) => ` within ${q.text}`),
);
/** A WHILE response takes `for` or no wrapper (golem-ears-hardening defect 5). */
const arbStateTemporal: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  arbQuantity('duration').map((q) => ` for ${q.text}`),
);

/**
 * A valid line of any of the five patterns built from `lexicon`, with a random
 * ID form, keyword case and optional commas. Returns the text and the fields a
 * correct parser must produce (pattern, ID, robot, clause texts and spans).
 * Clauses use single spaces; the line has no trailing period.
 */
export function arbValidLine(lexicon: Lexicon, pattern?: Pattern): fc.Arbitrary<GeneratedLine> {
  if (lexicon.perturbations.length === 0 || lexicon.predicates.length === 0 || lexicon.robotNames.length === 0) {
    throw new Error('arbValidLine needs at least one perturbation, one predicate and one robot name');
  }
  const perturbationPhrase = fc.constantFrom(...lexicon.perturbations.map((t) => t.phrase));
  const predicatePhrase = fc.constantFrom(...lexicon.predicates.map((t) => t.phrase));
  const arbPattern: fc.Arbitrary<Pattern> = pattern
    ? fc.constant(pattern)
    : fc.constantFrom<Pattern>('ubiquitous', 'event', 'state', 'unwanted', 'optional');

  const arbCondition = (p: Pattern): fc.Arbitrary<GeneratedClause | undefined> => {
    switch (p) {
      case 'ubiquitous': return fc.constant(undefined);
      case 'event':
      case 'unwanted': return perturbationPhrase.chain(arbFillPhrase);
      case 'state': return predicatePhrase.chain(arbFillPhrase);
      case 'optional': return arbFeature;
    }
  };
  const leadKeyword: Record<Pattern, string | undefined> = {
    ubiquitous: undefined, event: 'WHEN', state: 'WHILE', unwanted: 'IF', optional: 'WHERE',
  };

  return arbPattern
    .chain((p) =>
      fc.tuple(
        fc.constant(p),
        arbCondition(p),
        fc.tuple(predicatePhrase, p === 'state' ? arbStateTemporal : arbTemporal).chain(([ph, tmp]) =>
          arbFillPhrase(ph).map((c) => ({ ...c, text: c.text + tmp })),
        ),
        fc.constantFrom(...lexicon.robotNames),
        arbIdText,
        fc.boolean(),
        fc.boolean(),
        fc.tuple(arbCase(leadKeyword[p] ?? 'THE'), arbCase('THEN'), arbCase('THE'), arbCase('SHALL')),
      ),
    )
    .map(([p, condition, response, robot, idText, commaBeforeThe, commaAfterThen, [kwLead, kwThen, kwThe, kwShall]]) => {
      let text = '';
      const keywordsAsWritten: string[] = [];
      const kw = (w: string): void => { text += w; keywordsAsWritten.push(w); };
      let conditionSpan: GeneratedSpan | undefined;
      if (idText !== undefined) text += `${idText} `;
      if (p !== 'ubiquitous' && condition) {
        kw(kwLead);
        text += ' ';
        conditionSpan = { start: text.length, end: text.length + condition.text.length };
        text += condition.text;
        // Unwanted reads `IF fault[,] THEN [,] THE ...`; the others `KW clause[,] THE ...`.
        if (p === 'unwanted') {
          text += commaBeforeThe ? ', ' : ' ';
          kw(kwThen);
          text += commaAfterThen ? ', ' : ' ';
        } else {
          text += commaBeforeThe ? ', ' : ' ';
        }
      }
      kw(kwThe);
      text += ' ';
      const robotSpan = { start: text.length, end: text.length + robot.length };
      text += `${robot} `;
      kw(kwShall);
      text += ' ';
      const responseSpan = { start: text.length, end: text.length + response.text.length };
      text += response.text;
      const line: GeneratedLine = {
        text,
        pattern: p,
        robot,
        response,
        keywordsAsWritten,
        commaBeforeThe,
        commaAfterThen: p === 'unwanted' ? commaAfterThen : false,
        spans: { robot: robotSpan, response: responseSpan },
      };
      if (idText !== undefined) {
        line.idText = idText;
        line.id = idText.endsWith('.') ? idText.slice(0, -1) : idText;
      }
      if (condition && conditionSpan) {
        line.condition = condition;
        line.spans.condition = conditionSpan;
      }
      return line;
    });
}

// ---------- mutations ----------

export type MutationOp = 'swap' | 'delete' | 'insert' | 'misspell';
export interface Mutation { op: MutationOp; text: string; changed: boolean }

const INSERT_WORDS = ['banana', 'sideways', 'quickly', 'purple', 'often', 'sharply'];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Mutates a single-spaced clause by swapping two adjacent words, deleting a
 * word, inserting an unrelated word, or misspelling one letter of a word.
 * `changed` is false when the operator could not alter the text (for example
 * swapping two equal words), so callers can skip those cases.
 */
export function arbMutation(clause: string): fc.Arbitrary<Mutation> {
  return fc
    .tuple(
      fc.constantFrom<MutationOp>('swap', 'delete', 'insert', 'misspell'),
      fc.nat(1000),
      fc.nat(1000),
    )
    .map(([op, a, b]) => {
      const words = clause.split(' ');
      const n = words.length;
      let out = words.slice();
      if (op === 'swap' && n >= 2) {
        const i = a % (n - 1);
        const x = out[i]!; out[i] = out[i + 1]!; out[i + 1] = x;
      } else if (op === 'delete' && n >= 1) {
        out.splice(a % n, 1);
      } else if (op === 'insert') {
        out.splice(a % (n + 1), 0, INSERT_WORDS[b % INSERT_WORDS.length]!);
      } else if (op === 'misspell') {
        const candidates = words.map((w, i) => (/[A-Za-z]/.test(w) ? i : -1)).filter((i) => i >= 0);
        if (candidates.length > 0) {
          const wi = candidates[a % candidates.length]!;
          const chars = [...words[wi]!];
          const pos = chars.map((c, i) => (/[A-Za-z]/.test(c) ? i : -1)).filter((i) => i >= 0);
          const ci = pos[b % pos.length]!;
          const c = chars[ci]!;
          const idx = LETTERS.indexOf(c.toLowerCase());
          const repl = LETTERS[(idx + 1 + (a % 25)) % 26]!;
          chars[ci] = c === c.toUpperCase() ? repl.toUpperCase() : repl;
          out[wi] = chars.join('');
        }
      }
      const text = out.join(' ');
      return { op, text, changed: text !== clause };
    });
}
