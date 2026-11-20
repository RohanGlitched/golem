// Vite plugins: render each page from the committed data, and ship the robots' files with the studios.
import type { Plugin } from 'vite';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadSiteData } from './data';
import { renderDocument } from './layout';
import { renderPage } from '../pages';

export interface PageEntry { name: string; file: string; id: string }

export const PAGE_ENTRIES: PageEntry[] = [
  { name: 'index', file: 'index.html', id: 'home' },
  { name: 'kit', file: 'kit/index.html', id: 'kit' },
  { name: 'evidence', file: 'evidence/index.html', id: 'evidence' },
  { name: 'how-kiro', file: 'how-kiro/index.html', id: 'how-kiro' },
  { name: 'yard', file: 'yard/index.html', id: 'yard' },
  { name: '404', file: '404.html', id: 'notfound' },
  { name: 'stagger', file: 'stagger/index.html', id: 'stagger' },
  { name: 'candy', file: 'candy/index.html', id: 'candy' },
  { name: 'hover', file: 'hover/index.html', id: 'hover' },
];

export const STUDIOS = ['stagger', 'candy', 'hover'] as const;

/** The yard robots (apps/yard/robots.json): one studio page each at /yard/<id>/. Empty when the yard is not in the checkout. */
export const YARD_IDS: string[] = (() => {
  const f = path.join(REPO_ROOT, 'apps/yard/robots.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { robots: { id: string }[] }).robots.map((r) => r.id) : [];
})();
PAGE_ENTRIES.push(...YARD_IDS.map((id) => ({ name: `yard-${id}`, file: `yard/${id}/index.html`, id: `yard-${id}` })));

/** `/kit/`, `/kit`, `/kit/index.html?x=1` all name the same entry. */
export function entryForPath(urlPath: string): PageEntry | undefined {
  let p = urlPath.split('?')[0]!.split('#')[0]!;
  if (p.endsWith('/')) p += 'index.html';
  else if (!/\.[a-z0-9]+$/i.test(p)) p += '/index.html';
  const norm = p.replace(/^\/+/, '');
  return PAGE_ENTRIES.find((e) => e.file === norm);
}

export function pagesPlugin(): Plugin {
  return {
    name: 'golem-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        const entry = entryForPath(ctx.path);
        if (!entry) throw new Error(`golem-pages: no page is registered for ${ctx.path}`);
        const data = loadSiteData();
        return renderDocument(renderPage(entry.id, data), data.changelog);
      },
    },
    configureServer(server) {
      // Dev only: the data files are read on every request, so a restart is not needed after regenerating them.
      server.watcher.add([path.join(REPO_ROOT, 'site/data'), path.join(REPO_ROOT, 'evidence/results')]);
    },
  };
}

const MIME: Record<string, string> = {
  '.xml': 'application/xml', '.stl': 'model/stl', '.obj': 'text/plain', '.png': 'image/png', '.bin': 'application/octet-stream', '.json': 'application/json',
};

/** Copies apps/<id>/robot into the build at /<id>/robot, and serves it the same way in dev. */
export function robotFilesPlugin(): Plugin {
  const dirOf = (id: string): string => path.join(REPO_ROOT, 'apps', id, 'robot');
  const yardDir = (id: string): string => path.join(REPO_ROOT, 'apps', 'yard', 'robots', id, 'robot');
  return {
    name: 'golem-robot-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const y = /^\/yard\/([a-z0-9_]+)\/robot\/(.+?)(\?.*)?$/.exec(req.url ?? '');
        if (y && YARD_IDS.includes(y[1]!)) {
          const dir = yardDir(y[1]!);
          const rel = decodeURIComponent(y[2]!).replace(/^LICENSE\.txt$/, 'LICENSE');
          const file = path.join(dir, rel);
          if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) return next();
          res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
          res.end(readFileSync(file));
          return;
        }
        const m = /^\/(stagger|candy|hover)\/robot\/(.+?)(\?.*)?$/.exec(req.url ?? '');
        if (!m) return next();
        const file = path.join(dirOf(m[1]!), decodeURIComponent(m[2]!));
        if (!file.startsWith(dirOf(m[1]!)) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    writeBundle(opts) {
      const out = opts.dir ?? path.join(REPO_ROOT, 'site/dist');
      // yard robots: only the files their manifest lists (the fetched model, meshes, textures, scene, licence)
      for (const id of YARD_IDS) {
        const src = yardDir(id);
        const man = path.join(src, 'SOURCE.json');
        if (!existsSync(path.join(src, 'scene.xml'))) {
          this.warn(`apps/yard/robots/${id}/robot is not fetched: /yard/${id}/ ships without robot files (run node apps/yard/scripts/fetch-assets.mjs).`);
          continue;
        }
        const outputs = Object.keys((JSON.parse(readFileSync(man, 'utf8')) as { outputs: Record<string, string> }).outputs);
        for (const rel of [...outputs, 'SOURCE.json']) {
          const to = path.join(out, 'yard', id, 'robot', rel);
          mkdirSync(path.dirname(to), { recursive: true });
          copyFileSync(path.join(src, rel), to);
        }
        copyFileSync(path.join(src, 'LICENSE'), path.join(out, 'yard', id, 'robot', 'LICENSE.txt'));
      }
      for (const id of STUDIOS) {
        const src = dirOf(id);
        if (!existsSync(src)) {
          this.warn(`apps/${id}/robot is missing: /${id}/ ships a notice page and no robot files.`);
          continue;
        }
        mkdirSync(path.join(out, id, 'robot'), { recursive: true });
        cpSync(src, path.join(out, id, 'robot'), { recursive: true });
        // CloudFront rewrites extensionless URLs to <url>/index.html, so the licence also ships as LICENSE.txt (see studio/fetch-shim.ts).
        const lic = path.join(src, 'LICENSE');
        if (existsSync(lic)) copyFileSync(lic, path.join(out, id, 'robot', 'LICENSE.txt'));
      }
    },
  };
}
