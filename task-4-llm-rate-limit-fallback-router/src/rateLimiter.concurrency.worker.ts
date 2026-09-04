import { parentPort, workerData } from "node:worker_threads";
import { TokenRateLimiter } from "./rateLimiter.js";

const { dbPath, tenantKey, tokens, now } = workerData as {
  dbPath: string;
  tenantKey: string;
  tokens: number;
  now: number;
};

// Each worker opens its OWN DatabaseSync connection to the same file — this
// is the only way to exercise real cross-connection SQLite locking. Calling
// checkAndConsume repeatedly from Promise.all in a single process can never
// race, because the method is fully synchronous and Node is single-threaded;
// a true race can only appear across separate connections/threads.
const limiter = new TokenRateLimiter(dbPath);
const result = limiter.checkAndConsume(tenantKey, tokens, now);
limiter.close();

parentPort!.postMessage(result);
