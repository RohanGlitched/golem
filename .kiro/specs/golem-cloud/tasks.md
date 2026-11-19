# Implementation Plan: golem-cloud

## Overview

Build order follows the design: close the cross-package gaps (G6, G7) first, then the pure Scribe_Lambda modules behind an `EarsPort` stub seam (G1 to G3), then the handler, the studio box, the bundle, the stack template and the Python deploy tooling. TypeScript (strict, ES modules, Node 20) for `infra/scribe/` and `skeleton/src/ui/scribe/`. Python (boto3 only, lazily imported) for `infra/deploy.py` and `infra/smoke.py`.

Rules that apply to every task:
- Tests ship in the same task as the logic they cover (`testing.md`). Vitest for examples, fast-check for properties (`numRuns >= 100`, comment tag `Feature: golem-cloud, Property N: <title>`), Python `unittest` with a fixed `random.Random(seed)` for the deploy tooling.
- No network, real clock or `Math.random()` in any test or in Lambda logic. Use `FakeModel`, `MemoryCounterStore` and a fixed clock.
- Never weaken an assertion or a requirement to make a test pass. A test found wrong is fixed with the reason in the commit message.
- `interfaces.md` shapes are used unchanged. Only `golem-spec`, `golem-spec/ui` and `<app>/lexicon` are imported across packages. Only `ears-adapter.ts` imports `golem-spec` inside `infra/scribe/src`.
- Python is used only under `infra/`.
- Property test sub-tasks are not optional because `testing.md` requires properties for core modules.

## Tasks

- [ ] 1. Scaffold the scribe package and close cross-package gaps G6 and G7
  - [ ] 1.1 Create the `infra/scribe` package and workspace wiring
    - Add `infra/scribe/package.json` (name `golem-scribe`, private; devDeps esbuild, vitest, fast-check, yaml; AWS SDK v3 Bedrock Runtime and DynamoDB clients), `tsconfig.json` (strict, ES2022, ESNext modules), `vitest.config.ts`
    - Add `infra/scribe` to the root `package.json` `workspaces` list (G7)
    - Add `infra/scribe/dist/` and `infra/.deploy/` to `.gitignore`; do not ignore `infra/stack.yaml`
    - Add test helpers in `infra/scribe/test/helpers/`: `FakeModel` (scripted text, retryable and fatal errors, records prompts), `MemoryCounterStore` (optional failure at the n-th call), fixed clock, stub `EarsPort`
    - Add Apache-2.0 notice headers to new files; no secret or account ID
    - Add a smoke test that the helpers behave as scripted (FakeModel order, store failure injection)
    - _Requirements: 18.1, 20.1, 20.2, 20.5, 20.6_

  - [ ] 1.2 Export each app lexicon as a subpath (G7)
    - Add `"exports": { "./lexicon": "./lexicon.ts" }` to `apps/stagger/package.json` and `apps/candy/package.json`, keeping existing fields
    - Ensure each `lexicon.ts` imports only types from `golem-spec` (no `app.ts`, no MuJoCo)
    - Add a test in `infra/scribe/test/` that resolves `stagger/lexicon` and `candy/lexicon` and that the lexicon source files contain no import other than `golem-spec`
    - _Requirements: 20.2_

  - [ ] 1.3 Make `golem-spec` tree-shakeable for the Lambda (G6a)
    - Set `"sideEffects": false` in `skeleton/package.json`
    - Add a test that reads `skeleton/package.json` and asserts the flag
    - _Requirements: 10.1, 20.2, 20.3_

- [ ] 2. Implement the ears seam and the lexicon catalogue (G1, G2, G3, G4)
  - Implement `ears-adapter.ts` with `EarsPort` (`compile`, `canonical`); `canonical` composes `tokenize`, `parse`, clears `ast.id`, then `format` (G1). Compile runs on the original line
  - Implement `catalogue.ts` (`get`, sorted `ids`) from `stagger/lexicon` and `candy/lexicon`
  - Add a local `stripPositions` test helper for AST equality (G3)
  - Add a contract test that reads `ACCEPTED_UNITS` through `golem-spec` when exported and checks each entry appears in `UNITS_FOR_PROMPT`; skip with a visible reason until it is exported, never weaken it (G2)
  - Add example tests for catalogue lookup and sorted ids, and a test that the adapter is the only `src` file importing `golem-spec`
  - Tests that need real compilation fail loudly, not skip, once the ears module exists
  - _Requirements: 9.3, 9.5, 20.2_

