// Pure checkers for the Power (requirement 25): the plugin manifest and the no-URL scan.
export const PLUGIN_FIELDS = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'] as const;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

/** Closed Agent Plugins 1.0 schema: only the permitted fields, and a valid name, version, description and licence. */
export function checkPluginManifest(file: unknown): string[] {
  if (!isObj(file)) return ['plugin.json must be a JSON object'];
  const v: string[] = [];
  for (const k of Object.keys(file)) if (!(PLUGIN_FIELDS as readonly string[]).includes(k)) v.push(`field "${k}" is not part of the Agent Plugins 1.0 schema`);
  if (!nonEmpty(file['name'])) v.push('name must be a non-empty string');
  if (typeof file['version'] !== 'string' || !/^\d+\.\d+\.\d+$/.test(file['version'])) v.push('version must have the form MAJOR.MINOR.PATCH');
  if (!nonEmpty(file['description'])) v.push('description must be a non-empty string');
  if (file['license'] !== 'Apache-2.0') v.push('license must be Apache-2.0');
  if (file['$schema'] !== undefined && !nonEmpty(file['$schema'])) v.push('$schema must be a non-empty string');
  if (file['keywords'] !== undefined && !(Array.isArray(file['keywords']) && file['keywords'].every((k) => typeof k === 'string'))) v.push('keywords must be an array of strings');
  return v;
}

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const SCHEMA_FILES = new Set(['plugin.json', 'mcp.json']);

/**
 * URLs and IP addresses in the Power files. Only the top-level `$schema` value of `plugin.json` and `mcp.json` may hold a
 * URL. The licence text is exempt: it is a byte-identical copy of the repository licence, which names its own URL.
 */
export function scanUrls(files: { path: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const base = f.path.replace(/\\/g, '/').split('/').pop() as string;
    if (base === 'LICENSE') continue;
    let text = f.text;
    if (SCHEMA_FILES.has(base) && f.path.replace(/\\/g, '/').split('/').length === 1) {
      try {
        const j = JSON.parse(f.text) as unknown;
        if (isObj(j)) { const { $schema: _drop, ...rest } = j; text = JSON.stringify(rest); }
      } catch { /* scan the raw text */ }
    }
    for (const m of text.matchAll(URL_RE)) out.push(`${f.path}: URL ${m[0]}`);
    for (const m of text.matchAll(IP_RE)) out.push(`${f.path}: IP address ${m[0]}`);
  }
  return out;
}
