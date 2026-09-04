import "dotenv/config";
import express from "express";
import { StreamRedactor } from "./redactor.js";

const PORT = Number(process.env.GATEWAY_PORT ?? 5000);
const UPSTREAM_URL = process.env.UPSTREAM_URL ?? "http://localhost:5100/v1/chat/stream";

const app = express();
app.use(express.json());

app.post("/v1/chat/stream", async (req, res) => {
  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: req.body?.scenario }),
    });
  } catch (err) {
    console.error("[gateway] failed to reach upstream:", err);
    res.status(502).json({ error: { code: "upstream_unavailable", message: "Upstream LLM unavailable" } });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    res.status(502).json({ error: { code: "upstream_unavailable", message: "Upstream LLM unavailable" } });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const redactor = new StreamRedactor();
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n\n");
      sseBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const payload = line.replace(/^data: /, "").trim();
        if (payload === "[DONE]") continue;
        if (!payload) continue;

        const { delta } = JSON.parse(payload) as { delta: string };
        const safe = redactor.push(delta);
        if (safe) {
          res.write(`data: ${JSON.stringify({ delta: safe })}\n\n`);
        }
      }
    }

    const remaining = redactor.flush();
    if (remaining) {
      res.write(`data: ${JSON.stringify({ delta: remaining })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.error(`[gateway] PII-redaction LLM gateway listening on :${PORT}`);
});
