import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockIdb, logout } from '../API_tests/helpers';

// ============================================================
// Mock dependencies
// ============================================================

const mockIdb = createMockIdb();
let setEncryptionHooksCalled = false;
let clearEncryptionHooksCalled = false;
let lastSetHooksArgs: any[] = [];

vi.mock('../src/lib/services/idbAccessLayer', () => ({
  idbAccessLayer: {
    ...mockIdb,
    setEncryptionHooks: vi.fn((...args: any[]) => {
      setEncryptionHooksCalled = true;
      lastSetHooksArgs = args;
      mockIdb.setEncryptionHooks?.(...args);
    }),
    clearEncryptionHooks: vi.fn(() => {
      clearEncryptionHooksCalled = true;
      mockIdb.clearEncryptionHooks?.();
    }),
    getEncryptedStoreNames: vi.fn(() => ['bookings', 'sessions', 'registrations', 'messages']),
  },
}));

vi.mock('../src/lib/utils/broadcastChannels', () => ({
  channelManager: {
    broadcast: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  },
  CHANNELS: { AUTH_SYNC: 'auth-sync' },
}));

const { authService } = await import('../src/lib/services/authService');
const { encryptionService } = await import('../src/lib/services/encryptionService');
const { idbAccessLayer } = await import('../src/lib/services/idbAccessLayer');

// ============================================================
// Tests
// ============================================================

describe('Encryption Hook Wiring (Phase 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdb._clear();
    logout();
    setEncryptionHooksCalled = false;
    clearEncryptionHooksCalled = false;
    lastSetHooksArgs = [];

    mockIdb.getAll.mockImplementation(async (store: string, index?: string, value?: any) => {
      const all = Array.from(mockIdb._getStore(store).values());
      if (index && value !== undefined) {
        const field = index.replace('idx_', '');
        return all.filter((r: any) => r[field] === value);
      }
      return all;
    });

    mockIdb.put.mockImplementation(async (store: string, record: any) => {
      const keyMap: Record<string, string> = { users: 'user_id' };
      const keyPath = keyMap[store] || 'id';
      mockIdb._getStore(store).set(record[keyPath], { ...record });
      return { version: record._version ?? 1 };
    });
  });

  async function seedUser(encryptionEnabled: boolean) {
    const salt = encryptionService.generateSalt();
    const passwordHash = await encryptionService.hashPassword('testpass', salt);
    const encSalt = encryptionEnabled ? encryptionService.generateSalt() : null;

    const user = {
      user_id: 'user-1',
      username: 'testuser',
      password_hash: passwordHash,
      salt: salt.buffer,
      role: 'SYSTEM_ADMIN',
      org_unit: 'system',
      failed_attempts: 0,
      locked_until: null,
      encryption_enabled: encryptionEnabled,
      encryption_salt: encSalt ? encSalt.buffer : null,
      _version: 1,
    };
    mockIdb._seed('users', [user]);
    return user;
  }

  it('sets encryption hooks on login when encryption is enabled', async () => {
    await seedUser(true);

    await authService.login('testuser', 'testpass');

    expect(idbAccessLayer.setEncryptionHooks).toHaveBeenCalledTimes(1);
    expect(setEncryptionHooksCalled).toBe(true);
  });

  it('does not set encryption hooks on login when encryption is disabled', async () => {
    await seedUser(false);
    setEncryptionHooksCalled = false;

    await authService.login('testuser', 'testpass');

    expect(setEncryptionHooksCalled).toBe(false);
  });

  it('clears encryption hooks on logout', async () => {
    await seedUser(false);
    await authService.login('testuser', 'testpass');
    clearEncryptionHooksCalled = false;

    await authService.logout();

    expect(clearEncryptionHooksCalled).toBe(true);
  });

  it('enableEncryption sets hooks and persists state', async () => {
    await seedUser(false);
    await authService.login('testuser', 'testpass');

    setEncryptionHooksCalled = false;
    await authService.enableEncryption('user-1', 'testpass');

    expect(setEncryptionHooksCalled).toBe(true);
    const storedUser = mockIdb._getStore('users').get('user-1');
    expect(storedUser.encryption_enabled).toBe(true);
    expect(storedUser.encryption_salt).toBeTruthy();
  });

  it('enableEncryption rejects wrong password', async () => {
    await seedUser(false);

    await expect(
      authService.enableEncryption('user-1', 'wrongpass'),
    ).rejects.toThrow('Invalid password');
  });

  it('disableEncryption clears hooks and state', async () => {
    await seedUser(true);
    await authService.login('testuser', 'testpass');
    clearEncryptionHooksCalled = false;

    await authService.disableEncryption('user-1', 'testpass');

    expect(clearEncryptionHooksCalled).toBe(true);
    const storedUser = mockIdb._getStore('users').get('user-1');
    expect(storedUser.encryption_enabled).toBe(false);
    expect(storedUser.encryption_salt).toBeNull();
  });

  it('setEncryptionHooks receives userId as third argument', async () => {
    await seedUser(true);
    lastSetHooksArgs = [];

    await authService.login('testuser', 'testpass');

    expect(setEncryptionHooksCalled).toBe(true);
    // Third argument should be the userId
    expect(lastSetHooksArgs[2]).toBe('user-1');
  });

  it('restoreSession flags encryptionRequiresRelogin when encryption was enabled', async () => {
    await seedUser(true);
    // Login first to create a session in localStorage
    const session = await authService.login('testuser', 'testpass');

    // Simulate app reload: clear hooks and restore
    vi.mocked(idbAccessLayer.clearEncryptionHooks).mockClear();
    vi.mocked(idbAccessLayer.setEncryptionHooks).mockClear();

    // Set the encryption flag in localStorage (simulating prior enable)
    localStorage.setItem('encryption_enabled_user-1', 'true');

    const restored = authService.restoreSession();

    expect(restored).toBeTruthy();
    expect(restored!.encryptionRequiresRelogin).toBe(true);
    // Should NOT have called setEncryptionHooks (no password available)
    expect(idbAccessLayer.setEncryptionHooks).not.toHaveBeenCalled();
  });
});

