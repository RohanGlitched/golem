import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string): any => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

describe('package bins', () => {
  const pkg = read('../package.json');

  it('offers golem and golem-spec on the same file, so npx --no-install golem-spec resolves inside the monorepo', () => {
    expect(pkg.bin).toEqual({ golem: 'dist/cli/main.js', 'golem-spec': 'dist/cli/main.js' });
  });

  it('records both bins in the root lockfile, so npm install links them', () => {
    const lock = read('../../package-lock.json');
    expect(lock.packages['skeleton'].bin).toEqual(pkg.bin);
  });

  it('names the bin that the pack tells people to run', () => {
    const pack = readFileSync(new URL('../kiro-pack/README.md', import.meta.url), 'utf8');
    expect(pack).toContain('npx --no-install golem-spec');
    expect(Object.keys(pkg.bin)).toContain('golem-spec');
  });
});
