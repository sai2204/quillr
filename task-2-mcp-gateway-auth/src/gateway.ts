import "dotenv/config";
import express from "express";
import type { JsonRpcRequest, JsonRpcErrorResponse } from "./types.js";
import { extractRole, AuthError } from "./auth.js";

const PORT = Number(process.env.GATEWAY_PORT ?? 4000);
const DOWNSTREAM_URL = process.env.DOWNSTREAM_URL ?? "http://localhost:4100";

const app = express();
app.use(express.json());

function rpcError(id: string | number | null, code: number, message: string): JsonRpcErrorResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

app.post("/", async (req, res) => {
  const body = req.body as JsonRpcRequest;
  const id = body?.id ?? null;

  let role: "admin" | "viewer";
  try {
    role = extractRole(req.header("authorization"));
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(401).json(rpcError(id, -32000, err.message));
      return;
    }
    throw err;
  }

  if (body.method === "tools/call" && body.params?.name?.startsWith("admin_") && role !== "admin") {
    res.json(rpcError(id, -32001, "Unauthorized Tool Call"));
    return;
  }

  if (body.method !== "tools/list" && body.method !== "tools/call") {
    res.json(rpcError(id, -32601, `Method not found: ${body.method}`));
    return;
  }

  try {
    const upstream = await fetch(DOWNSTREAM_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    res.json(data);
  } catch {
    res.status(502).json(rpcError(id, -32002, "Downstream MCP server unavailable"));
  }
});

app.listen(PORT, () => {
  console.error(`[gateway] MCP gateway listening on :${PORT}, forwarding to ${DOWNSTREAM_URL}`);
});
