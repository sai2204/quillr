import pino from "pino";

// stdout is reserved for JSON-RPC framing over the stdio transport — every
// log line must go to stderr or it corrupts the protocol stream.
export const logger = pino(
  { level: process.env.LOG_LEVEL ?? "info" },
  pino.destination(2),
);