- [ ] 3. Implement the Prompt_Builder
  - [ ] 3.1 Implement `prompt.ts` with example tests
    - `buildPrompt`, `promptText`, `escapeBlock`, `unescapeBlock`, `UNITS_FOR_PROMPT`
    - Fixed system order: role and output rule, robot names, four patterns, unit rule, `Predicates` and `Perturbations` lists as `- <phrase>` in lexicon order, data rule; `<user_text>` and `<rejected_lines>` blocks escaped with `&amp;`, `&lt;`, `&gt;`
    - Examples: prompt lists every phrase of the real Stagger and Candy lexicons, the unit list, the delimiters, an escaped delimiter in Plain_Text, diagnostics in the repair prompt, no `<rejected_lines>` in round 1
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 18.2_

  - [ ] 3.2 Write property test for prompt determinism
    - **Property 5: Prompt determinism**
    - **Validates: Requirements 7.1, 7.11**

  - [ ] 3.3 Write property test for lexicon phrase presence
    - **Property 6: Every lexicon phrase appears exactly once**
    - **Validates: Requirements 7.2, 7.10**

  - [ ] 3.4 Write property test for secret and signal isolation
    - **Property 7: No secret, signal name or counter value in the prompt**
    - **Validates: Requirements 7.9**

  - [ ] 3.5 Write property test for untrusted text containment
    - **Property 8: Untrusted text stays inside its block**
    - **Validates: Requirements 7.6, 7.8**

  - [ ] 3.6 Write property test for the repair prompt
    - **Property 9: Repair prompt carries the diagnostics**
    - **Validates: Requirements 7.7**

- [ ] 4. Implement the Compile_Filter
  - [ ] 4.1 Implement `filter.ts` with example tests
    - `extractLines`, `compileFilter` (bare or single-fenced JSON, first 3 entries, trim, drop empty, over 400 characters, line breaks; `optional` pattern rejected with `PATTERN_MISMATCH`; duplicate dropped silently; `CanonicalFailed` defensive rejection)
    - Examples with the stub port and the real exports when available: valid line in Canonical_Text, `MISSING_UNIT` rejection, `WHERE` rejection, fenced JSON, non-JSON gives zero lines, duplicates dropped, 3-line cap
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.11, 18.4_

  - [ ] 4.2 Write property test for compile filter soundness
    - **Property 1: Compile filter soundness**
    - **Validates: Requirements 9.3, 9.4, 9.6, 9.12**

  - [ ] 4.3 Write property test for canonical text round trip
    - **Property 2: Canonical text round trip**
    - **Validates: Requirements 9.5, 9.13**

  - [ ] 4.4 Write property test for filter idempotence
    - **Property 3: Compile filter idempotence**
    - **Validates: Requirements 9.14**

  - [ ] 4.5 Write property test for filter bounds and extraction
    - **Property 4: Compile filter bounds and extraction rules**
    - **Validates: Requirements 9.1, 9.2, 9.7, 9.11**

- [ ] 5. Implement the Rate_Limiter
  - [ ] 5.1 Implement pure limiter functions and the counter stores with example tests
    - `limiter.ts`: `dayKey`, `ipKey`, `dayTtl`, `hourTtl`, `retryAfter`, `ipFromViewerAddress`, `ipHash` (HMAC-SHA-256 hex; literal `unknown` slot when no address)
    - `store.ts`: `CounterStore`, `DynamoCounterStore` (one conditional `UpdateItem` per increment, compensating decrement, `ConditionalCheckFailedException` returns false, other errors propagate), `MemoryCounterStore`
    - Examples: TTL values and bucket keys at hour and day boundaries, request shapes captured from a fake DynamoDB client
    - _Requirements: 13.1, 13.2, 13.3, 13.7, 13.11, 18.8_

  - [ ] 5.2 Write property test for bucket keys and TTLs
    - **Property 12: Bucket keys and TTLs**
    - **Validates: Requirements 13.3, 13.7**

  - [ ] 5.3 Write property test for Retry-After
    - **Property 13: Retry-After**
    - **Validates: Requirements 13.8**

  - [ ] 5.4 Write property test for IP hash and viewer-address parsing
    - **Property 14: IP hash and viewer-address parsing**
    - **Validates: Requirements 13.2, 13.14**

  - [ ] 5.5 Implement `admit` with example tests
    - IP counter first, then daily; compensating decrement on a daily refusal; best-effort decrement and rethrow on a store error at the daily step
    - Examples: refused `ip` leaves daily untouched, refused `daily` undoes the IP increment, store failure fails closed
    - _Requirements: 13.3, 13.4, 13.5, 13.6, 13.9, 13.10_

  - [ ] 5.6 Write property test for the limit invariant
    - **Property 10: Rate limiter limit invariant**
    - **Validates: Requirements 13.3, 13.4, 13.5, 13.6, 13.12**

  - [ ] 5.7 Write property test for unchanged counters on refusal or failure
    - **Property 11: A refused or failed call changes no counter**
    - **Validates: Requirements 13.5, 13.9, 13.10, 13.13**

