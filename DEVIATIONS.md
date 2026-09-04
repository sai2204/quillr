# Deviations from spec

Plain-language log of every place the implementation diverged from the original
task prompt, why, and what was actually built instead.

---

## Task 1 — MCP server

### `McpServer` (SDK convenience class) → low-level `Server` class

**Spec said:** validate inputs with Zod; invalid input must be rejected with
standard MCP JSON-RPC error codes (e.g. `-32602 Invalid params`).

**What was built:** [task-1-mcp-server/src/index.ts](task-1-mcp-server/src/index.ts) uses
`@modelcontextprotocol/sdk/server/index.js`'s low-level `Server` class with
manual `CallToolRequestSchema` / `ListToolsRequestSchema` handlers, instead of
the higher-level `McpServer.registerTool()` convenience wrapper.

**Why:** `McpServer.registerTool()` internally catches validation failures
(including its own Zod-schema check) and converts them into a
`CallToolResult` with `isError: true` — a tool-result payload, not a
protocol-level JSON-RPC error object. A client would see
`{"result":{"content":[...],"isError":true}}`, not
`{"error":{"code":-32602,...}}`. This was confirmed by reading
`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`: the
`CallToolRequestSchema` handler's `catch` block explicitly re-wraps any
`McpError` (other than `UrlElicitationRequired`) into `createToolError()`
rather than letting it propagate. The base `Server`/`Protocol` class does not
do this rewrapping — an `McpError` thrown from a handler registered via
`server.setRequestHandler(CallToolRequestSchema, ...)` propagates as a real
top-level JSON-RPC error response, which is what the spec explicitly asked
for. Verified live: a malformed `customer_id` now returns
`{"jsonrpc":"2.0","id":N,"error":{"code":-32602,"message":"..."}}` at the
top level.

---

## Task 4 — Rate limiter + fallback router

### `better-sqlite3` → `node:sqlite`

**Spec said:** persist rate-limit state in on-disk SQLite (suggested
`better-sqlite3` or similar).

**What was built:** [task-4-llm-rate-limit-fallback-router/src/rateLimiter.ts](task-4-llm-rate-limit-fallback-router/src/rateLimiter.ts)
uses Node's built-in `node:sqlite` module (`DatabaseSync`) instead of the
`better-sqlite3` npm package.

**Why:** `better-sqlite3` ships a native addon that has no prebuilt binary
for this machine's Node version (v24.13.0) on Windows, and building from
source via `node-gyp` failed because no Visual Studio "Desktop development
with C++" workload / MSVC toolchain is installed. Rather than requiring the
user to install several GB of build tooling for a take-home-style project,
`node:sqlite` was used instead — it ships with Node itself (stable enough for
this use case, though the runtime does print an `ExperimentalWarning`), needs
no native compilation, and still satisfies the spec's actual requirement: a
real on-disk SQLite file with `(tenant_key, tokens, timestamp)` rows,
survives process restarts, prunes on each check. The task's `README.md`
documents this ("on-disk SQLite" requirement, met via `node:sqlite`) and the
verification pass confirmed the DB file at
`task-4-llm-rate-limit-fallback-router/rate_limit.db` actually persists rows
via a direct query, independent of the app.

### Added `primaryMode` / `secondaryMode` request fields (not in original spec)

**Spec said:** build small mock primary/secondary endpoints, "one that can be
toggled to return 429, hang past 3000ms, or succeed, so failover is provably
exercised" — but didn't specify how the toggle should be addressed per
provider.

**What was built:** [task-4-llm-rate-limit-fallback-router/src/mockProviders.ts](task-4-llm-rate-limit-fallback-router/src/mockProviders.ts)
accepts a `mode` field in its own request body (`"ok" | "429" | "hang"`).
[task-4-llm-rate-limit-fallback-router/src/gateway.ts](task-4-llm-rate-limit-fallback-router/src/gateway.ts) forwards two
independently-settable fields from the client's request —
`req.body.primaryMode` to the primary call and `req.body.secondaryMode` to
the secondary call — instead of a single shared `mode` applied to both.

