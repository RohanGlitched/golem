// Public surface of the ears module. Matcher, monitor, ranges and the unit table stay internal.
export { compileRequirement, compileRequirementsFile } from './compile.js';
export type { CompileResult, FileCompileResult } from './compile.js';
export { extractCriteria } from './extract.js';
export type { RawCriterion } from './extract.js';
export { kiroText, tokenize } from './tokenizer.js';
export { parse } from './parser.js';
export { format } from './format.js';
export { parseQuantity, toSI, fromSI } from './units.js';
export { tokenEditDistance } from './editDistance.js';

export type { Diagnostic, DiagnosticKind } from './diagnostics.js';
export type { ParsedRequirement, Clause } from './ast.js';
export type {
  Kind, Quantity, Dimension, ScenarioSpace, Scenario, Trace,
  PerturbationCall, CompiledRequirement, SimContext,
  PredicateTemplate, PerturbationTemplate, Lexicon,
  Pattern, Token, TokenType, CompileOptions,
} from './types.js';
