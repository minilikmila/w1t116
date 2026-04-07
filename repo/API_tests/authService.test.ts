import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { authStore } from '../src/lib/stores';

// ============================================================
// Mock dependencies before importing authService
// ============================================================

const mockIdb = {
  getAll: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  setEncryptionHooks: vi.fn(),
  clearEncryptionHooks: vi.fn(),
};

vi.mock('../src/lib/services/idbAccessLayer', () => ({
  idbAccessLayer: mockIdb,
}));

vi.mock('../src/lib/utils/broadcastChannels', () => ({
  channelManager: {
    broadcast: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  },
  CHANNELS: {
    AUTH_SYNC: 'auth-sync',
  },
}));

// Mock encryptionService with fast, deterministic operations
const mockEncryption = {
  hashPassword: vi.fn(async (password: string, salt: Uint8Array) => {
    const encoder = new TextEncoder();
    return encoder.encode(`hash:${password}:${Array.from(salt).join(',')}`).buffer;
  }),
  generateSalt: vi.fn(() => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])),
  reEncryptAll: vi.fn(),
};

vi.mock('../src/lib/services/encryptionService', () => ({
  encryptionService: mockEncryption,
}));

// Now import the service under test
const { authService } = await import('../src/lib/services/authService');

// ============================================================
// Helpers
// ============================================================

