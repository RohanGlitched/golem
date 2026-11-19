import { describe, expect, it } from 'vitest';
import { memoryFileSystem } from './fs.js';

describe('memoryFileSystem', () => {
  it('reads back what was written and logs the calls', async () => {
    const fs = memoryFileSystem();
    await fs.writeFile('a', 'x');
    expect(await fs.readFile('a')).toBe('x');
    expect(fs.log.map((c) => c.method)).toEqual(['writeFile', 'readFile']);
    expect(fs.count('writeFile', 'rename')).toBe(1);
  });
  it('throws ENOENT for a missing file', async () => {
    const fs = memoryFileSystem();
    await expect(fs.readFile('nope')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.rename('nope', 'b')).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('ignores a missing file on remove', async () => {
    const fs = memoryFileSystem();
    await expect(fs.remove('nope')).resolves.toBeUndefined();
  });
  it('rename moves the content', async () => {
    const fs = memoryFileSystem({ a: 'x' });
    await fs.rename('a', 'b');
    expect(fs.files.has('a')).toBe(false);
    expect(fs.files.get('b')).toBe('x');
  });
  it('fails exactly the Nth call of a method', async () => {
    const fs = memoryFileSystem();
    fs.failOn('writeFile', 2, new Error('disk full'));
    await fs.writeFile('a', '1');
    await expect(fs.writeFile('b', '2')).rejects.toThrow('disk full');
    await fs.writeFile('c', '3');
    expect(fs.files.has('b')).toBe(false);
    expect(fs.files.get('c')).toBe('3');
  });
});
