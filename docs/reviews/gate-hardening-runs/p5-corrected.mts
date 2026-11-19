// Probe 5 with the usage error removed: the audit's p5 passed --search-seed 0, which the argument parser rejects (exit 1, 'posint'),
// so one of its 60 "misses" in every row was not a miss. This version uses seeds 1 to 60 and tells a miss (exit 2) from a usage error.
// Run from skeleton/: npx tsx ../docs/reviews/gate-hardening-runs/p5-corrected.mts
import { createHarness } from '../../../skeleton/test/support/harness.js';

const req = (max: number): string => `# Requirements Document

| Criterion | Topic | Expectation |
|---|---|---|
| 1.1 | Height | Expected_Break |

### Requirement 1: Height

#### Acceptance Criteria

1. WHEN the base is pushed with up to ${max} N THE robot SHALL keep its height above 0.4 m for 1 s
`;

for (const max of [160, 175, 200]) {
  const red: number[] = [];
  const N = 60;
  for (let s = 1; s <= N; s++) {
    const h = createHarness({ requirements: req(max) });
    const code = await h.run('gate', '--search-seed', String(s));
    if (code !== 0) red.push(s);
  }
  console.log(`up to ${max} N (breaks above ~149 N): gate red on ${red.length}/${N} search seeds (1 to ${N}) with no pinned seed${red.length > 0 ? `: ${JSON.stringify(red)}` : ''}`);
}