function makeUser(overrides: Record<string, any> = {}) {
  const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const encoder = new TextEncoder();
  return {
    user_id: 'user-1',
    username: 'admin',
    password_hash: encoder.encode(`hash:admin:${Array.from(salt).join(',')}`).buffer,
    salt: salt.buffer,
    role: 'SYSTEM_ADMIN',
    org_unit: 'HQ',
    failed_attempts: 0,
    locked_until: null,
    encryption_enabled: false,
    encryption_salt: null,
    _version: 1,
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authStore.set(null);
    localStorage.clear();
  });

  // ----------------------------------------------------------
  // login — normal inputs
  // ----------------------------------------------------------

  describe('login', () => {
    it('returns session on valid credentials', async () => {
      const user = makeUser();
      mockIdb.getAll.mockResolvedValueOnce([user]);
      mockIdb.put.mockResolvedValue(undefined);

      const session = await authService.login('admin', 'admin');

      expect(session.user_id).toBe('user-1');
      expect(session.role).toBe('SYSTEM_ADMIN');
      expect(session.token).toBeTruthy();
      expect(session.expires_at).toBeGreaterThan(Date.now());
    });

    it('sets authStore on successful login', async () => {
      mockIdb.getAll.mockResolvedValueOnce([makeUser()]);
      mockIdb.put.mockResolvedValue(undefined);

      await authService.login('admin', 'admin');

      const stored = get(authStore);
      expect(stored).not.toBeNull();
      expect(stored!.user_id).toBe('user-1');
    });

    it('persists session to localStorage', async () => {
      mockIdb.getAll.mockResolvedValueOnce([makeUser()]);
      mockIdb.put.mockResolvedValue(undefined);

      await authService.login('admin', 'admin');

      const raw = localStorage.getItem('session_user-1');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.user_id).toBe('user-1');
    });

    it('resets failed_attempts on successful login', async () => {
      const user = makeUser({ failed_attempts: 5 });
      mockIdb.getAll.mockResolvedValueOnce([user]);
      mockIdb.put.mockResolvedValue(undefined);

      await authService.login('admin', 'admin');

      // The second put call clears the user's failed_attempts
      const clearedUser = mockIdb.put.mock.calls[0][1];
      expect(clearedUser.failed_attempts).toBe(0);
      expect(clearedUser.locked_until).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // login — invalid inputs
  // ----------------------------------------------------------

  describe('login — error cases', () => {
    it('throws on nonexistent username', async () => {
      mockIdb.getAll.mockResolvedValueOnce([]);

      await expect(authService.login('unknown', 'pass'))
        .rejects.toThrow('Invalid username or password');
    });

    it('throws on wrong password and increments failed_attempts', async () => {
      const user = makeUser();
      mockIdb.getAll.mockResolvedValueOnce([user]);
      mockIdb.put.mockResolvedValue(undefined);

      // Supply wrong password — hash won't match
      mockEncryption.hashPassword.mockResolvedValueOnce(new ArrayBuffer(10));

      await expect(authService.login('admin', 'wrong'))
        .rejects.toThrow('Invalid username or password');

      expect(mockIdb.put).toHaveBeenCalledWith('users', expect.objectContaining({
        failed_attempts: 1,
      }));
    });

    it('locks account after 10 failed attempts', async () => {
      const user = makeUser({ failed_attempts: 9 });
      mockIdb.getAll.mockResolvedValueOnce([user]);
      mockIdb.put.mockResolvedValue(undefined);
      mockEncryption.hashPassword.mockResolvedValueOnce(new ArrayBuffer(10));

      await expect(authService.login('admin', 'wrong')).rejects.toThrow();

      const updatedUser = mockIdb.put.mock.calls[0][1];
      expect(updatedUser.failed_attempts).toBe(10);
      expect(updatedUser.locked_until).toBeGreaterThan(Date.now());
    });

    it('rejects login when account is locked', async () => {
      const user = makeUser({ locked_until: Date.now() + 15 * 60 * 1000 });
      mockIdb.getAll.mockResolvedValueOnce([user]);

      await expect(authService.login('admin', 'admin'))
        .rejects.toThrow(/Account is locked/);
    });

    it('allows login after lock expires', async () => {
      const user = makeUser({ locked_until: Date.now() - 1000, failed_attempts: 10 });
      mockIdb.getAll.mockResolvedValueOnce([user]);
      mockIdb.put.mockResolvedValue(undefined);

      const session = await authService.login('admin', 'admin');
      expect(session.user_id).toBe('user-1');
    });
  });

  // ----------------------------------------------------------
  // logout
  // ----------------------------------------------------------

  describe('logout', () => {
    it('clears authStore', async () => {
      authStore.set({
        user_id: 'user-1', role: 'SYSTEM_ADMIN', org_unit: 'HQ',
        token: 'tok', expires_at: Date.now() + 60_000,
      });

      await authService.logout();

      expect(get(authStore)).toBeNull();
    });

    it('removes session from localStorage', async () => {
      authStore.set({
        user_id: 'user-1', role: 'SYSTEM_ADMIN', org_unit: 'HQ',
        token: 'tok', expires_at: Date.now() + 60_000,
      });
      localStorage.setItem('session_user-1', 'data');

      await authService.logout();

      expect(localStorage.getItem('session_user-1')).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // restoreSession
  // ----------------------------------------------------------

  describe('restoreSession', () => {
    it('returns null when no sessions in localStorage', () => {
      const result = authService.restoreSession();
      expect(result).toBeNull();
    });

    it('restores a valid session', () => {
      const session = {
        user_id: 'user-1', role: 'SYSTEM_ADMIN', org_unit: 'HQ',
        token: 'tok', expires_at: Date.now() + 60_000,
      };
      localStorage.setItem('session_user-1', JSON.stringify(session));

      const restored = authService.restoreSession();
      expect(restored).not.toBeNull();
      expect(restored!.user_id).toBe('user-1');
    });

    it('removes and ignores expired sessions', () => {
      const session = {
        user_id: 'user-1', role: 'SYSTEM_ADMIN', org_unit: 'HQ',
        token: 'tok', expires_at: Date.now() - 1000,
      };
      localStorage.setItem('session_user-1', JSON.stringify(session));

      const restored = authService.restoreSession();
      expect(restored).toBeNull();
      expect(localStorage.getItem('session_user-1')).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // createUser
  // ----------------------------------------------------------

  describe('createUser', () => {
    it('creates a user with hashed password', async () => {
      mockIdb.put.mockResolvedValue(undefined);

      const user = await authService.createUser({
        username: 'newuser',
        password: 'pass123',
        role: 'INSTRUCTOR',
        org_unit: 'Science',
      });

      expect(user.username).toBe('newuser');
      expect(user.role).toBe('INSTRUCTOR');
      expect(user.org_unit).toBe('Science');
      expect(user.failed_attempts).toBe(0);
      expect(user.locked_until).toBeNull();
      expect(user._version).toBe(1);
      expect(user.password_hash).toBeTruthy();
      expect(user.salt).toBeTruthy();
    });

    it('persists user to IDB', async () => {
      mockIdb.put.mockResolvedValue(undefined);

      await authService.createUser({
        username: 'newuser',
        password: 'pass123',
        role: 'PARTICIPANT',
        org_unit: 'DormA',
      });

      expect(mockIdb.put).toHaveBeenCalledWith('users', expect.objectContaining({
        username: 'newuser',
        role: 'PARTICIPANT',
      }));
    });
  });

  // ----------------------------------------------------------
  // changePassword
  // ----------------------------------------------------------

  describe('changePassword', () => {
    it('throws when user not found', async () => {
      mockIdb.get.mockResolvedValueOnce(undefined);

      await expect(authService.changePassword('nope', 'old', 'new'))
        .rejects.toThrow('User not found');
    });

    it('throws when old password is wrong', async () => {
      const user = makeUser();
      mockIdb.get.mockResolvedValueOnce(user);
      mockEncryption.hashPassword.mockResolvedValueOnce(new ArrayBuffer(10));

      await expect(authService.changePassword('user-1', 'wrong', 'new'))
        .rejects.toThrow('Current password is incorrect');
    });
  });
});
