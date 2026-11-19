import { writeReport } from '../report.js';
import { defaultResultsDir, gitCommit, repoRoot } from '../lib/meta.js';

type Flags = Record<string, string | true>;

export function run(flags: Flags): void {
  const results = typeof flags['results'] === 'string' ? (flags['results'] as string) : defaultResultsDir;
  const { markdown } = writeReport({
    results, site: `${repoRoot}/site/data`, out: `${repoRoot}/evidence/REPORT.md`,
    stagger: `${repoRoot}/apps/stagger/.kiro/specs/g1-walking/requirements.md`, repoCommit: gitCommit(), apps: `${repoRoot}/apps`,
  });
  console.log(`wrote evidence/REPORT.md (${markdown.length} characters) and site/data/*.json`);
}
