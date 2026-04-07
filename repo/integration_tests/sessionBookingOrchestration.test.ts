import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockIdb, loginAs, logout } from '../API_tests/helpers';
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
        max_active_reservations: 10,
      };
      return defaults[key] ?? null;
    }),
    isBlacklisted: vi.fn(async () => false),
    getMaintenanceWindows: vi.fn(async () => []),
  },
}));

const { roomSchedulingService } = await import('../src/lib/services/roomSchedulingService');

// ============================================================
// Helpers
// ============================================================

function seedRoom(roomId: string, capacity: number = 30) {
  mockIdb._seed('rooms', [{
    room_id: roomId,
    name: `Room ${roomId}`,
    building_code: 'B1',
    floor_code: 'F1',
    capacity,
    equipment: ['projector'],
    _version: 1,
  }]);
}

// ============================================================
// Tests
// ============================================================

describe('Session Booking Orchestration (Phase 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdb._clear();
    logout();

    mockIdb.getAll.mockImplementation(async (store: string, index?: string, value?: any) => {
      const all = Array.from(mockIdb._getStore(store).values());
      if (index && value !== undefined) {
        const field = index.replace('idx_', '');
        return all.filter((r: any) => r[field] === value);
      }
      return all;
    });

    mockIdb.put.mockImplementation(async (store: string, record: any) => {
      const keyMap: Record<string, string> = {
        bookings: 'booking_id', sessions: 'session_id', rooms: 'room_id',
      };
      const keyPath = keyMap[store] || 'id';
      mockIdb._getStore(store).set(record[keyPath], { ...record });
      return { version: record._version ?? 1 };
    });
  });

  it('createSessionBooking creates both booking and session via conflict-checked path', async () => {
    loginAs('INSTRUCTOR', { user_id: 'inst-1' });
    seedRoom('room-1');

    const result = await roomSchedulingService.createSessionBooking({
      title: 'Chemistry 101',
      room_id: 'room-1',
      start_time: Date.now() + 3_600_000,
      end_time: Date.now() + 7_200_000,
      capacity: 25,
      fee: 50,
      instructor_id: 'inst-1',
    });

    expect('conflicts' in result).toBe(false);
    if (!('conflicts' in result)) {
      expect(result.session.title).toBe('Chemistry 101');
      expect(result.session.booking_id).toBe(result.booking.booking_id);
      expect(result.session.fee).toBe(50);
      expect(result.booking.status).toBe('confirmed');

      // Verify both records were persisted
      const storedSession = mockIdb._getStore('sessions').get(result.session.session_id);
      const storedBooking = mockIdb._getStore('bookings').get(result.booking.booking_id);
      expect(storedSession).toBeTruthy();
      expect(storedBooking).toBeTruthy();
    }
  });

  it('createSessionBooking returns conflicts when room is already booked', async () => {
    loginAs('INSTRUCTOR', { user_id: 'inst-1' });
    seedRoom('room-1');

    const startTime = Date.now() + 3_600_000;
    const endTime = Date.now() + 7_200_000;

    // Seed an existing booking
    mockIdb._seed('bookings', [{
      booking_id: 'existing-booking',
      room_id: 'room-1',
      user_id: 'other-user',
      start_time: startTime,
      end_time: endTime,
      requested_equipment: [],
      participant_capacity: 20,
      status: 'confirmed',
      created_at: Date.now(),
      _version: 1,
    }]);

    const result = await roomSchedulingService.createSessionBooking({
      title: 'Conflict Session',
      room_id: 'room-1',
      start_time: startTime + 1000,
      end_time: endTime - 1000,
      capacity: 20,
      fee: 0,
      instructor_id: 'inst-1',
    });

    expect('conflicts' in result).toBe(true);
    if ('conflicts' in result) {
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0].type).toBe('time_overlap');
    }
  });

  it('updateSessionBooking detects conflicts on time change', async () => {
    loginAs('INSTRUCTOR', { user_id: 'inst-1' });
    seedRoom('room-1');

    const startTime = Date.now() + 3_600_000;
    const endTime = Date.now() + 7_200_000;

    // Seed existing session with linked booking
    mockIdb._seed('sessions', [{
      session_id: 'sess-1',
      instructor_id: 'inst-1',
      room_id: 'room-1',
      booking_id: 'booking-1',
      title: 'Original',
      start_time: startTime,
      end_time: endTime,
      capacity: 20,
      current_enrollment: 5,
      status: 'active',
      fee: 0,
      _version: 1,
    }]);

    mockIdb._seed('bookings', [
      {
        booking_id: 'booking-1',
        room_id: 'room-1',
        user_id: 'inst-1',
        start_time: startTime,
        end_time: endTime,
        requested_equipment: [],
        participant_capacity: 20,
        status: 'confirmed',
        created_at: Date.now(),
        _version: 1,
      },
      {
        booking_id: 'other-booking',
        room_id: 'room-1',
        user_id: 'other-user',
        start_time: startTime + 10_000_000,
        end_time: startTime + 14_000_000,
        requested_equipment: [],
        participant_capacity: 20,
        status: 'confirmed',
        created_at: Date.now(),
        _version: 1,
      },
    ]);

    // Try to move session to overlap with the other booking
    await expect(
      roomSchedulingService.updateSessionBooking('sess-1', {
        start_time: startTime + 10_000_000 + 500,
        end_time: startTime + 14_000_000 - 500,
      }),
    ).rejects.toThrow(/conflict/i);
  });

  it('updateSessionBooking updates both session and booking on valid time change', async () => {
    loginAs('INSTRUCTOR', { user_id: 'inst-1' });
    seedRoom('room-1');

    const startTime = Date.now() + 3_600_000;
    const endTime = Date.now() + 7_200_000;
    const newStart = Date.now() + 10_000_000;
    const newEnd = Date.now() + 14_000_000;

    mockIdb._seed('sessions', [{
      session_id: 'sess-1',
      instructor_id: 'inst-1',
      room_id: 'room-1',
      booking_id: 'booking-1',
      title: 'Original',
      start_time: startTime,
      end_time: endTime,
      capacity: 20,
      current_enrollment: 0,
      status: 'active',
      fee: 0,
      _version: 1,
    }]);

    mockIdb._seed('bookings', [{
      booking_id: 'booking-1',
      room_id: 'room-1',
      user_id: 'inst-1',
      start_time: startTime,
      end_time: endTime,
      requested_equipment: [],
      participant_capacity: 20,
      status: 'confirmed',
      created_at: Date.now(),
      _version: 1,
    }]);

    const updated = await roomSchedulingService.updateSessionBooking('sess-1', {
      title: 'Renamed',
      start_time: newStart,
      end_time: newEnd,
    });

    expect(updated.title).toBe('Renamed');
    expect(updated.start_time).toBe(newStart);
    expect(updated.end_time).toBe(newEnd);

    // Verify the linked booking was also updated
    const storedBooking = mockIdb._getStore('bookings').get('booking-1');
    expect(storedBooking.start_time).toBe(newStart);
    expect(storedBooking.end_time).toBe(newEnd);
  });
});
