import { idbAccessLayer } from './idbAccessLayer';
import { rbacService } from './rbacService';
import { idempotencyService } from './idempotencyService';
import { opsConfigService } from './opsConfigService';
import { channelManager, CHANNELS } from '../utils/broadcastChannels';
import { RateLimitError } from '../types';
import type { Registration, SessionRecord, RegistrationSyncMessage } from '../types';

// ============================================================
// Rate Limiting
// ============================================================

async function checkRateLimit(userId: string): Promise<void> {
  const rateLimitAttempts = ((await opsConfigService.getPolicy('rate_limit_attempts')) as number) || 5;
  const rateLimitWindowMs = (((await opsConfigService.getPolicy('rate_limit_window_seconds')) as number) || 10) * 1000;

  const windowStart = Math.floor(Date.now() / rateLimitWindowMs) * rateLimitWindowMs;
  const counterKey = `rate_limit_${userId}_${windowStart}`;

  const existing = await idbAccessLayer.get<any>('idempotency_keys', counterKey);
  const currentCount = existing ? (existing.result as number) || 0 : 0;

  if (currentCount >= rateLimitAttempts) {
    const retryAfter = windowStart + rateLimitWindowMs - Date.now();
    throw new RateLimitError(retryAfter, `Rate limit exceeded. Try again in ${Math.ceil(retryAfter / 1000)} seconds.`);
  }

  // Increment counter
  await idbAccessLayer.put('idempotency_keys', {
    key_id: counterKey,
    status: 'completed',
    result: currentCount + 1,
    created_at: windowStart,
    completed_at: null,
  });

  // Broadcast rate-limit increment to other tabs
  channelManager.broadcast(CHANNELS.REGISTRATION_SYNC, {
    type: 'rate-limit-increment',
    user_id: userId,
    attempt_count: currentCount + 1,
    window_start: windowStart,
  } as RegistrationSyncMessage);
}

// ============================================================
// Registration Operations
// ============================================================

async function add(
  participantId: string,
  sessionId: string,
  idempotencyKey: string,
): Promise<Registration> {
  // 1. RBAC check
  rbacService.checkPermission('registration:manage');

  // 2. Idempotency check
  const idempCheck = await idempotencyService.checkKey(idempotencyKey);
  if (idempCheck.isDuplicate) {
    return idempCheck.cachedResult as Registration;
  }

  // 3. Rate limit check
  await checkRateLimit(participantId);

  // 4. Blacklist check
  const isBlacklisted = await opsConfigService.isBlacklisted('participant', participantId);
  if (isBlacklisted) {
    throw new Error('Registration denied: participant is restricted.');
  }

  // 5. Atomic transaction: read session, verify capacity, check uniqueness, decrement, create registration
  const registration = await idbAccessLayer.transaction<Registration>(
    ['sessions', 'registrations', 'idempotency_keys'],
    'readwrite',
    async (tx) => {
      // Read session
      const session = await tx.get<SessionRecord>('sessions', sessionId);
      if (!session) throw new Error(`Session ${sessionId} not found`);
      if (session.status === 'cancelled') throw new Error('Cannot register for a cancelled session');

      // Check capacity
      const availableCapacity = session.capacity - session.current_enrollment;
      if (availableCapacity <= 0) {
        throw new Error('Session is full. No seats available.');
      }

      // Check one-seat-per-participant (query all registrations for this session)
      const allRegs = await tx.getAll<Registration>('registrations', 'idx_session', sessionId);
      const existingActive = allRegs.find(
        (r) => r.participant_id === participantId && r.status === 'active'
      );
      if (existingActive) {
        throw new Error('You already have an active registration for this session.');
      }

      // Decrement capacity with version check
      const updatedSession = {
        ...session,
        current_enrollment: session.current_enrollment + 1,
        _version: session._version + 1,
      };
      await tx.put('sessions', updatedSession);

      // Create registration
      const reg: Registration = {
        registration_id: crypto.randomUUID(),
        participant_id: participantId,
        session_id: sessionId,
        status: 'active',
        registered_at: Date.now(),
        _version: 1,
      };
      await tx.put('registrations', reg);

      return reg;
    }
  );

  // 6. Mark idempotency key as complete
  await idempotencyService.markComplete(idempotencyKey, registration);

  // 7. Broadcast capacity change
  const updatedSession = await idbAccessLayer.get<SessionRecord>('sessions', sessionId);
  channelManager.broadcast(CHANNELS.REGISTRATION_SYNC, {
    type: 'capacity-changed',
    session_id: sessionId,
    new_capacity: updatedSession ? updatedSession.capacity - updatedSession.current_enrollment : 0,
    version: updatedSession?._version,
  } as RegistrationSyncMessage);

  return registration;
}

