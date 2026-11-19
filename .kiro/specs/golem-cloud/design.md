# Design Document

## Overview

`golem-cloud` has two parts that share one CloudFront distribution.

1. **Hosting.** `infra/stack.yaml` defines a private S3 bucket, a CloudFront distribution (Origin Access Control, security headers, cache policies), a DynamoDB counter table and one Lambda function. `infra/deploy.py` (boto3 only) creates or updates the stack, ships the Lambda zip, uploads `site/dist` with explicit Content-Type and Cache-Control, deletes stale objects and invalidates changed HTML.
2. **Scribe API.** `infra/scribe/` is a TypeScript package that bundles to `infra/scribe/dist/index.mjs`. The handler answers `POST /api/scribe`. It validates the request, checks the origin secret, charges two counters, builds a prompt from the app's lexicon, calls Amazon Bedrock (Converse API), compiles every proposed line with the `golem-ears` compiler, optionally repairs once, and returns only lines that compile. The studio's "Say it plainly" box (`skeleton/src/ui/scribe/`, exported from `golem-spec/ui`) displays the lines as drafts.

The model proposes text and nothing else. No verdict, robustness value or counterexample passes through the Lambda (`product.md`). The static site works without the API.

### Design decisions

| Decision | Rationale |
|---|---|
| One seam to `golem-ears`: `ears-adapter.ts` is the only file in `infra/scribe/src` that imports `golem-spec`. It exposes a two-method `EarsPort`. | The ears module is not yet implemented (`skeleton/src/ears/index.ts` is `export {}`). A port lets the filter, prompt and handler be written and tested against a stub, and lets the real compiler replace it with no other change. It also keeps one place where the API gaps below are bridged. |
| Handler is `handle(request, deps)`, a pure-ish function over injected `ModelClient`, `CounterStore`, `clock` and `env`. `index.ts` only wires real AWS clients and exports `handler`. | Requirements 8.8, 18.1 and 20.4 need fakes and a fixed clock. No `Math.random()` anywhere in the Lambda. |
| Bedrock **Converse** API with `system` (lexicon and rules) and `user` (the Plain_Text block) messages. | One request shape for Nova Lite and Micro, instruction and data are separate message roles, and `maxTokens` and `temperature` live in `inferenceConfig`. Converse is authorised by the `bedrock:InvokeModel` action, so the IAM surface stays what Requirement 4.5 states. |
| Rate limiter checks the **IP counter first**, then the daily counter, and compensates any increment it made if a later step refuses. | Matches Requirement 13.6. The tested invariant is stronger than 13.5: a refused call leaves both counters as it found them. |
| Lambda code is not part of the CloudFormation template. The stack creates the function with a tiny inline stub, and `deploy.py` calls `lambda:UpdateFunctionCode` with the zip. | `Code.ZipFile` is limited to 4 KB, and an S3 code bucket would need a second bucket that exists before the stack does. Putting the zip in the Site_Bucket would publish it through CloudFront. A SHA-256 check (`CodeSha256`) makes the update idempotent. |
| `/api/*` is a second CloudFront behaviour with `CachingDisabled`, a custom origin request policy (`CloudFront-Viewer-Address`, `Content-Type`, no cookies, no query), the same Response_Headers_Policy as the site, and `AllowedMethods` of all seven methods. | Requirements 2.6, 3.7, 11.2, 11.3, 12.7. |
| Directory indexes use a CloudFront Function (viewer-request, `cloudfront-js-2.0`) on the static behaviour only. | `DefaultRootObject` covers only `/`. Requirement 1.5 needs `/stagger/` to serve `/stagger/index.html`. CloudFront Functions are not Lambda@Edge, so Requirement 1.7 holds. |
| 404 handling maps S3 403 and 404 to `/404.html` with status 404 (`CustomErrorResponses`, `ErrorCachingMinTTL: 0`). | With OAC and `s3:GetObject` only (Requirement 1.3), S3 answers 403 for a missing key. Granting `s3:ListBucket` would turn that into 404, but Requirement 1.3 grants `GetObject` only, so the template maps both codes. The mapping is distribution-wide, so a 403 or 404 from the Lambda on `/api/*` would also be rewritten. Through CloudFront the Lambda never answers either (the origin header is always right and the path is fixed), and the box treats an unexpected 404 as degraded anyway. |
| The Python deploy logic lives in `deploy.py` itself as module-level pure functions. `boto3` is imported inside functions that need it. | Requirements 5.14 and 18.13. `unittest` imports the module without boto3 or credentials. |
| `Math.random`-free property tests, fixed seeds recorded on failure (fast-check `seed` printed by default). | `testing.md`. |

### Open point from the requirements: the real `golem-ears` API

`skeleton/src/ears/index.ts` is currently `export {};` and `skeleton/src/index.ts` re-exports it (`export * from './ears/index.js'`). The names below are therefore taken from `.kiro/specs/golem-ears/design.md` ("File layout" and "Components and Interfaces"), not from code. They are pinned here and treated as the contract.

| Need in golem-cloud | Pinned name (from `golem-spec`) | Signature (type level) | Status |
|---|---|---|---|
| Compile a line against a lexicon | `compileRequirement` | `(line: string, lexicon: Lexicon, options?: CompileOptions) => { requirement?: CompiledRequirement; diagnostics: Diagnostic[] }` | In the stated public export list. |
| Tokenize | `tokenize` | `(input: string) => { tokens: Token[]; diagnostics: Diagnostic[] }` | In the public export list. |
| Parse to AST | `parse` | `(tokens: readonly Token[], robotNames: readonly string[]) => { ast?: ParsedRequirement; diagnostics: Diagnostic[] }` | In the public export list. |
| Print canonical text | `format` | `(ast: ParsedRequirement) => string` (throws on an invalid `pattern`) | In the public export list. |
| Diagnostic type | `Diagnostic`, `DiagnosticKind` | `{ kind; severity: 'error' \| 'warning'; message; line; column; start; end; suggestion? }` | Listed as exported "types". |
| Kinds used here | `PATTERN_MISMATCH`, `MISSING_UNIT`, `UNKNOWN_PHRASE`, `BAD_RANGE`, `UNKNOWN_ROBOT`, `NON_EARS_LINE` | closed set | Requirement 9.6 reuses `PATTERN_MISMATCH`; no new kind is needed. |

Gaps, each stated as an assumption this design depends on:

- **G1. No single call returns canonical text.** `compileRequirement` returns a `CompiledRequirement`, not the AST. The adapter composes `tokenize`, `parse` and `format`, with `ast.id` cleared (Requirement 9.3 says no requirement ID). Compile runs on the original line, so diagnostics are the compiler's own.
- **G2. `ACCEPTED_UNITS` is in `units.ts` but not in the stated public export list.** The prompt's unit list is a constant in `prompt.ts` (Requirement 7.3 spells it out). A contract test reads `ACCEPTED_UNITS` through `golem-spec` when it is exported and checks that every entry appears in the prompt. Until it is exported the test is skipped with a visible reason, never weakened.
- **G3. `stripOffsets` is not in the stated public export list.** The round-trip property uses a local `stripPositions` helper in the test (deep copy without `start`, `end`, `line`, `column`, `span`; keywords upper-cased).
- **G4. `Lexicon.episodeSeconds?: number`** is an additive field that golem-ears adds. golem-cloud neither reads nor sets it.
- **G5. `Diagnostic.start` and `Diagnostic.end`** are not part of the Scribe_Response (Requirement 6.8 lists `kind`, `severity`, `message`, `line`, `column`, `suggestion`). The serialiser picks fields explicitly.
- **G6. Bundle isolation.** `golem-spec`'s root entry re-exports `sim`, `falsify` and `pool`, which reach `@mujoco/mujoco`. Requirement 10.1 forbids the Lambda from importing them, and the tech rule forbids deep imports. This design requires (a) `"sideEffects": false` in `skeleton/package.json` so esbuild can tree-shake the unused re-exports, (b) `@mujoco/mujoco`, `three`, `react` and `react-dom` marked `external` in the esbuild call so that an accidental reach fails at load, and (c) a post-build test that the bundle contains none of the strings `mujoco`, `falsify` or `TrialPool`. If (a) cannot hold, the fallback is an additive public subpath `golem-spec/ears` (a change to `golem-kit`, listed as the fix in Error Handling).
- **G7. Lexicon access.** `apps/stagger/lexicon.ts` and `apps/candy/lexicon.ts` are currently empty modules, and the app `package.json` files declare no `exports`. This design assumes each app adds `"exports": { "./lexicon": "./lexicon.ts" }` and that `lexicon.ts` imports only `golem-spec` types (so it does not drag in MuJoCo or `app.ts`). `infra/scribe` then imports `stagger/lexicon` and `candy/lexicon` as workspace dependencies. The root `package.json` `workspaces` list gains `infra/scribe`.
- **G8. Studio wiring.** `golem-studio-ui` is not changed beyond mounting the box. The box takes callbacks `onAddDraft(text)` and `onInsertPhrase(phrase)`; the Studio supplies them from its Tablet. Their exact Tablet API is the studio's design and is assumed to exist.
- **G9. Rate-limit scope has no field.** Requirement 6.5 fixes the response shape (no `scope`), Requirement 6.12 forbids other fields, and Requirement 14.1 and 14.2 need the box to tell `ip` from `daily`. The design encodes the scope in the first words of `message` (`Hourly limit reached:` and `Daily limit reached:`). The box classifies by these prefixes. A contract test ties the Lambda's message builder to the box's classifier. A cleaner fix is an additive `scope` field in the requirements; that needs a requirements change and is not made here.

