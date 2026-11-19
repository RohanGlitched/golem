// Document shell shared by every page: head, header with the theme toggle, and the rich footer (identical everywhere).
import type { ChangelogEntry } from './data';
import { esc } from './html';

export const REPO_URL = 'https://github.com/RohanGlitched/golem';
export const SITE_NAME = 'GOLEM';
export const SITE_URL = 'https://d23v187fnxad7l.cloudfront.net';

export interface PageSpec {
  id: string;
  path: string;            // URL path, "/kit/"
  title: string;
  description: string;
  body: string;            // inside <main>
  modules?: string[];      // extra module scripts, as source paths
  mainClass?: string;
  noindex?: boolean;
  head?: string;           // extra tags for <head>, such as a preload
}

export const NAV: { href: string; label: string; id: string }[] = [
  { href: '/stagger/', label: 'Studio', id: 'stagger' },
  { href: '/kit/', label: 'Kit', id: 'kit' },
  { href: '/evidence/', label: 'Evidence', id: 'evidence' },
  { href: '/how-kiro/', label: 'How Kiro built it', id: 'how-kiro' },
];

export const SITEMAP: { href: string; label: string; note: string }[] = [
  { href: '/', label: 'Home', note: 'Shove the G1, summon the ghosts' },
  { href: '/stagger/', label: 'Stagger studio', note: 'Unitree G1 walking under Unitree’s policy' },
  { href: '/candy/', label: 'Candy studio', note: 'Franka Panda sorting candy near hands' },
  { href: '/hover/', label: 'Hover studio', note: 'Skydio X2 holding a point in gusts' },
  { href: '/kit/', label: 'The kit', note: 'CLI, MCP, hooks, agents, EARS dialect' },
  { href: '/evidence/', label: 'Evidence', note: 'Stability map, benchmark, limits' },
  { href: '/how-kiro/', label: 'How Kiro built it', note: 'Specs, audits, what went wrong' },
];

export const LICENCES: { what: string; licence: string; href: string }[] = [
  { what: 'GOLEM code and this site', licence: 'Apache-2.0', href: `${REPO_URL}/blob/main/LICENSE` },
  { what: 'Unitree G1 model and walking policy (unitree_rl_gym)', licence: 'BSD-3-Clause', href: '/stagger/robot/LICENSE.txt' },
  { what: 'Franka Panda (MuJoCo Menagerie)', licence: 'Apache-2.0', href: '/candy/robot/LICENSE.txt' },
  { what: 'Skydio X2 (MuJoCo Menagerie)', licence: 'Apache-2.0', href: '/hover/robot/LICENSE.txt' },
  { what: 'MuJoCo', licence: 'Apache-2.0', href: 'https://github.com/google-deepmind/mujoco/blob/main/LICENSE' },
  { what: 'B612 and B612 Mono (Airbus)', licence: 'SIL OFL 1.1', href: '/fonts/OFL.txt' },
  { what: 'Gloock', licence: 'SIL OFL 1.1', href: '/fonts/OFL-Gloock.txt' },
];

export function renderHeader(current: string): string {
  const links = NAV.map((n) => `<a href="${n.href}"${n.id === current ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`).join('');
  return `<header class="site-head"><a class="wordmark" href="/" aria-label="GOLEM, home">GOLEM</a><nav aria-label="Main">${links}<a href="${REPO_URL}" rel="noopener">Source</a></nav><button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to the light theme">Light</button></header>`;
}

export function renderFooter(changelog: ChangelogEntry[]): string {
  const sitemap = SITEMAP.map((s) => `<li><a href="${s.href}">${esc(s.label)}</a><span>${esc(s.note)}</span></li>`).join('');
  const lic = LICENCES.map((l) => `<li><a href="${l.href}"${l.href.startsWith('http') ? ' rel="noopener"' : ''}>${esc(l.what)}</a><span>${esc(l.licence)}</span></li>`).join('');
  const log = changelog.slice(0, 8).map((c) => `<li><time datetime="${esc(c.date)}">${esc(c.date)}</time> <a href="${REPO_URL}/commit/${esc(c.hash)}" rel="noopener"><code>${esc(c.hash)}</code></a> ${esc(c.subject)}</li>`).join('');
  return `<footer class="site-foot"><div class="foot-grid">
<section aria-labelledby="f-map"><h2 id="f-map">Sitemap</h2><ul class="foot-list">${sitemap}</ul></section>
<section aria-labelledby="f-lic"><h2 id="f-lic">Licences</h2><ul class="foot-list">${lic}</ul></section>
<section aria-labelledby="f-repo"><h2 id="f-repo">Repository</h2><p><a href="${REPO_URL}" rel="noopener">github.com/RohanGlitched/golem</a></p><p class="foot-small">A pass in GOLEM means no counterexample was found within the stated search budget. It is not a proof. Verdicts come from deterministic monitors, never from a language model.</p></section>
<section aria-labelledby="f-log"><h2 id="f-log">Changelog</h2><ul class="foot-log">${log}</ul></section>
</div><p class="foot-end">Built with Kiro. Simulation only: no real robot ran any of these tests.</p></footer>`;
}

export function renderDocument(p: PageSpec, changelog: ChangelogEntry[]): string {
  const modules = ['/src/client/site.ts', ...(p.modules ?? [])];
  const title = p.id === 'home' ? p.title : `${p.title} · ${SITE_NAME}`;
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(p.description)}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#2A211C">${p.noindex ? '\n<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta property="og:url" content="${SITE_URL}${p.path}">${p.noindex ? '' : `
<link rel="canonical" href="${SITE_URL}${p.path}">`}
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A polar plot of the largest push the Unitree G1 survives from each direction, drawn in clay and cinnabar on a dark ground.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE_URL}/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/B612-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/Gloock-Regular.woff2" as="font" type="font/woff2" crossorigin>
${p.head ?? ''}
<script src="/theme-init.js"></script>
<link rel="stylesheet" href="/src/client/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${renderHeader(p.id)}
<main id="main" class="page${p.mainClass ? ` ${p.mainClass}` : ''}">
${p.body}
</main>
${renderFooter(changelog)}
${modules.map((m) => `<script type="module" src="${m}"></script>`).join('\n')}
</body>
</html>
`;
}
