// Readers for the shipped pack files.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PACK_DIR = fileURLToPath(new URL('../../kiro-pack/', import.meta.url));
export const SKELETON_DIR = fileURLToPath(new URL('../../', import.meta.url));

export const packFile = (rel: string): string => readFileSync(`${PACK_DIR}${rel}`, 'utf8');
export const packJson = <T = any>(rel: string): T => JSON.parse(packFile(rel)) as T;
export const hookFile = (): { version: string; hooks: Record<string, any>[] } => packJson('hooks/golem.json');
export const agentFile = (role: 'tuner' | 'skeptic' | 'scribe'): Record<string, any> => packJson(`agents/golem-${role}.json`);
export const agentSource = (role: 'tuner' | 'skeptic' | 'scribe'): Record<string, any> => packJson(`agent-src/golem-${role}.json`);