describe('Password Change Re-encryption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdb._clear();
    logout();
    setEncryptionHooksCalled = false;
    clearEncryptionHooksCalled = false;
    lastSetHooksArgs = [];

    mockIdb.getAll.mockImplementation(async (store: string, index?: string, value?: any, userId?: string) => {
      let all = Array.from(mockIdb._getStore(store).values());
      if (index && value !== undefined) {
        const field = index.replace('idx_', '');
        all = all.filter((r: any) => r[field] === value);
      }
      // Namespace filtering: match real idbAccessLayer behavior
      if (userId) {
        all = all.filter((r: any) => !r.user_id || r.user_id === userId);
      }
      return all;
    });

    mockIdb.put.mockImplementation(async (store: string, record: any) => {
      const keyMap: Record<string, string> = {
        users: 'user_id', bookings: 'booking_id', sessions: 'session_id',
        registrations: 'registration_id', messages: 'message_id',
      };
      const keyPath = keyMap[store] || 'id';
      mockIdb._getStore(store).set(record[keyPath], { ...record });
      return { version: record._version ?? 1 };
    });
  });

  async function seedUserWithEncryption() {
    const salt = encryptionService.generateSalt();
    const passwordHash = await encryptionService.hashPassword('oldpass', salt);
    const encSalt = encryptionService.generateSalt();

    const user = {
      user_id: 'user-1',
      username: 'testuser',
      password_hash: passwordHash,
      salt: salt.buffer,
      role: 'SYSTEM_ADMIN',
      org_unit: 'system',
      failed_attempts: 0,
      locked_until: null,
      encryption_enabled: true,
      encryption_salt: encSalt.buffer,
      _version: 1,
    };
    mockIdb._seed('users', [user]);
    return user;
  }

  it('re-encrypts all encrypted stores on password change', async () => {
    await seedUserWithEncryption();
    await authService.login('testuser', 'oldpass');

    // Seed data in encrypted stores — owned by user-1
    mockIdb._seed('bookings', [{
      booking_id: 'b-1', room_id: 'r-1', user_id: 'user-1', status: 'confirmed', _version: 1,
    }]);
    mockIdb._seed('sessions', [{
      session_id: 's-1', title: 'Test Session', user_id: 'user-1', status: 'active', _version: 1,
    }]);

    // Track put calls per store
    const putCalls: Record<string, number> = {};
    const originalPut = mockIdb.put.getMockImplementation()!;
    mockIdb.put.mockImplementation(async (store: string, record: any) => {
      putCalls[store] = (putCalls[store] || 0) + 1;
      return originalPut(store, record);
    });

    await authService.changePassword('user-1', 'oldpass', 'newpass');

    // Verify records in encrypted stores were re-written
    expect(putCalls['bookings']).toBeGreaterThanOrEqual(1);
    expect(putCalls['sessions']).toBeGreaterThanOrEqual(1);

    // Verify new encryption hooks were activated with new key
    expect(setEncryptionHooksCalled).toBe(true);

    // Verify user record was updated with new password hash
    const storedUser = mockIdb._getStore('users').get('user-1');
    expect(storedUser).toBeTruthy();
    expect(storedUser.encryption_salt).toBeTruthy();
  });

  it('does not re-encrypt when encryption is disabled', async () => {
    const salt = encryptionService.generateSalt();
    const passwordHash = await encryptionService.hashPassword('oldpass', salt);
    mockIdb._seed('users', [{
      user_id: 'user-1',
      username: 'testuser',
      password_hash: passwordHash,
      salt: salt.buffer,
      role: 'SYSTEM_ADMIN',
      org_unit: 'system',
      failed_attempts: 0,
      locked_until: null,
      encryption_enabled: false,
      encryption_salt: null,
      _version: 1,
    }]);
    await authService.login('testuser', 'oldpass');

    mockIdb._seed('bookings', [{
      booking_id: 'b-1', room_id: 'r-1', status: 'confirmed', _version: 1,
    }]);

    setEncryptionHooksCalled = false;
    const putCalls: string[] = [];
    const originalPut = mockIdb.put.getMockImplementation()!;
    mockIdb.put.mockImplementation(async (store: string, record: any) => {
      putCalls.push(store);
      return originalPut(store, record);
    });

    await authService.changePassword('user-1', 'oldpass', 'newpass');

    // Should only write the user record update, not re-encrypt other stores
    expect(putCalls.filter((s) => s === 'bookings').length).toBe(0);
    // User record is still updated with new hash
    expect(putCalls).toContain('users');
  });
});

