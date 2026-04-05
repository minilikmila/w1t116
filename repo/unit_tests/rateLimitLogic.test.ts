import { describe, it, expect } from 'vitest';

// ============================================================
// Pure rate-limit window logic extracted from registrationService
// ============================================================

function computeWindowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

function isRateLimited(currentCount: number, maxAttempts: number): boolean {
  return currentCount >= maxAttempts;
}

function computeRetryAfter(windowStart: number, windowMs: number, now: number): number {
  return windowStart + windowMs - now;
}

function buildCounterKey(userId: string, windowStart: number): string {
  return `rate_limit_${userId}_${windowStart}`;
}

// ============================================================
// Tests
// ============================================================

describe('rate limiting logic', () => {
  const WINDOW_MS = 10_000; // 10 seconds (default)
  const MAX_ATTEMPTS = 5;   // default

  describe('computeWindowStart', () => {
    it('aligns to window boundary', () => {
      const now = 1_700_000_005_123; // mid-window
      const start = computeWindowStart(now, WINDOW_MS);
      expect(start).toBe(1_700_000_000_000);
    });

    it('returns exact time when already on boundary', () => {
      const now = 1_700_000_010_000;
      expect(computeWindowStart(now, WINDOW_MS)).toBe(1_700_000_010_000);
    });

    it('consecutive calls within same window return same start', () => {
      const t1 = 1_700_000_001_000;
      const t2 = 1_700_000_009_999;
      expect(computeWindowStart(t1, WINDOW_MS)).toBe(computeWindowStart(t2, WINDOW_MS));
    });

    it('different windows return different starts', () => {
      const t1 = 1_700_000_005_000;
      const t2 = 1_700_000_015_000;
      expect(computeWindowStart(t1, WINDOW_MS)).not.toBe(computeWindowStart(t2, WINDOW_MS));
    });
  });

  describe('isRateLimited', () => {
    it('returns false below threshold', () => {
      expect(isRateLimited(0, MAX_ATTEMPTS)).toBe(false);
      expect(isRateLimited(4, MAX_ATTEMPTS)).toBe(false);
    });

    it('returns true at exactly the limit', () => {
      expect(isRateLimited(5, MAX_ATTEMPTS)).toBe(true);
    });

    it('returns true above the limit', () => {
      expect(isRateLimited(10, MAX_ATTEMPTS)).toBe(true);
    });
  });

  describe('computeRetryAfter', () => {
    it('computes remaining time in window', () => {
      const windowStart = 1_700_000_000_000;
      const now = 1_700_000_003_000; // 3s into window
      expect(computeRetryAfter(windowStart, WINDOW_MS, now)).toBe(7_000);
    });

    it('returns 0 at window boundary', () => {
      const windowStart = 1_700_000_000_000;
      const now = windowStart + WINDOW_MS;
      expect(computeRetryAfter(windowStart, WINDOW_MS, now)).toBe(0);
    });

    it('returns negative if past window (caller should handle)', () => {
      const windowStart = 1_700_000_000_000;
      const now = windowStart + WINDOW_MS + 500;
      expect(computeRetryAfter(windowStart, WINDOW_MS, now)).toBe(-500);
    });
  });

  describe('buildCounterKey', () => {
    it('produces deterministic key from userId + windowStart', () => {
      expect(buildCounterKey('user-1', 1_700_000_000_000)).toBe('rate_limit_user-1_1700000000000');
    });

    it('different users produce different keys', () => {
      const ws = 1_700_000_000_000;
      expect(buildCounterKey('user-1', ws)).not.toBe(buildCounterKey('user-2', ws));
    });

    it('different windows produce different keys', () => {
      expect(buildCounterKey('user-1', 1_700_000_000_000))
        .not.toBe(buildCounterKey('user-1', 1_700_000_010_000));
    });
  });
});
