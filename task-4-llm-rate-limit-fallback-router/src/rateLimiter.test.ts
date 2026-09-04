import assert from "node:assert/strict";
import fs from "node:fs";
import { TokenRateLimiter, WINDOW_MS } from "./rateLimiter.js";

const DB_PATH = "./test_rate_limit.db";
for (const suffix of ["", "-wal", "-shm"]) {
  if (fs.existsSync(DB_PATH + suffix)) fs.rmSync(DB_PATH + suffix);
}

const limiter = new TokenRateLimiter(DB_PATH);
const T0 = 1_000_000;

// admits up to the cap
{
  const r1 = limiter.checkAndConsume("tenant-a", 30_000, T0);
  assert.equal(r1.allowed, true);
  const r2 = limiter.checkAndConsume("tenant-a", 20_000, T0 + 1000);
  assert.equal(r2.allowed, true);
  assert.equal(r2.tokensUsedInWindow, 50_000);
  console.log("PASS: admits requests up to the 50k cap");
}

// rejects over the cap within the same window
{
  const r3 = limiter.checkAndConsume("tenant-a", 1, T0 + 2000);
  assert.equal(r3.allowed, false, "one token over budget should be rejected");
  console.log("PASS: rejects request that would exceed the cap");
}

// tenants are isolated
{
  const r4 = limiter.checkAndConsume("tenant-b", 50_000, T0 + 2000);
  assert.equal(r4.allowed, true, "a different tenant has its own budget");
  console.log("PASS: tenants are isolated");
}

// sliding window: once ALL prior entries age past 60s, budget fully frees up
{
  const afterWindow = T0 + 1000 + WINDOW_MS + 1;
  const r5 = limiter.checkAndConsume("tenant-a", 50_000, afterWindow);
  assert.equal(r5.allowed, true, "entries older than the 60s window must be evicted, freeing the full budget");
  console.log("PASS: sliding window evicts entries older than 60s");
}

// partial eviction: only the expired slice of usage is pruned, not everything
{
  limiter.checkAndConsume("tenant-c", 25_000, T0);
  limiter.checkAndConsume("tenant-c", 25_000, T0 + 59_000);
  // by T0+60_001 the T0 row has aged out (25k freed) but the T0+59_000 row
  // has not, so tenant-c has 25k used and 25k remaining, not the full 50k
  const r6 = limiter.checkAndConsume("tenant-c", 25_001, T0 + 60_001);
  assert.equal(r6.allowed, false, "still-valid usage from the second entry should block a request just over the freed budget");
  const r7 = limiter.checkAndConsume("tenant-c", 25_000, T0 + 60_001);
  assert.equal(r7.allowed, true, "exactly the freed budget should be admitted");
  console.log("PASS: partial window eviction keeps still-valid usage counted");
}

limiter.close();
for (const suffix of ["", "-wal", "-shm"]) {
  if (fs.existsSync(DB_PATH + suffix)) fs.rmSync(DB_PATH + suffix);
}

console.log("\nAll rate limiter tests passed.");
