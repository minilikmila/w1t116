import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockIdb, loginAs, logout } from './helpers';
import type { BookingRequest } from '../src/lib/types';

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
  CHANNELS: { AUTH_SYNC: 'auth-sync' },
}));

vi.mock('../src/lib/services/opsConfigService', () => ({
  opsConfigService: {
    getPolicy: vi.fn(async (key: string) => {
      const defaults: Record<string, any> = {
        booking_window_days: 14,
        max_active_reservations: 3,
      };
      return defaults[key] ?? null;
    }),
    isBlacklisted: vi.fn(async () => false),
    getMaintenanceWindows: vi.fn(async () => []),
  },
}));

const { roomSchedulingService } = await import('../src/lib/services/roomSchedulingService');
const { opsConfigService } = await import('../src/lib/services/opsConfigService');

// ============================================================
// Helpers
// ============================================================

function makeRequest(overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    room_id: 'room-1',
    start_time: Date.now() + 3600_000,
    end_time: Date.now() + 7200_000,
    requested_equipment: [],
    participant_capacity: 20,
    user_id: 'user-1',
    ...overrides,
  };
}

function seedRoom(roomId: string, capacity: number = 30) {
  mockIdb._seed('rooms', [{
    room_id: roomId,
    name: `Room ${roomId}`,
    building_code: 'B1',
    floor_code: 'F1',
    capacity,
    equipment: ['projector', 'whiteboard'],
    _version: 1,
  }]);
}

// ============================================================
// Tests
// ============================================================

