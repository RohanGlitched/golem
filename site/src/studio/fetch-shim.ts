// infra/stack.yaml rewrites every extensionless URL to <url>/index.html, so /<app>/robot/LICENSE would 404 on CloudFront.
// The build ships that file as LICENSE.txt; this shim asks for it by that name. Same-origin /robot/ URLs only.
const orig = globalThis.fetch.bind(globalThis);

export function shimUrl(input: string, base: string): string {
  const u = new URL(input, base);
  if (u.origin === new URL(base).origin && /\/robot\/[^/.]+$/.test(u.pathname)) u.pathname += '.txt';
  return u.href;
}

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const base = (globalThis as { location?: { href: string } }).location?.href ?? 'http://localhost/';
  if (typeof input === 'string' || input instanceof URL) return orig(shimUrl(String(input), base), init);
  return orig(input, init);
}) as typeof fetch;
