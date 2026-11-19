# Requirements Document

## Introduction

`golem-cloud` covers `infra/` and the studio's "Say it plainly" box. It has two parts.

1. **Hosting.** GOLEM's public site (`site/dist`, which includes both app studios at `/stagger/` and `/candy/`, see `golem-site`) is served from a private S3 bucket through a CloudFront distribution. A CloudFormation template (`infra/stack.yaml`) defines the resources, and a Python boto3 script (`infra/deploy.py`) creates or updates the stack, uploads the files and invalidates the HTML.
2. **Scribe API.** A visitor types a behaviour in plain words, such as "it shouldn't fall over if a kid bumps into it". The Scribe_API proposes one to three GOLEM EARS lines for the current app. One Lambda function (Node 20) builds a prompt from the app's lexicon, calls Amazon Bedrock, then compiles every proposed line with the `golem-ears` EARS_Compiler against that lexicon. It returns only the lines that compile, plus Diagnostics for those that do not. It retries once with the Diagnostics fed back to the model. The browser shows the returned lines as drafts that the visitor can add to the tablet and test.

**Relation to the product rules.** `tech.md` allows no network access at runtime except static assets, and `product.md` forbids calling an LLM to decide a verdict. The Scribe_API is a deliberate, opt-in exception to the first rule and no exception to the second. The model only proposes text. Every verdict still comes from deterministic monitors that run in the visitor's browser (or Node), and a proposed line has no effect until the visitor adds it and tests it. The static build works without the Scribe_API, on any static file server, including `localhost`.

**Python.** `tech.md` forbids Python in the product. Python (boto3) appears only in `infra/` as deploy and smoke tooling. It is not imported by `skeleton/`, `apps/` or `site/`, and it is not shipped to visitors.

**Cross-module contracts.** This spec consumes, and never renames or removes, the shapes in `.kiro/steering/interfaces.md` (`Lexicon`, `PredicateTemplate`, `PerturbationTemplate`, `CompiledRequirement`, `RobotApp`). It consumes the `golem-ears` EARS_Compiler, Formatter, Diagnostic and Lexicon_Matcher through the public entry point `golem-spec`, and never deep-imports `skeleton/src/...`. It adds a "Say it plainly" component to `golem-spec/ui` and does not otherwise change `golem-studio-ui`. It adds one hosting requirement set that `golem-site` consumes (its Static_Deploy_Directory).

Assumptions made in this document:

- The AWS account is restricted by an organisation policy to the region `ap-southeast-2`. Resources that must live in another region (ACM certificates for CloudFront, WAF web ACLs for CloudFront, Lambda@Edge) are therefore out of scope. The site is served on the default `*.cloudfront.net` domain.
- CloudFront is a global service and is allowed by the organisation policy. The Bedrock inference profiles `apac.amazon.nova-lite-v1:0` and `apac.amazon.nova-micro-v1:0` are allowed by the organisation policy and are enabled for the account. Cross-region inference within the APAC profile is covered by that allowance.
- No AWS CLI is installed locally. The deploy and smoke tooling use boto3 with the default credential chain.
- An AWS Budget alarm already exists. This spec creates no billing, budget or cost-anomaly resources.
- The Lambda has no per-app configuration source for optional features, so `WHERE` (optional pattern) lines are not proposed (see Requirement 9).

## Glossary

- **Cloud_Stack**: The CloudFormation stack defined by `infra/stack.yaml`.
- **Stack_Template**: The file `infra/stack.yaml`.
- **Site_Bucket**: The private S3 bucket in the Cloud_Stack that holds the Static_Deploy_Directory (`site/dist`).
- **Distribution**: The CloudFront distribution in the Cloud_Stack.
- **OAC**: The CloudFront origin access control that lets the Distribution read the Site_Bucket.
- **Hashed_Asset**: A file in `site/dist` whose file name contains a content hash (for example `assets/index-3f9a1c2b.js`), and any `.wasm`, `.woff2` file that the Site_Build names with a content hash.
- **HTML_Object**: A file in `site/dist` with the extension `.html`.
- **Response_Headers_Policy**: The CloudFront response headers policy attached to every behaviour that serves the static site.
- **CSP**: The `Content-Security-Policy` response header.
- **Deploy_Script**: The Python script `infra/deploy.py`.
- **Smoke_Script**: The Python script `infra/smoke.py` that calls the deployed Scribe_API once.
- **Scribe_API**: The HTTP endpoint at `/api/scribe` on the Distribution, backed by the Scribe_Lambda.
- **Scribe_Lambda**: The one Node 20 Lambda function with a Function URL that implements the Scribe_API.
- **Function_URL**: The Lambda Function URL of the Scribe_Lambda, used as a CloudFront origin.
- **Origin_Secret**: The secret value that CloudFront sends in the header `x-golem-origin` and that the Scribe_Lambda checks.
- **Scribe_Request**: The JSON body `{ "app": string, "text": string }` sent to the Scribe_API.
- **Scribe_Response**: The JSON body returned by the Scribe_API, defined in Requirement 6.
- **Plain_Text**: The visitor's `text` field, a behaviour in plain words.
- **App_Id**: The `RobotApp.id` of the current app, for example `stagger` or `candy`.
- **Lexicon_Catalogue**: The build-time bundle in the Scribe_Lambda that maps each App_Id to its `Lexicon` (`robotNames`, `predicates`, `perturbations`) and its accepted-unit list from `golem-ears`.
- **Prompt_Builder**: The pure function in the Scribe_Lambda that turns a Lexicon_Catalogue entry, the Plain_Text and optional Diagnostics into a model prompt.
- **Model_Client**: The component that calls Amazon Bedrock with SigV4 and returns the model's text output.
- **Primary_Model**: The Bedrock inference profile `apac.amazon.nova-lite-v1:0` in `ap-southeast-2`.
- **Fallback_Model**: The Bedrock inference profile `apac.amazon.nova-micro-v1:0` in `ap-southeast-2`.
- **Proposed_Line**: One EARS line that the model returned as text.
- **Compile_Filter**: The pure function that compiles each Proposed_Line with the EARS_Compiler against the App's Lexicon and splits the results into accepted lines and rejected lines.
- **Accepted_Line**: A Proposed_Line that the EARS_Compiler compiled without error Diagnostics, returned in the Formatter's Canonical_Text.
- **Rejected_Line**: A Proposed_Line that did not compile, returned with its Diagnostics.
- **Repair_Round**: The single second model call, whose prompt contains the Rejected_Lines and their Diagnostics.
- **Rate_Limiter**: The component that reads and updates the DynamoDB counters.
- **Counter_Table**: The DynamoDB table in the Cloud_Stack that holds the counters, with a TTL attribute.
- **Daily_Limit**: 600 scribe calls per UTC calendar day, across all visitors.
- **Hourly_IP_Limit**: 20 scribe calls per hashed IP per UTC clock hour.
- **IP_Hash**: The HMAC-SHA-256 of the client IP address, keyed with a secret salt, as a hex string. The raw IP is never stored or logged.
- **Scribe_Call**: One Scribe_Request that passes input validation and the origin check, regardless of how many model calls it makes.
- **Draft**: An Accepted_Line shown in the studio, labelled as model-proposed, that is not on the tablet until the visitor adds it.
- **Say_It_Plainly_Box**: The studio component with a text field, a submit control and a Draft list.
- **Phrase_List**: The list of the app Lexicon's predicate and perturbation `phrase` strings, shown by the studio so that a visitor can write a line by hand.
- **Degraded_Mode**: The state of the Say_It_Plainly_Box in which it shows the Phrase_List and a message instead of calling or after failing to call the Scribe_API.
- **Fake_Model**: A test double of the Model_Client that returns scripted text.
- **Tablet**: The React panel of requirement lines defined in `golem-studio-ui`.
- **EARS_Compiler**, **Formatter**, **Diagnostic**, **Canonical_Text**, **Lexicon_Matcher**: As defined in `golem-ears`.