async function drop(
  participantId: string,
  sessionId: string,
  idempotencyKey: string,
): Promise<void> {
  // 1. RBAC
  rbacService.checkPermission('registration:manage');

  // 2. Idempotency
  const idempCheck = await idempotencyService.checkKey(idempotencyKey);
  if (idempCheck.isDuplicate) return;

  // 3. Rate limit
  await checkRateLimit(participantId);

  // 4. Atomic transaction
  await idbAccessLayer.transaction<void>(
    ['sessions', 'registrations'],
    'readwrite',
    async (tx) => {
      // Find the active registration
      const allRegs = await tx.getAll<Registration>('registrations', 'idx_session', sessionId);
      const activeReg = allRegs.find(
        (r) => r.participant_id === participantId && r.status === 'active'
      );
      if (!activeReg) {
        throw new Error('No active registration found for this session.');
      }

      // Mark registration as cancelled
      await tx.put('registrations', {
        ...activeReg,
        status: 'cancelled',
        _version: activeReg._version + 1,
      });

      // Increment session capacity
      const session = await tx.get<SessionRecord>('sessions', sessionId);
      if (!session) throw new Error(`Session ${sessionId} not found`);

      await tx.put('sessions', {
        ...session,
        current_enrollment: Math.max(0, session.current_enrollment - 1),
        _version: session._version + 1,
      });
    }
  );

  // Mark idempotency complete
  await idempotencyService.markComplete(idempotencyKey, { dropped: true });

  // Broadcast
  const updatedSession = await idbAccessLayer.get<SessionRecord>('sessions', sessionId);
  channelManager.broadcast(CHANNELS.REGISTRATION_SYNC, {
    type: 'capacity-changed',
    session_id: sessionId,
    new_capacity: updatedSession ? updatedSession.capacity - updatedSession.current_enrollment : 0,
    version: updatedSession?._version,
  } as RegistrationSyncMessage);
}