### Research summary

- Bedrock geographic inference profiles such as `apac.*` let Bedrock pick a commercial Region inside the APAC geography to process a request, and requests stay inside that geography ([Geographic cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html), [Cross-Region inference overview](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html)). Content was rephrased for compliance with licensing restrictions.
- A cross-Region profile is authorised against the profile ARN in the calling Region and against the foundation-model ARN in each Region the profile can route to, and an AccessDenied appears when the role or an SCP does not allow the destination Region ([AccessDenied troubleshooting](https://repost.aws/knowledge-center/bedrock-access-denied-exception)).
- A Function URL with auth type `NONE` is reachable only when the function's resource policy grants public access; for new function URLs AWS now documents that both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` are needed ([Control access to Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)). The stack therefore defines two `AWS::Lambda::Permission` resources.
- CloudFront Functions can rewrite the request URI at viewer-request, which is the standard way to serve `index.html` for directory paths on an S3 origin behind OAC.

## Architecture

### Deployment topology

```mermaid
flowchart LR
    V["Visitor browser"] -->|"GET /, /stagger/, assets"| CF["CloudFront Distribution<br/>Response_Headers_Policy"]
    V -->|"POST /api/scribe"| CF
    CF -->|"default behaviour<br/>OAC sigv4, viewer-request Function"| S3[("Site_Bucket<br/>private")]
    CF -->|"/api/* behaviour<br/>x-golem-origin, CloudFront-Viewer-Address"| FU["Function URL<br/>auth NONE"]
    FU --> L["Scribe_Lambda<br/>Node 20, 512 MB, concurrency 3"]
    L -->|"UpdateItem"| DDB[("Counter_Table<br/>TTL on ttl")]
    L -->|"Converse<br/>apac.amazon.nova-lite-v1:0<br/>fallback nova-micro"| BR["Bedrock Runtime<br/>ap-southeast-2<br/>may route within APAC"]
    D["deploy.py (boto3)"] -.->|"CreateStack / ChangeSet"| CFN["CloudFormation"]
    D -.->|"UpdateFunctionCode"| L
    D -.->|"PutObject, Delete"| S3
    D -.->|"CreateInvalidation"| CF
    SM["smoke.py"] -.->|"1 POST, optional 1 direct"| CF
```

### Scribe call, in order

```mermaid
sequenceDiagram
    participant B as Browser box
    participant CF as CloudFront
    participant H as handle()
    participant R as Rate_Limiter
    participant M as Model_Client
    participant F as Compile_Filter
    B->>CF: POST /api/scribe {app,text}
    CF->>H: request + x-golem-origin + CloudFront-Viewer-Address
    H->>H: 1 origin check (constant time)
    H->>H: 2 method, 3 size, 4 content-type, 5 parse, 6 validate
    H->>R: 7 admit(ipHash, now)
    R-->>H: ok / refused(scope) / store error
    H->>M: 8 round 1 prompt
    M-->>H: text, modelId
    H->>F: compileFilter(text, app)
    F-->>H: accepted, rejected
    opt rejected and fewer than 3 accepted and budget left
        H->>M: 9 repair prompt with diagnostics
        M-->>H: text
        H->>F: compileFilter(text, app)
    end
    H-->>CF: Scribe_Response + log line
    CF-->>B: JSON, no-store, security headers
```

Steps 1 to 6 charge nothing and call nothing. A request that fails any of them never reaches the counter table (Requirement 13.10).

### Module layout

```
infra/
  stack.yaml
  deploy.py            pure functions + main(); boto3 imported lazily
  smoke.py
  README.md
  tests/               Python unittest (test_deploy_logic.py)
  scribe/
    package.json       name golem-scribe, private; devDeps: esbuild, vitest, fast-check, yaml
    tsconfig.json      strict, ES2022, module ESNext
    build.mjs          esbuild: bundle, node20, esm, banner createRequire, externals per G6
    src/
      index.ts         wiring: real clients, `export const handler`
      handler.ts       handle(request, deps) -> HttpResult
      http.ts          header lookup, media-type parse, body decode, result builders
      validate.ts      parseRequest(body) -> Parsed | BadRequest
      origin.ts        checkOrigin(headers, secret)
      limiter.ts       pure: keys, ttl, retryAfter, ipFromViewerAddress, ipHash; admit(store, ...)
      store.ts         CounterStore interface, DynamoCounterStore, MemoryCounterStore (test helper)
      prompt.ts        buildPrompt (pure), escapeBlock, constants
      model.ts         ModelClient interface, BedrockModelClient, error classification, FailoverModel
      filter.ts        compileFilter (pure)
      ears-adapter.ts  EarsPort over golem-spec (only importer of golem-spec)
      catalogue.ts     LexiconCatalogue: { stagger, candy }
      response.ts      buildResponse, status derivation, messages, shape serialiser
      log.ts           logCall(fields) -> one JSON line
    test/              Vitest + fast-check, fakes, generators
skeleton/src/ui/scribe/   (React 18 only; exported from golem-spec/ui)
  SayItPlainly.tsx, client.ts, classify.ts, phrases.ts, messages.ts
```

## Components and Interfaces

All code below is signatures only. Cross-module shapes (`Lexicon`, `PredicateTemplate`, `PerturbationTemplate`, `CompiledRequirement`) are used unchanged from `interfaces.md`.

### Contract types (`response.ts`)

```ts
type ScribeStatus = 'ok' | 'partial' | 'none' | 'rate_limited' | 'unavailable' | 'bad_request';
interface ScribeRequest { app: string; text: string }
interface WireDiagnostic { kind: string; severity: 'error' | 'warning'; message: string;
                           line: number; column: number; suggestion?: string }
interface ScribeResponse {
  status: ScribeStatus; message: string;
  lines: { text: string; pattern: string }[];                  // <= 3
  rejected: { text: string; diagnostics: WireDiagnostic[] }[];
  model: string | null; attempts: 0 | 1 | 2;
}
interface HttpResult { statusCode: number; headers: Record<string, string>; body: string }
declare function toWireDiagnostic(d: Diagnostic): WireDiagnostic;     // picks fields, drops start/end
declare function deriveStatus(accepted: number, rejected: number): 'ok' | 'partial' | 'none';
```

`deriveStatus`: `accepted = 0` gives `none`; `accepted > 0 and rejected = 0` gives `ok`; otherwise `partial`.

HTTP mapping: `ok`, `partial`, `none` give 200. `bad_request` gives 400, except 413 (too large) and 405 (method), which also carry `status: "bad_request"`. `rate_limited` gives 429 with `Retry-After`. `unavailable` gives 503. A bad origin gives 403 with body `{}` and is not a Scribe_Response. Every result carries `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`. `OPTIONS` gives 204 with an empty body and the same two headers, and no CORS headers.

Messages (product voice, units, no spooky wording): `Hourly limit reached: 20 scribe requests per address per hour. Try again in <n> min.`, `Daily limit reached: 600 scribe requests per UTC day. It resets at 00:00 UTC.`, `The model could not be reached.`, `The scribe is unavailable.`, `<n> line(s) proposed.`, `No line could be built from that text.`, and for bad input, one sentence that names the limit (`Text must be 1 to 400 characters.`).

### Handler (`handler.ts`)

```ts
interface Deps {
  env: { originSecret: string; ipSalt: string };
  now(): number;                          // epoch ms, injected
  store: CounterStore;
  model: ModelClient;
  catalogue: LexiconCatalogue;
  ears: EarsPort;
  log(line: string): void;
}
interface HttpRequest { method: string; headers: Record<string, string>; body: string | undefined; isBase64Encoded: boolean }
declare function handle(req: HttpRequest, deps: Deps): Promise<HttpResult>;
```

Order of steps in `handle`, each short-circuiting. A step never runs after a step that rejects:

1. `checkOrigin`: missing or wrong `x-golem-origin` gives 403 `{}`. The body is not read.
2. `OPTIONS` gives 204. Any method other than `POST` gives 405.
3. Decoded body length in bytes above 2048 gives 413.
4. Media type of `content-type` (case-insensitive, parameters ignored) must be `application/json`. Otherwise 400.
5. Parse JSON. It must be an object with exactly the keys `app` and `text`, both strings. Otherwise 400.
6. `app` must be in the catalogue (400 with the known ids listed). `text` is trimmed, then rejected when empty, longer than 400 UTF-16 code units, or containing a control character other than space, tab, line feed or carriage return. Otherwise whitespace runs collapse to one space.
7. `admit`. Refused gives 429. A store error gives 503, no model call.
8. Rounds (below), then build the response, then log one line.

Whether a control character is "disallowed" is decided on the trimmed text before collapsing. Line breaks are allowed in input and removed by the collapse.

### Origin check (`origin.ts`)

```ts
declare function checkOrigin(headers: Record<string, string>, secret: string): boolean;
```

Header lookup is case-insensitive. Both values are hashed with SHA-256 and compared with `crypto.timingSafeEqual`, so length differences do not leak and the comparison is constant time. An empty `secret` in the environment fails closed (always false).

### Rate limiter (`limiter.ts`, `store.ts`)

Pure functions (no client):

```ts
declare function dayKey(nowMs: number): string;                // 'day#YYYYMMDD' (UTC)
declare function ipKey(ipHash: string, nowMs: number): string; // 'ip#<hash>#YYYYMMDDHH' (UTC)
declare function dayTtl(nowMs: number): number;                // start of UTC day + 48 h, Unix seconds
declare function hourTtl(nowMs: number): number;               // start of UTC hour + 2 h, Unix seconds
declare function retryAfter(scope: 'ip' | 'daily', nowMs: number): number; // whole seconds to next boundary, >= 1
declare function ipFromViewerAddress(header: string | undefined): string | undefined;
declare function ipHash(ip: string, salt: string): string;     // HMAC-SHA-256 hex
```

`ipFromViewerAddress`: take the part after the last comma, trim, strip the port (`[v6]:port` form: text between the brackets; otherwise, when there is more than one colon or exactly one colon, drop the text after the last colon). Return `undefined` for an empty result. When undefined, `ipHash` is not called and the hash slot is the literal `unknown`, so the key is `ip#unknown#YYYYMMDDHH`. All requests without a usable address share that hourly bucket of 20. This is the reading of Requirement 13.2's "key `ip#unknown`" that keeps the bucket bounded by the hour.

Store port:

```ts
interface CounterStore {
  tryIncrement(pk: string, limit: number, ttl: number): Promise<boolean>; // false only when count >= limit
  decrement(pk: string): Promise<void>;                                   // never below 0
}
```

`DynamoCounterStore.tryIncrement` is one `UpdateItem` with `UpdateExpression: 'SET #ttl = :ttl ADD #count :one'` and `ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit'`. A `ConditionalCheckFailedException` returns `false`; any other error propagates. `decrement` is `ADD #count :minusOne` with `ConditionExpression: '#count > :zero'`, and a failed condition is ignored. Both need only `dynamodb:UpdateItem`.

Admission:

```ts
type Admission = { ok: true } | { ok: false; scope: 'ip' | 'daily' };
declare function admit(store: CounterStore, ipHashOrUnknown: string, nowMs: number): Promise<Admission>;
```

```
a = tryIncrement(ipKey, 20, hourTtl)        // false -> refuse 'ip', daily untouched
b = tryIncrement(dayKey, 600, dayTtl)       // false -> decrement(ipKey), refuse 'daily'
store error at b -> best-effort decrement(ipKey), rethrow (handler answers 503)
```

Because the IP counter is charged first, an IP that is over its hourly limit never increments the daily counter. The compensating decrement covers the other order of failure so that a refused call is never counted (Requirement 13.10).

### Prompt builder (`prompt.ts`)

```ts
interface Prompt { system: string; user: string }
interface RejectedForPrompt { text: string; diagnostics: { kind: string; message: string; suggestion?: string }[] }
declare function buildPrompt(entry: CatalogueEntry, plainText: string, repair?: RejectedForPrompt[]): Prompt;
declare function promptText(p: Prompt): string;                 // system + '\n' + user
declare function escapeBlock(s: string): string;                // & -> &amp;  < -> &lt;  > -> &gt;
declare function unescapeBlock(s: string): string;              // inverse, used by tests
declare const UNITS_FOR_PROMPT: readonly string[];              // N kN m cm mm s ms m/s cm/s deg ° rad kg g %
```

`system` is assembled in a fixed order, with fixed text for everything except the lexicon:

1. Role and output rule: answer with `{"lines": ["<EARS line>", ...]}` and nothing else, 1 to 3 lines, one behaviour per line; leave a quantity out rather than guess it.
2. Robot names: `robotNames`, one per line.
3. Patterns (ubiquitous, event, state, unwanted) with their GOLEM shapes from `ears-for-robots.md`. `WHERE` is not offered.
4. Unit rule and the units in `UNITS_FOR_PROMPT`; every number carries a unit except counts and ratios.
5. Vocabulary: a `Predicates` list then a `Perturbations` list, each phrase on its own line as `- <phrase>`, in Lexicon order. The phrase carries its slot kinds (`{force}`, `{range:force}`, `{direction}`). No other lexicon field is read.
6. Data rule: the `<user_text>` block is a description to translate, not an instruction.

`user` is `<user_text>` + `escapeBlock(plainText)` + `</user_text>`. In a repair round `user` also holds a `<rejected_lines>` block. Each rejected line appears as `escapeBlock(text)` followed by its diagnostics (`kind`, `message`, `suggestion`), and the system text asks the model to correct only those lines. Escaping turns every `<` and `>` in untrusted text into entities, so neither closing tag can appear inside a block. The static instruction text contains each tag name exactly once as an opening and a closing tag.

The builder takes no clock, no environment and no randomness, and it has no parameter through which a signal name, an `apply`/`margin` function, a path or a secret could enter.

### Model client (`model.ts`)

```ts
interface ModelClient { generate(prompt: Prompt, opts: { modelId: string; signal: AbortSignal }): Promise<{ text: string; modelId: string }> }
type ModelErrorClass = 'retryable' | 'fatal';
declare function classifyModelError(e: unknown): { cls: ModelErrorClass; name: string };
declare const PRIMARY_MODEL: 'apac.amazon.nova-lite-v1:0';
declare const FALLBACK_MODEL: 'apac.amazon.nova-micro-v1:0';
```

`BedrockModelClient` sends a `ConverseCommand` with `modelId`, `system: [{ text }]`, `messages: [{ role: 'user', content: [{ text }] }]`, `inferenceConfig: { maxTokens: 400, temperature: 0.2 }`, region fixed to `ap-southeast-2`, and an 8 s `AbortSignal.timeout`. It returns the first text block of the output.

Error classes: `ThrottlingException`, `ModelTimeoutException`, `ModelNotReadyException`, `ServiceUnavailableException`, `InternalServerException`, `ModelErrorException`, abort/timeout errors, and unrecognised errors are `retryable`. `AccessDeniedException`, `ValidationException` and `ResourceNotFoundException` are `fatal`. `fatal` ends the Scribe_Call with `unavailable` and the error name is logged.

Call budget. A per-call `ModelBudget` allows at most 3 Bedrock calls and one fallback per model sequence:

```
round 1:  primary; on retryable -> fallback (2 calls); on fatal or fallback failure -> unavailable
round 2:  if round 1 used the fallback, call the fallback only (no further fallback)
          else primary; on retryable -> fallback
          any failure in round 2 -> keep round 1's result (no 'unavailable')
```

The maximum is 2 calls in round 1 plus 1 in round 2 (after a fallback) or 1 plus 2 (after a primary success), which is 3 in both cases. This resolves the arithmetic in Requirement 8.7, which would otherwise allow 4.

### Compile filter (`filter.ts`, `ears-adapter.ts`)

```ts
interface EarsPort {
  compile(line: string, lexicon: Lexicon): { requirement?: CompiledRequirement; diagnostics: Diagnostic[] };
  canonical(line: string, lexicon: Lexicon): string | undefined;   // tokenize -> parse -> clear id -> format
}
interface AcceptedLine { text: string; pattern: string }               // text is Canonical_Text
interface RejectedLine { text: string; diagnostics: Diagnostic[] }
interface FilterResult { accepted: AcceptedLine[]; rejected: RejectedLine[]; proposed: number }
declare function compileFilter(modelText: string, appId: string, cat: LexiconCatalogue, ears: EarsPort,
                               takeAtMost?: number): FilterResult;
declare function extractLines(modelText: string): string[];             // parse step only
```

Algorithm, all pure:

1. `extractLines`: the trimmed text is JSON, or a single fenced block (` ``` ` or ` ```json `) whose content is JSON. Anything else gives `[]`. The value must be an object with a `lines` array. Non-string entries are dropped.
2. Keep the first 3 entries (`takeAtMost` lowers this in a repair round), trim, drop empty, longer than 400 characters, or containing `\n` or `\r`. `proposed` is the count that survives.
3. Compile each line with `ears.compile`. If `requirement` exists, no diagnostic has severity `error` and `requirement.pattern !== 'optional'`, the line is accepted with `ears.canonical`. A line with pattern `optional` is rejected with one synthesised `PATTERN_MISMATCH` error diagnostic (`line 1`, `column 1`) whose message says that the `WHERE` pattern is not proposed by the Scribe_API. Other lines are rejected with the compiler's diagnostics (sorted by `start`, as the compiler returns them).
4. Duplicate accepted `text` values after the first are dropped silently, and not reported as rejected.

`ears.canonical` returning `undefined` for a line that compiled is treated as a rejection with a synthesised `PATTERN_MISMATCH` and logged as `errorName: 'CanonicalFailed'`. It cannot happen when the ears module meets its own round-trip property, and the defensive path keeps the soundness property total.

### Rounds and merging (`handler.ts`)

```ts
interface RoundOutcome { filter: FilterResult; modelId: string }
declare function runRounds(p: { entry: CatalogueEntry; text: string; deps: Deps }):
  Promise<{ accepted: AcceptedLine[]; rejected: RejectedLine[]; modelId: string | null; attempts: 0 | 1 | 2; unavailable?: string }>;
```

- Round 1 runs always. Failure of round 1 gives `unavailable`, `attempts: 0`, `model: null`.
- A repair round runs only when round 1 has at least one rejected line and fewer than 3 accepted lines. Its prompt carries the rejected lines with diagnostics. Its accepted lines are appended after round 1's, deduplicated, up to 3 in total.
- `rejected` returned is the repair round's rejected lines when the repair round returned at least one proposed line, and round 1's rejected lines when the repair round failed or proposed nothing.
- `attempts` counts rounds that returned model text. `model` is the id that produced the last returned text, or `null` when `attempts` is 0.

### Catalogue (`catalogue.ts`)

```ts
interface CatalogueEntry { appId: string; lexicon: Lexicon }
interface LexiconCatalogue { get(appId: string): CatalogueEntry | undefined; ids(): string[] }
```

Built at bundle time from `stagger/lexicon` and `candy/lexicon` (G7), with `ids()` in sorted order for the 400 message.

### Logging (`log.ts`)

```ts
interface CallLog { status: ScribeStatus | 'forbidden'; app: string | null; rounds: number; model: string | null;
                    accepted: number; rejected: number; ms: number; errorName?: string }
declare function logCall(f: CallLog): string;   // JSON.stringify of exactly these keys
```

One line per Scribe_Call that reaches step 6 or later. Earlier rejections log `status`, `ms` and `errorName` only, with `app: null`. No request header value, Plain_Text, proposed line or address is ever passed to `log`.

### Say-it-plainly box (`skeleton/src/ui/scribe/`)

Pure, tested without a DOM:

```ts
type ScribeOutcome =
  | { kind: 'http'; status: number; retryAfter?: number; body: unknown }
  | { kind: 'network' } | { kind: 'timeout' } | { kind: 'disabled' };
type BoxView =
  | { mode: 'drafts'; message: string; drafts: { text: string; pattern: string }[]; notUsed: ScribeResponse['rejected'] }
  | { mode: 'none'; message: string; showPhraseList: true; notUsed: ScribeResponse['rejected'] }
  | { mode: 'input_error'; message: string }
  | { mode: 'degraded'; reason: 'ip' | 'daily' | 'unreachable' | 'disabled'; message: string; showPhraseList: true };
declare function classify(o: ScribeOutcome): BoxView;
declare function isScribeResponse(x: unknown): x is ScribeResponse;       // strict shape check
declare function phraseList(lexicon: Lexicon): { kind: 'predicate' | 'perturbation'; phrase: string }[];
declare function scopeFromMessage(message: string): 'ip' | 'daily' | undefined;  // prefix match
```

`classify` rules, in order: `disabled` gives degraded `disabled`. `network` and `timeout` give degraded `unreachable`. HTTP 200 with a valid `ok` or `partial` body gives drafts, with a valid `none` body gives none, with anything else gives degraded `unreachable`. HTTP 400 and 413 with a valid `bad_request` body give `input_error`, otherwise degraded `unreachable`. HTTP 429 gives degraded `ip` or `daily` by `scopeFromMessage` (unknown prefix gives `unreachable`); minutes are `max(1, ceil(retryAfter / 60))`. Every other status, including 404, 405, 503, and Lambda's own 429 or 5xx on exhausted concurrency (a body that is not a valid `rate_limited` Scribe_Response), gives degraded `unreachable`. The box messages are the exact strings of Requirement 14.

`SayItPlainly` props:

```ts
interface SayItPlainlyProps {
  appId: string; lexicon: Lexicon;
  endpoint?: string;                       // default '/api/scribe'; '' => start degraded 'disabled'
  onAddDraft(text: string): void;          // Studio compiles locally and appends an 'untested' line (10.4, 16.3)
  onInsertPhrase(phrase: string): void;    // Tablet line with missing quantities (14.5)
  announce(message: string): void;         // Studio Live_Region
  fetchImpl?: typeof fetch;                // test hook
}
```

`client.ts` issues `fetch(endpoint, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', signal })` with a 12 s `AbortController` timer and aborts the previous request on resubmit and on unmount. `endpoint` must resolve to the page origin (`new URL(endpoint, location.href).origin === location.origin`), otherwise the box starts degraded `disabled`. The box never sends on mount or on input. The plain text lives in component state only (Requirement 17.4).

```mermaid
stateDiagram-v2
    [*] --> Idle
    [*] --> Degraded: endpoint empty or cross-origin
    Idle --> Sending: submit (text 1..400 chars)
    Sending --> Idle: aborted by resubmit
    Sending --> Drafts: 200 ok or partial
    Sending --> NoLine: 200 none
    Sending --> InputError: 400 or 413
    Sending --> Degraded: network, 12 s, 404, 405, 429, 5xx, bad shape
    Drafts --> Sending: submit
    NoLine --> Sending: submit
    InputError --> Sending: submit
    Degraded --> Sending: submit
    Degraded --> Drafts: next successful response
```

Visual and motion follow `design-language.md`: tokens `--ground-2`, `--ink`, `--ink-2`, `--clay`, `--hold`, `--break`, B612 for the sentences, B612 Mono for the `<n> / 400` counter, EARS keywords at 0.85em with 0.04em letter-spacing, 2 px control radius, 1 px `--clay` border at 35% opacity, no gradients or shadows. A rejected line uses the `--break` hairline, never a green check. Under `prefers-reduced-motion` drafts appear with no transition. Buttons are verbs: "Propose lines", "Add to tablet", "Dismiss". The privacy sentence (Requirement 10.3) sits next to the submit control in `--ink-2`.

### Deploy script (`infra/deploy.py`)

Pure functions (no boto3 argument):

```python
def content_type_for(key: str) -> str                      # table lookup on lower-cased extension
def is_hashed_asset(key: str) -> bool
def cache_control_for(key: str) -> str                     # immutable | html | default
def sha256_hex(data: bytes) -> str
def plan_uploads(local: list[LocalFile], remote: dict[str, RemoteObject]) -> Plan
def invalidation_paths(changed_html_keys: Iterable[str]) -> list[str]
def zip_lambda(bundle: bytes) -> bytes                     # fixed timestamps and permissions
def lambda_code_sha256(zip_bytes: bytes) -> str            # base64(sha256(zip))
```

Boto3 parts, each creating clients with `region_name='ap-southeast-2'` only: `check_identity` (STS first; failure prints one line and exits before any change), `create_or_update_stack` (create, or change set with `UsePreviousValue` for `OriginSecret` and `IpSalt`; `No updates` treated as success), `wait_and_report_events`, `ship_lambda` (compare `CodeSha256`, else `update_function_code` and wait for `Active`), `sync_site`, `invalidate`, `print_urls`.

Content-Type table: the eleven mappings of Requirement 5.7, plus `.map` as `application/json`, `.ico` as `image/x-icon`, `.jpg`/`.jpeg` as `image/jpeg`, `.webp` as `image/webp`, `.webmanifest` as `application/manifest+json`, `.gz` as `application/gzip` and `.br` as `application/octet-stream`. `golem-site` writes `.gz` and `.br` sidecar files; CloudFront compresses on its own, so those are uploaded as plain objects and never served with a `Content-Encoding`. Unknown extensions fall back to `application/octet-stream` with a warning that names the file.

`is_hashed_asset(key)` is true when one path segment before the file name is `assets` and the file name matches `^.+[-.][A-Za-z0-9_-]{8,}\.(js|mjs|css|wasm|woff2|map)$`. This assumes the Site_Build writes hashed files under an `assets/` directory with a hash of at least 8 characters before the extension (the Vite default and the example in Requirement's glossary). A false negative gives the shorter default cache, which is safe. HTML is never hashed.

Cache-Control: HTML gives `public, max-age=60, must-revalidate`. Hashed gives `public, max-age=31536000, immutable`. Everything else gives `public, max-age=3600`.

## Data Models

### Stack template (`infra/stack.yaml`)

Parameters: `OriginSecret` (String, NoEcho, MinLength 32), `IpSalt` (String, NoEcho, MinLength 32). Both are generated by `deploy.py` with `secrets.token_urlsafe(32)` on creation only.

| Logical ID | Type | Key properties |
|---|---|---|
| `SiteBucket` | `AWS::S3::Bucket` | all four `PublicAccessBlockConfiguration` flags true; `BucketEncryption` SSE-S3 (AES256); no website config |
| `SiteBucketPolicy` | `AWS::S3::BucketPolicy` | one Allow: Principal `cloudfront.amazonaws.com`, Action `s3:GetObject`, Resource `${SiteBucket.Arn}/*`, Condition `StringEquals AWS:SourceArn = arn:aws:cloudfront::${AWS::AccountId}:distribution/${Distribution}` |
| `OriginAccessControl` | `AWS::CloudFront::OriginAccessControl` | type `s3`, signing behaviour `always`, protocol `sigv4` |
| `DirectoryIndexFunction` | `AWS::CloudFront::Function` | runtime `cloudfront-js-2.0`, viewer-request; appends `index.html` when the URI ends in `/` |
| `StaticCachePolicy` | `AWS::CloudFront::CachePolicy` | MinTTL 0, DefaultTTL 86400, MaxTTL 31536000; gzip and Brotli enabled; no headers, cookies or query strings in the key |
| `ApiOriginRequestPolicy` | `AWS::CloudFront::OriginRequestPolicy` | headers `CloudFront-Viewer-Address`, `Content-Type`; cookies none; query strings none |
| `SecurityHeadersPolicy` | `AWS::CloudFront::ResponseHeadersPolicy` | HSTS `max-age=31536000` (no `preload`), `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, CSP, and custom headers COOP `same-origin` and COEP `require-corp`; every item `Override: true` |
| `Distribution` | `AWS::CloudFront::Distribution` | origins `site` (S3 regional domain, OAC) and `api` (Function URL host, HTTPS only, `OriginReadTimeout` 30, custom header `x-golem-origin`); default behaviour: `redirect-to-https`, GET/HEAD, `StaticCachePolicy`, `Compress`, the Function, the headers policy; cache behaviour `/api/*`: `redirect-to-https`, all methods, managed `CachingDisabled` (`4135ea2d-6df8-44a3-9df3-4b5a84be39ad`), `ApiOriginRequestPolicy`, the headers policy, `Compress` false; `DefaultRootObject index.html`; `MinimumProtocolVersion TLSv1.2_2021`, default CloudFront certificate; custom error responses 403 and 404 to `/404.html` with 404; no `Logging`; `PriceClass_All` is not required, `PriceClass_100` keeps cost down |
| `CounterTable` | `AWS::DynamoDB::Table` | key `pk` (S), `PAY_PER_REQUEST`, `TimeToLiveSpecification { AttributeName: ttl, Enabled: true }` |
| `ScribeLogGroup` | `AWS::Logs::LogGroup` | `RetentionInDays: 14` |
| `ScribeRole` | `AWS::IAM::Role` | trust `lambda.amazonaws.com`; inline policy below |
| `ScribeFunction` | `AWS::Lambda::Function` | Node 20, `index.handler`, 512 MB, timeout 25 s, `ReservedConcurrentExecutions: 3`, `LoggingConfig.LogGroup`, env `ORIGIN_SECRET`, `IP_SALT`, `COUNTER_TABLE`, `BEDROCK_REGION`; inline stub `Code.ZipFile` |
| `ScribeFunctionUrl` | `AWS::Lambda::Url` | `AuthType: NONE`, `InvokeMode: BUFFERED` |
| `ScribeUrlPermission`, `ScribeInvokePermission` | `AWS::Lambda::Permission` | principal `*`; `lambda:InvokeFunctionUrl` with `FunctionUrlAuthType: NONE`, and `lambda:InvokeFunction` with `InvokedViaFunctionUrl: true` (both are needed for new function URLs) |

CSP value, in one line: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. The `style-src-attr 'unsafe-inline'` directive is added only if the Site_Build is found to need inline style attributes (Requirement 3.4); it is off by default and the stack test asserts it is the only relaxation.

Execution role policy, and nothing else:

| Statement | Actions | Resources |
|---|---|---|
| Logs | `logs:CreateLogStream`, `logs:PutLogEvents` | `${ScribeLogGroup.Arn}:*` |
| Counters | `dynamodb:UpdateItem` | `${CounterTable.Arn}` |
| Bedrock profiles | `bedrock:InvokeModel` | `arn:aws:bedrock:ap-southeast-2:<account>:inference-profile/apac.amazon.nova-lite-v1:0` and `.../apac.amazon.nova-micro-v1:0` |
| Bedrock models behind the profiles | `bedrock:InvokeModel` | `arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0` and `arn:aws:bedrock:*::foundation-model/amazon.nova-micro-v1:0`, with condition `StringLike bedrock:InferenceProfileArn` equal to the two profile ARNs |

**Cross-region note.** The `apac.*` profiles are geographic inference profiles. Bedrock chooses the Region that serves each request from a set that AWS defines for the profile, and that set can include Regions other than `ap-southeast-2` and can change over time. The call still goes to the Sydney endpoint, but IAM is evaluated against the foundation-model ARN in the Region that serves it. That is why the model statement uses a wildcard Region and not `ap-southeast-2`. The wildcard is bounded by the `bedrock:InferenceProfileArn` condition, so the role cannot invoke those models directly, and cannot use any other profile. The account-level Region allowance stated in the requirements must cover every Region in the profile's APAC set. If an organisation policy denies one of them, Bedrock answers `AccessDeniedException` on some requests only. The handler treats that as `unavailable` and logs the error name, and `smoke.py` is the check that finds it. Requirement 4.1 and 4.2 constrain where the stack creates resources and where boto3 calls go, not which Region Bedrock may use internally. `Condition` and `Resource` use `${AWS::AccountId}` and `${AWS::Partition}` so no account ID is in the repository (Requirement 20.5).

### Counter items

| `pk` | `count` | `ttl` (Unix seconds) |
|---|---|---|
| `day#YYYYMMDD` | 0..600 | start of that UTC day + 172800 |
| `ip#<hex64>#YYYYMMDDHH` or `ip#unknown#YYYYMMDDHH` | 0..20 | start of that UTC hour + 7200 |

No other attribute is stored. The item holds no address, text or line.

### Upload plan (Python)

```python
@dataclass(frozen=True) class LocalFile:   key: str; sha256: str; content_type: str; cache_control: str
@dataclass(frozen=True) class RemoteObject: key: str; sha256: str | None; content_type: str; cache_control: str
@dataclass(frozen=True) class Plan:        uploads: tuple[LocalFile, ...]; deletes: tuple[str, ...]
```

`plan_uploads` returns an upload for each local file whose remote object is missing, or differs in `sha256`, `content_type` or `cache_control`. `uploads` is ordered non-HTML keys (sorted) before HTML keys (sorted). `deletes` is the sorted set of remote keys not in `local`, and the executor runs it only after every upload succeeded. `invalidation_paths` takes the keys of uploaded and deleted HTML objects. For `a/b/index.html` it returns `/a/b/index.html` and `/a/b/`; for `index.html` it returns `/index.html` and `/`; for `x.html` only `/x.html`. Paths are percent-encoded, de-duplicated and sorted.

### Environment variables (Lambda)

`ORIGIN_SECRET`, `IP_SALT`, `COUNTER_TABLE`, `BEDROCK_REGION` (always `ap-southeast-2`). `index.ts` fails every request with 403 `{}` if `ORIGIN_SECRET` or `IP_SALT` is empty.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Reflection on redundancy. Requirements 9.4 and 9.12 are one soundness property. Requirement 6.12 and 10.1 are folded into one response-shape property. Requirements 13.5 and 13.13 are folded into the stronger "refused call changes nothing" property. Requirements 12.3 and 18.9 are one input-validation property. Requirements 11.4 and 11.5 are one origin property. Requirement 13.10 is covered by Property 15 (non-admitted requests leave the store untouched) and Property 11. The cache-control, content-type, upload-plan and invalidation properties each cover a distinct pure function. Requirements 5.2 to 5.5, 5.12, 5.13, 8.1, 8.2, 8.6 and 19.x need AWS or a live model and are covered as integration or example tests, not properties.

### Property 1: Compile filter soundness

*For any* model text, any app in the catalogue and any scripted ears port behaviour derived from the real compiler, every Accepted_Line returned by the Compile_Filter compiles against that app's lexicon with no Diagnostic of severity `error`, has a pattern other than `optional`, and every Rejected_Line either has at least one error Diagnostic or is the `WHERE` rejection.

**Validates: Requirements 9.3, 9.4, 9.6, 9.12**

### Property 2: Canonical text round trip

*For any* generated valid EARS line for an app lexicon and any mutation of it that still compiles, the Canonical_Text returned by the filter, when tokenized, parsed, formatted and parsed again, yields an AST equal to the first parse with source offsets ignored, and compiling the Canonical_Text yields a `CompiledRequirement` with the same `pattern`, `space` and `horizon` as compiling the original line.

**Validates: Requirements 9.5, 9.13**

### Property 3: Compile filter idempotence

*For any* model text and app, taking the Canonical_Texts of the filter's Accepted_Lines, wrapping them as `{"lines": [...]}` and applying the filter again returns the same Accepted_Lines in the same order and no Rejected_Line.

**Validates: Requirements 9.14**

### Property 4: Compile filter bounds and extraction rules

*For any* model text (valid JSON object, fenced JSON, non-JSON, arrays with non-string entries, strings with line breaks, empty strings, strings over 400 characters, repeated lines), the filter never throws, returns at most 3 Accepted_Lines with pairwise-different text, returns zero lines for text that is neither a bare JSON object nor a single fenced JSON object, never reports a dropped duplicate as rejected, and reads at most the first 3 entries of `lines`.

**Validates: Requirements 9.1, 9.2, 9.7, 9.11**

### Property 5: Prompt determinism

*For any* catalogue entry, Plain_Text and optional rejected-line set, calling `buildPrompt` twice returns equal prompts, and the result does not change when the environment variables, clock or random source are altered between calls.

**Validates: Requirements 7.1, 7.11**

### Property 6: Every lexicon phrase appears exactly once

*For any* lexicon with pairwise distinct phrases that are not substrings of each other or of the static prompt text, and *for any* Plain_Text, the prompt with the `<user_text>` and `<rejected_lines>` blocks removed contains each predicate and perturbation phrase exactly once, in Lexicon order, and contains every `robotNames` entry. For the committed Stagger and Candy lexicons, each phrase is the entire content of exactly one `- ` list line.

**Validates: Requirements 7.2, 7.10**

### Property 7: No secret, signal name or counter value in the prompt

*For any* catalogue entry whose predicates read signals with distinctive names, any origin secret, any salt, any counter value and any Plain_Text that does not itself contain those strings, the prompt contains none of the signal names, the secret, the salt or the counter value.

**Validates: Requirements 7.9**

### Property 8: Untrusted text stays inside its block

*For any* Plain_Text and any rejected-line text, including ones that contain `<`, `>`, `&`, `</user_text>` or `</rejected_lines>`, the prompt has exactly one opening and one closing tag for each block, `unescapeBlock` of the block content equals the original text, and `escapeBlock` is injective.

**Validates: Requirements 7.6, 7.8**

### Property 9: Repair prompt carries the diagnostics

*For any* non-empty set of rejected lines with diagnostics, the repair prompt contains, for each rejected line, its escaped text and the `kind`, `message` and `suggestion` of each of its diagnostics, and the first-round prompt contains no `<rejected_lines>` block.

**Validates: Requirements 7.7**

### Property 10: Rate limiter limit invariant

*For any* sequence of Scribe_Calls from any set of IP addresses within one UTC hour, driven through the in-memory counter store (including calls that arrive after the store reports failures), the number of calls admitted to the Model_Client is at most 20 for each IP hash and at most 600 in total, and a call is refused with scope `ip` exactly when its IP already has 20 admitted calls in that hour.

**Validates: Requirements 13.3, 13.4, 13.5, 13.6, 13.12**

### Property 11: A refused or failed call changes no counter

*For any* counter-store state and any call that is refused (scope `ip` or `daily`) or that fails in the store, the counter values for both keys after the call equal the values before it, and a call refused with scope `ip` never increments the daily counter.

**Validates: Requirements 13.5, 13.9, 13.10, 13.13**

### Property 12: Bucket keys and TTLs

*For any* instant, `dayKey` and `ipKey` are the UTC calendar day and UTC clock hour of that instant (boundaries included), `dayTtl` equals the start of that UTC day plus 48 hours and `hourTtl` equals the start of that UTC hour plus 2 hours, both in whole Unix seconds, and neither depends on the local time zone.

**Validates: Requirements 13.3, 13.7**

### Property 13: Retry-After

*For any* instant, `retryAfter('ip', t)` equals the whole seconds to the next UTC hour and `retryAfter('daily', t)` equals the whole seconds to the next UTC day, both between 1 and 3600 or 86400 inclusive, and adding that many seconds to `t` lands exactly on the boundary.

**Validates: Requirements 13.8**

### Property 14: IP hash and viewer-address parsing

*For any* address, salt and pair of different salts, `ipHash` is deterministic, is 64 lowercase hex characters, differs between the two salts, and does not contain the address text. *For any* `CloudFront-Viewer-Address` value of the form `<ipv4>:<port>`, `[<ipv6>]:<port>` or a comma-separated list of those, `ipFromViewerAddress` returns the last entry's address without its port, and returns `undefined` for an empty or missing header.

**Validates: Requirements 13.2, 13.14**

### Property 15: Input validation answers 400 exactly when the input is invalid

*For any* Plain_Text string and any body shape (non-object, unknown key, missing key, wrong value types, unknown app), the handler answers HTTP 400 with `status: "bad_request"` if and only if the trimmed text is empty, longer than 400 UTF-16 code units, or contains a control character other than space, tab or line break, or the body is not an object with exactly the keys `app` and `text` with a known app. In every 400 case the counter store and the Model_Client receive no call. For a valid request, the prompt's Plain_Text has no run of whitespace longer than one character.

**Validates: Requirements 6.2, 6.3, 12.3, 12.4, 13.10**

### Property 16: Origin check precedes everything and is exact

*For any* request (any method, body and other headers) whose `x-golem-origin` header is missing or differs from the secret, the handler answers HTTP 403 with body `{}`, never decodes or parses the body, and makes no store or model call. *For any* request with the correct header (any header-name case) the origin check passes. *For any* method other than `POST` and `OPTIONS` that carries the correct header the answer is 405, and for `OPTIONS` it is 204 with no CORS header, in both cases with no store or model call. A body of more than 2048 bytes (counting a base64-decoded body) gives 413 with no downstream call.

**Validates: Requirements 6.4, 11.4, 11.5, 11.9**

### Property 17: Response shape and absence of verdict fields

*For any* request, store state and scripted model (including failures, malformed text and refusals) that does not end in a 403, the response body is valid JSON that is an object with exactly the keys `status`, `message`, `lines`, `rejected`, `model` and `attempts`, with `lines` of at most 3 entries of exactly `text` and `pattern`, `rejected` entries of exactly `text` and `diagnostics`, diagnostics with only the allowed keys, `status` in the allowed set, and at no depth any key named `Verdict`, `verdict`, `robustness`, `held`, `broken` or `counterexample`. Every response carries `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

**Validates: Requirements 6.5, 6.8, 6.11, 6.12, 10.1**

### Property 18: Status, lines and attempts are consistent with the outcome

*For any* scripted model run that returns text, `status` is `ok` when at least one line is returned and nothing is rejected, `partial` when at least one line is returned and something is rejected, and `none` when no line is returned, each `lines[i].text` is Canonical_Text with no requirement ID, and `attempts` equals the number of model rounds that returned text with `model` equal to the identifier that produced the last returned text, or `null` when `attempts` is 0. A repair round runs if and only if round 1 had a rejected line and fewer than 3 accepted lines.

**Validates: Requirements 6.6, 6.7, 6.9, 9.8, 9.9, 9.10**

### Property 19: Model call budget and failover

*For any* scripted sequence of per-call outcomes (success text, retryable error, fatal error) for the primary and fallback models, the handler makes at most 3 Bedrock calls per Scribe_Call, calls the fallback only after a retryable error and never after a fatal error, calls the fallback at most once per round and never again in a later round once it was used, answers `unavailable` when round 1 cannot get text, and keeps round 1's result when only round 2 fails.

**Validates: Requirements 8.3, 8.4, 8.5, 8.7**

### Property 20: Rate-limited messages name exactly one scope

*For any* instant and either scope, the `rate_limited` response has HTTP 429, a `Retry-After` header equal to `retryAfter(scope, t)`, and a message for which the box's `scopeFromMessage` returns that scope, and the message contains the limit as a number with its unit and does not contain the other scope's prefix.

**Validates: Requirements 13.8, 14.7, 14.8**

### Property 21: Logs contain only the allowed fields and no private data

*For any* request, including ones with Plain_Text, header values and addresses chosen to contain recognisable markers, every line passed to `log` is a JSON object whose keys are a subset of `status`, `app`, `rounds`, `model`, `accepted`, `rejected`, `ms`, `errorName`, and no logged line, no store item and no counter key contains the Plain_Text, a proposed line, a header value, the raw address, the origin secret or the salt.

**Validates: Requirements 11.7, 17.1, 17.2**

### Property 22: Request content type is matched case-insensitively

*For any* casing of `application/json` with any parameter suffix (for example `; charset=UTF-8`) and any casing of the header name, the handler treats a valid body as JSON, and *for any* other media type it answers 400 with no downstream call.

**Validates: Requirements 6.1**

### Property 23: Content-Type lookup depends only on the lower-cased extension

*For any* file name and any re-casing of its extension, `content_type_for` returns the same value; a name with no extension, or an extension outside the table, returns `application/octet-stream`; and each of the eleven mappings required by Requirement 5.7 holds.

**Validates: Requirements 5.7, 5.8, 5.15**

### Property 24: Cache-Control choice by object class

*For any* object key, `cache_control_for` returns `public, max-age=60, must-revalidate` for an `.html` key (in any case), `public, max-age=31536000, immutable` for a hashed asset, and `public, max-age=3600` otherwise; no `.html` key is ever classified as hashed, and `is_hashed_asset` is false for a key outside an `assets` directory.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 25: Upload plan idempotence and ordering

*For any* set of local files and any set of remote objects, applying the plan to the remote set (replace the uploaded objects, remove the deleted keys) and planning again yields an empty plan; a local file whose remote object has equal `sha256`, `content_type` and `cache_control` is never in `uploads`; every remote key absent locally is in `deletes`; and in `uploads` every non-HTML key precedes every HTML key.

**Validates: Requirements 5.9, 5.10, 5.16**

### Property 26: Invalidation paths cover changed HTML and nothing else

*For any* set of changed keys, `invalidation_paths` contains, for each HTML key, its `/`-rooted file path and (for `index.html` keys) its directory path, contains no path for a hashed asset or other non-HTML key, has no duplicates, and each path starts with `/`.

**Validates: Requirements 5.11**

### Property 27: Stack template invariants hold, and the checker catches each violation

*For any* single mutation of the parsed `infra/stack.yaml` that violates an invariant (a Block Public Access flag turned off, a public principal or extra action in the bucket policy, a custom domain, certificate, WAF or Lambda@Edge resource, a billing resource, a role action or resource outside the allowed set, reserved concurrency other than 3, a missing TTL attribute, a log bucket, `unsafe-eval` or a foreign host in the CSP, a missing or changed COOP, COEP, HSTS, nosniff, referrer or frame header), the invariant checker reports that violation, and the unmutated template reports none.

**Validates: Requirements 1.1, 1.3, 1.7, 3.1, 3.2, 3.3, 3.5, 3.6, 4.4, 4.5, 12.1, 13.1, 17.5**

### Property 28: The box state is total and degraded states always show the phrase list

*For any* `ScribeOutcome` (any HTTP status, any body value including malformed JSON shapes, network error, timeout, disabled endpoint, any `retryAfter`), `classify` returns exactly one `BoxView`; it returns a degraded view whenever the outcome is `network`, `timeout`, `disabled`, an HTTP status outside 200, 400, 413 and 429, a 200 or 429 body that is not a valid Scribe_Response of the matching status, or a `rate_limited` body; every degraded and `none` view has `showPhraseList` true and the phrase list contains every predicate and perturbation phrase of the lexicon; and for `ip` the message minutes equal `max(1, ceil(retryAfter / 60))`.

**Validates: Requirements 14.1, 14.2, 14.3, 14.4, 15.2, 15.3, 16.6**

## Error Handling

| Condition | Where | Result |
|---|---|---|
| Missing or wrong `x-golem-origin`, or empty secret in the environment | `checkOrigin` | 403 `{}`, nothing parsed, no downstream call, log `forbidden` |
| Method not `POST`/`OPTIONS` | `handle` | 405 `bad_request` |
| Body over 2048 bytes | `handle` | 413 `bad_request` |
| Wrong media type, bad JSON, wrong keys or types, unknown app, bad text | `validate` | 400 `bad_request` with a one-sentence message (known app ids listed for an unknown app) |
| IP hourly limit (20) or daily limit (600) reached | `admit` | 429 `rate_limited`, `Retry-After`, message with the scope prefix; counters unchanged |
| Counter store error other than a failed condition | `admit` | best-effort compensation, 503 `unavailable`, model not called (fail closed) |
| Model: retryable error in round 1 | `FailoverModel` | one call to the fallback model; if it also fails, 503 `unavailable` ("The model could not be reached.") |
| Model: `AccessDenied`, `Validation`, `ResourceNotFound` | `FailoverModel` | 503 `unavailable`, no fallback, error name logged. An `AccessDenied` that appears only on some requests points to an SCP or IAM gap on one of the APAC destination Regions |
| Model failure in the repair round | `runRounds` | round 1 result returned, `attempts: 1` |
| Model text is not the expected JSON | `extractLines` | zero proposed lines; if this is round 1 and nothing was rejected, there is no repair round and the response is `none` |
| `ears.canonical` fails on a compiled line | `compileFilter` | line rejected with a synthesised `PATTERN_MISMATCH`, `errorName: CanonicalFailed` logged |
| Unexpected exception in `handle` | `index.ts` wrapper | 503 `unavailable` with `The scribe is unavailable.`; the error name only is logged |
| Lambda reserved concurrency exhausted | Lambda service | 429/5xx with the service's own body; CloudFront passes it through; the box shows the unreachable message (Requirement 12.6) |
| Browser: network error, 12 s timeout, 404, 405, bad shape | `client.ts` + `classify` | degraded `unreachable`, phrase list shown, tablet editor usable, no retry |
| Browser: endpoint empty or cross-origin | `SayItPlainly` | degraded `disabled`, no request |
| Static copy without the stack | box | 404 or network error, degraded `unreachable`; the studio still loads and tests |
| `deploy.py`: no credentials | `check_identity` | one line stating that credentials are missing and how boto3 finds them, non-zero exit before any change |
| `deploy.py`: stack create or update fails | `wait_and_report_events` | prints each failed event with logical ID and reason, non-zero exit |
| `deploy.py`: `infra/scribe/dist/index.mjs` missing | `zip_lambda` caller | message naming the file, non-zero exit |
| `deploy.py`: upload fails | `sync_site` | non-zero exit, deletes and invalidation are not run |
| Bundle pulls in `@mujoco/mujoco`, `three` or `react` (G6) | esbuild `external` and the bundle test | build or test fails; the fix is `"sideEffects": false` in `skeleton`, or an additive `golem-spec/ears` subpath if that is not possible |

Known latency mismatch. The Lambda allows 8 s per model call and up to 3 calls, so a worst case can exceed the box's 12 s timeout. The box then shows the unreachable message, but the Lambda finishes and the call has already been counted. This follows the requirements as written.

## Testing Strategy

PBT applies to the pure parts: the prompt builder, compile filter, rate-limit logic, validation, origin check, response building, box classifier, and the Python deploy logic. It does not apply to CloudFormation resources, Bedrock, DynamoDB or CloudFront behaviour. Those use template checks, example tests with fakes, or are left to `smoke.py`, which does not run in CI.

**Libraries.** TypeScript: Vitest and fast-check (`infra/scribe/test/`, `skeleton/src/ui/scribe/__tests__/`). Python: `unittest` only; its property-style checks draw cases from `random.Random(seed)` with a fixed seed per test, 200 cases each. No real network, real clock or `Math.random()` in any test (Requirement 18.1).

**Fakes.** `FakeModel` (a scripted list of outcomes per call: text, retryable error, fatal error; it records prompts), `MemoryCounterStore` (a map, with optional injected failure at the n-th call), a fixed clock (`now = () => fixedMs`, with generators that vary the instant), and a stub `EarsPort` for tests that must run before golem-ears lands. Tests that need real compilation use the real `golem-spec` ears exports and are tagged so that they fail loudly (not skip) once the module is implemented.

**Property tests.** Each correctness property above is one fast-check test with `numRuns >= 100`, tagged with a comment of the form `Feature: golem-cloud, Property N: <title>`. Generators:

- Lexicons: from the real Stagger and Candy lexicons, and synthetic ones with distinct random tokens for Properties 6 and 7.
- Valid EARS lines: built from lexicon templates with random in-range quantities, then mutated (drop a unit, swap two words, unknown robot name, `WHERE` prefix, add a requirement ID) for Properties 1 to 4.
- Model texts: valid JSON, fenced JSON, prose, arrays with non-strings, over-long and multi-line strings.
- Requests: arbitrary header maps, base64 flags, method names, bodies up to just over 2048 bytes, texts around the 400-character and control-character boundaries (Properties 15, 16, 22).
- Call sequences: arrays of `{ipIndex, tick}` over 1 to 30 addresses within one hour, plus a store-failure index (Properties 10, 11).
- Instants: integers over several years including day, hour and month boundaries (Properties 12, 13).

**Example tests (Vitest).** Prompt contains every phrase of both real lexicons, the unit list, the delimiters, and the escaped delimiter case (Requirement 18.2); filter examples for a valid line, `MISSING_UNIT`, a `WHERE` line, fenced JSON, non-JSON, duplicates and the 3-line cap (18.4); bad line then corrected line gives exactly 2 rounds, the second prompt holds the diagnostics, status `ok` (18.6); primary fails and fallback answers, both fail (18.7); TTL values and bucket keys (18.8); origin missing, wrong, correct (18.10); Bedrock request captured from a fake SDK client has `maxTokens <= 400`, `temperature <= 0.2`, the profile id and region `ap-southeast-2` (8.1, 8.2); `OPTIONS` gives 204 (11.9); the box component with a fake `fetch`: each message of Requirement 14, degraded on network error, 404, malformed JSON and a 12 s timeout using fake timers, no request on mount or typing, the phrase list in every degraded case, submit disabled when empty or over 400, character counter `<n> / 400` (18.12); a contract test that `scopeFromMessage` and the Lambda message builder agree (G9); a bundle test that `dist/index.mjs` exists after build, contains no `mujoco`, `falsify` or `TrialPool`, and stays under 6 MB (G6).

**Template test.** `infra/scribe/test/stack.test.ts` parses `infra/stack.yaml` with the `yaml` package using custom tags for `!Ref`, `!Sub`, `!GetAtt`, `!Join`, `!Select`, `!Split`, `!If` and `!Equals`, and runs the invariant checker of Property 27. Example assertions cover the remaining configuration criteria (Requirements 1.2, 1.4, 1.5, 1.6, 1.8, 2.4, 2.5, 2.6, 3.4, 3.7, 4.1, 11.1, 11.2, 11.3, 11.8, 12.2, 12.8).

**Python tests.** `infra/tests/test_deploy_logic.py` covers Properties 23 to 26 and examples for `lambda_code_sha256` stability across runs, `--dry-run` output with a stubbed client factory that raises on any mutating call, and the credentials-missing message. No test imports `boto3`.

**Physics rules.** The short-horizon and budget rules in `testing.md` do not apply here, because nothing in golem-cloud runs a simulation. No test weakens an assertion or a requirement to pass. A test found wrong is fixed with the reason in the commit message.

**Not in CI.** `infra/smoke.py` (one live `POST`, and with `--direct` one unauthenticated call that must return 403) and the real deploy. The README states how to run them and the exit codes (0, 1, 3).