- [ ] 6. Checkpoint - Pure modules
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement the Model_Client with failover
  - Implement `model.ts`: `ModelClient`, `classifyModelError`, `PRIMARY_MODEL`, `FALLBACK_MODEL`, `BedrockModelClient` (Converse, `maxTokens` 400, `temperature` 0.2, region `ap-southeast-2`, 8 s abort), `FailoverModel`, `ModelBudget` (at most 3 calls per Scribe_Call, one fallback per round, none after fatal)
  - Examples with a fake SDK client: request has profile id, region, `maxTokens <= 400`, `temperature <= 0.2`; retryable error calls the fallback once; `AccessDenied`, `Validation` and `ResourceNotFound` do not; error classes table
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 12.5_

- [ ] 8. Implement request and response edges
  - [ ] 8.1 Implement `response.ts` and `log.ts` with example tests
    - `ScribeResponse` shape, `toWireDiagnostic` (G5, drops `start` and `end`), `deriveStatus`, status to HTTP mapping, messages
    - Rate-limit messages start with `Hourly limit reached:` or `Daily limit reached:` and carry the limit and unit (G9); `logCall` emits exactly the allowed keys
    - Examples: each status mapping, `Retry-After`, no CORS headers on 204, wording has no spooky terms
    - _Requirements: 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 11.9, 13.8, 14.7, 17.2_

  - [ ] 8.2 Implement `origin.ts` and `http.ts` with example tests
    - `checkOrigin` (case-insensitive header, SHA-256 then `timingSafeEqual`, empty secret fails closed); header lookup, media-type parse, base64 body decode, result builders
    - Examples: missing, wrong and correct header, header-name casing, empty secret
    - _Requirements: 11.4, 11.5, 11.6, 11.8, 18.10_

  - [ ] 8.3 Implement `validate.ts` with example tests
    - `parseRequest`: exact keys `app` and `text`, known app, trim, length 1 to 400, control-character rule, whitespace collapse
    - Examples: boundaries at 0, 1, 400 and 401 characters, control characters, unknown app lists known ids
    - _Requirements: 6.1, 6.2, 6.3, 12.3, 12.4_

- [ ] 9. Implement the handler
  - [ ] 9.1 Implement `handler.ts` and `index.ts` with example tests
    - `handle(req, deps)` in the design's fixed order (origin, method, size, content type, parse, validate, admit, rounds, response, log); `runRounds` with repair merge and `rejected` selection; `index.ts` wires real clients, fails closed on empty secrets, wraps unexpected errors as 503
    - Examples: bad line then corrected line gives exactly 2 rounds with diagnostics in the second prompt and status `ok`; primary fails and fallback answers; both fail gives `unavailable` with at most 3 calls; `OPTIONS` gives 204; store failure gives 503 with no model call
    - _Requirements: 6.4, 6.10, 8.4, 8.7, 9.8, 9.9, 9.10, 11.9, 12.1, 13.9, 13.10, 18.6, 18.7_

  - [ ] 9.2 Write property test for origin check ordering
    - **Property 16: Origin check precedes everything and is exact**
    - **Validates: Requirements 6.4, 11.4, 11.5, 11.9**

  - [ ] 9.3 Write property test for input validation
    - **Property 15: Input validation answers 400 exactly when the input is invalid**
    - **Validates: Requirements 6.2, 6.3, 12.3, 12.4, 13.10**

  - [ ] 9.4 Write property test for content-type matching
    - **Property 22: Request content type is matched case-insensitively**
    - **Validates: Requirements 6.1**

  - [ ] 9.5 Write property test for response shape
    - **Property 17: Response shape and absence of verdict fields**
    - **Validates: Requirements 6.5, 6.8, 6.11, 6.12, 10.1**

  - [ ] 9.6 Write property test for status, lines and attempts
    - **Property 18: Status, lines and attempts are consistent with the outcome**
    - **Validates: Requirements 6.6, 6.7, 6.9, 9.8, 9.9, 9.10**

  - [ ] 9.7 Write property test for model call budget
    - **Property 19: Model call budget and failover**
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.7**

  - [ ] 9.8 Write property test for log contents
    - **Property 21: Logs contain only the allowed fields and no private data**
    - **Validates: Requirements 11.7, 17.1, 17.2**

