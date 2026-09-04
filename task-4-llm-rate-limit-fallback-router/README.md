# Task 4 — LLM Rate-Limit & Fallback Router

A resilient completion-routing gateway: per-tenant token rate limiting backed
by on-disk SQLite, plus primary→secondary failover with a hard timeout.

- [src/rateLimiter.ts](src/rateLimiter.ts) — `TokenRateLimiter`, sliding-window limiter over SQLite.
- [src/router.ts](src/router.ts) — `routeCompletion`, primary/secondary failover with `AbortController`.
- [src/mockProviders.ts](src/mockProviders.ts) — mock primary (:6100) and secondary (:6200) endpoints, each
  toggleable per-request via `{ "mode": "ok" | "429" | "hang" }`. The gateway
  exposes independent `primaryMode` / `secondaryMode` fields so a caller can
  break just the primary and prove failover to a healthy secondary.
- [src/gateway.ts](src/gateway.ts) — ties both together behind `POST /v1/complete`.

## Sliding window rate limiting

Limit: **50,000 tokens/minute per tenant API key** (`X-API-Key` header),
enforced with a true sliding window, not a fixed bucket.

Each request is logged as a `(tenant_key, tokens, ts)` row in SQLite. On every
check, inside a single transaction:

1. `DELETE` rows for that tenant with `ts < now - 60_000` — evicts exactly
   the entries that have aged out, nothing more, nothing less. This runs on
   every request rather than on a timer, so the table never accumulates
   unbounded history and there's no separate cleanup job to keep alive.
2. `SUM(tokens)` over what's left is the tenant's true usage in the trailing
   60-second window.
3. If `used + requested <= 50_000`, insert the new row and admit; otherwise
   reject with `429` and leave the row out (a rejected request doesn't count
   against the tenant).

Running prune → check → insert inside one `BEGIN IMMEDIATE` / `COMMIT`
transaction over `node:sqlite`'s `DatabaseSync` (synchronous, so no other
statement can interleave) closes the race where two concurrent requests both
read a stale `used` value and both get admitted past the cap. A
`PRAGMA busy_timeout` is set on the connection so concurrent writers from
separate connections queue for the lock instead of failing fast with
`database is locked`.

Because the log is per-tenant timestamped rows rather than a single counter,
the window boundary is exact — there's no fixed-window edge effect where
usage resets sharply every 60s regardless of actual request timing.

## Failover routing

`routeCompletion` calls the primary with a **3000ms** budget via
`AbortController`: a `setTimeout` calls `controller.abort()` at 3000ms, which
rejects the in-flight `fetch` with an `AbortError` rather than leaving it
dangling. A primary `429` or any other non-2xx also triggers failover
immediately, without waiting out the rest of the timeout budget.

On any primary failure (abort, 429, network error), the secondary is called
with no timeout of its own — it's the last resort. If both fail, a single
`GatewayError("all_providers_failed", ...)` is thrown upward.

**Race handling**: the timer and the fetch's own rejection are racing by
construction (`AbortController` is exactly this pattern) — whichever fires
first wins, and `clearTimeout` in the `finally` block guarantees the timer
never fires after a request that already resolved, so a slow-but-eventually-
successful primary response arriving after 3000ms can never double-fire
against a request that already fell back to secondary.

## Sanitized errors

The gateway never forwards raw upstream JSON, stack traces, or provider URLs
to the client. `GatewayError` carries only a short `code` and `message`; the
actual underlying error (including the real cause and URL) is logged via
`console.error` server-side only. Client-facing shape:

```json
{ "error": { "code": "all_providers_failed", "message": "All upstream providers failed to respond" } }
```

## Run

```
npm install
cp .env.example .env
npm run dev           # mock providers (:6100, :6200) + gateway (:6000)
```

```
# normal request
curl -s http://localhost:6000/v1/complete -H "x-api-key: tenant-1" -H "content-type: application/json" -d '{"estimatedTokens":1000}'

# force primary to 429, secondary healthy -> failover succeeds
curl -s http://localhost:6000/v1/complete -H "x-api-key: tenant-1" -H "content-type: application/json" -d '{"estimatedTokens":1000,"primaryMode":"429"}'

# force primary to hang past 3000ms, secondary healthy -> aborted, failover succeeds
curl -s http://localhost:6000/v1/complete -H "x-api-key: tenant-1" -H "content-type: application/json" -d '{"estimatedTokens":1000,"primaryMode":"hang"}'

# force both down -> sanitized all_providers_failed error
curl -s http://localhost:6000/v1/complete -H "x-api-key: tenant-1" -H "content-type: application/json" -d '{"estimatedTokens":1000,"primaryMode":"429","secondaryMode":"429"}'

# exceed 50k tokens/min for a tenant -> 429 rate_limit_exceeded
for i in 1 2 3 4 5 6; do curl -s http://localhost:6000/v1/complete -H "x-api-key: tenant-2" -H "content-type: application/json" -d '{"estimatedTokens":9000}'; done
```

## Tests

```
npm test                     # runs all three suites below
npm run test:core            # admission/rejection/tenant isolation/window eviction
npm run test:window          # window-boundary edge cases (exact ts === windowStart, etc.)
npm run test:concurrency     # 20 concurrent worker threads racing the same tenant key
```

Covers: admission up to the cap, rejection just over the cap, tenant
isolation, window eviction after 60s, partial eviction (only expired rows
pruned, still-valid usage stays counted), the exact window boundary (a row
timestamped at `now - WINDOW_MS` still counts; one 1ms older does not), and
that total admitted tokens never exceed the 50k cap under real concurrent
load from separate SQLite connections.
