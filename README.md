# quillr

Four independent TypeScript/Node.js services, each in its own folder with its
own `package.json` — no shared dependency tree, each runs standalone.

## [task-1-mcp-server/](task-1-mcp-server/)

An MCP server (official `@modelcontextprotocol/sdk`) over stdio exposing two
Zod-validated tools: `get_customer_record` and `trigger_refund`. Malformed
input is rejected with standard MCP JSON-RPC error codes; all logging goes to
stderr so stdout stays clean JSON-RPC.

```
cd task-1-mcp-server/ && npm install && npm run dev
```

## [task-2-mcp-gateway-auth/](task-2-mcp-gateway-auth/)

An HTTP/JSON-RPC MCP Gateway that sits in front of a mock downstream MCP
server. Reads a role (`admin`/`viewer`) from a signed JWT bearer token and
blocks non-admins from calling `admin_`-prefixed tools with a
`-32001 Unauthorized Tool Call` error.

```
cd task-2-mcp-gateway-auth/ && npm install && npm run dev
```

## [task-3-llm-pii-redaction-gateway/](task-3-llm-pii-redaction-gateway/)

An LLM gateway that proxies a streaming completion from a mock upstream and
redacts emails, SSNs, and card-like numbers in real time using a sliding
overlap buffer — never buffering the full response, and correctly catching
PII patterns split across chunk boundaries.

```
cd task-3-llm-pii-redaction-gateway/ && npm install && npm run dev
# npm test runs the redaction test cases
```

## [task-4-llm-rate-limit-fallback-router/](task-4-llm-rate-limit-fallback-router/)

A resilient model router: a SQLite-backed sliding-window token rate limiter
(50,000 tokens/min per tenant) plus primary→secondary failover on `429` or a
3000ms timeout (via `AbortController`), with sanitized error responses that
never leak upstream internals.

```
cd task-4-llm-rate-limit-fallback-router/ && npm install && npm run dev
# npm test runs the rate limiter test cases
```
