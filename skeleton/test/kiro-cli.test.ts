// Runs the real kiro-cli when it is installed: validate every committed agent, and check that a second upgrade
// leaves every byte unchanged. Without kiro-cli it reports one skip line that names kiro-cli as missing.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_DIR } from './support/pack.js';

const kiro = (args: string[]) => spawnSync('kiro-cli', args, { encoding: 'utf8', shell: process.platform === 'win32' });
const probe = kiro(['--version']);
const installed = probe.error === undefined && probe.status === 0;
if (!installed) console.warn('[skip] kiro-cli is missing: agent validate and the idempotence check are skipped');

describe.skipIf(!installed)('kiro-cli', () => {
  const files = readdirSync(join(PACK_DIR, 'agents')).filter((f) => f.endsWith('.json'));

  it.each(files)('validates %s', (f) => {
    const r = kiro(['agent', 'validate', '--path', join(PACK_DIR, 'agents', f)]);
    expect(r.status, `${f} exited with ${r.status}: ${r.stderr}`).toBe(0);
  });

  it('leaves every finalized agent byte-identical on a second upgrade', () => {
    const dir = mkdtempSync(join(tmpdir(), 'golem-upgrade-'));
    try {
      for (const f of files) copyFileSync(join(PACK_DIR, 'agents', f), join(dir, f));
      const r = kiro(['agent', 'upgrade', dir, '--no-backup']);
      expect(r.status).toBe(0);
      for (const f of files) expect(readFileSync(join(dir, f), 'utf8')).toBe(readFileSync(join(PACK_DIR, 'agents', f), 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe.skipIf(installed)('kiro-cli is missing', () => {
  it('skips the real validate and idempotence checks', () => { expect(installed).toBe(false); });
});
