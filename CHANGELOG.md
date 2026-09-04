# Changelog

## 1. Summary

`quillr` is a set of four independent TypeScript/Node.js services built to a
spec covering: an MCP tool server, an MCP gateway with role-based auth, a
streaming LLM gateway that redacts PII in real time, and a rate-limited
LLM router with primary/secondary failover. Each task lives in its own
folder with its own `package.json` and runs standalone — there is no shared
dependency tree.

## 2. Build log per task

### Task 1 — `task-1-mcp-server/`
- MCP server over stdio transport ([src/index.ts](task-1-mcp-server/src/index.ts)), built on the SDK's
  low-level `Server` class (see Deviations).
- `get_customer_record` and `trigger_refund` tools, Zod-validated
  ([src/schemas.ts](task-1-mcp-server/src/schemas.ts)).
- Mock customer lookup ([src/customers.ts](task-1-mcp-server/src/customers.ts)).
- stderr-only logger via `pino` ([src/logger.ts](task-1-mcp-server/src/logger.ts)) — stdout carries JSON-RPC only.

### Task 2 — `task-2-mcp-gateway-auth/`
- Mock downstream MCP server ([src/downstream.ts](task-2-mcp-gateway-auth/src/downstream.ts)) exposing a normal
  tool (`get_weather`) and an admin-only tool (`admin_reset_key`).
- Gateway/reverse proxy ([src/gateway.ts](task-2-mcp-gateway-auth/src/gateway.ts)) enforcing role-based access on
  `admin_`-prefixed tool calls.
- JWT auth with a `role` claim ([src/auth.ts](task-2-mcp-gateway-auth/src/auth.ts)) plus a token-minting helper
  script ([src/mint-token.ts](task-2-mcp-gateway-auth/src/mint-token.ts)).

### Task 3 — `task-3-llm-pii-redaction-gateway/`
- Mock streaming upstream ([src/mockUpstream.ts](task-3-llm-pii-redaction-gateway/src/mockUpstream.ts)) simulating an SSE token
  stream, including a scenario with an email deliberately split across a
  chunk boundary.
- Sliding-overlap-buffer redaction engine ([src/redactor.ts](task-3-llm-pii-redaction-gateway/src/redactor.ts)) for
  emails, SSNs, and card-like numbers.
- Streaming gateway ([src/gateway.ts](task-3-llm-pii-redaction-gateway/src/gateway.ts)) that re-streams redacted SSE to the
  client without buffering the full response.
- Unit tests ([src/redactor.test.ts](task-3-llm-pii-redaction-gateway/src/redactor.test.ts)) covering in-chunk PII, split-boundary
  PII, and unmodified passthrough of plain text.

### Task 4 — `task-4-llm-rate-limit-fallback-router/`
- SQLite-backed sliding-window token rate limiter ([src/rateLimiter.ts](task-4-llm-rate-limit-fallback-router/src/rateLimiter.ts)),
  50,000 tokens/minute per tenant key.
- Primary/secondary failover router ([src/router.ts](task-4-llm-rate-limit-fallback-router/src/router.ts)) with a 3000ms
  `AbortController` timeout budget on the primary.
- Mock primary/secondary providers ([src/mockProviders.ts](task-4-llm-rate-limit-fallback-router/src/mockProviders.ts)), each
  independently toggleable to succeed, return 429, or hang.
- Gateway tying rate limiting and routing together ([src/gateway.ts](task-4-llm-rate-limit-fallback-router/src/gateway.ts))
  behind `POST /v1/complete`, with sanitized client-facing errors.
- Core test suite ([src/rateLimiter.test.ts](task-4-llm-rate-limit-fallback-router/src/rateLimiter.test.ts)): admission/rejection at
  the cap, tenant isolation, window eviction, partial eviction.
- Window-boundary test suite ([src/rateLimiter.window.test.ts](task-4-llm-rate-limit-fallback-router/src/rateLimiter.window.test.ts)): exact
  eviction edge (`ts === windowStart` vs. one ms older), hit-cap-then-recover
  after the window passes.
- Concurrency test suite ([src/rateLimiter.concurrency.test.ts](task-4-llm-rate-limit-fallback-router/src/rateLimiter.concurrency.test.ts) +
  [src/rateLimiter.concurrency.worker.ts](task-4-llm-rate-limit-fallback-router/src/rateLimiter.concurrency.worker.ts)): 20 real worker
  threads, each on its own SQLite connection, racing the same tenant key at
  the edge of the cap.

## 3. Deviations from spec

Full detail in [DEVIATIONS.md](DEVIATIONS.md). Condensed:

- **Task 1:** `McpServer` convenience wrapper → low-level `Server` class,
  because `registerTool()` swallows Zod validation failures into a
  `CallToolResult{isError:true}` instead of a real top-level JSON-RPC error —
  confirmed by reading the SDK source.
- **Task 4:** `better-sqlite3` → `node:sqlite`, because the native addon had
  no prebuilt binary for this Node version on Windows and no MSVC toolchain
  was available to build it from source; `node:sqlite` needs no compilation
  and still meets the on-disk SQLite requirement.
- **Task 4:** added `primaryMode`/`secondaryMode` fields to the mock
  provider request body (not in the original spec) so the primary and
  secondary could be broken independently, proving actual failover rather
  than only the both-down case.
- **Task 4:** added `PRAGMA busy_timeout` to the rate limiter's SQLite
  connection (bug fix — see section 4).
- **Task 3:** error code aligned from a JSON-RPC-style numeric code
  (`-32002`) to a semantic string code (`"upstream_unavailable"`), matching
  Task 4's convention, since Task 3 is plain HTTP with no JSON-RPC envelope
  and had no reason to imitate one.