## Requirements

### Requirement 1: Private static hosting through CloudFront

**User Story:** As a maintainer, I want the site served from a private bucket through CloudFront, so that visitors get the static build quickly and nobody can read the bucket directly.

#### Acceptance Criteria

1. THE Stack_Template SHALL define the Site_Bucket with all four S3 Block Public Access settings enabled, no bucket policy statement that grants access to a public principal, and server-side encryption enabled.
2. THE Stack_Template SHALL define the Distribution with the Site_Bucket as its default origin, accessed through an OAC with signing behaviour `always` and protocol `sigv4`.
3. THE Stack_Template SHALL grant `s3:GetObject` on the Site_Bucket to the CloudFront service principal only, with a condition that restricts `AWS:SourceArn` to the Distribution.
4. THE Distribution SHALL redirect HTTP to HTTPS, SHALL allow only TLS 1.2 or newer, and SHALL set `index.html` as the default root object.
5. WHEN a request path ends in `/` (for example `/stagger/` or `/kit/`), THE Distribution SHALL serve the `index.html` object under that path.
6. IF a requested object does not exist in the Site_Bucket, THEN THE Distribution SHALL return HTTP 404 with the body of the site's `404.html` object when that object exists in `site/dist`, and SHALL NOT return the content of `index.html` with status 200.
7. THE Stack_Template SHALL NOT define a custom domain, an ACM certificate, a WAF web ACL or a Lambda@Edge function.
8. THE Stack_Template SHALL output the Distribution domain name, the Distribution ID and the Site_Bucket name.

### Requirement 2: Cache policy by object type

**User Story:** As a visitor, I want hashed assets cached for a long time and pages checked often, so that repeat visits are fast and a new deploy shows up quickly.

#### Acceptance Criteria

1. WHEN the Deploy_Script uploads a Hashed_Asset, THE Deploy_Script SHALL set `Cache-Control: public, max-age=31536000, immutable` on the object.
2. WHEN the Deploy_Script uploads an HTML_Object, THE Deploy_Script SHALL set `Cache-Control: public, max-age=60, must-revalidate` on the object.
3. WHEN the Deploy_Script uploads a file that is neither a Hashed_Asset nor an HTML_Object (for example a pose recording or a JSONL file), THE Deploy_Script SHALL set `Cache-Control: public, max-age=3600` on the object.
4. THE Distribution SHALL use a cache policy for the static behaviour whose minimum TTL is 0 seconds and whose maximum TTL is at least 31536000 seconds, so that the object `Cache-Control` header determines the cache duration at the edge and in the browser.
5. THE Distribution SHALL enable gzip and Brotli compression for the static behaviour.
6. THE Distribution SHALL cache no response of the `/api/*` behaviour (minimum, default and maximum TTL of 0 seconds).

### Requirement 3: Security and isolation response headers

**User Story:** As a maintainer, I want strict headers on every response, so that MuJoCo workers can use `SharedArrayBuffer` if needed and the page resists script injection.

#### Acceptance Criteria

1. THE Response_Headers_Policy SHALL set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every response of the static behaviour, with the header override enabled.
2. THE Response_Headers_Policy SHALL set `Strict-Transport-Security` with `max-age` of at least 31536000 seconds, and SHALL NOT include the `preload` directive.
3. THE Response_Headers_Policy SHALL set a CSP that contains these directives and no `unsafe-eval`: `default-src 'none'`, `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self'`, `img-src 'self' data:`, `font-src 'self'`, `worker-src 'self'`, `style-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` and `frame-ancestors 'none'`.
4. WHERE the Site_Build requires inline style attributes, THE CSP SHALL add `style-src-attr 'unsafe-inline'` and no other relaxation of `style-src`.
5. THE CSP SHALL contain no host name other than `'self'`, so that the page cannot load a script, font, image or connection from another origin.
6. THE Response_Headers_Policy SHALL set `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`.
7. THE Response_Headers_Policy SHALL also apply to responses of the `/api/*` behaviour, so that a Scribe_Response carries the same security headers.
8. THE Deploy_Script SHALL set the `Content-Type` of each uploaded object so that `X-Content-Type-Options: nosniff` does not block any script, worker, style or WASM module (see Requirement 5).
9. THE Smoke_Script SHALL, when run with the `--headers` option, request the site root from the Distribution and SHALL report a failure for each header of criteria 1, 2, 3 and 6 that is missing or has a different value.