async function swap(
  participantId: string,
  fromSessionId: string,
  toSessionId: string,
  idempotencyKey: string,
): Promise<Registration> {
  // 1. RBAC
  rbacService.checkPermission('registration:manage');

  // 2. Idempotency
  const idempCheck = await idempotencyService.checkKey(idempotencyKey);
  if (idempCheck.isDuplicate) {
    return idempCheck.cachedResult as Registration;
  }

  // 3. Rate limit
  await checkRateLimit(participantId);

  // 4. Blacklist check for target session
  const isBlacklisted = await opsConfigService.isBlacklisted('participant', participantId);
  if (isBlacklisted) {
    throw new Error('Registration denied: participant is restricted.');
  }

  // 5. SINGLE atomic transaction: drop from old + add to new
  const newRegistration = await idbAccessLayer.transaction<Registration>(
    ['sessions', 'registrations'],
    'readwrite',
    async (tx) => {
      // --- DROP from old session ---
      const oldRegs = await tx.getAll<Registration>('registrations', 'idx_session', fromSessionId);
      const activeReg = oldRegs.find(
        (r) => r.participant_id === participantId && r.status === 'active'
      );
      if (!activeReg) {
        throw new Error('No active registration found in the source session.');
      }

      // Cancel old registration
      await tx.put('registrations', {
        ...activeReg,
        status: 'swapped',
        _version: activeReg._version + 1,
      });

      // Increment old session capacity
      const oldSession = await tx.get<SessionRecord>('sessions', fromSessionId);
      if (!oldSession) throw new Error(`Source session ${fromSessionId} not found`);
      await tx.put('sessions', {
        ...oldSession,
        current_enrollment: Math.max(0, oldSession.current_enrollment - 1),
        _version: oldSession._version + 1,
      });

      // --- ADD to new session ---
      const newSession = await tx.get<SessionRecord>('sessions', toSessionId);
      if (!newSession) throw new Error(`Target session ${toSessionId} not found`);
      if (newSession.status === 'cancelled') throw new Error('Target session is cancelled.');

      const newAvailable = newSession.capacity - newSession.current_enrollment;
      if (newAvailable <= 0) {
        throw new Error(
          'The swap could not be completed. Target session is full. ' +
          'Your original registration has been preserved.'
        );
      }

      // Check no existing active registration in target
      const newRegs = await tx.getAll<Registration>('registrations', 'idx_session', toSessionId);
      const existingInTarget = newRegs.find(
        (r) => r.participant_id === participantId && r.status === 'active'
      );
      if (existingInTarget) {
        throw new Error('You already have an active registration in the target session.');
      }

      // Decrement new session capacity
      await tx.put('sessions', {
        ...newSession,
        current_enrollment: newSession.current_enrollment + 1,
        _version: newSession._version + 1,
      });

      // Create new registration
      const reg: Registration = {
        registration_id: crypto.randomUUID(),
        participant_id: participantId,
        session_id: toSessionId,
        status: 'active',
        registered_at: Date.now(),
        _version: 1,
      };
      await tx.put('registrations', reg);

      return reg;
    }
  );

  // Mark idempotency complete
  await idempotencyService.markComplete(idempotencyKey, newRegistration);

  // Broadcast capacity changes for both sessions
  const fromSession = await idbAccessLayer.get<SessionRecord>('sessions', fromSessionId);
  const toSession = await idbAccessLayer.get<SessionRecord>('sessions', toSessionId);

  channelManager.broadcast(CHANNELS.REGISTRATION_SYNC, {
    type: 'capacity-changed',
    session_id: fromSessionId,
    new_capacity: fromSession ? fromSession.capacity - fromSession.current_enrollment : 0,
    version: fromSession?._version,
  } as RegistrationSyncMessage);

  channelManager.broadcast(CHANNELS.REGISTRATION_SYNC, {
    type: 'capacity-changed',
    session_id: toSessionId,
    new_capacity: toSession ? toSession.capacity - toSession.current_enrollment : 0,
    version: toSession?._version,
  } as RegistrationSyncMessage);

  return newRegistration;
}

// ============================================================
// Query helpers
// ============================================================

async function getRegistration(registrationId: string): Promise<Registration | undefined> {
  return idbAccessLayer.get<Registration>('registrations', registrationId);
}

async function getRegistrationsForSession(sessionId: string): Promise<Registration[]> {
  return idbAccessLayer.getAll<Registration>('registrations', 'idx_session', sessionId);
}

async function getRegistrationsForParticipant(participantId: string): Promise<Registration[]> {
  return idbAccessLayer.getAll<Registration>('registrations', 'idx_participant', participantId);
}

// ============================================================
// Cross-tab sync listener
// ============================================================

function initCrossTabSync(): () => void {
  return channelManager.onMessage(CHANNELS.REGISTRATION_SYNC, (message: RegistrationSyncMessage) => {
    // Rate limit increments from other tabs are handled via IndexedDB reads in checkRateLimit
    // Capacity changes trigger UI re-queries — handled by components subscribing to the channel
  });
}

// ============================================================
// Export
// ============================================================

export const registrationService = {
  add,
  drop,
  swap,
  getRegistration,
  getRegistrationsForSession,
  getRegistrationsForParticipant,
  initCrossTabSync,
};

export default registrationService;
