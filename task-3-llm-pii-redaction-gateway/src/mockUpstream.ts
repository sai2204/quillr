import "dotenv/config";
import express from "express";

const PORT = Number(process.env.UPSTREAM_PORT ?? 5100);

// Scenario: an email is deliberately split mid-string across two deltas
// ("jane.doe@exam" | "ple.com") to prove the gateway's overlap buffer works.
const SCENARIOS: Record<string, string[]> = {
  default: [
    "Sure, here is the info you asked for. ",
    "Please contact us at jane.doe@exam",
    "ple.com for support. ",
    "Your SSN on file is 123-45-6789 and ",
    "your card ending in 4242 is 4111 1111 1111 1234. ",
    "Thanks for reaching out, have a great day!",
  ],
  plain: [
    "This is a perfectly ordinary response ",
    "with no sensitive information in it ",
    "whatsoever, just plain conversational text.",
  ],
  email_in_one_chunk: [
    "Sure, you can reach support at bob.smith@example.com right away. ",
    "Let us know if you need anything else.",
  ],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const app = express();
app.use(express.json());

app.post("/v1/chat/stream", async (req, res) => {
  const scenario = (req.body?.scenario as string) ?? "default";
  const deltas = SCENARIOS[scenario] ?? SCENARIOS.default;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  for (const delta of deltas) {
    res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    await sleep(30);
  }
  res.write("data: [DONE]\n\n");
  res.end();
});

app.listen(PORT, () => {
  console.error(`[mock-upstream] streaming mock LLM listening on :${PORT}`);
});