### Requirement 4: Region, account and billing constraints

**User Story:** As a maintainer, I want the infrastructure to obey the organisation policy and leave billing alone, so that deploys are not blocked and spend is not duplicated.

#### Acceptance Criteria

1. THE Cloud_Stack SHALL create regional resources only in `ap-southeast-2`.
2. THE Deploy_Script SHALL create every boto3 client with `region_name='ap-southeast-2'` explicitly, and SHALL NOT read the region from the environment or from a profile.
3. IF the credentials resolve to no AWS identity (an `sts:GetCallerIdentity` call fails), THEN THE Deploy_Script SHALL print one line that states that credentials are missing and how boto3 finds them, and SHALL exit with a non-zero code before it creates or changes any resource.
4. THE Stack_Template SHALL NOT define any `AWS::Budgets::*`, `AWS::CE::*` or `AWS::CloudWatch::Alarm` resource whose purpose is billing.
5. THE Stack_Template SHALL grant the Scribe_Lambda execution role only: write access to its own CloudWatch log group, `bedrock:InvokeModel` on the Primary_Model and Fallback_Model inference profiles and the foundation models that those profiles route to, and `dynamodb:UpdateItem` on the Counter_Table.
6. THE Stack_Template SHALL give the Deploy_Script no resource that it needs to create outside `ap-southeast-2`.

### Requirement 5: Deploy script

**User Story:** As a maintainer without the AWS CLI, I want one Python script that deploys the stack and the site, so that I can publish from a plain machine.

#### Acceptance Criteria

1. THE Deploy_Script SHALL use boto3 only (plus the Python standard library) and SHALL accept the options `--stack-name` (default `golem-cloud`), `--dist` (default `site/dist`) and `--dry-run`.
2. WHEN the Cloud_Stack does not exist, THE Deploy_Script SHALL create it from the Stack_Template, and WHEN it exists, THE Deploy_Script SHALL update it through a change set, and SHALL treat a change set with no changes as success.
3. THE Deploy_Script SHALL wait for the stack operation to finish, SHALL print each failed stack event with its logical resource ID and status reason, and SHALL exit with a non-zero code when the operation fails or rolls back.
4. THE Deploy_Script SHALL generate the Origin_Secret and the IP-hash salt once, on stack creation, from `secrets.token_urlsafe(32)`, and SHALL reuse the existing values on update by passing `UsePreviousValue`, so that the values never appear in the repository, in the Stack_Template or in the script output.
5. THE Deploy_Script SHALL package the built Scribe_Lambda bundle (`infra/scribe/dist/index.mjs`) as a zip, and SHALL fail with a message that names the missing file when the bundle does not exist.
6. THE Deploy_Script SHALL upload each file under `--dist` to the Site_Bucket with its key equal to the file's POSIX path relative to `--dist`.
7. THE Deploy_Script SHALL set the `Content-Type` of each object from an explicit table, which maps at least `.html` to `text/html; charset=utf-8`, `.js` and `.mjs` to `text/javascript; charset=utf-8`, `.css` to `text/css; charset=utf-8`, `.json` to `application/json`, `.jsonl` to `application/x-ndjson`, `.wasm` to `application/wasm`, `.woff2` to `font/woff2`, `.png` to `image/png`, `.svg` to `image/svg+xml`, `.txt` to `text/plain; charset=utf-8` and `.xml` to `application/xml`.
8. IF a file has an extension that is not in the table, THEN THE Deploy_Script SHALL upload it as `application/octet-stream` and SHALL print a warning that names the file.
9. THE Deploy_Script SHALL upload an object only when its SHA-256 differs from the `sha256` user metadata of the existing object, or when its Content-Type or Cache-Control differs, and SHALL store the SHA-256 as user metadata on every object it uploads.
10. THE Deploy_Script SHALL upload all non-HTML objects before it uploads any HTML_Object, and SHALL delete objects from the Site_Bucket that are absent from `--dist` only after all uploads have succeeded.
11. WHEN at least one HTML_Object was uploaded or deleted, THE Deploy_Script SHALL create one CloudFront invalidation for the paths of the changed HTML_Objects and their directory forms (for example `/stagger/index.html` and `/stagger/`), and SHALL NOT invalidate Hashed_Assets.
12. WHEN `--dry-run` is given, THE Deploy_Script SHALL print the stack action, the objects it would upload or delete and the invalidation paths, and SHALL make no change to AWS.
13. WHEN the deploy finishes, THE Deploy_Script SHALL print the site URL (`https://<Distribution domain>/`) and the Scribe_API URL.
14. THE Deploy_Script SHALL keep its pure logic (Content-Type lookup, Cache-Control choice, upload plan, invalidation path list) in functions that take no boto3 client, so that unit tests can run without AWS.
15. FOR ALL file names, THE Content-Type lookup SHALL be a pure function of the lower-cased extension, so that `a.WASM` and `a.wasm` give the same type, and a file with no extension gives `application/octet-stream`.
16. FOR ALL sets of local files and remote objects, THE upload plan SHALL be idempotent: planning again after applying the plan SHALL produce an empty plan.

### Requirement 6: Scribe API contract

**User Story:** As a studio developer, I want a small, strict JSON contract, so that the browser can show drafts and every failure mode.

#### Acceptance Criteria

