import { idbAccessLayer } from './idbAccessLayer';
import { rbacService } from './rbacService';
import { opsConfigService } from './opsConfigService';
import type { Booking, BookingRequest, Conflict, ConflictResult, ScoredRoom, Room, MaintenanceWindow, Equipment } from '../types';
import { AccessError, VersionConflictError } from '../types';

// ============================================================
// Helpers
// ============================================================

function extractDigits(code: string): number {
  const match = code.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function timeOverlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// ============================================================
// detectConflicts
// ============================================================

async function detectConflicts(request: BookingRequest): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];

  // (a) Time overlap with existing bookings in the same room
  const allBookings = await idbAccessLayer.getAll<Booking>('bookings');
  const overlapping = allBookings.filter(
    (b) =>
      b.room_id === request.room_id &&
      b.status !== 'cancelled' &&
      b.start_time < request.end_time &&
      b.end_time > request.start_time,
  );
  for (const b of overlapping) {
    conflicts.push({
      type: 'time_overlap',
      description: `Booking ${b.booking_id} overlaps with the requested time range`,
      conflicting_record_id: b.booking_id,
    });
  }

  // (b) Maintenance windows
  const windows = await opsConfigService.getMaintenanceWindows(request.room_id);
  const overlappingWindows = windows.filter((w: MaintenanceWindow) =>
    timeOverlaps(request.start_time, request.end_time, w.start_time, w.end_time),
  );
  for (const w of overlappingWindows) {
    conflicts.push({
      type: 'maintenance',
      description: `Maintenance window "${w.description}" overlaps with the requested time range`,
      conflicting_record_id: w.window_id,
    });
  }

  // (c) Equipment exclusivity
  for (const eqType of request.requested_equipment) {
    const equipmentItems = await idbAccessLayer.getAll<Equipment>('equipment', 'idx_type', eqType);
    const exclusiveItems = equipmentItems.filter((e) => e.is_exclusive);

    for (const item of exclusiveItems) {
      // Check if this exclusive equipment item is reserved by another booking in the time range
      const conflictingBookings = allBookings.filter(
        (b) =>
          b.status !== 'cancelled' &&
          b.requested_equipment.includes(eqType) &&
          b.start_time < request.end_time &&
          b.end_time > request.start_time,
      );
      for (const cb of conflictingBookings) {
        conflicts.push({
          type: 'equipment',
          description: `Exclusive equipment "${item.name}" (${eqType}) is reserved by booking ${cb.booking_id}`,
          conflicting_record_id: cb.booking_id,
        });
      }
    }
  }

  return conflicts;
}

// ============================================================
// getAlternatives
// ============================================================

async function getAlternatives(request: BookingRequest): Promise<ScoredRoom[]> {
  const allRooms = await idbAccessLayer.getAll<Room>('rooms');

  // Filter candidates by capacity proximity
  const candidates = allRooms.filter(
    (room) => Math.abs(room.capacity - request.participant_capacity) <= 10,
  );

  if (candidates.length === 0) return [];

  // Pre-fetch data for scoring
  const allBookings = await idbAccessLayer.getAll<Booking>('bookings');

  // Compute MAX_DISTANCE dynamically across all candidate rooms
  let maxDistance = 0;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const b1 = extractDigits(candidates[i].building_code);
      const f1 = extractDigits(candidates[i].floor_code);
      const b2 = extractDigits(candidates[j].building_code);
      const f2 = extractDigits(candidates[j].floor_code);
      const dist = Math.abs(b1 - b2) + Math.abs(f1 - f2);
      if (dist > maxDistance) maxDistance = dist;
    }
  }

  // Parse the request room's building/floor for distance calculation
  const requestRoom = allRooms.find((r) => r.room_id === request.room_id);
  const reqBuilding = requestRoom ? extractDigits(requestRoom.building_code) : 0;
  const reqFloor = requestRoom ? extractDigits(requestRoom.floor_code) : 0;

  const scored: ScoredRoom[] = [];

  for (const room of candidates) {
    // Capacity fit (40%)
    const capacityFit = Math.max(
      0,
      Math.min(1, 1 - Math.abs(room.capacity - request.participant_capacity) / request.participant_capacity),
    );

    // Equipment match (30%)
    let equipmentMatch: number;
    if (request.requested_equipment.length === 0) {
      equipmentMatch = 1;
    } else {
      const matchCount = request.requested_equipment.filter((eq) =>
        room.equipment.includes(eq),
      ).length;
      equipmentMatch = matchCount / request.requested_equipment.length;
    }

    // Availability (20%)
    const hasOverlappingBooking = allBookings.some(
      (b) =>
        b.room_id === room.room_id &&
        b.status !== 'cancelled' &&
        timeOverlaps(request.start_time, request.end_time, b.start_time, b.end_time),
    );
    const maintenanceWindows = await opsConfigService.getMaintenanceWindows(room.room_id);
    const hasOverlappingMaintenance = maintenanceWindows.some((w: MaintenanceWindow) =>
      timeOverlaps(request.start_time, request.end_time, w.start_time, w.end_time),
    );
    const availability = hasOverlappingBooking || hasOverlappingMaintenance ? 0.0 : 1.0;

    // Distance (10%)
    const roomBuilding = extractDigits(room.building_code);
    const roomFloor = extractDigits(room.floor_code);
    const distance = Math.abs(reqBuilding - roomBuilding) + Math.abs(reqFloor - roomFloor);
    const distanceScore = maxDistance === 0 ? 1 : 1 - distance / maxDistance;

    const totalScore =
      capacityFit * 0.4 +
      equipmentMatch * 0.3 +
      availability * 0.2 +
      distanceScore * 0.1;

    scored.push({
      room,
      total_score: totalScore,
      scores: {
        capacity_fit: capacityFit,
        equipment_match: equipmentMatch,
        availability,
        distance: distanceScore,
      },
    });
  }

  // Sort descending by total_score, return top 5
  scored.sort((a, b) => b.total_score - a.total_score);
  return scored.slice(0, 5);
}

