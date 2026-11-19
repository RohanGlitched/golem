import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { prepareApp } from '../adapters/app-loader.js';

const root = mkdtempSync(join(tmpdir(), 'golem-loader-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A project directory under the temp root, with the given files. */
let n = 0;
function project(files: Record<string, string>): string {
  const dir = join(root, `p${n++}`);
  mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

const ESM_APP = "export default { id: 'esm', name: 'esm', lexicon: {}, where: import.meta.url };\n";

describe('app loader and the package type', () => {
  it('loads an ES module app.js in a package that says "type": "commonjs", with import.meta.url on the original file', async () => {
    const dir = project({ 'package.json': '{"type":"commonjs"}', 'app.js': ESM_APP });
    const { app, moduleUrl } = await prepareApp(join(dir, 'app.js'));
    expect(app.id).toBe('esm');
    expect((app as unknown as { where: string }).where).toBe(pathToFileURL(join(dir, 'app.js')).href);
    expect(moduleUrl).not.toBe(pathToFileURL(join(dir, 'app.js')).href);
    expect(moduleUrl.endsWith('.mjs')).toBe(true);
  });

  it('loads an ES module app.js in a package with no "type" and in a directory with no package.json', async () => {
    const layouts: Record<string, string>[] = [{ 'package.json': '{"name":"x"}', 'app.js': ESM_APP }, { 'app.js': ESM_APP }];
    for (const files of layouts) {
      const dir = project(files);
      expect((await prepareApp(join(dir, 'app.js'))).app.id).toBe('esm');
    }
  });

  it('imports the file itself when the package says "type": "module"', async () => {
    const dir = project({ 'package.json': '{"type":"module"}', 'app.js': ESM_APP });
    const { moduleUrl } = await prepareApp(join(dir, 'app.js'));
    expect(moduleUrl).toBe(pathToFileURL(join(dir, 'app.js')).href);
  });

  it('imports a CommonJS app as it is', async () => {
    const dir = project({ 'package.json': '{"type":"commonjs"}', 'app.js': "module.exports = { id: 'cjs', name: 'cjs', lexicon: {} };\n" });
    const { app, moduleUrl } = await prepareApp(join(dir, 'app.js'));
    expect(app.id).toBe('cjs');
    expect(moduleUrl).toBe(pathToFileURL(join(dir, 'app.js')).href);
  });

  it('asks for "type": "module" when an ES module app in a CommonJS package imports another file', async () => {
    const dir = project({ 'package.json': '{"type":"commonjs"}', 'app.js': "import lex from './lex.js';\nexport default { id: 'x', name: 'x', lexicon: lex };\n", 'lex.js': 'export default {};\n' });
    await expect(prepareApp(join(dir, 'app.js'))).rejects.toThrow('"type": "module"');
  });

  it('reports a real syntax error of an ES module app without hiding it', async () => {
    const dir = project({ 'package.json': '{"type":"commonjs"}', 'app.js': 'export default {;\n' });
    const err = await prepareApp(join(dir, 'app.js')).then(() => undefined, (e: unknown) => e as Error);
    expect(err?.message).toMatch(/Unexpected token|Failed to parse/);
    expect(err?.message).not.toContain('"type": "module"');
  });
});