1. WHEN a `POST` request with `Content-Type: application/json` arrives at `/api/scribe`, THE Scribe_API SHALL parse the body as a Scribe_Request.
2. THE Scribe_API SHALL accept the Scribe_Request fields `app` and `text` only, and SHALL answer HTTP 400 with `status: "bad_request"` when the body is not a JSON object, has an unknown field, or lacks either field.
3. IF `app` is not an App_Id in the Lexicon_Catalogue, THEN THE Scribe_API SHALL answer HTTP 400 with `status: "bad_request"` and a message that lists the App_Ids it knows.
4. THE Scribe_API SHALL answer a method other than `POST` with HTTP 405, and SHALL answer a request body larger than 2048 bytes with HTTP 413, in both cases before any model or counter call.
5. THE Scribe_Response SHALL be the JSON object `{ "status": ..., "message": string, "lines": [{ "text": string, "pattern": string }], "rejected": [{ "text": string, "diagnostics": [...] }], "model": string | null, "attempts": number }`, where `status` is one of `ok`, `partial`, `none`, `rate_limited`, `unavailable` or `bad_request`.
6. THE Scribe_API SHALL set `status` to `ok` when at least one Accepted_Line is returned and no Rejected_Line remains, `partial` when at least one Accepted_Line and at least one Rejected_Line remain, and `none` when no Accepted_Line is returned.
7. THE Scribe_Response `lines` array SHALL hold at most 3 entries, each `text` SHALL be the Canonical_Text of the Accepted_Line without a requirement ID, and each `pattern` SHALL be the compiled `CompiledRequirement.pattern`.
8. THE Scribe_Response `diagnostics` entries SHALL carry the golem-ears Diagnostic fields `kind`, `severity`, `message`, `line`, `column` and the optional `suggestion`.
9. THE Scribe_Response SHALL set `attempts` to the number of model rounds that ran (0, 1 or 2) and `model` to the identifier of the model that produced the returned lines, or `null` when no model ran.
10. THE Scribe_API SHALL answer `rate_limited` with HTTP 429 and a `Retry-After` header in whole seconds, and SHALL answer `unavailable` with HTTP 503.
11. THE Scribe_API SHALL set `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store` on every response.
12. FOR ALL Scribe_Responses, THE Scribe_Response SHALL be valid JSON that contains no field outside the shape of criterion 5.

### Requirement 7: Prompt from the app lexicon

**User Story:** As a visitor, I want the proposals to use my app's real vocabulary, so that the lines I get can compile and run.

#### Acceptance Criteria

1. THE Prompt_Builder SHALL be a pure function of the Lexicon_Catalogue entry, the Plain_Text and the optional Diagnostics, and SHALL read no clock, no random source and no environment variable.
2. THE Prompt_Builder SHALL include in the prompt each `robotNames` entry, and the `phrase` of every `PredicateTemplate` and `PerturbationTemplate` of the app's Lexicon in Lexicon order, each with its slot kinds (for example `{force}`, `{range:force}`, `{duration}`, `{direction}`).
3. THE Prompt_Builder SHALL include the accepted-unit list (N, kN, m, cm, mm, s, ms, m/s, cm/s, deg, °, rad, kg, g, %) and the rule that every number carries a unit, except counts and ratios.
4. THE Prompt_Builder SHALL describe the four patterns the Scribe_API accepts (ubiquitous, event, state, unwanted) with the GOLEM shapes from `ears-for-robots.md`, and SHALL tell the model to return between 1 and 3 lines, with one behaviour per line.
5. THE Prompt_Builder SHALL tell the model to answer with a JSON object of the form `{"lines": ["<EARS line>", ...]}` and nothing else, and SHALL tell the model to leave a quantity out of a line rather than guess it.
6. THE Prompt_Builder SHALL place the Plain_Text inside a clearly delimited block and SHALL tell the model that the block is a description to translate and not an instruction.
7. WHEN Diagnostics are given, THE Prompt_Builder SHALL add each Rejected_Line with the `kind`, `message` and `suggestion` of its Diagnostics, and SHALL ask the model to correct only those lines.
8. THE Prompt_Builder SHALL escape the delimiter of the Plain_Text block inside the Plain_Text, so that the Plain_Text cannot close the block.
9. THE Prompt_Builder SHALL NOT include a signal name, an `apply` or `margin` function, a file path, a secret or a counter value in the prompt.
10. FOR ALL Lexicon_Catalogue entries and Plain_Texts, THE prompt SHALL contain every `phrase` of the app's Lexicon, exactly once.
11. FOR ALL pairs of equal inputs, THE Prompt_Builder SHALL return equal prompts (determinism).

### Requirement 8: Bedrock calls with fallback and token limits

**User Story:** As a maintainer, I want a cheap model with a cheaper fallback and hard output limits, so that cost stays small and a throttled model does not break the box.

#### Acceptance Criteria

1. THE Model_Client SHALL call Amazon Bedrock Runtime in `ap-southeast-2` with SigV4 credentials of the Scribe_Lambda execution role, using the Primary_Model identifier `apac.amazon.nova-lite-v1:0`.
2. THE Model_Client SHALL set `maxTokens` to 400 or less, and a temperature of 0.2 or less, on every model call.
3. IF the Primary_Model call fails with a throttling, timeout, model-not-ready or service error, THEN THE Model_Client SHALL call the Fallback_Model `apac.amazon.nova-micro-v1:0` once for the same prompt.
4. IF the Fallback_Model call also fails, THEN THE Scribe_API SHALL answer `unavailable` (HTTP 503) with a message that states that the model could not be reached.
5. IF the Primary_Model call fails with an access-denied or validation error, THEN THE Scribe_API SHALL answer `unavailable` without calling the Fallback_Model for that error class, and SHALL log the error name.
6. THE Model_Client SHALL set a timeout of 8 seconds for each model call, and THE Scribe_Lambda SHALL have a function timeout of 25 seconds or less.
7. THE Scribe_Lambda SHALL make at most 3 Bedrock calls per Scribe_Call (one initial round and one Repair_Round, each with at most one fallback call).
8. THE Model_Client SHALL be an interface with one method that takes a prompt and returns the model's text and the model identifier, so that a Fake_Model can replace it in tests.
9. THE Model_Client SHALL NOT use the model output for anything other than parsing it as Proposed_Lines (see Requirement 9).

### Requirement 9: Compile and filter the proposals

**User Story:** As a visitor, I want to see only lines that GOLEM can run, so that a draft is never a sentence that fails to compile.

