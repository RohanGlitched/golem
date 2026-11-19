// Builds `kiro-pack/agents/*.json` from the V2 sources and writes `kiro-pack/manifest.json`.
//   write sources (UTF-8, no BOM) -> `kiro-cli agent upgrade <dir> --no-backup` -> finalizeAgent -> `kiro-cli agent validate --path <file>`
// A finalized file is never edited by hand. Run it with `npm run pack:build` in skeleton/.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_WRITE, checkAgent, finalizeAgent, type AgentJson, type AgentRole } from './pack-checks/agents.js';

export interface RunResult { code: number; stdout: string; stderr: string }
export interface PackBuilderOptions {
  upgradeArgs?(dir: string): readonly string[];
  validateArgs?(file: string): readonly string[];
  /** `'missing'` means kiro-cli is not installed. */
  run(cmd: string, args: readonly string[]): Promise<RunResult | 'missing'>;
}
export interface BuildResult { ok: boolean; skipped: string[]; failures: { file: string; stderr: string }[]; written: string[] }

const defaultUpgradeArgs = (dir: string): readonly string[] => ['agent', 'upgrade', dir, '--no-backup'];
const defaultValidateArgs = (file: string): readonly string[] => ['agent', 'validate', '--path', file];

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;

export function roleOf(file: string): AgentRole | undefined {
  const m = /golem-(tuner|skeptic|scribe)\.json$/.exec(file);
  return m === null ? undefined : (m[1] as AgentRole);
}

export async function buildPack(o: PackBuilderOptions, srcDir: string, outDir: string): Promise<BuildResult> {
  const res: BuildResult = { ok: true, skipped: [], failures: [], written: [] };
  const sources = readdirSync(srcDir).filter((f) => f.endsWith('.json')).sort();
  const work = mkdtempSync(join(tmpdir(), 'golem-agents-'));
  try {
    for (const f of sources) writeFileSync(join(work, f), stripBom(readFileSync(join(srcDir, f), 'utf8')), 'utf8');

    const up = await o.run('kiro-cli', (o.upgradeArgs ?? defaultUpgradeArgs)(work));
    if (up === 'missing') {
      res.skipped.push('kiro-cli is missing: skipped agent upgrade, validate and the idempotence check; the committed agent files are unchanged');
      return res;
    }
    if (up.code !== 0) {
      res.ok = false;
      res.failures.push({ file: work, stderr: up.stderr || up.stdout });
      return res;
    }
    for (const f of sources) {
      const path = join(work, f);
      const upgraded = JSON.parse(stripBom(readFileSync(path, 'utf8'))) as AgentJson;
      if (upgraded['permissions'] === undefined || upgraded['kiroUpgrade'] === undefined) {
        res.ok = false;
        res.failures.push({ file: f, stderr: 'kiro-cli agent upgrade left the file without permissions or the kiroUpgrade marker' });
        continue;
      }
      const source = JSON.parse(stripBom(readFileSync(join(srcDir, f), 'utf8'))) as { toolsSettings?: { write?: { allowedPaths?: string[] } } };
      const allowed = source.toolsSettings?.write?.allowedPaths ?? [];
      writeFileSync(path, json(finalizeAgent(upgraded, allowed)), 'utf8');
    }
    if (!res.ok) return res;
    for (const f of sources) {
      const v = await o.run('kiro-cli', (o.validateArgs ?? defaultValidateArgs)(join(work, f)));
      if (v === 'missing') { res.skipped.push('kiro-cli is missing: skipped agent validate'); continue; }
      if (v.code !== 0) { res.ok = false; res.failures.push({ file: f, stderr: v.stderr || v.stdout }); }
    }
    if (!res.ok) return res;
    for (const f of sources) {
      const role = roleOf(f);
      const bad = role === undefined ? [] : checkAgent(role, JSON.parse(readFileSync(join(work, f), 'utf8')), 'upgraded');
      if (bad.length > 0) { res.ok = false; res.failures.push({ file: f, stderr: bad.join('; ') }); }
    }
    if (!res.ok) return res;
    mkdirSync(outDir, { recursive: true });
    for (const f of sources) { copyFileSync(join(work, f), join(outDir, f)); res.written.push(f); }
    return res;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- manifest

export interface ManifestFile { rel: string; sha256: string; kind: 'copy' | 'merge-mcp' }

const EXCLUDED = (rel: string): boolean => rel.startsWith('agent-src/') || rel === 'README.md' || rel === 'manifest.json';

function walk(dir: string, base: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).replace(/\\/g, '/'));
  }
}

/** Every file of the pack except `agent-src/`, `README.md` and the manifest, sorted by path. */
export function buildManifest(packDir: string): { files: ManifestFile[] } {
  const rels: string[] = [];
  walk(packDir, packDir, rels);
  return {
    files: rels.filter((r) => !EXCLUDED(r)).sort().map((rel) => ({
      rel, sha256: createHash('sha256').update(readFileSync(join(packDir, rel))).digest('hex'),
      kind: rel === 'settings/mcp.json' ? 'merge-mcp' : 'copy',
    })),
  };
}

export function writeManifest(packDir: string): void {
  writeFileSync(join(packDir, 'manifest.json'), json(buildManifest(packDir)), 'utf8');
}

// ---------------------------------------------------------------- CLI

export function kiroRunner(): PackBuilderOptions['run'] {
  return async (cmd, args) => {
    const r = spawnSync(cmd, [...args], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.error !== undefined && (r.error as { code?: string }).code === 'ENOENT') return 'missing';
    if (r.status === 127 || (r.status === 1 && /not recognized|not found/i.test(r.stderr ?? '') && !/agent/.test(r.stderr ?? ''))) return 'missing';
    return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
}

const here = dirname(fileURLToPath(import.meta.url));

async function cli(): Promise<number> {
  const pack = join(here, '..', 'kiro-pack');
  const r = await buildPack({ run: kiroRunner() }, join(pack, 'agent-src'), join(pack, 'agents'));
  for (const s of r.skipped) console.log(s);
  for (const f of r.failures) console.error(`${f.file}: ${f.stderr}`);
  if (!r.ok) return 1;
  writeManifest(pack);
  console.log(`pack built: ${r.written.length} agent files written, manifest.json updated`);
  return 0;
}

// vite-node hides the script from argv, so `npm run pack:build` is recognised by its lifecycle event.
const direct = process.argv.slice(1).some((a) => /build-pack\.[tj]s$/.test(a)) || process.env['npm_lifecycle_event'] === 'pack:build';
if (process.env['VITEST'] === undefined && direct) process.exitCode = await cli();
void ALLOWED_WRITE;
