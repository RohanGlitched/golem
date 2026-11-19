// Probe 5: an Expected_Break line is a statement about the search, not about the controller.
// With no pinned seed (fresh checkout), does the quick budget (24 trials) find the break every time?
// Tiny controller breaks above ~149 N; the line pushes "up to <max> N". Marked Expected_Break and true for every max > 149 N.
// Run from skeleton/: npx tsx ../docs/reviews/gate-audit-probes/p5-flaky-break.mts
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
  let red = 0;
  const N = 60;
  for (let s = 0; s < N; s++) {
    const h = createHarness({ requirements: req(max) });
    const code = await h.run('gate', '--search-seed', String(s));
    if (code !== 0) red++;
  }
  console.log(`up to ${max} N (breaks above ~149 N): gate red on ${red}/${N} search seeds with no pinned seed, although the line does break`);
}

// And with the pinned seed from the first run present: same workspace, second run.
{
  const h = createHarness({ requirements: req(160) });
  let reds = 0;
  for (let s = 0; s < 60; s++) {
    const code = await h.run('gate', '--search-seed', String(s));
    if (code !== 0) reds++;
  }
  console.log(`same workspace reused for 60 gates (pins accumulate): red ${reds}/60`);
}