## 4. Bugs found and fixed during verification

- **Task 4** Bug: `node:sqlite`'s `DatabaseSync` connection had no busy
  timeout, so concurrent writers from separate connections (e.g. 20 worker
  threads hitting the same rate-limit DB file) threw
  `Error: database is locked` instead of queuing for the lock. Reproduced
  reliably on every run before the fix. -> Fix: added
  `PRAGMA busy_timeout = 5000` immediately after opening the connection, in
  [src/rateLimiter.ts](task-4-llm-rate-limit-fallback-router/src/rateLimiter.ts). Re-ran the same 20-way concurrency test 5
  times after the fix — passed every time, with total admitted tokens
  exactly 50,000 (10 of 20 requests admitted) in each run.

- **Task 3** Bug: the `fetch()` call to the upstream in
  [src/gateway.ts](task-3-llm-pii-redaction-gateway/src/gateway.ts) was not wrapped in try/catch. The existing
  `if (!upstream.ok || ...)` check only handles upstream responding with a
  bad status — it does nothing when upstream is unreachable entirely
  (connection refused, DNS failure), because `fetch()` rejects in that case
  rather than resolving. An unhandled rejection inside the async Express
  handler crashed the whole process. Reproduced directly: starting the
  gateway with no upstream running took the entire server down on the first
  request. -> Fix: wrapped the `fetch()` call in try/catch, logging the real
  error server-side via `console.error` and returning the same sanitized
  `{"error":{"code":"upstream_unavailable",...}}` / HTTP 502 the ok-check
  branch already used. Verified the process now stays alive and keeps
  serving subsequent requests normally.

- **Task 2** Bug: `.env.example` was missing `JWT_SECRET`, even though
  [src/auth.ts](task-2-mcp-gateway-auth/src/auth.ts) and [src/mint-token.ts](task-2-mcp-gateway-auth/src/mint-token.ts) both read
  `process.env.JWT_SECRET`. -> Fix: added `JWT_SECRET` to
  [task-2-mcp-gateway-auth/.env.example](task-2-mcp-gateway-auth/.env.example), confirmed by grepping every
  task's source for `process.env.*` and diffing against its `.env.example`
  line by line — all four tasks now match exactly.

No other bugs were found. The sliding-window eviction condition
(`ts >= windowStart` / `DELETE WHERE ts < windowStart`) was checked
explicitly for off-by-one errors at the exact boundary and was already
correct — no fix was needed there. The `BEGIN IMMEDIATE` transaction logic
in the rate limiter was also already correct for atomicity; the concurrency
bug above was purely about lock-wait behavior, not the transaction design.

## 5. Final verification status

- **Full end-to-end pass (prior session):** 22/22 cases passed across all
  four tasks — stdio JSON-RPC error codes (Task 1), role-based tool blocking
  and downstream-not-called proof (Task 2), split-chunk PII redaction and
  streaming timing (Task 3), and rate-limit/failover/sanitized-error
  behavior (Task 4). All servers confirmed shut down cleanly after, no
  orphaned processes or ports.
- **Window-eviction test (this session):** 4/4 assertions passed. Proved the
  window actually slides — a tenant that hits the 50k cap gets rate-limited,
  then (with time advanced via injected timestamps, no real sleep) the same
  tenant can send requests again once the window has passed. Also proved the
  exact boundary: a row timestamped at `now - WINDOW_MS` still counts; one
  timestamped 1ms earlier does not.
- **Concurrency test (this session):** passed consistently across 6 runs.
  Proved that 20 concurrent requests (100,000 tokens requested total) against
  a 50,000-token cap for one tenant never admit more than the cap — every
  run admitted exactly 10 requests (50,000 tokens) and rejected the other 10,
  even under real cross-connection concurrent load. This is what surfaced
  the `busy_timeout` bug in section 4.

## 6. How to run each task

### Task 1 — MCP server
```
cd task-1-mcp-server
npm install
npm run dev      # runs src/index.ts directly via tsx
# or: npm run build && npm start
```
Speaks JSON-RPC over stdin/stdout; meant to be launched by an MCP client.
Manual test: `npx @modelcontextprotocol/inspector npm run dev`, or pipe a
JSON-RPC request directly, e.g.
`echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npm run dev`.

### Task 2 — MCP Gateway Auth
```
cd task-2-mcp-gateway-auth
npm install
cp .env.example .env
npm run dev          # starts downstream (:4100) and gateway (:4000) together
```
Mint a token: `npx tsx src/mint-token.ts admin` (or `viewer`). Then:
```
TOKEN=$(npx tsx src/mint-token.ts viewer)
curl -s http://localhost:4000 -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_weather","arguments":{}}}'
```

### Task 3 — LLM Streaming PII Redaction Gateway
```
cd task-3-llm-pii-redaction-gateway
npm install
cp .env.example .env
npm run dev          # mock upstream (:5100) + gateway (:5000)
```
```
curl -N http://localhost:5000/v1/chat/stream -H "content-type: application/json" -d '{}'
```
Tests: `npm test`.

### Task 4 — LLM Rate-Limit & Fallback Router
```
cd task-4-llm-rate-limit-fallback-router
npm install
cp .env.example .env
npm run dev           # mock providers (:6100, :6200) + gateway (:6000)
```
```
curl -s http://localhost:6000/v1/complete -H "x-api-key: tenant-1" -H "content-type: application/json" -d '{"estimatedTokens":1000}'
```
Tests: `npm test` (runs `test:core`, `test:window`, and `test:concurrency`).
