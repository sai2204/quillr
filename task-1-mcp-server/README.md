# Task 1 — MCP Server (stdio)

An MCP server exposing two tools over the stdio transport:

- `get_customer_record` — looks up a mock customer by `customer_id` (`^CUST-[A-Z0-9]{5}$`).
- `trigger_refund` — issues a mock refund; requires `customer_id`, `amount` (> 0), `reason` (>= 10 chars).

All inputs are validated with Zod. Invalid input is rejected by the MCP SDK with a
JSON-RPC `-32602 Invalid params` error before it reaches tool logic — malformed
`customer_id`, non-positive/non-numeric `amount`, and short `reason` are all
covered by the schema in [src/schemas.ts](src/schemas.ts).

**stdout carries JSON-RPC only.** All logging goes to stderr via a `pino`
instance pinned to fd 2 ([src/logger.ts](src/logger.ts)) — `console.log` is never used.

## Run

```
npm install
npm run dev      # ts-node/tsx, runs src/index.ts directly
# or
npm run build && npm start
```

The process speaks JSON-RPC over stdin/stdout. It's meant to be launched by an
MCP client (e.g. Claude Desktop, an MCP Inspector), not used interactively.

## Manual testing

Easiest: use the official inspector CLI, which spawns the server and gives you
a web UI to call tools and see raw JSON-RPC traffic:

```
npx @modelcontextprotocol/inspector npm run dev
```

To test by hand, pipe a single JSON-RPC request into the process over stdin.
Example — list tools:

```
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npm run dev
```

Example — valid call:

```
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-A1B2C"}}}' | npm run dev
```

Example — invalid input (bad customer_id format) returns a `-32602` error:

```
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"bad-id","amount":10,"reason":"long enough reason"}}}' | npm run dev
```

Note: the MCP handshake requires an `initialize` call before other methods in
a real client session; the inspector handles this for you automatically.
