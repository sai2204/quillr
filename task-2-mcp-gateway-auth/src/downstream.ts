import "dotenv/config";
import express from "express";
import type { JsonRpcRequest } from "./types.js";

const PORT = Number(process.env.DOWNSTREAM_PORT ?? 4100);

const TOOLS = [
  { name: "get_weather", description: "Returns mock weather for a city." },
  { name: "admin_reset_key", description: "Resets a tenant's API key (admin only)." },
];

const app = express();
app.use(express.json());

app.post("/", (req, res) => {
  const body = req.body as JsonRpcRequest;
  console.error(`[downstream] received method=${body.method} tool=${body.params?.name ?? ""}`);

  if (body.method === "tools/list") {
    res.json({ jsonrpc: "2.0", id: body.id, result: { tools: TOOLS } });
    return;
  }

  if (body.method === "tools/call") {
    const name = body.params?.name;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      });
      return;
    }
    res.json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        content: [{ type: "text", text: `mock result from ${name}` }],
      },
    });
    return;
  }

  res.json({
    jsonrpc: "2.0",
    id: body.id,
    error: { code: -32601, message: `Method not found: ${body.method}` },
  });
});

app.listen(PORT, () => {
  console.error(`[downstream] mock MCP server listening on :${PORT}`);
});
