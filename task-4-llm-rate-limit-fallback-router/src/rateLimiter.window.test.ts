import assert from "node:assert/strict";
import fs from "node:fs";
import { TokenRateLimiter, WINDOW_MS, MAX_TOKENS_PER_WINDOW } from "./rateLimiter.js";

const DB_PATH = "./test_window_rate_limit.db";
for (const suffix of ["", "-wal", "-shm"]) {
  if (fs.existsSync(DB_PATH + suffix)) fs.rmSync(DB_PATH + suffix);
}

const limiter = new TokenRateLimiter(DB_PATH);
const T0 = 10_000_000;

// 1. Hit the cap with real HTTP-shaped calls (no real sleep — `now` is
//    injected directly, which is how the gateway itself calls this: it
//    passes Date.now() as a parameter rather than the limiter reading the
//    clock itself. That parameter IS the injection point.)
{
  const r1 = limiter.checkAndConsume("tenant-slide", 50_000, T0);
  assert.equal(r1.allowed, true, "first request should consume the full 50k budget");

  const r2 = limiter.checkAndConsume("tenant-slide", 1, T0 + 5000);
  assert.equal(r2.allowed, false, "tenant should now be rate-limited within the same window");
  console.log("PASS: tenant hits the 50k/min cap and gets rate-limited");
}

// 2. Advance time past the 1-minute window (no real sleep) and confirm the
//    same tenant can send requests again.
{
  const afterWindow = T0 + WINDOW_MS + 1;
  const r3 = limiter.checkAndConsume("tenant-slide", 50_000, afterWindow);
  assert.equal(r3.allowed, true, "after the window has fully passed, the tenant should be able to consume the full budget again");
  console.log("PASS: after the window passes, the same tenant can send requests again");
}

// 3. Exact boundary: a row timestamped exactly at windowStart (now - WINDOW_MS)
//    must still count (inclusive lower bound), while a row 1ms older must not.
{
  limiter.checkAndConsume("tenant-boundary", 1, T0);      // ts = T0
  const now = T0 + WINDOW_MS;                              // windowStart = T0 exactly
  // row at ts=T0 satisfies ts >= windowStart (T0 >= T0) -> NOT evicted, still counted
  const r4 = limiter.checkAndConsume("tenant-boundary", MAX_TOKENS_PER_WINDOW, now);
  assert.equal(r4.allowed, false, "a row exactly at the window boundary (ts === windowStart) must still count against the cap");
  console.log("PASS: row exactly at the window boundary (ts === windowStart) still counts");
}
{
  limiter.checkAndConsume("tenant-boundary-2", 1, T0);     // ts = T0
  const now = T0 + WINDOW_MS + 1;                           // windowStart = T0 + 1
  // row at ts=T0 fails ts >= windowStart (T0 >= T0+1 is false) -> evicted
  const r5 = limiter.checkAndConsume("tenant-boundary-2", MAX_TOKENS_PER_WINDOW, now);
  assert.equal(r5.allowed, true, "a row 1ms outside the window (ts === windowStart - 1) must be evicted and not count");
  console.log("PASS: row 1ms outside the window (ts === windowStart - 1) is evicted");
}

limiter.close();
for (const suffix of ["", "-wal", "-shm"]) {
  if (fs.existsSync(DB_PATH + suffix)) fs.rmSync(DB_PATH + suffix);
}

console.log("\nAll sliding-window tests passed.");