#### Acceptance Criteria

1. WHEN the model returns text, THE Compile_Filter SHALL parse it as a JSON object with a `lines` array of strings, SHALL accept the JSON object when it is the only content or is inside a single fenced code block, and SHALL treat any other output as zero Proposed_Lines.
2. THE Compile_Filter SHALL take at most the first 3 strings of `lines`, SHALL trim each, and SHALL drop an empty string, a string longer than 400 characters and a string that contains a line break.
3. THE Compile_Filter SHALL compile each remaining Proposed_Line with the EARS_Compiler against the Lexicon of the App_Id in the Scribe_Request, with no requirement ID.
4. THE Compile_Filter SHALL classify a Proposed_Line as an Accepted_Line only when the EARS_Compiler returns a `CompiledRequirement` and no Diagnostic with severity `error`.
5. THE Compile_Filter SHALL return each Accepted_Line as the Formatter's Canonical_Text, so that compiling the returned text again yields a `CompiledRequirement` with the same `pattern`, `space` and `horizon`.
6. IF a Proposed_Line compiles to the `optional` pattern, THEN THE Compile_Filter SHALL reject it with a Diagnostic of kind `PATTERN_MISMATCH` and the message that the pattern `WHERE` is not proposed by the Scribe_API.
7. THE Compile_Filter SHALL drop a second Accepted_Line whose Canonical_Text equals that of an earlier Accepted_Line, and SHALL NOT report the dropped line as rejected.
8. IF the first round yields at least one Rejected_Line and the Scribe_Call has made fewer than 2 rounds, THEN THE Scribe_Lambda SHALL run one Repair_Round whose prompt contains the Rejected_Lines with their Diagnostics, and SHALL merge its Accepted_Lines after the Accepted_Lines of the first round, up to 3 lines in total.
9. THE Scribe_Lambda SHALL NOT run a Repair_Round when the first round yields no Rejected_Line, or yields 3 Accepted_Lines.
10. THE Scribe_Lambda SHALL return as `rejected` only the Rejected_Lines that remain after the last round, each with its Diagnostics.
11. THE Compile_Filter SHALL be a pure function of the model text, the App_Id and the Lexicon_Catalogue, with no network, no clock and no random source.
12. FOR ALL model texts, every Accepted_Line returned by the Compile_Filter SHALL compile without error Diagnostics against the Lexicon (soundness).
13. FOR ALL Accepted_Lines, parsing the Canonical_Text, formatting the AST and parsing again SHALL produce an equal AST when source offsets are ignored (round trip).
14. FOR ALL model texts, applying the Compile_Filter to the Canonical_Texts of its own Accepted_Lines (wrapped as a `lines` array) SHALL return the same Accepted_Lines and no Rejected_Line (idempotence).

### Requirement 10: The model proposes text and never decides a verdict

**User Story:** As a robotics engineer, I want the scribe to stay outside the verdict path, so that "held" and "broken" still come only from deterministic monitors.

#### Acceptance Criteria

1. THE Scribe_Lambda SHALL return no `Verdict`, `robustness`, `held`, `broken` or `Counterexample` value, and SHALL NOT import the `sim`, `falsify` or `pool` modules.
2. THE Say_It_Plainly_Box SHALL send a Scribe_Request only when the visitor activates the submit control, and SHALL send no request to the Scribe_API when a page loads or when the visitor types.
3. THE Say_It_Plainly_Box SHALL show, next to the submit control, the sentence "Your text is sent to a language model in AWS Sydney (ap-southeast-2). It proposes lines. It never decides a verdict." in the product voice.
4. WHEN the visitor adds a Draft to the Tablet, THE Studio SHALL compile the Draft locally with the EARS_Compiler of the browser build against the app's Lexicon, and SHALL use that local result and not the Scribe_Response as the line's compiled form.
5. THE Studio SHALL set the status of an added Draft to `untested`, and SHALL NOT run any trial for a Draft until the visitor starts a test as for any other line.
6. FOR ALL Scribe_Responses, a Draft's status in the Studio SHALL derive only from deterministic monitors that ran after the visitor added it, and never from the Scribe_Response.
7. THE Studio SHALL keep every Draft out of the Requirements_File on disk: a Draft SHALL NOT be written to `.kiro/specs/**/requirements.md` by the browser or the Scribe_Lambda.

### Requirement 11: Origin protection

**User Story:** As a maintainer, I want the Function URL to answer only CloudFront, so that nobody can bypass the cache layer and the spend guards by calling it directly.

#### Acceptance Criteria

1. THE Distribution SHALL route `/api/scribe` to the Function_URL origin and SHALL add the custom origin header `x-golem-origin` with the Origin_Secret to each request to that origin.
2. THE Distribution SHALL allow all HTTP methods on the `/api/*` behaviour (so that the Scribe_Lambda, not CloudFront, answers 405 for methods other than `POST` and `OPTIONS`), SHALL forward the request body, and SHALL forward no cookie and no viewer `Authorization` header to the origin.
3. THE Distribution SHALL send the viewer address to the origin in the `CloudFront-Viewer-Address` header.
4. IF a request reaches the Scribe_Lambda without the header `x-golem-origin`, or with a value that differs from the Origin_Secret, THEN THE Scribe_Lambda SHALL answer HTTP 403 with an empty JSON object before it parses the body, calls the Counter_Table or calls the Model_Client.
5. THE Scribe_Lambda SHALL compare the header value with the Origin_Secret in constant time.
6. THE Scribe_Lambda SHALL read the Origin_Secret and the IP-hash salt from its environment variables, which the Cloud_Stack sets from NoEcho parameters.
7. THE Scribe_Lambda SHALL NOT log the Origin_Secret, the IP-hash salt, the raw client IP or the Plain_Text.
8. THE Function_URL SHALL use authorization type `NONE`, because the Origin_Secret check in criterion 4 is the access control.
9. THE Scribe_Lambda SHALL answer an `OPTIONS` request with HTTP 204 and no CORS headers, because the Scribe_API is same-origin only.

