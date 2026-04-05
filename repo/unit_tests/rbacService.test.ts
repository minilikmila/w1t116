import { describe, it, expect, beforeEach } from 'vitest';
import { authStore } from '../src/lib/stores';
import { rbacService } from '../src/lib/services/rbacService';
import { AccessError } from '../src/lib/types';
import type { Session, Role } from '../src/lib/types';

// ============================================================
// Helpers
// ============================================================

function setSession(overrides: Partial<Session> = {}): Session {
  const session: Session = {
    user_id: 'user-1',
    role: 'SYSTEM_ADMIN',
    org_unit: 'HQ',
    token: 'tok-1',
    expires_at: Date.now() + 3600_000,
    ...overrides,
  };
  authStore.set(session);
  return session;
}

// ============================================================
// Tests
// ============================================================

describe('rbacService', () => {
  beforeEach(() => {
    authStore.set(null);
  });

  // ----------------------------------------------------------
  // getCurrentSession
  // ----------------------------------------------------------

  describe('getCurrentSession', () => {
    it('throws AccessError when no session exists', () => {
      expect(() => rbacService.getCurrentSession()).toThrow(AccessError);
      expect(() => rbacService.getCurrentSession()).toThrow('No active session');
    });

    it('throws AccessError when session is expired', () => {
      setSession({ expires_at: Date.now() - 1000 });
      expect(() => rbacService.getCurrentSession()).toThrow('Session expired');
    });

    it('throws AccessError for invalid role', () => {
      setSession({ role: 'HACKER' as Role });
      expect(() => rbacService.getCurrentSession()).toThrow('Invalid session role');
    });

    it('returns session when valid', () => {
      const session = setSession();
      const result = rbacService.getCurrentSession();
      expect(result.user_id).toBe(session.user_id);
      expect(result.role).toBe('SYSTEM_ADMIN');
    });
  });

  // ----------------------------------------------------------
  // checkRole
  // ----------------------------------------------------------

  describe('checkRole', () => {
    it('passes when user role is in the required set', () => {
      setSession({ role: 'OPS_COORDINATOR' });
      expect(() => rbacService.checkRole(['OPS_COORDINATOR', 'SYSTEM_ADMIN'])).not.toThrow();
    });

    it('throws AccessError when user role is not in the required set', () => {
      setSession({ role: 'PARTICIPANT' });
      expect(() => rbacService.checkRole(['SYSTEM_ADMIN'])).toThrow(AccessError);
    });

    it('error message includes required and actual roles', () => {
      setSession({ role: 'INSTRUCTOR' });
      try {
        rbacService.checkRole(['SYSTEM_ADMIN']);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('SYSTEM_ADMIN');
        expect(e.message).toContain('INSTRUCTOR');
      }
    });
  });

  // ----------------------------------------------------------
  // checkPermission
  // ----------------------------------------------------------

  describe('checkPermission', () => {
    it('allows SYSTEM_ADMIN to create users', () => {
      setSession({ role: 'SYSTEM_ADMIN' });
      expect(() => rbacService.checkPermission('user:create')).not.toThrow();
    });

    it('denies PARTICIPANT from creating users', () => {
      setSession({ role: 'PARTICIPANT' });
      expect(() => rbacService.checkPermission('user:create')).toThrow(AccessError);
    });

    it('throws for unknown operation key', () => {
      setSession({ role: 'SYSTEM_ADMIN' });
      expect(() => rbacService.checkPermission('nonexistent:op')).toThrow('Unknown operation');
    });

    it('allows PARTICIPANT to manage registrations', () => {
      setSession({ role: 'PARTICIPANT' });
      expect(() => rbacService.checkPermission('registration:manage')).not.toThrow();
    });

    it('denies INSTRUCTOR from managing registrations', () => {
      setSession({ role: 'INSTRUCTOR' });
      expect(() => rbacService.checkPermission('registration:manage')).toThrow(AccessError);
    });

    it('allows INSTRUCTOR to create bookings', () => {
      setSession({ role: 'INSTRUCTOR' });
      expect(() => rbacService.checkPermission('booking:create')).not.toThrow();
    });

    it('denies PARTICIPANT from creating bookings', () => {
      setSession({ role: 'PARTICIPANT' });
      expect(() => rbacService.checkPermission('booking:create')).toThrow(AccessError);
    });
  });

  // ----------------------------------------------------------
  // checkOwnership
  // ----------------------------------------------------------

  describe('checkOwnership', () => {
    it('passes when owner matches current user', () => {
      expect(() => rbacService.checkOwnership('user-1', 'user-1')).not.toThrow();
    });

    it('throws AccessError when owner does not match', () => {
      expect(() => rbacService.checkOwnership('user-1', 'user-2')).toThrow(AccessError);
      expect(() => rbacService.checkOwnership('user-1', 'user-2')).toThrow('do not own');
    });
  });

  // ----------------------------------------------------------
  // isPermitted (no session required)
  // ----------------------------------------------------------

  describe('isPermitted', () => {
    it('returns true for permitted role+operation', () => {
      expect(rbacService.isPermitted('SYSTEM_ADMIN', 'user:create')).toBe(true);
    });

    it('returns false for unpermitted role+operation', () => {
      expect(rbacService.isPermitted('PARTICIPANT', 'user:create')).toBe(false);
    });

    it('returns false for unknown operation', () => {
      expect(rbacService.isPermitted('SYSTEM_ADMIN', 'fake:op')).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // getPermittedOperations
  // ----------------------------------------------------------

  describe('getPermittedOperations', () => {
    it('returns correct operations for SYSTEM_ADMIN (superset of most)', () => {
      const ops = rbacService.getPermittedOperations('SYSTEM_ADMIN');
      expect(ops).toContain('user:create');
      expect(ops).toContain('policy:modify');
      expect(ops).toContain('booking:create');
      expect(ops).not.toContain('registration:manage'); // PARTICIPANT only
      expect(ops).not.toContain('session:create');       // INSTRUCTOR only
    });

    it('returns correct operations for PARTICIPANT', () => {
      const ops = rbacService.getPermittedOperations('PARTICIPANT');
      expect(ops).toContain('registration:manage');
      expect(ops).toContain('registration:view_own');
      expect(ops).toContain('bill:view_own');
      expect(ops).toContain('message:view_inbox');
      expect(ops).not.toContain('user:create');
    });

    it('returns correct operations for INSTRUCTOR', () => {
      const ops = rbacService.getPermittedOperations('INSTRUCTOR');
      expect(ops).toContain('session:create');
      expect(ops).toContain('booking:create');
      expect(ops).toContain('attendance:track');
      expect(ops).not.toContain('registration:manage');
    });
  });

  // ----------------------------------------------------------
  // Permission matrix completeness
  // ----------------------------------------------------------

  describe('permission matrix boundary checks', () => {
    const ALL_ROLES: Role[] = ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT'];

    it('universal operations are accessible by all roles', () => {
      const universalOps = [
        'message:view_inbox',
        'message:search',
        'reminder:manage_own',
        'password:change_own',
        'encryption:toggle_own',
      ];
      for (const op of universalOps) {
        for (const role of ALL_ROLES) {
          expect(rbacService.isPermitted(role, op)).toBe(true);
        }
      }
    });

    it('SYSTEM_ADMIN-only operations are restricted', () => {
      const adminOnly = ['user:create', 'user:edit', 'policy:modify', 'feature_flag:manage', 'export_import:manage', 'blacklist:manage'];
      for (const op of adminOnly) {
        expect(rbacService.isPermitted('SYSTEM_ADMIN', op)).toBe(true);
        expect(rbacService.isPermitted('OPS_COORDINATOR', op)).toBe(false);
        expect(rbacService.isPermitted('INSTRUCTOR', op)).toBe(false);
        expect(rbacService.isPermitted('PARTICIPANT', op)).toBe(false);
      }
    });
  });
});
