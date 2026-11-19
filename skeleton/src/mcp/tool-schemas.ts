// Input schemas of the eight MCP tools. Hand-written JSON schema, validated by `validateInput`.
import type { InputSchema, JsonSchemaProp } from './schema.js';

const reqId: JsonSchemaProp = {
  type: 'string', minLength: 1, maxLength: 200,
  description: 'Requirement id as listed by list_requirements, for example "R3" or "1.2".',
};
const budget: JsonSchemaProp = {
  type: 'integer', minimum: 1, maximum: 1024, default: 24,
  description: 'Maximum number of trials for the search, from 1 to 1024. Default 24.',
};

export const TOOL_NAMES = [
  'list_requirements', 'check_requirement', 'run_requirement', 'falsify',
  'get_counterexample', 'replay', 'explain_margin', 'propose_requirement',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_SCHEMAS: Record<ToolName, InputSchema> = {
  list_requirements: { type: 'object', properties: {}, additionalProperties: false },
  check_requirement: {
    type: 'object', additionalProperties: false, required: ['text'],
    properties: { text: { type: 'string', minLength: 1, maxLength: 2000, description: 'One EARS line to compile, without running anything.' } },
  },
  run_requirement: { type: 'object', additionalProperties: false, required: ['reqId'], properties: { reqId, budget } },
  falsify: { type: 'object', additionalProperties: false, required: ['reqId'], properties: { reqId, budget } },
  get_counterexample: { type: 'object', additionalProperties: false, required: ['reqId'], properties: { reqId } },
  replay: {
    type: 'object', additionalProperties: false, required: ['reqId'],
    properties: {
      reqId,
      seed: { type: 'integer', minimum: 0, maximum: 4294967295, description: 'Seed of a pinned counterexample to replay. Default: the latest pinned one.' },
    },
  },
  explain_margin: { type: 'object', additionalProperties: false, required: ['reqId'], properties: { reqId } },
  propose_requirement: {
    type: 'object', additionalProperties: false, required: ['text'],
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 1000, description: 'One EARS line. It must compile with no error.' },
      rationale: { type: 'string', minLength: 0, maxLength: 1000, description: 'Why a real user or environment could produce the trigger.' },
    },
  },
};
