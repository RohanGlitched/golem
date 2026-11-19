import { compileRequirement, compileRequirementsFile } from '../../skeleton/src/ears/index.ts';

const DIRS: Record<string, [number, number]> = { 'any direction': [0, 2 * Math.PI], behind: [3 * Math.PI / 4, 5 * Math.PI / 4] };
const lex: any = {
  robotNames: ['golem', 'G1', 'robot'],
  predicates: [
    { phrase: 'stay upright', signals: ['pelvis_z', 'tilt_deg'], unit: 'm',
      margin: (s: any) => (s.tilt_deg > 60 ? -0.01 : s.pelvis_z - 0.5) },
    { phrase: 'keep its pelvis above {length}', signals: ['pelvis_z'], unit: 'm',
      margin: (s: any, k: any) => s.pelvis_z - k.length },
    { phrase: 'track the commanded speed within {speed}', signals: ['forward_speed', 'commanded_speed'], unit: 'm/s',
      margin: (s: any, k: any) => k.speed - Math.abs(s.forward_speed - s.commanded_speed) },
  ],
  perturbations: [
    { phrase: 'the pelvis is pushed with {range:force} for {duration} from {direction} at {phase}',
      dims: (sl: any) => { console.log('   dims() got slots:', JSON.stringify(sl));
        const f = sl.force; const d = typeof sl.direction === 'string' ? DIRS[sl.direction] : [sl.direction.si, sl.direction.si];
        return [
          { name: 'push.force', kind: 'force', min: f[0].si, max: f[1].si, severity: 'up' },
          { name: 'push.angle', kind: 'angle', min: d[0], max: d[1], severity: 'none', wrap: true },
          { name: 'push.phase', kind: 'phase', min: 0, max: 1, severity: 'none', wrap: true },
        ]; },
      apply() {} },
    { phrase: 'walking on a slope of {range:angle}',
      dims: (sl: any) => [{ name: 'slope.angle', kind: 'angle', min: sl.angle[0].si, max: sl.angle[1].si, severity: 'up' }], apply() {} },
  ],
};

const lines = [
  'R1. WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride, THE golem SHALL stay upright for 3 s',
  '1.2 WHEN the pelvis is pushed with 150 to 250 N for 200 ms from behind at any point in its stride THE G1 SHALL keep its pelvis above 0.6 m for 3 s',
  'WHEN the pelvis is pushed with up to 200 N for 0.2 s from behind at any point in its stride, THE golem SHALL stay uprigth for 3 s',
  'WHEN the pelvis is pushed with up to 200 for 0.2 s from behind at any point in its stride, THE golem SHALL stay upright for 3 s',
  'WHEN the pelvis is pushed with up to 200 N for 0.2 s from the left at any point in its stride, THE golem SHALL stay upright for 3 s',
  'WHILE walking on a slope of up to 10 deg, THE golem SHALL track the commanded speed within 0.15 m/s',
  'WHILE walking on a slope of up to 10 deg, THE golem SHALL stay upright for 3 s',
  'IF the pelvis is pushed with up to 300 N for 0.1 s from behind at any point in its stride, THEN THE robot SHALL keep its pelvis above 50 cm within 6 s',
  'WHERE the payload kit is fitted, THE golem SHALL stay upright',
  'THE golem SHALL track the commanded speed within 15 cm/s',
  'WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride THEN the golem SHALL stay upright for 3 s',
  'WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride, THE golem SHALL stay upright for 3',
  'THE golem SHALL keep its pelvis above 0.6',
  'THE Unitree G1 SHALL stay upright',
  'THE golem SHALL keep the pelvis above 0.6 m',
  'WHEN walking on a slope of up to 10 deg, THE golem SHALL stay upright for 3 s',
  'WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at 50%, THE golem SHALL stay upright for 3 s',
  'THE golem SHALL stay upright for 3 s',
  'WHEN the pelvis is pushed with up to 200 N for 0.2 s from 90 deg at any point in its stride, THE golem SHALL stay upright within 2 s',
  'WHEN the pelvis is pushed with up to -5 N for 0.2 s from behind at any point in its stride, THE golem SHALL stay upright',
];
const out: any[] = [];
for (const l of lines) {
  const r = compileRequirement(l, lex);
  console.log('\n>>', l);
  for (const d of r.diagnostics) console.log(`   ${d.severity} ${d.kind} @${d.line}:${d.column} [${d.start},${d.end}) "${l.slice(d.start, d.end)}" :: ${d.message}${d.suggestion ? ' || suggestion=' + d.suggestion : ''}`);
  if (r.requirement) {
    const q = r.requirement;
    console.log('   OK', q.id, q.pattern, 'horizon', q.horizon, 'dims', JSON.stringify(q.space.dims), 'perts', JSON.stringify(q.perturbations));
    out.push(q);
  } else out.push(undefined);
}

// traces
function mk(fall: boolean, trig = true, n = 501) {
  const t = new Float64Array(n), z = new Float64Array(n), tilt = new Float64Array(n), fs = new Float64Array(n), cs = new Float64Array(n);
  for (let i = 0; i < n; i++) { t[i] = i * 0.01; z[i] = 0.78; cs[i] = 0.5; fs[i] = 0.5 + 0.05 * Math.sin(i / 10);
    if (fall && t[i] >= 2.5) { z[i] = Math.max(0.1, 0.78 - (t[i] - 2.5) * 2); tilt[i] = 80; } }
  return { t, signals: { pelvis_z: z, tilt_deg: tilt, forward_speed: fs, commanded_speed: cs }, events: trig ? [{ name: 'trigger', t: 2.0 }] : [] };
}
for (const [i, idx] of [[0, 0], [1, 1], [7, 7], [5, 5], [9, 9], [17, 17], [18, 18]] as const) {
  const q = out[idx]; if (!q) continue;
  for (const [name, tr] of [['falls@2.5', mk(true)], ['stays', mk(false)], ['no trigger', mk(true, false)]] as const)
    console.log(`monitor L${idx} ${name}:`, JSON.stringify(q.monitor(tr)));
}

const md = `# Requirements Document

## Introduction

Push recovery for the G1.

## Requirements

### Requirement 1: Push recovery

**User Story:** As an engineer, I want the robot to stay up, so that it is safe.

#### Acceptance Criteria

1. WHEN the pelvis is pushed with up to 200 N for 0.2 s from any direction at any point in its stride, THE golem SHALL stay upright for 3 s.
2. WHEN the pelvis is pushed with up to 200 N for 0.2 s from behind
   at any point in its stride, THE golem SHALL keep its pelvis above 0.6 m for 3 s
3. THE golem SHALL track the commanded speed within 0.15 m/s and SHALL stay upright.
4. WHEN the pelvis is pushed with up to 200 N for 0.2 s from behind at any point in its stride THEN the golem SHALL stay upright for 3 s
5. FOR ALL pushes, the golem SHALL stay upright.
6. THE **golem** SHALL stay upright
7. THE golem SHALL keep its pelvis above \`0.6 m\`

### Requirement 2: Slopes

#### Acceptance Criteria

1. WHILE walking on a slope of up to 10°, THE golem SHALL stay upright
`;
const f = compileRequirementsFile(md, lex);
console.log('\nFILE: compiled', f.requirements.map((r) => r.id));
for (const d of f.diagnostics) console.log(`   ${d.severity} ${d.kind} @${d.line}:${d.column} :: ${d.message}${d.suggestion ? ' || ' + d.suggestion : ''}`);
