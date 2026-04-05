import type { Role } from '../types';
import { AccessError } from '../types';
import { authStore } from '../stores';
import { get } from 'svelte/store';

// ============================================================
// Permission Matrix — 26 operations × 4 roles
// Roles are strictly siloed. No inheritance.
// ============================================================

const PERMISSION_MATRIX: Record<string, Set<Role>> = {
  // User management
  'user:create':              new Set(['SYSTEM_ADMIN']),
  'user:edit':                new Set(['SYSTEM_ADMIN']),

  // System configuration
  'policy:modify':            new Set(['SYSTEM_ADMIN']),
  'feature_flag:manage':      new Set(['SYSTEM_ADMIN']),
  'export_import:manage':     new Set(['SYSTEM_ADMIN']),

  // Meter readings & maintenance
  'meter:enter':              new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),
  'maintenance:manage':       new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),

  // Messaging (publish/retract/pin/schedule)
  'message:publish':          new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),
  'message:retract':          new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),
  'message:pin':              new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),
  'message:schedule':         new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),

  // Bookings
  'booking:view_all':         new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),
  'booking:create':           new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR']),
  'booking:edit_own':         new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR']),
  'booking:cancel_any':       new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),
  'booking:cancel_own':       new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR']),

  // Sessions
  'session:create':           new Set(['INSTRUCTOR']),
  'session:edit_own':         new Set(['INSTRUCTOR']),

  // Attendance
  'attendance:track':         new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR']),

  // Registration
  'registration:manage':      new Set(['PARTICIPANT']),
  'registration:view_own':    new Set(['PARTICIPANT']),

  // Billing
  'bill:view_own':            new Set(['SYSTEM_ADMIN', 'PARTICIPANT']),
  'payment:record':           new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),
  'billing:generate':         new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),
  'billing:export_csv':       new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),
  'waiver:apply':             new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),

  // Analytics
  'analytics:view':           new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR']),

  // Messaging (compose session-related)
  'message:compose_session':  new Set(['INSTRUCTOR']),

  // Universal operations
  'message:view_inbox':       new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT']),
  'message:search':           new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT']),
  'reminder:manage_own':      new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT']),
  'password:change_own':      new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT']),
  'encryption:toggle_own':    new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT']),

  // Blacklist
  'blacklist:manage':         new Set(['SYSTEM_ADMIN']),

  // Room conflict alternatives
  'booking:view_alternatives': new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR']),
};

// ============================================================
// Session Validation
// ============================================================

function getCurrentSession() {
  const session = get(authStore);
  if (!session) {
    throw new AccessError('No active session. Please log in.');
  }

  // Validate session expiry
  if (session.expires_at < Date.now()) {
    throw new AccessError('Session expired. Please log in again.');
  }

  // Validate role is a known role
  const validRoles: Set<string> = new Set(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT']);
  if (!validRoles.has(session.role)) {
    throw new AccessError('Invalid session role. Please re-authenticate.');
  }

  return session;
}

// ============================================================
// Permission Checks
// ============================================================

/**
 * Check if the current user's role is in the required set.
 * Throws AccessError if not permitted.
 */
function checkRole(requiredRoles: Role[]): void {
  const session = getCurrentSession();
  const roleSet = new Set(requiredRoles);

  if (!roleSet.has(session.role)) {
    throw new AccessError(
      `Access denied. Required roles: [${requiredRoles.join(', ')}]. Your role: ${session.role}.`
    );
  }
}

/**
 * Check if the current user's role is permitted for the given operation key.
 * Throws AccessError if not permitted.
 */
function checkPermission(operationKey: string): void {
  const session = getCurrentSession();
  const allowedRoles = PERMISSION_MATRIX[operationKey];

  if (!allowedRoles) {
    throw new AccessError(`Unknown operation: ${operationKey}`);
  }

  if (!allowedRoles.has(session.role)) {
    throw new AccessError(
      `Access denied for operation '${operationKey}'. Your role: ${session.role}.`
    );
  }
}

/**
 * Check if the current user owns the resource.
 * Throws AccessError if ownership doesn't match.
 */
function checkOwnership(resourceOwnerId: string, currentUserId: string): void {
  if (resourceOwnerId !== currentUserId) {
    throw new AccessError('Access denied. You do not own this resource.');
  }
}

/**
 * Check if a given role is permitted for an operation (without requiring a session).
 * Used for UI-level gating (e.g., deciding which nav items to show).
 */
function isPermitted(role: Role, operationKey: string): boolean {
  const allowedRoles = PERMISSION_MATRIX[operationKey];
  if (!allowedRoles) return false;
  return allowedRoles.has(role);
}

/**
 * Get all operation keys permitted for a given role.
 */
function getPermittedOperations(role: Role): string[] {
  return Object.entries(PERMISSION_MATRIX)
    .filter(([, roles]) => roles.has(role))
    .map(([key]) => key);
}

// ============================================================
// Export
// ============================================================

export const rbacService = {
  checkRole,
  checkPermission,
  checkOwnership,
  isPermitted,
  getPermittedOperations,
  getCurrentSession,
};

export default rbacService;
