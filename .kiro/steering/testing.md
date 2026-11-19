---
inclusion: always
---
# Testing rules

- Every spec task that adds logic adds tests in the same task. Use Vitest for examples and **fast-check for properties**.
- Properties we expect, at minimum:
  - **Parser round trip**: `format(parse(line))` re-parses to an equal AST, for generated valid lines.
  - **Units**: converting to SI and back is the identity, within 1e-12 relative error.
  - **Robustness soundness**: `robustness(trace) > 0 ⇔ satisfied(trace)` for random traces, and the sign flips when the threshold crosses the signal.
  - **Monotonicity**: raising the threshold of an `above` predicate never raises robustness.
  - **Shrinker**: the shrunk scenario still fails and is never more severe than the original.
  - **Determinism**: the same (scenario, seed) gives a bit-identical trace.
- Physics tests in CI use short horizons (≤2 s sim) and small budgets. Long campaigns live in `evidence/`.
- **Never weaken an assertion or a requirement to make a test pass.** If a test is wrong, say why in the commit message.
- Test names state the behaviour: `it('rejects a force without a unit')`.
