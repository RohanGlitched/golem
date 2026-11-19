# CLI transcript

Real output of the GOLEM CLI on this app, run in `apps/hover` with `node v21.7.0`. Nothing here is edited. Each `test` run starts from an empty `.golem` folder, so its search seed (`--search-seed`, default 1) is the only thing that differs; `falsify` and `gate` re-run the seeds that the last `test` pinned, first. `test` exits 2 whenever any line is broken, including the lines that are expected to break; `gate` exits 0 when every line meets its Expectation. Wall times depend on the machine.

## `npx --no-install golem-spec check`

```text
6 requirements compiled, 0 warnings
```

Exit code: 0

## `npx --no-install golem-spec test --budget 64 --search-seed 2` (after rm -r .golem)

```text
1.1  HELD  closest margin +0.0966 m  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
1.2  HELD  closest margin +10.7 deg  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
1.3  BROKEN  margin -0.00295 m  27 trials  gust.force = 9.98 N, gust.angle = 307 deg  (shrunk, seed 972702968)  [Expected_Break: met]
2.1  HELD  closest margin +0.228 m  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
3.1  HELD  closest margin +0.134 m  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
3.2  BROKEN  margin -0.0152 m  30 trials  gust.force = 0 N, gust.angle = 307 deg, estimate.lag = 0.279 s  (shrunk, seed 972702968)  [Expected_Break: met]
6 requirements: 2 broken, 4 held, 0 error, in 6.05 s (search budget 64 trials per requirement; held means no counterexample found within that budget, not a proof)
```

Exit code: 2

## `npx --no-install golem-spec test --budget 64 --search-seed 3` (after rm -r .golem)

```text
1.1  HELD  closest margin +0.112 m  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
1.2  HELD  closest margin +11.6 deg  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
1.3  BROKEN  margin -0.00532 m  28 trials  gust.force = 10 N, gust.angle = 210 deg  (shrunk, seed 3568983572)  [Expected_Break: met]
2.1  HELD  closest margin +0.23 m  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
3.1  HELD  closest margin +0.158 m  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
3.2  BROKEN  margin -0.00397 m  30 trials  gust.force = 0.0449 N, gust.angle = 17.1 deg, estimate.lag = 0.275 s  (shrunk, seed 475866607)  [Expected_Break: met]
6 requirements: 2 broken, 4 held, 0 error, in 6.08 s (search budget 64 trials per requirement; held means no counterexample found within that budget, not a proof)
```

Exit code: 2

## `npx --no-install golem-spec test --budget 64` (after rm -r .golem)

```text
1.1  HELD  closest margin +0.104 m  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
1.2  HELD  closest margin +10.7 deg  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
1.3  BROKEN  margin -0.015 m  28 trials  gust.force = 10 N, gust.angle = 11.1 deg  (shrunk, seed 3909821944)  [Expected_Break: met]
2.1  HELD  closest margin +0.217 m  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
3.1  HELD  closest margin +0.149 m  no counterexample in 64 trials; from the 12 uniformly random ones, failure rate below 25 % (95 % confidence)  [Expected_Hold: met]
3.2  BROKEN  margin -0.0162 m  30 trials  gust.force = 0.163 N, gust.angle = 11.1 deg, estimate.lag = 0.285 s  (shrunk, seed 3909821944)  [Expected_Break: met]
6 requirements: 2 broken, 4 held, 0 error, in 6.28 s (search budget 64 trials per requirement; held means no counterexample found within that budget, not a proof)
```

Exit code: 2

## `npx --no-install golem-spec falsify 1.3 --budget 64`

```text
1.3  pinned generation 0: lowest -0.015 m, 1 trials used, 63 remaining
1.3  shrink generation 0: lowest -0.015 m, 15 trials used, 49 remaining
1.3  BROKEN  margin -0.015 m  15 trials  gust.force = 10 N, gust.angle = 11.1 deg  (not shrunk, seed 3909821944)
```

Exit code: 2

## `npx --no-install golem-spec gate`

```text
Expected_Hold (4 lines: must hold)
  ok    1.1  HELD  closest margin +0.117 m  no counterexample in 24 trials; from the 4 uniformly random ones, failure rate below 75 % (95 % confidence)
  ok    1.2  HELD  closest margin +12.2 deg  no counterexample in 24 trials; from the 4 uniformly random ones, failure rate below 75 % (95 % confidence)
  ok    2.1  HELD  closest margin +0.266 m  no counterexample in 24 trials; from the 4 uniformly random ones, failure rate below 75 % (95 % confidence)
  ok    3.1  HELD  closest margin +0.171 m  no counterexample in 24 trials; from the 4 uniformly random ones, failure rate below 75 % (95 % confidence)

Expected_Break (2 lines: must break)
  ok    1.3  BROKEN  margin -0.015 m  15 trials  gust.force = 10 N, gust.angle = 11.1 deg  (not shrunk, seed 3909821944)
  ok    3.2  BROKEN  margin -0.0162 m  16 trials  gust.force = 0.163 N, gust.angle = 11.1 deg, estimate.lag = 0.285 s  (not shrunk, seed 3909821944)

gate GREEN: every requirement meets its expectation (4 held as expected, 2 broke as expected; 127 trials, pinned seeds first, then the quick budget)
```

Exit code: 0