// ============================================================
// createBooking
// ============================================================

async function createBooking(request: BookingRequest): Promise<Booking | ConflictResult> {
  // 1. RBAC check
  rbacService.checkPermission('booking:create');

  // 2. Policy checks
  const windowDaysRaw = await opsConfigService.getPolicy('booking_window_days');
  const windowDays = typeof windowDaysRaw === 'number' ? windowDaysRaw : 14;
  if (request.start_time > Date.now() + windowDays * 86400000) {
    throw new Error(`Booking too far in advance. Maximum booking window is ${windowDays} days.`);
  }

  const maxActiveRaw = await opsConfigService.getPolicy('max_active_reservations');
  const maxActive = typeof maxActiveRaw === 'number' ? maxActiveRaw : 3;
  const allBookings = await idbAccessLayer.getAll<Booking>('bookings');
  const activeCount = allBookings.filter(
    (b) => b.user_id === request.user_id && b.status !== 'cancelled',
  ).length;
  if (activeCount >= maxActive) {
    throw new Error(`Maximum active reservations (${maxActive}) reached.`);
  }

  // 3. Blacklist checks
  const roomBlacklisted = await opsConfigService.isBlacklisted('room', request.room_id);
  if (roomBlacklisted) {
    throw new Error(`Room ${request.room_id} is blacklisted.`);
  }
  const participantBlacklisted = await opsConfigService.isBlacklisted('participant', request.user_id);
  if (participantBlacklisted) {
    throw new Error(`User ${request.user_id} is blacklisted.`);
  }

  // 4. Conflict detection
  const conflicts = await detectConflicts(request);
  if (conflicts.length > 0) {
    const alternatives = await getAlternatives(request);
    return { conflicts, alternatives } as ConflictResult;
  }

  // 5. Create booking
  const booking: Booking = {
    booking_id: crypto.randomUUID(),
    room_id: request.room_id,
    user_id: request.user_id,
    start_time: request.start_time,
    end_time: request.end_time,
    requested_equipment: request.requested_equipment,
    participant_capacity: request.participant_capacity,
    status: 'confirmed',
    created_at: Date.now(),
    _version: 1,
  };

  await idbAccessLayer.put('bookings', booking);
  return booking;
}

// ============================================================
// updateBooking
// ============================================================

async function updateBooking(bookingId: string, updates: Partial<Booking>): Promise<Booking> {
  const existing = await idbAccessLayer.get<Booking>('bookings', bookingId);
  if (!existing) {
    throw new Error(`Booking ${bookingId} not found.`);
  }

  // RBAC: check edit_own (with ownership) or admin
  const session = rbacService.getCurrentSession();
  try {
    rbacService.checkPermission('booking:edit_own');
    rbacService.checkOwnership(existing.user_id, session.user_id);
  } catch {
    // If ownership check fails, must be admin
    rbacService.checkPermission('booking:cancel_any');
  }

  // Merge updates with optimistic locking
  const updated: Booking = {
    ...existing,
    ...updates,
    booking_id: existing.booking_id, // prevent overwriting key fields
    _version: existing._version + 1,
  };

  await idbAccessLayer.put('bookings', updated);
  return updated;
}

// ============================================================
// cancelBooking
// ============================================================

async function cancelBooking(bookingId: string): Promise<void> {
  const existing = await idbAccessLayer.get<Booking>('bookings', bookingId);
  if (!existing) {
    throw new Error(`Booking ${bookingId} not found.`);
  }

  // RBAC: cancel_own (if owner) or cancel_any
  const session = rbacService.getCurrentSession();
  try {
    rbacService.checkPermission('booking:cancel_own');
    rbacService.checkOwnership(existing.user_id, session.user_id);
  } catch {
    rbacService.checkPermission('booking:cancel_any');
  }

  const cancelled: Booking = {
    ...existing,
    status: 'cancelled',
    _version: existing._version + 1,
  };

  await idbAccessLayer.put('bookings', cancelled);
}

// ============================================================
// getBooking / getAllBookings
// ============================================================

async function getBooking(bookingId: string): Promise<Booking | undefined> {
  return idbAccessLayer.get<Booking>('bookings', bookingId);
}

async function getAllBookings(userId?: string): Promise<Booking[]> {
  const bookings = await idbAccessLayer.getAll<Booking>('bookings');
  if (userId) {
    return bookings.filter((b) => b.user_id === userId);
  }
  return bookings;
}

// ============================================================
// Export
// ============================================================

export const roomSchedulingService = {
  createBooking,
  updateBooking,
  cancelBooking,
  detectConflicts,
  getAlternatives,
  getBooking,
  getAllBookings,
};

export default roomSchedulingService;
