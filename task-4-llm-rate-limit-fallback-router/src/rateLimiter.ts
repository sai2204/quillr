import { DatabaseSync } from "node:sqlite";

const WINDOW_MS = 60_000;
const MAX_TOKENS_PER_WINDOW = 50_000;

export interface RateLimitResult {
  allowed: boolean;
  tokensUsedInWindow: number;
  remaining: number;
}

export class TokenRateLimiter {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    // Without a busy timeout, concurrent writers from separate connections
    // (e.g. multiple gateway processes, or this test's worker threads) hit
    // SQLITE_BUSY immediately instead of waiting for the lock to free up.
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_key TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_token_usage_tenant_ts ON token_usage (tenant_key, ts);
    `);
  }

  /**
   * Prunes entries older than the window, sums what's left, and — only if
   * admitting `tokens` would stay within budget — records the new entry.
   * Prune-then-check-then-insert all runs inside one transaction so
   * concurrent requests for the same tenant can't race past the limit.
   */
  checkAndConsume(tenantKey: string, tokens: number, now: number): RateLimitResult {
    const windowStart = now - WINDOW_MS;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`DELETE FROM token_usage WHERE tenant_key = ? AND ts < ?`).run(tenantKey, windowStart);

      const row = this.db
        .prepare(`SELECT COALESCE(SUM(tokens), 0) AS used FROM token_usage WHERE tenant_key = ? AND ts >= ?`)
        .get(tenantKey, windowStart) as { used: number };

      const used = row.used;
      if (used + tokens > MAX_TOKENS_PER_WINDOW) {
        this.db.exec("COMMIT");
        return { allowed: false, tokensUsedInWindow: used, remaining: Math.max(0, MAX_TOKENS_PER_WINDOW - used) };
      }

      this.db.prepare(`INSERT INTO token_usage (tenant_key, tokens, ts) VALUES (?, ?, ?)`).run(tenantKey, tokens, now);
      this.db.exec("COMMIT");

      return {
        allowed: true,
        tokensUsedInWindow: used + tokens,
        remaining: MAX_TOKENS_PER_WINDOW - (used + tokens),
      };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}

export { MAX_TOKENS_PER_WINDOW, WINDOW_MS };
