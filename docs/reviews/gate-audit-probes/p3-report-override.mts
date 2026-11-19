// Probe 3: what the report and the Gate_Override record when the gate is red only because an Expected_Break line holds,
// and what report.json says after a green gate that contains a broken line.
// Run from skeleton/: npx tsx ../docs/reviews/gate-audit-probes/p3-report-override.mts
import { GREEN_REQUIREMENTS, RED_REQUIREMENTS, createHarness, stopPayload } from '../../../skeleton/test/support/harness.js';

const mark = (text: string, rows: string[]): string =>
  text.replace('### Requirement 1', `\n| Criterion | Topic | Expectation |\n|---|---|---|\n${rows.join('\n')}\n\n### Requirement 1`);

// 1. green gate with a broken line: what does report.json say?
{
  const h = createHarness({ requirements: mark(RED_REQUIREMENTS, ['| 1.2 | x | Expected_Break |']) });
  const code = await h.run('gate');
  const r = h.report();
  console.log(`\n## 1. green gate (exit ${code}); report.json`);
  console.log('meta.lastGateExitCode =', r.meta.lastGateExitCode);
  console.log('verdict statuses      =', JSON.stringify(r.verdicts.map((v: { reqId: string; status: string }) => [v.reqId, v.status])));
  console.log('keys of a verdict     =', Object.keys(r.verdicts[1]).join(', '));
  console.log('any "expect" field in report.json?', /expect/i.test(JSON.stringify(r)));
}

// 2. Expected_Break line holds; the agent stops 6 times -> override at block 5. What lands in gateOverrides?
{
  const h = createHarness({ requirements: mark(GREEN_REQUIREMENTS, ['| 1.2 | x | Expected_Break |']) });
  console.log('\n## 2. six Stop events on a gate that is red only because 1.2 (status held) is marked Expected_Break');
  for (let i = 1; i <= 6; i++) {
    h.clock.advance(3000);
    h.clearOutput();
    h.io.setStdin(stopPayload('s1'));
    await h.run('gate', '--kiro', '--budget', '12');
    const out = h.io.stdoutText();
    console.log(`stop ${i}: ${out === '' ? 'ALLOWED' : 'blocked'}`);
    if (out === '' && h.io.stderrText().includes('still RED')) console.log(h.io.stderrText().trimEnd());
  }
  const r = h.report();
  console.log('gateOverrides =', JSON.stringify(r.gateOverrides));
  console.log('status of 1.2 in the same report =', r.verdicts.find((v: { reqId: string }) => v.reqId === '1.2').status, '(field name is "brokenReqIds")');
}

// 3. the agent's one-line escape: edit the table. Same controller, same code, gate flips.
{
  const red = createHarness({ requirements: RED_REQUIREMENTS });
  const a = await red.run('gate');
  const flipped = createHarness({ requirements: mark(RED_REQUIREMENTS, ['| 1.2 | x | Expected_Break |']) });
  const b = await flipped.run('gate');
  console.log(`\n## 3. same controller: no table exit ${a}; one row added exit ${b}`);
}

// 4. multiple requirement files: same id in both table files is rejected by compile; show an orphan mark in file 2 for an id of file 1
{
  console.log('\n## 4. (skipped: needs a two-file config; see report)');
}
