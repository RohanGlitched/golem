import type { PageSpec } from '../build/layout';

export function notFoundPage(): PageSpec {
  return {
    id: 'notfound',
    path: '/404.html',
    title: 'Page not found',
    noindex: true,
    description: 'This page does not exist on the GOLEM site.',
    body: `<h1>No such page</h1>
<p class="lede">The address you followed does not lead to a page on this site.</p>
<p>These pages exist:</p>
<ul>
<li><a href="/">Home</a>: shove the G1 and summon the ghosts.</li>
<li><a href="/kit/">The kit</a>: CLI, MCP tools, hooks, agents and the EARS dialect.</li>
<li><a href="/evidence/">Evidence</a>: the stability map and the falsifier benchmark.</li>
<li><a href="/how-kiro/">How Kiro built it</a>: specs, audits and what went wrong.</li>
<li><a href="/stagger/">Stagger studio</a> and <a href="/candy/">Candy studio</a>.</li>
</ul>`,
  };
}
