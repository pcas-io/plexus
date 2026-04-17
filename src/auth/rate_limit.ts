/**
 * Tiny in-memory fixed-window rate limiter.
 *
 * Used to throttle public-facing endpoints (share consumption) and
 * login attempts. Scoped per key (usually the IP). Single-worker only —
 * a multi-worker deployment would need Redis or similar.
 *
 * The limiter returns `true` when the request should be *blocked*.
 *
 * Memory management (LOW-5 from the 2026-04-10 audit
 * entities:llclhdhv5a8yyf27xz4v): the previous version ran cleanup via
 * `Math.random() < 0.01` on every hit, which meant the map was never
 * pruned under low traffic (so stale entries lingered forever) and
 * pruning timing was non-deterministic under high traffic (so cleanup
 * could burst unpredictably). The new design runs a fixed-period
 * setInterval that calls `cleanup()`, `.unref()`s the handle so Node
 * can still exit cleanly, and exposes `close()` for explicit shutdown
 * in tests or graceful-restart paths. `cleanup()` is also directly
 * callable for deterministic testing.
 */

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private cleanupHandle: NodeJS.Timeout | null;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    options: { cleanupIntervalMs?: number } = {},
  ) {
    // Default cleanup cadence is one window — any entry that wasn't
    // touched within its own window is expired by definition, so running
    // cleanup at `windowMs` cadence guarantees at most `2 × windowMs`
    // retention for stale entries.
    const cleanupIntervalMs = options.cleanupIntervalMs ?? windowMs;
    if (cleanupIntervalMs > 0) {
      this.cleanupHandle = setInterval(() => this.cleanup(), cleanupIntervalMs);
      // Do not keep the event loop alive for the cleanup alone.
      this.cleanupHandle.unref();
    } else {
      this.cleanupHandle = null;
    }
  }

  /**
   * Record one hit against `key` and return true if the request should
   * be blocked (limit exceeded).
   */
  hit(key: string): boolean {
    const now = Date.now();
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt < now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return false;
    }
    existing.count += 1;
    return existing.count > this.limit;
  }

  /**
   * Drop all windows whose reset time has already passed. Safe to call
   * at any time; no-op when the map is empty.
   */
  cleanup(): void {
    if (this.windows.size === 0) return;
    const now = Date.now();
    for (const [k, w] of this.windows.entries()) {
      if (w.resetAt < now) this.windows.delete(k);
    }
  }

  /**
   * Current number of tracked windows. Primarily for tests; production
   * code should not depend on this for logic.
   */
  size(): number {
    return this.windows.size;
  }

  /**
   * Stop the internal cleanup interval. Idempotent. Call this in a
   * graceful-shutdown path or from test teardown so Node does not hold
   * a (fortunately already `.unref`'d) interval handle longer than
   * needed.
   */
  close(): void {
    if (this.cleanupHandle !== null) {
      clearInterval(this.cleanupHandle);
      // Null the handle so a second close() is a cheap no-op instead of
      // clearing an already-cleared timer.
      this.cleanupHandle = null;
    }
  }
}
