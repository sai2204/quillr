// Longest pattern we redact is a 16-digit card, optionally grouped with
// spaces/dashes (worst case "XXXX-XXXX-XXXX-XXXX" = 19 chars). Hold back a
// margin comfortably larger than that so a match can never be split between
// what we flush and what we hold.
const HOLD_BACK = 40;

const PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b(?:\d[ -]?){13,16}\b/g,
];

function redactText(text: string): string {
  let result = text;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Streams chunks through a sliding overlap buffer so a PII pattern split
 * across two chunk boundaries still gets caught. Each call is O(chunk size
 * + HOLD_BACK), never O(total stream size so far).
 */
export class StreamRedactor {
  private carry = "";

  push(chunk: string): string {
    const combined = this.carry + chunk;

    if (combined.length <= HOLD_BACK) {
      this.carry = combined;
      return "";
    }

    const splitAt = combined.length - HOLD_BACK;
    const safeToFlush = combined.slice(0, splitAt);
    this.carry = combined.slice(splitAt);

    return redactText(safeToFlush);
  }

  flush(): string {
    const remaining = redactText(this.carry);
    this.carry = "";
    return remaining;
  }
}
