import { describe, it, expect } from 'vitest';

// ============================================================
// Pure logic extracted from idempotencyService for unit testing
// ============================================================

const IN_PROGRESS_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const COMPLETED_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface IdempotencyKey {
  key_id: string;
  status: 'in-progress' | 'completed';
  result: unknown;
  created_at: number;
  completed_at: number | null;
}

function shouldReturnCached(record: IdempotencyKey): boolean {
  return record.status === 'completed';
}

function isAbandoned(record: IdempotencyKey, now: number): boolean {
  return record.status === 'in-progress' && (now - record.created_at) >= IN_PROGRESS_TIMEOUT;
}

function isStillInProgress(record: IdempotencyKey, now: number): boolean {
  return record.status === 'in-progress' && (now - record.created_at) < IN_PROGRESS_TIMEOUT;
}

function shouldCleanup(record: IdempotencyKey, now: number): boolean {
  return record.status === 'completed' && (now - record.created_at) > COMPLETED_TTL;
}

describe('idempotency logic', () => {
  const baseTime = 1_700_000_000_000;

  describe('shouldReturnCached', () => {
    it('returns true for completed records', () => {
      expect(shouldReturnCached({
        key_id: 'k1', status: 'completed', result: { id: 'r1' },
        created_at: baseTime, completed_at: baseTime + 1000,
      })).toBe(true);
    });

    it('returns false for in-progress records', () => {
      expect(shouldReturnCached({
        key_id: 'k1', status: 'in-progress', result: null,
        created_at: baseTime, completed_at: null,
      })).toBe(false);
    });
  });

  describe('isAbandoned', () => {
    it('returns true when in-progress exceeds 5-minute timeout', () => {
      const record: IdempotencyKey = {
        key_id: 'k1', status: 'in-progress', result: null,
        created_at: baseTime, completed_at: null,
      };
      expect(isAbandoned(record, baseTime + IN_PROGRESS_TIMEOUT)).toBe(true);
      expect(isAbandoned(record, baseTime + IN_PROGRESS_TIMEOUT + 1)).toBe(true);
    });

    it('returns false when in-progress within timeout', () => {
      const record: IdempotencyKey = {
        key_id: 'k1', status: 'in-progress', result: null,
        created_at: baseTime, completed_at: null,
      };
      expect(isAbandoned(record, baseTime + IN_PROGRESS_TIMEOUT - 1)).toBe(false);
    });

    it('returns false for completed records regardless of age', () => {
      const record: IdempotencyKey = {
        key_id: 'k1', status: 'completed', result: {},
        created_at: baseTime, completed_at: baseTime + 100,
      };
      expect(isAbandoned(record, baseTime + IN_PROGRESS_TIMEOUT * 10)).toBe(false);
    });
  });

  describe('isStillInProgress', () => {
    it('returns true when within timeout', () => {
      const record: IdempotencyKey = {
        key_id: 'k1', status: 'in-progress', result: null,
        created_at: baseTime, completed_at: null,
      };
      expect(isStillInProgress(record, baseTime + 1000)).toBe(true);
    });

    it('returns false when past timeout', () => {
      const record: IdempotencyKey = {
        key_id: 'k1', status: 'in-progress', result: null,
        created_at: baseTime, completed_at: null,
      };
      expect(isStillInProgress(record, baseTime + IN_PROGRESS_TIMEOUT)).toBe(false);
    });
  });

  describe('shouldCleanup', () => {
    it('returns true for completed records older than 24 hours', () => {
      const record: IdempotencyKey = {
        key_id: 'k1', status: 'completed', result: {},
        created_at: baseTime, completed_at: baseTime + 100,
      };
      expect(shouldCleanup(record, baseTime + COMPLETED_TTL + 1)).toBe(true);
    });

    it('returns false for completed records within 24 hours', () => {
      const record: IdempotencyKey = {
        key_id: 'k1', status: 'completed', result: {},
        created_at: baseTime, completed_at: baseTime + 100,
      };
      expect(shouldCleanup(record, baseTime + COMPLETED_TTL - 1)).toBe(false);
    });

    it('returns false for in-progress records even if old', () => {
      const record: IdempotencyKey = {
        key_id: 'k1', status: 'in-progress', result: null,
        created_at: baseTime, completed_at: null,
      };
      expect(shouldCleanup(record, baseTime + COMPLETED_TTL * 2)).toBe(false);
    });

    it('boundary: exactly at TTL returns false (> not >=)', () => {
      const record: IdempotencyKey = {
        key_id: 'k1', status: 'completed', result: {},
        created_at: baseTime, completed_at: baseTime,
      };
      expect(shouldCleanup(record, baseTime + COMPLETED_TTL)).toBe(false);
    });
  });
});