describe('roomSchedulingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdb._clear();
    logout();

    // Default: getAll returns from mock store
    mockIdb.getAll.mockImplementation(async (store: string) => {
      return Array.from(mockIdb._getStore(store).values());
    });
  });

  // ----------------------------------------------------------
  // createBooking — normal flow
  // ----------------------------------------------------------

  describe('createBooking', () => {
    it('creates a booking when no conflicts exist', async () => {
      const session = loginAs('INSTRUCTOR');
      seedRoom('room-1');

      const result = await roomSchedulingService.createBooking(
        makeRequest({ user_id: session.user_id }),
      );

      // Should be a Booking, not a ConflictResult
      expect(result).toHaveProperty('booking_id');
      expect((result as any).status).toBe('confirmed');
      expect((result as any).room_id).toBe('room-1');
    });

    it('returns ConflictResult when time overlap exists', async () => {
      const session = loginAs('INSTRUCTOR');
      seedRoom('room-1');

      // Seed an existing booking that overlaps
      mockIdb._seed('bookings', [{
        booking_id: 'existing-1',
        room_id: 'room-1',
        user_id: 'other-user',
        start_time: Date.now() + 3000_000,
        end_time: Date.now() + 9000_000,
        requested_equipment: [],
        participant_capacity: 20,
        status: 'confirmed',
        created_at: Date.now(),
        _version: 1,
      }]);

      const result = await roomSchedulingService.createBooking(
        makeRequest({ user_id: session.user_id }),
      );

      expect(result).toHaveProperty('conflicts');
      expect((result as any).conflicts.length).toBeGreaterThan(0);
      expect((result as any).conflicts[0].type).toBe('time_overlap');
    });
  });

  // ----------------------------------------------------------
  // createBooking — validation errors
  // ----------------------------------------------------------

  describe('createBooking — validation', () => {
    it('rejects booking too far in advance', async () => {
      loginAs('INSTRUCTOR');
      seedRoom('room-1');

      const farFuture = makeRequest({
        start_time: Date.now() + 30 * 86400_000, // 30 days out
        end_time: Date.now() + 30 * 86400_000 + 3600_000,
      });

      await expect(roomSchedulingService.createBooking(farFuture))
        .rejects.toThrow('too far in advance');
    });

    it('rejects when max active reservations reached', async () => {
      const session = loginAs('INSTRUCTOR');
      seedRoom('room-1');

      // Seed 3 existing active bookings
      for (let i = 0; i < 3; i++) {
        mockIdb._seed('bookings', [{
          booking_id: `existing-${i}`,
          room_id: `room-${i}`,
          user_id: session.user_id,
          start_time: Date.now() + (i + 1) * 86400_000,
          end_time: Date.now() + (i + 1) * 86400_000 + 3600_000,
          requested_equipment: [],
          participant_capacity: 20,
          status: 'confirmed',
          created_at: Date.now(),
          _version: 1,
        }]);
      }

      await expect(roomSchedulingService.createBooking(
        makeRequest({ user_id: session.user_id }),
      )).rejects.toThrow('Maximum active reservations');
    });

    it('rejects when room is blacklisted', async () => {
      loginAs('INSTRUCTOR');
      seedRoom('room-blacklisted');
      (opsConfigService.isBlacklisted as any).mockImplementation(
        async (type: string, id: string) => type === 'room' && id === 'room-blacklisted',
      );

      await expect(roomSchedulingService.createBooking(
        makeRequest({ room_id: 'room-blacklisted' }),
      )).rejects.toThrow('blacklisted');
    });

    it('rejects when user is blacklisted', async () => {
      loginAs('INSTRUCTOR');
      seedRoom('room-1');
      (opsConfigService.isBlacklisted as any)
        .mockResolvedValueOnce(false)   // room check passes
        .mockResolvedValueOnce(true);   // participant check fails

      await expect(roomSchedulingService.createBooking(makeRequest()))
        .rejects.toThrow('blacklisted');
    });
  });

  // ----------------------------------------------------------
  // createBooking — permission errors
  // ----------------------------------------------------------

  describe('createBooking — permissions', () => {
    it('requires booking:create permission', async () => {
      loginAs('PARTICIPANT'); // PARTICIPANT can't create bookings

      await expect(roomSchedulingService.createBooking(makeRequest()))
        .rejects.toThrow('Access denied');
    });

    it('throws when not logged in', async () => {
      logout();

      await expect(roomSchedulingService.createBooking(makeRequest()))
        .rejects.toThrow('No active session');
    });

    it('allows SYSTEM_ADMIN to create bookings', async () => {
      const session = loginAs('SYSTEM_ADMIN');
      seedRoom('room-1');

      const result = await roomSchedulingService.createBooking(
        makeRequest({ user_id: session.user_id }),
      );

      expect(result).toHaveProperty('booking_id');
    });

    it('allows OPS_COORDINATOR to create bookings', async () => {
      const session = loginAs('OPS_COORDINATOR');
      seedRoom('room-1');

      const result = await roomSchedulingService.createBooking(
        makeRequest({ user_id: session.user_id }),
      );

      expect(result).toHaveProperty('booking_id');
    });
  });

  // ----------------------------------------------------------
  // cancelBooking
  // ----------------------------------------------------------

  describe('cancelBooking', () => {
    it('cancels own booking', async () => {
      const session = loginAs('INSTRUCTOR');

      mockIdb._seed('bookings', [{
        booking_id: 'book-cancel',
        room_id: 'room-1',
        user_id: session.user_id,
        start_time: Date.now() + 3600_000,
        end_time: Date.now() + 7200_000,
        requested_equipment: [],
        participant_capacity: 20,
        status: 'confirmed',
        created_at: Date.now(),
        _version: 1,
      }]);

      await roomSchedulingService.cancelBooking('book-cancel');

      expect(mockIdb.put).toHaveBeenCalledWith('bookings', expect.objectContaining({
        booking_id: 'book-cancel',
        status: 'cancelled',
      }));
    });

    it('throws when booking not found', async () => {
      loginAs('INSTRUCTOR');

      await expect(roomSchedulingService.cancelBooking('nonexistent'))
        .rejects.toThrow('not found');
    });
  });

  // ----------------------------------------------------------
  // detectConflicts
  // ----------------------------------------------------------

  describe('detectConflicts', () => {
    it('returns empty array when no conflicts', async () => {
      const conflicts = await roomSchedulingService.detectConflicts(makeRequest());
      expect(conflicts).toEqual([]);
    });

    it('detects maintenance window conflicts', async () => {
      const req = makeRequest();
      (opsConfigService.getMaintenanceWindows as any).mockResolvedValueOnce([{
        window_id: 'mw-1',
        room_id: 'room-1',
        start_time: req.start_time - 1000,
        end_time: req.end_time + 1000,
        description: 'Scheduled maintenance',
        _version: 1,
      }]);

      const conflicts = await roomSchedulingService.detectConflicts(req);
      expect(conflicts.some(c => c.type === 'maintenance')).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // getAllBookings
  // ----------------------------------------------------------

  describe('getAllBookings', () => {
    it('returns all bookings for SYSTEM_ADMIN', async () => {
      loginAs('SYSTEM_ADMIN');
      mockIdb._seed('bookings', [
        { booking_id: 'b1', user_id: 'u1', room_id: 'r1', status: 'confirmed', requested_equipment: [], _version: 1 },
        { booking_id: 'b2', user_id: 'u2', room_id: 'r2', status: 'confirmed', requested_equipment: [], _version: 1 },
      ]);

      const all = await roomSchedulingService.getAllBookings();
      expect(all).toHaveLength(2);
    });

    it('filters to own bookings for INSTRUCTOR', async () => {
      const session = loginAs('INSTRUCTOR');
      mockIdb._seed('bookings', [
        { booking_id: 'b1', user_id: session.user_id, room_id: 'r1', status: 'confirmed', requested_equipment: [], _version: 1 },
        { booking_id: 'b2', user_id: 'other-user', room_id: 'r2', status: 'confirmed', requested_equipment: [], _version: 1 },
      ]);

      const filtered = await roomSchedulingService.getAllBookings();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].user_id).toBe(session.user_id);
    });
  });
});
