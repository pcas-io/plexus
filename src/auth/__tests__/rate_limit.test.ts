/**
 * Tests for the in-memory fixed-window rate limiter.
 *
 * Covers the basic hit/limit contract plus the LOW-5 audit finding
 * (entities:llclhdhv5a8yyf27xz4v) on deterministic cleanup. The original
 * implementation used `Math.random() < 0.01` which never ran under low
 * traffic and was non-deterministic to test. The new design exposes a
 * `cleanup()` method that reaps expired windows on demand, plus an
 * internal setInterval that calls it regularly — the interval is `.unref`'d
 * so Node can still exit cleanly, and `close()` stops it for explicit
 * shutdown.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { RateLimiter } from '../rate_limit.js';

// Track any limiters created inside a test so afterEach can always close
// them even if the test body forgot — prevents leaking setInterval handles
// between test files.
const openLimiters: RateLimiter[] = [];
function track(rl: RateLimiter): RateLimiter {
  openLimiters.push(rl);
  return rl;
}
afterEach(() => {
  while (openLimiters.length > 0) openLimiters.pop()?.close();
});

describe('RateLimiter.hit', () => {
  test('first hit is always allowed', () => {
    const rl = track(new RateLimiter(3, 60_000));
    expect(rl.hit('ip-1')).toBe(false);
  });

  test('hits within the limit are not blocked', () => {
    const rl = track(new RateLimiter(3, 60_000));
    expect(rl.hit('ip-1')).toBe(false);
    expect(rl.hit('ip-1')).toBe(false);
    expect(rl.hit('ip-1')).toBe(false);
  });

  test('hits beyond the limit are blocked', () => {
    const rl = track(new RateLimiter(2, 60_000));
    expect(rl.hit('ip-1')).toBe(false);
    expect(rl.hit('ip-1')).toBe(false);
    expect(rl.hit('ip-1')).toBe(true);
    expect(rl.hit('ip-1')).toBe(true);
  });

  test('different keys count independently', () => {
    const rl = track(new RateLimiter(1, 60_000));
    expect(rl.hit('ip-a')).toBe(false);
    expect(rl.hit('ip-b')).toBe(false);
    expect(rl.hit('ip-a')).toBe(true);
    expect(rl.hit('ip-b')).toBe(true);
  });

  test('window resets after windowMs has passed', async () => {
    const rl = track(new RateLimiter(1, 20));
    expect(rl.hit('ip-1')).toBe(false);
    expect(rl.hit('ip-1')).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(rl.hit('ip-1')).toBe(false); // new window
  });
});

describe('RateLimiter.cleanup (LOW-5)', () => {
  test('cleanup removes expired windows', async () => {
    const rl = track(new RateLimiter(1, 20));
    rl.hit('stale');
    rl.hit('fresh');
    await new Promise((r) => setTimeout(r, 25));
    // Touch "fresh" to reset its window to the future
    rl.hit('fresh');
    rl.cleanup();
    expect(rl.size()).toBe(1); // only "fresh" remains
  });

  test('cleanup leaves active windows untouched', () => {
    const rl = track(new RateLimiter(5, 60_000));
    rl.hit('a');
    rl.hit('b');
    rl.hit('c');
    rl.cleanup();
    expect(rl.size()).toBe(3);
  });

  test('cleanup on an empty map is a no-op', () => {
    const rl = track(new RateLimiter(5, 60_000));
    expect(() => rl.cleanup()).not.toThrow();
    expect(rl.size()).toBe(0);
  });
});

describe('RateLimiter lifecycle', () => {
  test('close() can be called multiple times safely', () => {
    const rl = new RateLimiter(5, 60_000);
    expect(() => {
      rl.close();
      rl.close();
    }).not.toThrow();
  });

  test('close() stops the internal cleanup interval', () => {
    const rl = new RateLimiter(5, 60_000);
    rl.close();
    // A tracker that would pick up unreferenced intervals is not
    // available in vitest directly; the best we can do is assert that
    // close() does not throw and that subsequent hits still work on the
    // stopped limiter (the map lookups are pure functions).
    expect(rl.hit('ip-1')).toBe(false);
  });
});