### Requirement 12: Spend guards on size and concurrency

**User Story:** As a maintainer, I want hard caps on concurrency, input and output, so that one visitor or one bug cannot run up a bill.

#### Acceptance Criteria

1. THE Cloud_Stack SHALL set the reserved concurrency of the Scribe_Lambda to 3.
2. THE Scribe_Lambda SHALL have a memory size of 512 MB or less.
3. THE Scribe_API SHALL trim the Plain_Text and SHALL answer HTTP 400 with `status: "bad_request"` when the trimmed Plain_Text is empty, longer than 400 characters (counted as JavaScript string length), or contains a control character other than space, tab or line break.
4. THE Scribe_API SHALL collapse each run of whitespace in the Plain_Text to one space before it builds the prompt.
5. THE Model_Client SHALL request at most 400 output tokens on every call (see Requirement 8.2).
6. IF the Lambda service rejects an invocation because the reserved concurrency is exhausted, THEN THE Distribution SHALL return the Function_URL's HTTP 429 or 5xx to the browser, and THE Say_It_Plainly_Box SHALL show the Degraded_Mode message of Requirement 14.
7. THE Distribution SHALL cache no `/api/*` response, so that a spend guard response is never served from the edge to another visitor.
8. THE Cloud_Stack SHALL set a log retention of 14 days or less on the Scribe_Lambda log group.

### Requirement 13: Per-day and per-IP counters

**User Story:** As a maintainer, I want a global daily cap and a per-IP hourly cap, so that the scribe stays inside a small, known spend.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL store counters in the Counter_Table with the partition key `pk` (string), a numeric `count` and a numeric `ttl` attribute, and the Cloud_Stack SHALL enable DynamoDB TTL on `ttl` and use on-demand billing.
2. THE Rate_Limiter SHALL derive the client IP from the last address in the `CloudFront-Viewer-Address` header (with its port removed), and SHALL compute the IP_Hash from it. IF the header is missing or has no address, THEN THE Rate_Limiter SHALL use the key `ip#unknown`.
3. WHEN a Scribe_Call arrives, THE Rate_Limiter SHALL increment the daily counter `day#<YYYYMMDD in UTC>` and the hourly counter `ip#<IP_Hash>#<YYYYMMDDHH in UTC>` before any model call, using one conditional `UpdateItem` per counter (`count < limit`), so that the increments are atomic under concurrent calls.
4. IF the daily counter would exceed 600, THEN THE Rate_Limiter SHALL refuse the Scribe_Call with scope `daily`.
5. IF the hourly counter of the caller would exceed 20, THEN THE Rate_Limiter SHALL refuse the Scribe_Call with scope `ip`, and SHALL undo the increment of the daily counter that the same Scribe_Call made, so that a refused IP does not consume the global budget.
6. THE Rate_Limiter SHALL check the hourly IP counter before the daily counter, so that a single IP that is over its limit does not increment the daily counter at all.
7. THE Rate_Limiter SHALL set the `ttl` of a daily counter to 48 hours after the start of its UTC day, and the `ttl` of an hourly counter to 2 hours after the start of its UTC hour, as Unix seconds.
8. WHEN a Scribe_Call is refused, THE Scribe_API SHALL answer `rate_limited` (HTTP 429) with `Retry-After` equal to the seconds until the next UTC hour for scope `ip`, or until the next UTC day for scope `daily`, and a message that states the scope in plain words.
9. IF a Counter_Table call fails for a reason other than a failed condition, THEN THE Scribe_API SHALL answer `unavailable` (HTTP 503) without calling the Model_Client (fail closed).
10. THE Rate_Limiter SHALL count a Scribe_Call once, regardless of its number of model rounds, and SHALL NOT count a request that was rejected for bad input, bad origin header, a wrong method or an oversized body.
11. THE Rate_Limiter SHALL keep its decision logic (bucket keys, TTL values, and the decision from current counts) in pure functions that take no DynamoDB client, so that tests run without AWS.
12. FOR ALL sequences of Scribe_Calls from any set of IPs within one UTC hour, driven through a fake counter store, the number of calls that reach the Model_Client SHALL NOT exceed 20 for any one IP_Hash and SHALL NOT exceed 600 in total (limit invariant).
13. FOR ALL sequences of calls, a call refused with scope `ip` SHALL leave the daily counter equal to its value before the call (no budget leak).
14. FOR ALL IP addresses, THE IP_Hash SHALL be a deterministic function of the address and the salt, SHALL differ for different salts, and SHALL NOT contain the address text.

### Requirement 14: Clear messages and a hand-writing fallback

**User Story:** As a visitor, I want a plain message when the scribe is unavailable and a way to still write a line, so that the studio stays useful.

#### Acceptance Criteria

1. WHEN the Scribe_API answers `rate_limited` with scope `ip`, THE Say_It_Plainly_Box SHALL show the message "You have used your 20 scribe requests for this hour. Try again in <minutes> min, or write a line by hand below." with `<minutes>` rounded up from `Retry-After`.
2. WHEN the Scribe_API answers `rate_limited` with scope `daily`, THE Say_It_Plainly_Box SHALL show the message "The scribe has reached today's limit of 600 requests. It resets at 00:00 UTC. You can still write a line by hand below."
3. WHEN the Scribe_API answers `unavailable`, or answers with a status that is not 200, 400, 413 or 429, THE Say_It_Plainly_Box SHALL show the message "The scribe is not reachable right now. You can still write a line by hand below."
4. WHEN the Scribe_API answers `rate_limited` or `unavailable`, THE Say_It_Plainly_Box SHALL enter Degraded_Mode, SHALL show the Phrase_List of the current app's Lexicon (every predicate and perturbation `phrase`, with slot kinds), and SHALL keep the Tablet's line editor usable.
5. THE Say_It_Plainly_Box SHALL show each phrase of the Phrase_List with a control that inserts the phrase as a new editable line on the Tablet, with its slots marked as missing quantities and no number filled in.
6. THE Say_It_Plainly_Box SHALL leave Degraded_Mode on the next successful Scribe_Response, and SHALL NOT retry automatically.
7. THE Scribe_Lambda messages (`message` field) SHALL state the scope and the limit in numbers with units, and SHALL contain no spooky wording, in line with the product voice.
8. FOR ALL Scribe_Responses with status `rate_limited`, the message SHALL name exactly one scope (`ip` or `daily`).

