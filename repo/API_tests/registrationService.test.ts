import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authStore } from '../src/lib/stores';
import { createMockIdb, loginAs, logout } from './helpers';

// ============================================================
// Mock dependencies
// ============================================================

const mockIdb = createMockIdb();

vi.mock('../src/lib/services/idbAccessLayer', () => ({
  idbAccessLayer: mockIdb,
}));

vi.mock('../src/lib/utils/broadcastChannels', () => ({
  channelManager: {
    broadcast: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  },
  CHANNELS: {
    REGISTRATION_SYNC: 'registration-sync',
    AUTH_SYNC: 'auth-sync',
    FLAG_SYNC: 'flag-sync',
  },
}));

vi.mock('../src/lib/services/idempotencyService', () => ({
  idempotencyService: {
    checkKey: vi.fn(async () => ({ isDuplicate: false })),
    markComplete: vi.fn(),
  },
}));

vi.mock('../src/lib/services/opsConfigService', () => ({
  opsConfigService: {
    getPolicy: vi.fn(async (key: string) => {
      const defaults: Record<string, any> = {
        rate_limit_attempts: 5,
        rate_limit_window_seconds: 10,
      };
      return defaults[key] ?? null;
    }),
    isBlacklisted: vi.fn(async () => false),
  },
}));

const { registrationService } = await import('../src/lib/services/registrationService');
const { opsConfigService } = await import('../src/lib/services/opsConfigService');
const { idempotencyService } = await import('../src/lib/services/idempotencyService');

// ============================================================
// Helpers
// ============================================================

function seedSession(sessionId: string, capacity: number, enrollment: number = 0) {
  mockIdb._seed('sessions', [{
    session_id: sessionId,
    instructor_id: 'inst-1',
    room_id: 'room-1',
    booking_id: 'book-1',
    title: 'Test Session',
    start_time: Date.now() + 3600_000,
    end_time: Date.now() + 7200_000,
    capacity,
    current_enrollment: enrollment,
    status: 'active',
    _version: 1,
  }]);
}

// ============================================================
// Tests
// ============================================================

