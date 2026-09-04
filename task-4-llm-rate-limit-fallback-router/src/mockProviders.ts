import "dotenv/config";
import express from "express";

const PRIMARY_PORT = Number(process.env.PRIMARY_PORT ?? 6100);
const SECONDARY_PORT = Number(process.env.SECONDARY_PORT ?? 6200);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// mode drives failover scenarios: "ok" (default), "429", or "hang" (never responds)
function makeProvider(name: string, port: number): void {
  const app = express();
  app.use(express.json());

  app.post("/v1/complete", async (req, res) => {
    const mode = (req.body?.mode as string) ?? "ok";

    if (mode === "429") {
      res.status(429).json({ error: { code: "rate_limited", message: `${name} is rate limited` } });
      return;
    }

    if (mode === "hang") {
      // never resolves within the gateway's 3000ms budget; gateway aborts us
      await sleep(60_000);
      return;
    }

    await sleep(200);
    res.json({ provider: name, text: `mock completion from ${name}` });
  });

  app.listen(port, () => {
    console.error(`[${name}] mock provider listening on :${port}`);
  });
}

makeProvider("primary", PRIMARY_PORT);
makeProvider("secondary", SECONDARY_PORT);