### Requirement 15: The studio box works with the API unreachable

**User Story:** As a visitor on a static copy or on localhost, I want the box to work, clearly degraded, when no API exists, so that nothing is broken or silent.

#### Acceptance Criteria

1. THE Say_It_Plainly_Box SHALL be a component of `golem-spec/ui`, SHALL take the endpoint URL as an option with the default `/api/scribe`, and SHALL take the app's `Lexicon` and App_Id from the mounted Studio.
2. WHEN the request fails with a network error, a 404 or 405 status, a response that is not valid JSON of the Scribe_Response shape, or no answer within 12 seconds, THE Say_It_Plainly_Box SHALL enter Degraded_Mode with the message of Requirement 14.3.
3. WHEN the endpoint option is empty, THE Say_It_Plainly_Box SHALL start in Degraded_Mode with the message "The scribe is not available on this copy of the site. You can write a line by hand below." and SHALL make no request.
4. THE Say_It_Plainly_Box SHALL cancel an unfinished request when the visitor submits again or when the Studio is disposed.
5. THE Say_It_Plainly_Box SHALL disable the submit control while a request runs, and SHALL disable it when the trimmed input is empty or longer than 400 characters, with a visible character counter that reads `<n> / 400`.
6. THE Say_It_Plainly_Box SHALL send the request only to a same-origin URL, and SHALL use `fetch` with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`.
7. THE Say_It_Plainly_Box SHALL announce the result (drafts found, rejected, or degraded) in the Studio's Live_Region and SHALL be operable by keyboard alone.
8. THE Say_It_Plainly_Box SHALL follow `design-language.md` (tokens, type, motion) and SHALL honour Reduced_Motion.
9. THE static build of the site SHALL work on any static file server, including `localhost`, with no request to the Scribe_API at page load (see Requirement 10.2), and the Studio SHALL load, run trials and edit lines without the Scribe_API.

### Requirement 16: Drafts on the tablet

**User Story:** As a visitor, I want the proposed lines shown as drafts that I can add and test, so that I stay in control of what runs.

#### Acceptance Criteria

1. WHEN a Scribe_Response has at least one entry in `lines`, THE Say_It_Plainly_Box SHALL show each entry as a Draft with the label "Proposed by a model" and the text in the same keyword style as a Tablet line.
2. THE Say_It_Plainly_Box SHALL show each Draft with an "Add to tablet" control and a "Dismiss" control, and SHALL add no Draft automatically.
3. WHEN the visitor activates "Add to tablet" for a Draft, THE Studio SHALL append the line to the Tablet as a Requirement_Line with a new ID in the Tablet's numbering, with every quantity editable, and with the status `untested`.
4. IF the local compile of an added Draft (Requirement 10.4) returns an error Diagnostic, THEN THE Studio SHALL show the Diagnostic on the line as for any hand-written line and SHALL keep the line editable.
5. WHEN a Scribe_Response has entries in `rejected`, THE Say_It_Plainly_Box SHALL list each rejected text in a collapsed "Not used" section with the Diagnostics' `message` and `suggestion`, and SHALL offer no "Add to tablet" control for it.
6. WHEN a Scribe_Response has status `none`, THE Say_It_Plainly_Box SHALL show the message "No line could be built from that text. Try a physical description, for example a push, a force, a time." and the Phrase_List.
7. THE Say_It_Plainly_Box SHALL show at most 3 Drafts, and SHALL replace the Drafts of the previous request when a new response arrives, except Drafts already added to the Tablet.
8. THE Say_It_Plainly_Box SHALL keep the Plain_Text in the field after a response, so that the visitor can edit and resubmit it.

### Requirement 17: Privacy and logging

**User Story:** As a visitor, I want my words and address kept private, so that I can try the box without being tracked.

#### Acceptance Criteria

1. THE Scribe_Lambda SHALL write no Plain_Text, no Proposed_Line, no raw IP address and no header value to its logs, to the Counter_Table or to any other store.
2. THE Scribe_Lambda SHALL log, per Scribe_Call, one JSON line with only these fields: the status, the App_Id, the number of rounds, the model identifier, the number of Accepted_Lines, the number of Rejected_Lines, the duration in ms and the error name, if any.
3. THE Site and the Scribe_API SHALL set no cookie and SHALL include no analytics script and no tracker.
4. THE Say_It_Plainly_Box SHALL NOT store the Plain_Text in local storage, session storage or a cookie.
5. THE Scribe_Lambda SHALL NOT enable CloudFront standard logging or real-time logs for the Distribution, and the Cloud_Stack SHALL define no log bucket.
6. THE Cloud_Stack SHALL NOT enable Bedrock model invocation logging.

### Requirement 18: Unit and property tests with a fake model

**User Story:** As a maintainer, I want tests that need no AWS and no real model, so that CI proves the prompt, the filter and the limits.

#### Acceptance Criteria

1. THE test suite SHALL be written with Vitest, with properties written with fast-check, under `infra/scribe/`, and SHALL use a Fake_Model, a fake counter store and a fixed clock, and SHALL NOT use the network, the real clock or `Math.random()`.
2. THE test suite SHALL include examples that check these Prompt_Builder behaviours: the prompt lists every phrase of the Stagger and Candy Lexicons, includes the unit list, delimits the Plain_Text, escapes a Plain_Text that contains the delimiter, and adds Diagnostics for a Repair_Round.
3. THE test suite SHALL include properties for the Prompt_Builder: determinism (Requirement 7.11), every lexicon phrase present exactly once (Requirement 7.10), and no secret or signal name in the prompt (Requirement 7.9).
4. THE test suite SHALL include examples that check these Compile_Filter behaviours with a Fake_Model: a valid line is accepted in Canonical_Text, a line with a missing unit is rejected with a `MISSING_UNIT` Diagnostic, a `WHERE` line is rejected, fenced JSON is accepted, non-JSON text gives zero lines, duplicates are dropped, and at most 3 lines are returned.
5. THE test suite SHALL include properties for the Compile_Filter: soundness (Requirement 9.12), round trip (Requirement 9.13) and idempotence (Requirement 9.14), over generated valid lines and generated mutations of them (dropped unit, swapped words, unknown robot name).
6. THE test suite SHALL include an example in which the Fake_Model returns one bad line first and a corrected line second, and SHALL check that the second prompt contains the Diagnostics, that exactly 2 rounds ran, and that the response has status `ok`.
7. THE test suite SHALL include an example in which the Fake_Model fails on the Primary_Model and answers on the Fallback_Model, and an example in which both fail, and SHALL check the responses `ok` or `none` and `unavailable` respectively, and that no more than 3 model calls were made.
8. THE test suite SHALL include a model-based property for the Rate_Limiter (Requirements 13.12 and 13.13) over generated call sequences, and examples for the TTL values and bucket keys of Requirement 13.7 and 13.3.
9. THE test suite SHALL include a property that, for generated Plain_Texts, the handler answers HTTP 400 exactly when the trimmed text is empty, longer than 400 characters, or contains a disallowed control character, and calls neither the Rate_Limiter nor the Model_Client in that case.
10. THE test suite SHALL include examples for the origin check: a missing header, a wrong header and a correct header, with the check done before the body is parsed.
11. THE test suite SHALL include a property that the handler's response always satisfies the shape of Requirement 6.5 and never contains `Verdict`, `robustness`, `held` or `broken` fields (Requirement 10.1).
12. THE test suite SHALL include component tests for the Say_It_Plainly_Box with a fake `fetch`: each message of Requirement 14, Degraded_Mode on network error, 404, malformed JSON and timeout, no request at mount, no request on typing, and the Phrase_List shown in every degraded case.
13. THE test suite SHALL include Python `unittest` tests for the pure functions of the Deploy_Script (Requirement 5.14 to 5.16), run without boto3 credentials, including a property-style check of Content-Type case-insensitivity over a generated table of extensions.
14. THE test suite SHALL include a Stack_Template test that parses `infra/stack.yaml` (with a parser that accepts CloudFormation short-form tags) and checks Requirements 1.1, 1.3, 1.7, 3.1 to 3.6, 4.4, 4.5, 12.1, 13.1 and 17.5.
15. THE test suite SHALL NOT weaken an assertion or a requirement to make a test pass. IF a test is wrong, THEN the commit message SHALL state why.
16. THE test suite SHALL name each test by the behaviour it checks, such as `it('rejects a line with a missing unit')`.

### Requirement 19: Smoke script for the deployed endpoint

**User Story:** As a maintainer, I want one command that calls the live endpoint once, so that I know the deploy works end to end.

#### Acceptance Criteria

1. THE Smoke_Script SHALL use only the Python standard library and boto3, and SHALL take the site URL from `--url` or, when absent, from the `SiteUrl` output of the Cloud_Stack read through boto3 in `ap-southeast-2`.
2. THE Smoke_Script SHALL send exactly one `POST` request to `<url>/api/scribe` with the body `{"app":"stagger","text":"it shouldn't fall over if a kid bumps into it"}`.
3. WHEN the response has HTTP status 200 and `status` equal to `ok` or `partial`, THE Smoke_Script SHALL print each returned line, the model identifier, the attempts and the duration in ms, and SHALL exit with code 0.
4. IF the response is `rate_limited`, THEN THE Smoke_Script SHALL print the message and exit with code 3, and IF the response is anything else, THEN THE Smoke_Script SHALL print the status, the HTTP status and the message and exit with code 1.
5. WHEN `--direct` is given, THE Smoke_Script SHALL read the Function_URL from the Cloud_Stack outputs, send one request to it without the `x-golem-origin` header, and exit with code 0 only when the answer is HTTP 403.
6. THE Smoke_Script SHALL print no secret value, and SHALL send no more than 2 requests in one run (the one in criterion 2 and the one in criterion 5).
7. THE Smoke_Script SHALL NOT run in CI, and the CI configuration SHALL NOT invoke it.

### Requirement 20: Packaging, structure and licence

**User Story:** As a maintainer, I want the new code to follow the repository rules, so that it fits the kit and the build stays reproducible.

#### Acceptance Criteria

1. THE repository SHALL hold the cloud code under `infra/` with `stack.yaml`, `deploy.py`, `smoke.py`, a `scribe/` TypeScript package for the Scribe_Lambda, and a `README.md` that states the deploy and smoke commands, the region restriction, and that Python is used only for deploy tooling.
2. THE Scribe_Lambda source SHALL be TypeScript in strict mode, ES modules, targeting Node 20, and SHALL import the EARS_Compiler, the Formatter and the Lexicon types only through the public entry point `golem-spec`, and SHALL import each app's `lexicon.ts` only through the app package for the Lexicon_Catalogue.
3. THE Scribe_Lambda build SHALL produce one bundle file `infra/scribe/dist/index.mjs`, SHALL need no `node_modules` at runtime beyond what the bundle contains, and SHALL use the AWS SDK for JavaScript v3 clients for Bedrock Runtime and DynamoDB.
4. THE Scribe_Lambda SHALL use no `Math.random()` in logic that affects its output, and SHALL take the clock as an injected function, so that tests are deterministic.
5. THE `infra/` files SHALL carry the Apache-2.0 licence notice used by the repository, and SHALL contain no secret, account ID or credential.
6. THE `.gitignore` SHALL list `infra/scribe/dist/` and `infra/.deploy/`, and SHALL NOT list `infra/stack.yaml`.
7. THE Say_It_Plainly_Box SHALL use only React 18 for its UI and no other runtime dependency, and SHALL add no network access other than the same-origin Scribe_API call.