**Why:** the first version forwarded one `mode` value to both providers
identically (since it's the same request body shape sent to each). That made
it structurally impossible to prove failover-to-a-healthy-secondary: setting
`mode: "429"` failed *both* providers at once, so the client only ever saw
"all providers failed," never "secondary rescued a broken primary." Splitting
into `primaryMode` / `secondaryMode` (with `mode` kept as a back-compat alias
for `primaryMode`) let the verification pass independently break the primary
while leaving the secondary healthy, and vice versa — proving the actual
failover branch, not just the both-down branch. This is a test-ergonomics
change only; it does not affect production request handling logic, since a
real client would never set either field.

### Added `PRAGMA busy_timeout` to the rate limiter's SQLite connection (bug fix, this session)

**What the bug was:** `node:sqlite`'s `DatabaseSync` connection had no busy
timeout configured. `checkAndConsume()` already wrapped its prune → sum →
insert sequence in `BEGIN IMMEDIATE ... COMMIT`, which is the *correct*
mechanism for making the check-and-write atomic against a single connection
— that part of the design was sound. But under genuine concurrent load from
**separate connections** (e.g. multiple gateway processes, or — as built for
this verification — 20 worker threads each opening their own `DatabaseSync`
handle against the same file), a connection trying to acquire the write lock
while another held it would immediately throw
`SQLite: database is locked (ERR_SQLITE_ERROR, errcode 5)` instead of
waiting for the lock to free. This was reproduced directly: 20 concurrent
`TokenRateLimiter` instances against one `rate_limit.db` file threw
`Error: database is locked` on essentially every run before the fix.

**The fix:** added `this.db.exec("PRAGMA busy_timeout = 5000")` immediately
after opening the connection, before any other statement (including the
`CREATE TABLE IF NOT EXISTS` in the constructor, which was itself hitting the
same contention during concurrent first-time schema setup). This tells
SQLite to retry internally for up to 5 seconds instead of failing fast on
`SQLITE_BUSY`. After the fix, the same 20-way concurrent test passed
consistently across 5 repeated runs — every run admitted exactly 10 requests
(50,000 tokens), rejected the other 10, and total admitted tokens never
exceeded the 50,000 cap. See the verification transcript for the exact
before/after commands and output.

This did not require changing the transaction logic itself — `BEGIN
IMMEDIATE` was already correct for atomicity; the gap was purely in how the
connection behaved when it couldn't immediately acquire the lock.

---

## Task 3 — PII redaction gateway

### Error code aligned from a JSON-RPC-style numeric code to a semantic string code

**What was found:** the only error site in
[task-3-llm-pii-redaction-gateway/src/gateway.ts](task-3-llm-pii-redaction-gateway/src/gateway.ts) returned
`{"error":{"code":-32002,"message":"Upstream LLM unavailable"}}` — a numeric
code borrowed from JSON-RPC's error-code space, even though this gateway is
a plain HTTP/SSE service with no `jsonrpc`/`id` envelope anywhere in its
protocol. Task 4's structurally identical plain-HTTP gateway used semantic
string codes (`"rate_limit_exceeded"`, `"upstream_unavailable"`-style
naming) instead. There was no protocol reason for Task 3 to imitate
JSON-RPC — it was simply copied from the pattern used in Task 1/2 without
being adapted to a non-JSON-RPC context.

**Fix:** changed the code to the string `"upstream_unavailable"`, matching
Task 4's convention. See the "Error response consistency" section below for
the full before/after survey.

### Bug found and fixed while verifying the above: unhandled `fetch()` rejection crashed the process

**What the bug was:** the `fetch(UPSTREAM_URL, ...)` call in
`gateway.ts` was not wrapped in try/catch. The `if (!upstream.ok || ...)`
branch only handles the case where upstream *responds* with a bad status —
it does nothing for the case where upstream is unreachable entirely (refuses
the connection, DNS failure, etc.), because `fetch()` *rejects* in that case
rather than resolving to a non-ok `Response`. An unhandled promise rejection
inside an Express async handler crashed the whole Node process. Reproduced
directly: starting only the gateway (no mock upstream running) and sending
one request took the entire server down with an uncaught `TypeError: fetch
failed` / `ECONNREFUSED`.

**Fix:** wrapped the `fetch()` call in its own try/catch, logging the real
error (with stack trace and `ECONNREFUSED` cause) server-side via
`console.error` and returning the same sanitized
`{"error":{"code":"upstream_unavailable","message":"Upstream LLM
unavailable"}}` / HTTP 502 that the not-ok-status branch already returned.
Verified: the same reproduction now returns the sanitized 502 on every
request and the process stays alive and keeps serving subsequent requests
normally once upstream comes back.

---

## Error response consistency across all 4 tasks

Full survey of every error shape each task can return, done by grepping
`error:` / `McpError` sites in each task's source.

| Task | Transport | Shape | `code` type |
|---|---|---|---|
| 1 — MCP server | stdio JSON-RPC | `{jsonrpc:"2.0", id, error:{code, message}}` | number (MCP/JSON-RPC error codes, e.g. `-32602`) |
| 2 — MCP Gateway | HTTP JSON-RPC | `{jsonrpc:"2.0", id, error:{code, message}}` | number (`-32001`, `-32601`, `-32000`) |
| 3 — PII redaction gateway | plain HTTP/SSE | `{error:{code, message}}` | string (`"upstream_unavailable"`) |
| 4 — Rate limit/failover router | plain HTTP | `{error:{code, message}}` | string (`"rate_limit_exceeded"`, `"missing_api_key"`, `"invalid_request"`, `"all_providers_failed"`) |

**Aligned:** Task 3's single error site used a numeric JSON-RPC-style code
(`-32002`) despite not being a JSON-RPC service. Changed to the string
`"upstream_unavailable"` to match Task 4's convention — both are plain HTTP
gateways with no protocol reason to differ. This was cheap and safe: Task 3
has exactly one error response in its whole codebase, and nothing in its
spec or client contract depends on the code being numeric.

**Left alone (protocol-locked):** Task 1 and Task 2 both speak MCP over
JSON-RPC, and JSON-RPC 2.0 mandates the `{jsonrpc, id, error:{code,
message}}` envelope with an integer `code` — this is non-negotiable per the
spec ("Task 1/2 must stay valid JSON-RPC"). Their `error.code` values are
themselves drawn from the JSON-RPC/MCP reserved range (`-32700` to `-32000`)
plus the MCP-specific `-32001` this project defined for `Unauthorized Tool
Call`, which is exactly what a JSON-RPC-based protocol requires — there is
no inconsistency to fix here, and forcing them to match Task 3/4's string
codes would break the JSON-RPC contract itself.

**Field naming:** all four tasks already use `code` and `message` uniformly
— no task used a synonym like `msg` or `error_description`, so no renaming
was needed there.

**Not touched:** Task 2's downstream mock server (`downstream.ts`) also
returns JSON-RPC-shaped errors (`-32601 Method not found` /
`-32601 Unknown tool`) — correct and consistent with Task 1/2's protocol,
left as-is.

---

## Notes on things that look like deviations but aren't

- Task 3's redaction is deliberately "plain pattern matching, no Luhn check"
  for card numbers — this was explicitly requested in the original spec, not
  a shortcut taken unilaterally.
- Task 2's auth scheme (signed JWT with a `role` claim, chosen over a static
  token→role lookup table) was an explicit either/or choice offered by the
  spec; JWT was picked and documented, not a deviation from a single
  prescribed design.