- [ ] 10. Checkpoint - Scribe_Lambda logic
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement the Say_It_Plainly_Box in `golem-spec/ui`
  - [ ] 11.1 Implement the pure box modules with example tests
    - In `skeleton/src/ui/scribe/`: `messages.ts` (exact strings of Requirement 14 and 15.3), `classify.ts` (`classify`, `isScribeResponse`, `scopeFromMessage`), `phrases.ts` (`phraseList`), `client.ts` (same-origin check, `fetch` with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`, 12 s timer, abort previous on resubmit and unmount)
    - Examples: each message string, minutes `max(1, ceil(retryAfter / 60))`, 404, 405, 503 and Lambda-own 429 give `unreachable`, cross-origin or empty endpoint gives `disabled`
    - _Requirements: 12.6, 14.1, 14.2, 14.3, 14.4, 15.1, 15.2, 15.3, 15.4, 15.6_

  - [ ] 11.2 Write property test for total box classification
    - **Property 28: The box state is total and degraded states always show the phrase list**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 15.2, 15.3, 16.6**

  - [ ] 11.3 Implement `SayItPlainly.tsx` with component tests
    - React 18 only; props per the design; no request on mount or typing; submit disabled while running or when trimmed input is empty or over 400; `<n> / 400` counter; drafts (max 3, "Proposed by a model", "Add to tablet", "Dismiss"); collapsed "Not used" section with messages and suggestions, no add control; `none` message and phrase list; Plain_Text kept after response and never stored; privacy sentence next to submit; Live_Region `announce`; keyboard operable; tokens and Reduced_Motion per `design-language.md`
    - Component tests with a fake `fetch` and fake timers: each Requirement 14 message, degraded on network error, 404, malformed JSON and 12 s timeout, phrase list in every degraded case, no request at mount or typing, leave degraded on the next success without auto-retry
    - _Requirements: 10.2, 10.3, 14.4, 14.5, 14.6, 15.2, 15.4, 15.5, 15.7, 15.8, 15.9, 16.1, 16.2, 16.5, 16.6, 16.7, 16.8, 17.4, 18.12, 20.7_

  - [ ] 11.4 Export the box and bridge it to the Studio Tablet (G8)
    - Export `SayItPlainly` and its types from `skeleton/src/ui/index.ts` (`golem-spec/ui`)
    - Provide the callbacks `onAddDraft(text)`, `onInsertPhrase(phrase)` and `announce(message)` through a narrow bridge type, adapted to the Tablet API of `golem-studio-ui` as it exists; if that API is absent, define the bridge interface in `scribe/bridge.ts` and test it with a fake Tablet
    - `onAddDraft` compiles locally with the browser ears compiler, appends a line with a new ID and status `untested`, shows local error Diagnostics on the line, runs no trial, and writes nothing to `requirements.md`; `onInsertPhrase` adds an editable line with missing quantities and no number filled in
    - Tests with a fake Tablet: draft status is `untested`, local compile result is used and not the response, no trial starts, no file write
    - _Requirements: 10.4, 10.5, 10.6, 10.7, 14.5, 16.3, 16.4_

  - [ ] 11.5 Write property test and contract test for rate-limit scope encoding (G9)
    - **Property 20: Rate-limited messages name exactly one scope**
    - Contract test in `infra/scribe/test/` imports `scopeFromMessage` from `golem-spec/ui` and ties it to the Lambda's message builder for both scopes
    - **Validates: Requirements 13.8, 14.7, 14.8**

- [ ] 12. Bundle the Lambda and prove isolation (G6b, G6c)
  - Add `infra/scribe/build.mjs`: esbuild bundle to `infra/scribe/dist/index.mjs`, node20, ESM, `createRequire` banner, `external` for `@mujoco/mujoco`, `three`, `react`, `react-dom`
  - Add a post-build test: the file exists, contains none of `mujoco`, `falsify` or `TrialPool`, is under 6 MB, and exports `handler`
  - If tree-shaking cannot meet this, record the fallback (an additive `golem-spec/ears` subpath, owned by `golem-kit`) in `infra/README.md` and stop for the user; do not weaken the test
  - _Requirements: 10.1, 20.2, 20.3_

- [ ] 13. Checkpoint - Studio box and bundle
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Define the CloudFormation stack
  - [ ] 14.1 Write `infra/stack.yaml`
    - Resources per the design Data Models table: private encrypted bucket, bucket policy limited to the distribution `SourceArn`, OAC, directory-index CloudFront Function, cache policy, API origin request policy, security headers policy (CSP, COOP, COEP, HSTS without `preload`, nosniff, referrer, frame), distribution with the `/api/*` behaviour and 403/404 mapped to `/404.html` with 404, counter table with TTL on `ttl`, log group with 14 days, role with the four allowed statements, function (Node 20, 512 MB, 25 s, concurrency 3, inline stub), Function URL and both permissions
    - Parameters `OriginSecret` and `IpSalt` (NoEcho, MinLength 32); outputs `DistributionDomain`, `DistributionId`, `SiteBucketName`, `SiteUrl`, Function URL
    - No custom domain, certificate, WAF, Lambda@Edge, billing, log bucket or Bedrock invocation logging
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.4, 4.5, 4.6, 11.1, 11.2, 11.3, 11.8, 12.1, 12.2, 12.7, 12.8, 13.1, 17.3, 17.5, 17.6_

  - [ ] 14.2 Implement the invariant checker and stack example tests
    - `infra/scribe/test/stack.test.ts` parses `stack.yaml` with the `yaml` package and custom tags (`!Ref`, `!Sub`, `!GetAtt`, `!Join`, `!Select`, `!Split`, `!If`, `!Equals`); shared `checkInvariants(template)` returns violations
    - Examples for Requirements 1.2, 1.4, 1.5, 1.6, 1.8, 2.4, 2.5, 2.6, 3.4, 3.7, 4.1, 11.1, 11.2, 11.3, 11.8, 12.2, 12.8, and that the unmutated template has no violations
    - _Requirements: 18.14, 1.1, 1.3, 1.7, 3.1, 3.2, 3.3, 3.5, 3.6, 4.4, 4.5, 12.1, 13.1, 17.5_

  - [ ] 14.3 Write property test for template invariants
    - **Property 27: Stack template invariants hold, and the checker catches each violation**
    - **Validates: Requirements 1.1, 1.3, 1.7, 3.1, 3.2, 3.3, 3.5, 3.6, 4.4, 4.5, 12.1, 13.1, 17.5**

- [ ] 15. Implement deploy and smoke tooling (Python, boto3 imported lazily)
  - [ ] 15.1 Implement the pure functions of `infra/deploy.py` with unit tests
    - `content_type_for` (explicit table, lower-cased extension, unknown gives `application/octet-stream` with a warning naming the file), `is_hashed_asset`, `cache_control_for`, `sha256_hex`, `plan_uploads` (`LocalFile`, `RemoteObject`, `Plan`), `invalidation_paths`, `zip_lambda` (fixed timestamps and permissions), `lambda_code_sha256`
    - `infra/tests/test_deploy_logic.py` with `unittest`, importing no `boto3`: each table entry of Requirement 5.7, `.WASM` equals `.wasm`, no-extension case, `lambda_code_sha256` stable across runs
    - _Requirements: 2.1, 2.2, 2.3, 5.1, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.14, 5.15, 5.16, 18.13_

  - [ ] 15.2 Write property test for Content-Type lookup
    - **Property 23: Content-Type lookup depends only on the lower-cased extension**
    - File `infra/tests/test_content_type_property.py`, fixed seed, 200 cases
    - **Validates: Requirements 5.7, 5.8, 5.15**

  - [ ] 15.3 Write property test for Cache-Control choice
    - **Property 24: Cache-Control choice by object class**
    - File `infra/tests/test_cache_control_property.py`, fixed seed, 200 cases
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ] 15.4 Write property test for upload plan idempotence and ordering
    - **Property 25: Upload plan idempotence and ordering**
    - File `infra/tests/test_upload_plan_property.py`, fixed seed, 200 cases
    - **Validates: Requirements 5.9, 5.10, 5.16**

  - [ ] 15.5 Write property test for invalidation paths
    - **Property 26: Invalidation paths cover changed HTML and nothing else**
    - File `infra/tests/test_invalidation_property.py`, fixed seed, 200 cases
    - **Validates: Requirements 5.11**

  - [ ] 15.6 Implement the boto3 orchestration of `deploy.py` with stubbed-client tests
    - Options `--stack-name` (default `golem-cloud`), `--dist` (default `site/dist`), `--dry-run`; every client created with `region_name='ap-southeast-2'`
    - `check_identity` (STS first; one line and non-zero exit before any change), `create_or_update_stack` (create, or change set; `UsePreviousValue` for `OriginSecret` and `IpSalt`; secrets from `secrets.token_urlsafe(32)` on creation only; no-change is success), `wait_and_report_events`, `ship_lambda` (missing bundle names the file; `CodeSha256` check), `sync_site` (non-HTML first, deletes only after all uploads succeed, `sha256` user metadata), `invalidate` (changed HTML only), `print_urls`
    - Tests with a stub client factory that raises on any mutating call under `--dry-run`, the credentials-missing message, region pinned, secrets absent from output, missing bundle message
    - _Requirements: 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 18.13_

  - [ ] 15.7 Implement `infra/smoke.py` with unit tests for its pure parts
    - Standard library and boto3 only; `--url` or `SiteUrl` output read in `ap-southeast-2`; exactly one `POST` of the fixed body; `--headers` check of Requirements 3.1, 3.2, 3.3 and 3.6; `--direct` sends one request without `x-golem-origin` and exits 0 only on HTTP 403; at most 2 requests per run; exit codes 0, 1, 3; prints no secret
    - Unit tests for arg parsing, exit-code mapping, header comparison and the request count, with a stubbed transport; no live call
    - _Requirements: 3.9, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_

- [ ] 16. Document and wire the test scripts
  - Add `infra/README.md`: deploy and smoke commands, exit codes 0, 1 and 3, region restriction, Python only for deploy tooling, that deploy and smoke are not run in CI
  - Add root and package scripts to run the `infra/scribe` Vitest suite and `python -m unittest discover infra/tests`; confirm no CI configuration invokes `smoke.py` or `deploy.py`
  - Add a test that `.gitignore` lists `infra/scribe/dist/` and `infra/.deploy/` and not `infra/stack.yaml`, and that `infra/` files contain no account ID or credential pattern
  - _Requirements: 5.1, 19.7, 20.1, 20.5, 20.6_

- [ ] 17. Final checkpoint - Everything green offline
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Manual: deploy to AWS and run the smoke check (not run by an agent or CI)
  - The maintainer builds the site, then runs `npm run build` in `infra/scribe`
  - Run `python infra/deploy.py --dry-run`, review the plan, then `python infra/deploy.py` with `ap-southeast-2` credentials
  - Run `python infra/smoke.py` (one live call, expect exit 0), then `python infra/smoke.py --direct` (expect 403) and `python infra/smoke.py --headers`
  - If Bedrock answers `AccessDenied` on some calls, check the organisation policy for every Region in the `apac` profile set
  - _Requirements: 5.2, 5.13, 19.2, 19.3, 19.5_

## Notes

- Deploy and smoke are never run in CI. Task 18 is manual.
- G1 to G9 map to tasks: G1, G2, G3 to task 2; G4 and G5 to tasks 2 and 8.1; G6 to tasks 1.3 and 12; G7 to tasks 1.1 and 1.2; G8 to task 11.4; G9 to tasks 8.1 and 11.5.
- Each checkpoint also covers the tasks above it.
- Each property has its own sub-task and test file, so tasks in one wave never write the same file.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2", "5.1"] },
    { "id": 2, "tasks": ["3.1", "4.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6", "4.2", "4.3", "4.4", "4.5", "5.6", "5.7"] },
    { "id": 4, "tasks": ["6"] },
    { "id": 5, "tasks": ["7", "8.1", "8.2", "8.3"] },
    { "id": 6, "tasks": ["9.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8"] },
    { "id": 8, "tasks": ["10"] },
    { "id": 9, "tasks": ["11.1", "12"] },
    { "id": 10, "tasks": ["11.2", "11.3"] },
    { "id": 11, "tasks": ["11.4"] },
    { "id": 12, "tasks": ["11.5"] },
    { "id": 13, "tasks": ["13"] },
    { "id": 14, "tasks": ["14.1", "15.1", "15.7"] },
    { "id": 15, "tasks": ["14.2", "15.2", "15.3", "15.4", "15.5", "15.6"] },
    { "id": 16, "tasks": ["14.3", "16"] },
    { "id": 17, "tasks": ["17"] },
    { "id": 18, "tasks": ["18"] }
  ]
}
```
