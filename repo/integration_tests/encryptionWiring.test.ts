import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockIdb, logout } from '../API_tests/helpers';

// ============================================================
// Mock dependencies
// ============================================================

const mockIdb = createMockIdb();
let setEncryptionHooksCalled = false;
let clearEncryptionHooksCalled = false;

vi.mock('../src/lib/services/idbAccessLayer', () => ({
  idbAccessLayer: {
    ...mockIdb,
    setEncryptionHooks: vi.fn((...args: any[]) => {
      setEncryptionHooksCalled = true;
      mockIdb.setEncryptionHooks?.(...args);
    }),
    clearEncryptionHooks: vi.fn(() => {
      clearEncryptionHooksCalled = true;
      mockIdb.clearEncryptionHooks?.();
    }),
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

    await authService.login('testuser', 'testpass');

    expect(idbAccessLayer.setEncryptionHooks).not.toHaveBeenCalled();
  });

  it('clears encryption hooks on logout', async () => {
    await seedUser(false);
    await authService.login('testuser', 'testpass');

    await authService.logout();

    expect(idbAccessLayer.clearEncryptionHooks).toHaveBeenCalled();
  });

  it('enableEncryption sets hooks and persists state', async () => {
    await seedUser(false);
    await authService.login('testuser', 'testpass');

    vi.mocked(idbAccessLayer.setEncryptionHooks).mockClear();
    await authService.enableEncryption('user-1', 'testpass');

    expect(idbAccessLayer.setEncryptionHooks).toHaveBeenCalledTimes(1);
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

    await authService.disableEncryption('user-1', 'testpass');

    expect(idbAccessLayer.clearEncryptionHooks).toHaveBeenCalled();
    const storedUser = mockIdb._getStore('users').get('user-1');
    expect(storedUser.encryption_enabled).toBe(false);
    expect(storedUser.encryption_salt).toBeNull();
  });
});
