import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { MAX_TOKENS_PER_WINDOW } from "./rateLimiter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../test_concurrency_rate_limit.db");
const WORKER_PATH = path.resolve(__dirname, "./rateLimiter.concurrency.worker.ts");

for (const suffix of ["", "-wal", "-shm"]) {
  if (fs.existsSync(DB_PATH + suffix)) fs.rmSync(DB_PATH + suffix);
}

interface WorkerResult {
  allowed: boolean;
  tokensUsedInWindow: number;
  remaining: number;
}

function runWorker(tenantKey: string, tokens: number, now: number): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      execArgv: ["--import", "tsx"],
      workerData: { dbPath: DB_PATH, tenantKey, tokens, now },
    });
    worker.on("message", (msg: WorkerResult) => resolve(msg));
    worker.on("error", reject);
  });
}

async function main() {
  const TENANT = "tenant-concurrent";
  const REQUEST_TOKENS = 5_000;
  const CONCURRENT_REQUESTS = 20; // 20 x 5000 = 100,000 requested; cap is 50,000 -> exactly half should be admitted
  const now = Date.now();

  console.log(`Firing ${CONCURRENT_REQUESTS} concurrent requests of ${REQUEST_TOKENS} tokens each (${CONCURRENT_REQUESTS * REQUEST_TOKENS} total requested, cap is ${MAX_TOKENS_PER_WINDOW})...`);

  const results = await Promise.all(
    Array.from({ length: CONCURRENT_REQUESTS }, () => runWorker(TENANT, REQUEST_TOKENS, now)),
  );

  const admitted = results.filter((r) => r.allowed);
  const rejected = results.filter((r) => !r.allowed);
  const totalAdmittedTokens = admitted.length * REQUEST_TOKENS;

  console.log(`Admitted: ${admitted.length} requests (${totalAdmittedTokens} tokens)`);
  console.log(`Rejected: ${rejected.length} requests`);
  console.log("Raw results:", JSON.stringify(results, null, 2));

  assert.ok(
    totalAdmittedTokens <= MAX_TOKENS_PER_WINDOW,
    `admitted tokens (${totalAdmittedTokens}) must never exceed the cap (${MAX_TOKENS_PER_WINDOW}) even under concurrent load`,
  );
  assert.equal(
    admitted.length,
    MAX_TOKENS_PER_WINDOW / REQUEST_TOKENS,
    `expected exactly ${MAX_TOKENS_PER_WINDOW / REQUEST_TOKENS} of ${CONCURRENT_REQUESTS} requests to be admitted (50k budget / 5k per request)`,
  );

  console.log(`PASS: total admitted tokens (${totalAdmittedTokens}) never exceeded the cap (${MAX_TOKENS_PER_WINDOW}) under ${CONCURRENT_REQUESTS}-way concurrency`);

  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(DB_PATH + suffix)) fs.rmSync(DB_PATH + suffix);
  }

  console.log("\nAll concurrency tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
