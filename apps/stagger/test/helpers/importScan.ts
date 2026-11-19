// Public-entry-point scan: finds import specifiers that reach into skeleton/src.
const SPECIFIER = /(?:\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?|\bexport\s+(?:type\s+)?[\w*{}\s,$]*\s+from\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

/** Every module specifier in `source` (static, re-export, dynamic import and require). */
export function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(SPECIFIER)) out.push(m[2]!);
  return out;
}

/** The specifiers that contain `skeleton/src`. `golem-spec`, `golem-spec/ui` and `golem-spec/node` pass. */
export function forbiddenImports(source: string): string[] {
  return importSpecifiers(source).filter((s) => s.replace(/\\/g, '/').includes('skeleton/src'));
}
