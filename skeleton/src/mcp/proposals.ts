// The Proposals_File: `.kiro/specs/<robot>/proposals.md`. The only file the MCP server writes besides the report.
import type { KitFs } from '../cli/deps.js';
import { atomicWriteFile } from '../cli/store.js';

export interface ProposalEntry { timestamp: string; text: string; rationale?: string }

const flat = (s: string): string => s.replace(/[\r\n]+/g, ' ');

/** One Markdown list item, ending with a newline. Line breaks inside `text` and `rationale` become spaces. */
export function formatEntry(e: ProposalEntry): string {
  const lines = [`- ${e.timestamp}`, `  EARS: ${flat(e.text)}`];
  if (e.rationale !== undefined) lines.push(`  Rationale: ${flat(e.rationale)}`);
  return `${lines.join('\n')}\n`;
}

/** Inverse of `formatEntry`. `line` is the 1-based line of the `- <timestamp>` line. */
export function parseEntries(file: string): { entries: (ProposalEntry & { line: number })[] } {
  const lines = file.split('\n');
  const entries: (ProposalEntry & { line: number })[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^- (\S+)$/.exec(lines[i] as string);
    const ears = lines[i + 1]?.startsWith('  EARS: ') === true ? (lines[i + 1] as string).slice('  EARS: '.length) : undefined;
    if (head === null || ears === undefined) continue;
    const next = lines[i + 2];
    const e: ProposalEntry & { line: number } = { timestamp: head[1] as string, text: ears, line: i + 1 };
    if (next?.startsWith('  Rationale: ') === true) e.rationale = next.slice('  Rationale: '.length);
    entries.push(e);
  }
  return { entries };
}

/** Collapses every whitespace run to one space and trims. */
export function normaliseLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const ID_PREFIX = /^(?:R?\d+(?:\.\d+)*[.)]?)\s+/i;

const comparable = (s: string): string => normaliseLine(s).replace(/^EARS:\s*/, '').replace(ID_PREFIX, '');

/** First line in any file that equals `text` ignoring whitespace, a leading id and an `EARS:` label. */
export function findDuplicate(text: string, files: { path: string; content: string }[]): { path: string; line: number } | undefined {
  const want = comparable(text);
  if (want === '') return undefined;
  for (const f of files) {
    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (comparable(lines[i] as string) === want) return { path: f.path, line: i + 1 };
    }
  }
  return undefined;
}

/** Whole-file write through `atomicWriteFile`; creates the directory. */
export async function appendProposal(fs: KitFs, path: string, e: ProposalEntry, nextTmp: () => string): Promise<void> {
  let old = '';
  try {
    old = await fs.readFile(path);
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw new Error(`cannot read ${path}: ${(err as Error).message}`);
  }
  const head = old === '' ? '# Proposed requirements\n\nLines proposed by golem agents. A human or Kiro spec mode merges accepted lines into requirements.md.\n\n' : (old.endsWith('\n') ? old : `${old}\n`);
  await atomicWriteFile(fs, path, head + formatEntry(e), nextTmp);
}
