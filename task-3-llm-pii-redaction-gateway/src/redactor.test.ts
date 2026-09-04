import assert from "node:assert/strict";
import { StreamRedactor } from "./redactor.js";

function runStream(chunks: string[]): string {
  const redactor = new StreamRedactor();
  let out = "";
  for (const chunk of chunks) {
    out += redactor.push(chunk);
  }
  out += redactor.flush();
  return out;
}

// (a) PII fully inside one chunk
{
  const out = runStream(["Contact me at bob@example.com please."]);
  assert.ok(out.includes("[REDACTED]"), "email in single chunk should be redacted");
  assert.ok(!out.includes("bob@example.com"), "raw email must not leak");
  console.log("PASS: PII fully inside one chunk");
}

// (b) PII split across a chunk boundary
{
  const out = runStream(["My SSN is 123-", "45-6789, keep it safe."]);
  assert.ok(out.includes("[REDACTED]"), "SSN split across chunks should be redacted");
  assert.ok(!out.includes("123-45-6789"), "raw SSN must not leak");
  console.log("PASS: PII split across chunk boundary");
}

{
  const out = runStream(["reach jane.doe@exam", "ple.com for support"]);
  assert.ok(out.includes("[REDACTED]"), "email split across chunks should be redacted");
  assert.ok(!out.includes("jane.doe@example.com"), "raw email must not leak");
  console.log("PASS: email split across chunk boundary");
}

// (c) non-PII text streams through unmodified
{
  const chunks = ["This is ", "just plain ", "conversational text ", "with nothing sensitive."];
  const out = runStream(chunks);
  assert.equal(out, chunks.join(""), "plain text must pass through unchanged");
  console.log("PASS: non-PII text streams through unmodified");
}

// per-chunk flush should not wait for the whole stream (sanity: early chunks
// produce output before flush(), given enough chunk volume to exceed HOLD_BACK)
{
  const redactor = new StreamRedactor();
  const early = redactor.push("x".repeat(100));
  assert.ok(early.length > 0, "large early chunk should flush immediately, not wait for stream end");
  console.log("PASS: large chunk flushes before stream end");
}

console.log("\nAll redactor tests passed.");