describe('registrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdb._clear();
    logout();
  });

  // ----------------------------------------------------------
  // add — normal flow
  // ----------------------------------------------------------

  describe('add', () => {
    it('creates a registration and increments enrollment', async () => {
      const session = loginAs('PARTICIPANT');
      seedSession('sess-1', 30, 0);

      const reg = await registrationService.add(session.user_id, 'sess-1', 'idemp-1');

      expect(reg.participant_id).toBe(session.user_id);
      expect(reg.session_id).toBe('sess-1');
      expect(reg.status).toBe('active');
      expect(reg._version).toBe(1);
    });

    it('marks idempotency key as complete after registration', async () => {
      const session = loginAs('PARTICIPANT');
      seedSession('sess-1', 30);

      await registrationService.add(session.user_id, 'sess-1', 'idemp-2');

      expect(idempotencyService.markComplete).toHaveBeenCalledWith('idemp-2', expect.any(Object));
    });

    it('returns cached result for duplicate idempotency key', async () => {
      loginAs('PARTICIPANT');
      const cached = { registration_id: 'cached-reg', participant_id: 'p1', session_id: 's1', status: 'active' };
      (idempotencyService.checkKey as any).mockResolvedValueOnce({ isDuplicate: true, cachedResult: cached });

      const result = await registrationService.add('p1', 's1', 'idemp-dup');

      expect(result).toEqual(cached);
    });
  });

  // ----------------------------------------------------------
  // add — error cases
  // ----------------------------------------------------------

  describe('add — errors', () => {
    it('throws when session not found', async () => {
      loginAs('PARTICIPANT');

      await expect(registrationService.add('p1', 'nonexistent', 'idemp-3'))
        .rejects.toThrow('not found');
    });

    it('throws when session is full', async () => {
      loginAs('PARTICIPANT');
      seedSession('sess-full', 1, 1); // capacity = enrollment

      await expect(registrationService.add('p1', 'sess-full', 'idemp-4'))
        .rejects.toThrow('full');
    });

    it('throws when session is cancelled', async () => {
      loginAs('PARTICIPANT');
      mockIdb._seed('sessions', [{
        session_id: 'sess-cancelled',
        instructor_id: 'inst-1',
        room_id: 'room-1',
        booking_id: 'book-1',
        title: 'Cancelled',
        start_time: Date.now(),
        end_time: Date.now() + 3600_000,
        capacity: 30,
        current_enrollment: 0,
        status: 'cancelled',
        _version: 1,
      }]);

      await expect(registrationService.add('p1', 'sess-cancelled', 'idemp-5'))
        .rejects.toThrow('cancelled');
    });

    it('throws when participant already registered', async () => {
      const session = loginAs('PARTICIPANT');
      seedSession('sess-dup', 30, 1);
      mockIdb._seed('registrations', [{
        registration_id: 'reg-existing',
        participant_id: session.user_id,
        session_id: 'sess-dup',
        status: 'active',
        registered_at: Date.now(),
        _version: 1,
      }]);

      await expect(registrationService.add(session.user_id, 'sess-dup', 'idemp-6'))
        .rejects.toThrow('already have an active registration');
    });

    it('throws when participant is blacklisted', async () => {
      loginAs('PARTICIPANT');
      seedSession('sess-bl', 30);
      (opsConfigService.isBlacklisted as any).mockResolvedValueOnce(true);

      await expect(registrationService.add('p1', 'sess-bl', 'idemp-7'))
        .rejects.toThrow('restricted');
    });
  });

  // ----------------------------------------------------------
  // add — permission errors
  // ----------------------------------------------------------

  describe('add — permission checks', () => {
    it('throws AccessError when not logged in', async () => {
      logout();
      await expect(registrationService.add('p1', 's1', 'idemp-8'))
        .rejects.toThrow('No active session');
    });

    it('throws AccessError for non-PARTICIPANT role', async () => {
      loginAs('INSTRUCTOR');
      await expect(registrationService.add('p1', 's1', 'idemp-9'))
        .rejects.toThrow('Access denied');
    });
  });

  // ----------------------------------------------------------
  // drop
  // ----------------------------------------------------------

  describe('drop', () => {
    it('cancels registration and decrements enrollment', async () => {
      const session = loginAs('PARTICIPANT');
      seedSession('sess-drop', 30, 1);
      mockIdb._seed('registrations', [{
        registration_id: 'reg-drop',
        participant_id: session.user_id,
        session_id: 'sess-drop',
        status: 'active',
        registered_at: Date.now(),
        _version: 1,
      }]);

      await registrationService.drop(session.user_id, 'sess-drop', 'idemp-drop');

      // Verify idempotency marked complete
      expect(idempotencyService.markComplete).toHaveBeenCalledWith(
        'idemp-drop',
        expect.objectContaining({ dropped: true }),
      );
    });

    it('throws when no active registration exists', async () => {
      const session = loginAs('PARTICIPANT');
      seedSession('sess-nodrop', 30);

      await expect(registrationService.drop(session.user_id, 'sess-nodrop', 'idemp-nodrop'))
        .rejects.toThrow('No active registration');
    });
  });

  // ----------------------------------------------------------
  // swap
  // ----------------------------------------------------------

  describe('swap', () => {
    it('atomically drops from source and adds to target', async () => {
      const session = loginAs('PARTICIPANT');
      seedSession('sess-from', 30, 1);
      seedSession('sess-to', 30, 0);
      mockIdb._seed('registrations', [{
        registration_id: 'reg-swap',
        participant_id: session.user_id,
        session_id: 'sess-from',
        status: 'active',
        registered_at: Date.now(),
        _version: 1,
      }]);

      const newReg = await registrationService.swap(
        session.user_id, 'sess-from', 'sess-to', 'idemp-swap',
      );

      expect(newReg.session_id).toBe('sess-to');
      expect(newReg.status).toBe('active');
    });

    it('throws when target session is full', async () => {
      const session = loginAs('PARTICIPANT');
      seedSession('sess-from2', 30, 1);
      seedSession('sess-to-full', 1, 1);
      mockIdb._seed('registrations', [{
        registration_id: 'reg-swap2',
        participant_id: session.user_id,
        session_id: 'sess-from2',
        status: 'active',
        registered_at: Date.now(),
        _version: 1,
      }]);

      await expect(registrationService.swap(
        session.user_id, 'sess-from2', 'sess-to-full', 'idemp-swap2',
      )).rejects.toThrow('full');
    });

    it('throws when no active registration in source session', async () => {
      const session = loginAs('PARTICIPANT');
      seedSession('sess-from3', 30);
      seedSession('sess-to3', 30);

      await expect(registrationService.swap(
        session.user_id, 'sess-from3', 'sess-to3', 'idemp-swap3',
      )).rejects.toThrow('No active registration');
    });

    it('throws when participant is blacklisted', async () => {
      const session = loginAs('PARTICIPANT');
      seedSession('sess-from4', 30, 1);
      seedSession('sess-to4', 30);
      mockIdb._seed('registrations', [{
        registration_id: 'reg-swap4',
        participant_id: session.user_id,
        session_id: 'sess-from4',
        status: 'active',
        registered_at: Date.now(),
        _version: 1,
      }]);
      (opsConfigService.isBlacklisted as any).mockResolvedValueOnce(true);

      await expect(registrationService.swap(
        session.user_id, 'sess-from4', 'sess-to4', 'idemp-swap4',
      )).rejects.toThrow('restricted');
    });
  });

  // ----------------------------------------------------------
  // Query helpers
  // ----------------------------------------------------------

  describe('query helpers', () => {
    it('getRegistration returns undefined for nonexistent id', async () => {
      const result = await registrationService.getRegistration('nope');
      expect(result).toBeUndefined();
    });

    it('getRegistrationsForSession returns empty array when none exist', async () => {
      const result = await registrationService.getRegistrationsForSession('sess-empty');
      expect(result).toEqual([]);
    });
  });
});
