# Task 3 — LLM Streaming PII Redaction Gateway

An LLM gateway that proxies a streaming completion request to a mock upstream
and re-streams the response to the client with PII redacted in real time,
without buffering the full response in memory.

- [src/mockUpstream.ts](src/mockUpstream.ts) — mock upstream that streams SSE deltas, simulating an
  OpenAI/Anthropic-style token stream. The `default` scenario deliberately
  splits an email address (`jane.doe@exam` | `ple.com`) across two chunks.
- [src/redactor.ts](src/redactor.ts) — `StreamRedactor`, the sliding-overlap-buffer redaction engine.
- [src/gateway.ts](src/gateway.ts) — consumes the upstream SSE stream chunk-by-chunk and re-streams
  redacted SSE to the client.

## Redaction

Detects and replaces with `[REDACTED]`: email addresses, SSNs (`XXX-XX-XXXX`),
and 13-16 digit sequences (optionally grouped with spaces/dashes) as a stand-in
for credit card numbers. Plain pattern matching only — no Luhn check.

## How the sliding buffer works

A regex can't be safely applied to each raw chunk in isolation, because a
match (e.g. an email) can be split across the boundary between two chunks. At
the same time we must not buffer the whole response — that would kill both
memory bounds and time-to-first-byte.

`StreamRedactor.push(chunk)`:

1. Appends the new chunk to a small `carry` string held from the previous call.
2. Holds back the last `HOLD_BACK` (40) characters of the combined
   string — comfortably longer than any pattern we match (worst case ~19
   chars for a grouped 16-digit card) — and redacts + flushes everything
   before that point.
3. The held-back tail becomes next call's `carry`, so a pattern straddling the
   old boundary is now whole and inside the next redaction pass.

`flush()` is called once the stream ends to redact and emit whatever's left
in `carry`.

This keeps each `push()` O(chunk size + 40) — never O(total response size) —
and the client sees output within one chunk's latency, not after the full
response completes.

## Error handling

If the upstream is unreachable (connection refused/DNS failure) or responds
with a non-2xx status, the gateway returns a sanitized HTTP 502:

```json
{ "error": { "code": "upstream_unavailable", "message": "Upstream LLM unavailable" } }
```

The real error (stack trace, connection cause) is logged server-side via
`console.error` only — never forwarded to the client.

## Run

```
npm install
cp .env.example .env
npm run dev          # mock upstream (:5100) + gateway (:5000)
```

```
curl -N http://localhost:5000/v1/chat/stream -H "content-type: application/json" -d '{}'
curl -N http://localhost:5000/v1/chat/stream -H "content-type: application/json" -d '{"scenario":"plain"}'
```

## Tests

```
npm test
```

Covers: PII fully inside one chunk, PII split across a chunk boundary
(including the email deliberately split by the mock upstream), and non-PII
text passing through byte-for-byte unmodified.
