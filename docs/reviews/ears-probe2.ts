import { compileRequirement } from 'I:/Programs/ListofHackathon/hackathons/39-kiroween/golem/skeleton/src/ears/index.ts';
const lex: any = { robotNames: ['golem'], perturbations: [], predicates: [
  { phrase: 'keep its pelvis above {length}', signals: ['pelvis_z'], unit: 'm', margin: (s: any, k: any) => s.pelvis_z - k.length },
  { phrase: 'track the commanded speed within {speed}', signals: ['v'], unit: 'm/s', margin: (s: any, k: any) => k.speed - Math.abs(s.v - 0.5) } ] };
const n = 501, t = new Float64Array(n), z = new Float64Array(n), v = new Float64Array(n);
for (let i = 0; i < n; i++) { t[i] = i * 0.01; z[i] = 0.78; v[i] = t[i] > 4 ? 2 : 0.5; }
const tr = { t, signals: { pelvis_z: z, v }, events: [] };
for (const l of ['WHILE keep its pelvis above 0.4 m, THE golem SHALL track the commanded speed within 0.15 m/s for 3 s',
  'THE golem SHALL track the commanded speed within 0.15 m/s for 3 s',
  'WHERE the payload kit is fited, THE golem SHALL keep its pelvis above 2 m']) {
  const r = compileRequirement(l, lex); console.log(l, '\n  ', r.diagnostics.map((d) => d.message), r.requirement && JSON.stringify(r.requirement.monitor(tr)), r.requirement?.horizon);
}
