import "dotenv/config";
import express from "express";
import path from "node:path";
import { TokenRateLimiter } from "./rateLimiter.js";
import { routeCompletion, GatewayError } from "./router.js";

const PORT = Number(process.env.GATEWAY_PORT ?? 6000);
const PRIMARY_URL = process.env.PRIMARY_URL ?? "http://localhost:6100/v1/complete";
const SECONDARY_URL = process.env.SECONDARY_URL ?? "http://localhost:6200/v1/complete";
const DB_PATH = process.env.RATE_LIMIT_DB_PATH ?? path.join(process.cwd(), "rate_limit.db");

const limiter = new TokenRateLimiter(DB_PATH);

const app = express();
app.use(express.json());

app.post("/v1/complete", async (req, res) => {
  const tenantKey = req.header("x-api-key");
  if (!tenantKey) {
    res.status(401).json({ error: { code: "missing_api_key", message: "X-API-Key header is required" } });
    return;
  }

  const estimatedTokens = Number(req.body?.estimatedTokens ?? 100);
  if (!Number.isFinite(estimatedTokens) || estimatedTokens <= 0) {
    res.status(400).json({ error: { code: "invalid_request", message: "estimatedTokens must be a positive number" } });
    return;
  }

  const limit = limiter.checkAndConsume(tenantKey, estimatedTokens, Date.now());
  if (!limit.allowed) {
    res.status(429).json({
      error: { code: "rate_limit_exceeded", message: "Token rate limit exceeded for this tenant" },
    });
    return;
  }

  try {
    const result = await routeCompletion(
      PRIMARY_URL,
      SECONDARY_URL,
      { mode: req.body?.primaryMode ?? req.body?.mode },
      { mode: req.body?.secondaryMode },
    );
    res.json(result);
  } catch (err) {
    const gwErr = err instanceof GatewayError ? err : new GatewayError("internal_error", "Unexpected gateway failure");
    console.error("[gateway] completion failed:", err);
    res.status(502).json({ error: { code: gwErr.code, message: "All upstream providers failed to respond" } });
  }
});

app.listen(PORT, () => {
  console.error(`[gateway] rate-limit/failover gateway listening on :${PORT}`);
});
