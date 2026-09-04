# Task 2 — MCP Gateway Auth

An HTTP/JSON-RPC reverse proxy that sits in front of a downstream MCP server
and enforces role-based access on admin-prefixed tools.

- [src/downstream.ts](src/downstream.ts) — minimal mock MCP server (`tools/list`, `tools/call`) exposing
  `get_weather` (normal) and `admin_reset_key` (admin-only) tools.
- [src/gateway.ts](src/gateway.ts) — the proxy.
- [src/auth.ts](src/auth.ts) — token verification.

## Auth scheme

**Signed JWT with a `role` claim.** The gateway expects
`Authorization: Bearer <jwt>` where the JWT is signed with `JWT_SECRET` and
carries `{ role: "admin" | "viewer" }`. This is the only auth mechanism
implemented — there is no separate static-token table.

Mint a test token:

```
npx tsx src/mint-token.ts admin
npx tsx src/mint-token.ts viewer
```

## Gateway logic

1. Missing/malformed `Authorization` header, invalid/expired JWT, or missing
   `role` claim → `401` with a JSON-RPC-shaped error body, before the request
   body is even interpreted as JSON-RPC.
2. `method: "tools/list"` → forwarded to downstream unmodified.
3. `method: "tools/call"` with `params.name` starting with `admin_` and
   `role !== "admin"` → rejected locally without contacting downstream:
   `{ error: { code: -32001, message: "Unauthorized Tool Call" } }`.
4. Otherwise forwarded to downstream and the response relayed as-is.

Stateless per request — no sessions.

## Run

```
npm install
cp .env.example .env
npm run dev          # starts downstream (:4100) and gateway (:4000) together
```

## Try it

```
TOKEN=$(npx tsx src/mint-token.ts viewer)

# allowed: normal tool
curl -s http://localhost:4000 -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_weather","arguments":{}}}'

# blocked: viewer calling admin_ tool -> -32001 Unauthorized Tool Call
curl -s http://localhost:4000 -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"admin_reset_key","arguments":{}}}'

# no Authorization header -> 401
curl -s http://localhost:4000 -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}'
```