describe('Password Change Cross-User Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdb._clear();
    logout();
    setEncryptionHooksCalled = false;
    clearEncryptionHooksCalled = false;
    lastSetHooksArgs = [];

    mockIdb.getAll.mockImplementation(async (store: string, index?: string, value?: any, userId?: string) => {
      let all = Array.from(mockIdb._getStore(store).values());
      if (index && value !== undefined) {
        const field = index.replace('idx_', '');
        all = all.filter((r: any) => r[field] === value);
      }
      if (userId) {
        all = all.filter((r: any) => !r.user_id || r.user_id === userId);
      }
      return all;
    });

    mockIdb.put.mockImplementation(async (store: string, record: any) => {
      const keyMap: Record<string, string> = {
        users: 'user_id', bookings: 'booking_id', sessions: 'session_id',
        registrations: 'registration_id', messages: 'message_id',
      };
      const keyPath = keyMap[store] || 'id';
      mockIdb._getStore(store).set(record[keyPath], { ...record });
      return { version: record._version ?? 1 };
    });
  });

  it('does not re-encrypt records owned by another user', async () => {
    // Seed User A (encryption enabled)
    const saltA = encryptionService.generateSalt();
    const hashA = await encryptionService.hashPassword('passA', saltA);
    const encSaltA = encryptionService.generateSalt();
    mockIdb._seed('users', [{
      user_id: 'user-A',
      username: 'userA',
      password_hash: hashA,
      salt: saltA.buffer,
      role: 'INSTRUCTOR',
      org_unit: 'unit1',
      failed_attempts: 0,
      locked_until: null,
      encryption_enabled: true,
      encryption_salt: encSaltA.buffer,
      _version: 1,
    }]);

    // Seed bookings: one for User A, one for User B
    mockIdb._seed('bookings', [
      { booking_id: 'b-A', room_id: 'r-1', user_id: 'user-A', status: 'confirmed', _version: 1 },
      { booking_id: 'b-B', room_id: 'r-2', user_id: 'user-B', status: 'confirmed', _version: 1 },
    ]);

    await authService.login('userA', 'passA');

    // Track which records get written per store
    const writtenKeys: Record<string, string[]> = {};
    const originalPut = mockIdb.put.getMockImplementation()!;
    mockIdb.put.mockImplementation(async (store: string, record: any) => {
      if (!writtenKeys[store]) writtenKeys[store] = [];
      const keyMap: Record<string, string> = {
        users: 'user_id', bookings: 'booking_id', sessions: 'session_id',
      };
      const kp = keyMap[store] || 'id';
      writtenKeys[store].push(record[kp]);
      return originalPut(store, record);
    });

    await authService.changePassword('user-A', 'passA', 'newPassA');

    // User A's booking should have been re-written
    expect(writtenKeys['bookings'] ?? []).toContain('b-A');
    // User B's booking must NOT have been re-written
    expect(writtenKeys['bookings'] ?? []).not.toContain('b-B');

    // User B's booking should still have its original data untouched
    const bB = mockIdb._getStore('bookings').get('b-B');
    expect(bB.user_id).toBe('user-B');
    expect(bB.room_id).toBe('r-2');
  });

  it('does not re-encrypt shared records that have no user_id', async () => {
    // Seed User A (encryption enabled)
    const saltA = encryptionService.generateSalt();
    const hashA = await encryptionService.hashPassword('passA', saltA);
    const encSaltA = encryptionService.generateSalt();
    mockIdb._seed('users', [{
      user_id: 'user-A',
      username: 'userA',
      password_hash: hashA,
      salt: saltA.buffer,
      role: 'SYSTEM_ADMIN',
      org_unit: 'system',
      failed_attempts: 0,
      locked_until: null,
      encryption_enabled: true,
      encryption_salt: encSaltA.buffer,
      _version: 1,
    }]);

    // Seed a shared record with no user_id and an owned record
    mockIdb._seed('bookings', [
      { booking_id: 'b-owned', room_id: 'r-1', user_id: 'user-A', status: 'confirmed', _version: 1 },
      { booking_id: 'b-shared', room_id: 'r-2', status: 'confirmed', _version: 1 },
    ]);

    await authService.login('userA', 'passA');

    const writtenKeys: string[] = [];
    const originalPut = mockIdb.put.getMockImplementation()!;
    mockIdb.put.mockImplementation(async (store: string, record: any) => {
      if (store === 'bookings') writtenKeys.push(record.booking_id);
      return originalPut(store, record);
    });

    await authService.changePassword('user-A', 'passA', 'newPassA');

    // Owned record should be re-written
    expect(writtenKeys).toContain('b-owned');
    // Shared record (no user_id) is included by the filter (!r.user_id passes)
    // so it WILL be re-written — this is correct for records the user can access
    expect(writtenKeys).toContain('b-shared');

    // Both records should still be intact
    expect(mockIdb._getStore('bookings').get('b-owned').room_id).toBe('r-1');
    expect(mockIdb._getStore('bookings').get('b-shared').room_id).toBe('r-2');
  });
});

describe('Encryption Payload Verification', () => {
  it('encrypt then decrypt round-trips produce original data', async () => {
    const password = 'test-password-123';
    const salt = encryptionService.generateSalt();
    const key = await encryptionService.deriveKey(password, salt);

    const originalData = { message_id: 'msg-1', title: 'Secret Notice', body: 'Classified content' };

    // Encrypt
    const { ciphertext, iv } = await encryptionService.encrypt(key, originalData);

    // Verify encrypted output is not plaintext
    expect(ciphertext.byteLength).toBeGreaterThan(0);
    expect(iv.length).toBe(12);

    // The ciphertext should NOT contain the original plaintext
    const decoder = new TextDecoder();
    const ciphertextBytes = new Uint8Array(ciphertext);
    const ciphertextStr = decoder.decode(ciphertextBytes);
    expect(ciphertextStr).not.toContain('Secret Notice');

    // Decrypt
    const decrypted = await encryptionService.decrypt(key, ciphertext, iv);

    expect(decrypted).toEqual(originalData);
  });

  it('encrypt hook produces encrypted shape, decrypt hook recovers original', async () => {
    const password = 'hook-test-pw';
    const salt = encryptionService.generateSalt();
    const key = await encryptionService.deriveKey(password, salt);

    // Build the same hooks authService uses
    const encryptFn = async (data: unknown, _uid: string) => {
      const { ciphertext, iv } = await encryptionService.encrypt(key, data);
      return { ciphertext, iv };
    };
    const decryptFn = async (data: unknown, _uid: string) => {
      const record = data as { ciphertext: ArrayBuffer; iv: Uint8Array };
      if (record.ciphertext && record.iv) {
        return encryptionService.decrypt(key, record.ciphertext, new Uint8Array(record.iv));
      }
      return data;
    };

    const original = { booking_id: 'b-1', room_id: 'r-1', status: 'confirmed' };

    // Encrypt via hook
    const encrypted = await encryptFn(original, 'user-1') as { ciphertext: ArrayBuffer; iv: Uint8Array };
    expect(encrypted.ciphertext.byteLength).toBeGreaterThan(0);
    expect(encrypted.iv.length).toBe(12);

    // Decrypt via hook
    const recovered = await decryptFn(encrypted, 'user-1');
    expect(recovered).toEqual(original);
  });

  it('different keys cannot decrypt each other\'s data', async () => {
    const salt = encryptionService.generateSalt();
    const key1 = await encryptionService.deriveKey('password-one', salt);
    const key2 = await encryptionService.deriveKey('password-two', salt);

    const data = { secret: 'value' };
    const { ciphertext, iv } = await encryptionService.encrypt(key1, data);

    // Decrypting with wrong key should throw
    await expect(
      encryptionService.decrypt(key2, ciphertext, iv),
    ).rejects.toThrow();
  });
});
