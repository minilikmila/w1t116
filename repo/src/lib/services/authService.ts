import { get } from 'svelte/store';
import { idbAccessLayer } from './idbAccessLayer';
import { encryptionService } from './encryptionService';
import { channelManager, CHANNELS } from '../utils/broadcastChannels';
import { authStore } from '../stores';
import type { Session, User, AuthSyncMessage, Role } from '../types';

// ============================================================
// Helpers
// ============================================================

function compareBuffers(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const viewA = new Uint8Array(a);
  const viewB = new Uint8Array(b);
  if (viewA.byteLength !== viewB.byteLength) return false;
  for (let i = 0; i < viewA.byteLength; i++) {
    if (viewA[i] !== viewB[i]) return false;
  }
  return true;
}

// ============================================================
// 1. login
// ============================================================

async function login(username: string, password: string): Promise<Session> {
  const users: User[] = await idbAccessLayer.getAll('users', 'idx_username', username);
  const user = users[0];
  if (!user) {
    throw new Error('Invalid username or password');
  }

  // Check account lockout
  if (user.locked_until && user.locked_until > Date.now()) {
    const remainingMs = user.locked_until - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60_000);
    throw new Error(
      `Account is locked. Try again in ${remainingMin} minute${remainingMin !== 1 ? 's' : ''}.`
    );
  }

  // Derive hash and compare
  const hash = await encryptionService.hashPassword(
    password,
    new Uint8Array(user.salt) as unknown as Uint8Array
  );

  if (!compareBuffers(hash, user.password_hash)) {
    // Mismatch — increment failed_attempts
    const newAttempts = user.failed_attempts + 1;
    const updatedUser: User = {
      ...user,
      failed_attempts: newAttempts,
      locked_until: newAttempts >= 10 ? Date.now() + 15 * 60 * 1000 : user.locked_until,
    };
    await idbAccessLayer.put('users', updatedUser);
    throw new Error('Invalid username or password');
  }

  // Match — reset failed_attempts
  const clearedUser: User = {
    ...user,
    failed_attempts: 0,
    locked_until: null,
  };
  await idbAccessLayer.put('users', clearedUser);

  // Wire encryption hooks if encryption is enabled for this user
  if (user.encryption_enabled && user.encryption_salt) {
    const encKey = await encryptionService.deriveKey(
      password,
      new Uint8Array(user.encryption_salt),
    );
    idbAccessLayer.setEncryptionHooks(
      async (data: unknown, _userId: string) => {
        const { ciphertext, iv } = await encryptionService.encrypt(encKey, data);
        return { ciphertext, iv };
      },
      async (data: unknown, _userId: string) => {
        const record = data as { ciphertext: ArrayBuffer; iv: Uint8Array };
        if (record.ciphertext && record.iv) {
          return encryptionService.decrypt(encKey, record.ciphertext, new Uint8Array(record.iv));
        }
        return data;
      },
    );
  }

  // Build session
  const session: Session = {
    user_id: user.user_id,
    role: user.role,
    org_unit: user.org_unit,
    token: crypto.randomUUID(),
    expires_at: Date.now() + 24 * 60 * 60 * 1000,
  };

  localStorage.setItem(`session_${user.user_id}`, JSON.stringify(session));
  authStore.set(session);

  return session;
}

// ============================================================
// 2. logout
// ============================================================

async function logout(): Promise<void> {
  const session = get(authStore);

  if (session) {
    localStorage.removeItem(`session_${session.user_id}`);
    idbAccessLayer.clearEncryptionHooks();
    channelManager.broadcast(CHANNELS.AUTH_SYNC, {
      type: 'logout',
      user_id: session.user_id,
    });
  }

  authStore.set(null);
}

// ============================================================
// 3. restoreSession
// ============================================================

function restoreSession(): Session | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('session_')) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed: Session = JSON.parse(raw);
          if (parsed.expires_at > Date.now()) {
            authStore.set(parsed);
            return parsed;
          }
          // Stale — remove
          localStorage.removeItem(key);
        }
      }
    }
  } catch {
    // localStorage may be unavailable
  }
  return null;
}

// ============================================================
// 4. changePassword
// ============================================================

async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  const user: User | undefined = await idbAccessLayer.get('users', userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Verify old password
  const oldHash = await encryptionService.hashPassword(
    oldPassword,
    new Uint8Array(user.salt) as unknown as Uint8Array
  );

  if (!compareBuffers(oldHash, user.password_hash)) {
    throw new Error('Current password is incorrect');
  }

  // Generate new credentials
  const newSalt = encryptionService.generateSalt();
  const newHash = await encryptionService.hashPassword(newPassword, newSalt);

  // Re-encrypt if encryption is enabled
  if (user.encryption_enabled) {
    await encryptionService.reEncryptAll(
      userId,
      oldPassword,
      newPassword,
      async () => {
        // Gather all encrypted records for this user — include user record itself
        const allStores = ['users'];
        const records: Array<{ store: string; record: Record<string, unknown> }> = [];
        const currentUser = await idbAccessLayer.get('users', userId);
        if (currentUser) {
          records.push({ store: 'users', record: currentUser as unknown as Record<string, unknown> });
        }
        return records;
      },
      async (records) => {
        for (const { store, record } of records) {
          await idbAccessLayer.put(store, record);
        }
      }
    );
  }

  // Update user record
  const updatedUser: User = {
    ...user,
    password_hash: newHash,
    salt: newSalt.buffer as ArrayBuffer,
    _version: user._version + 1,
  };
  await idbAccessLayer.put('users', updatedUser);

  // Broadcast session refresh
  channelManager.broadcast(CHANNELS.AUTH_SYNC, {
    type: 'session-refresh',
    user_id: userId,
  });
}

// ============================================================
// 5. initCrossTabSync
// ============================================================

function initCrossTabSync(): () => void {
  const unsubscribe = channelManager.onMessage(
    CHANNELS.AUTH_SYNC,
    (message: AuthSyncMessage) => {
      if (message.type === 'logout') {
        // Clear local session for the user
        localStorage.removeItem(`session_${message.user_id}`);
        authStore.set(null);
      } else if (message.type === 'session-refresh') {
        const current = get(authStore);
        if (current && current.user_id === message.user_id) {
          const updated: Session = {
            ...current,
            expires_at: message.new_expires_at ?? current.expires_at,
          };
          authStore.set(updated);
          localStorage.setItem(`session_${current.user_id}`, JSON.stringify(updated));
        }
      }
    }
  );

  return unsubscribe;
}

// ============================================================
// 6. createUser
// ============================================================

async function createUser(userData: {
  username: string;
  password: string;
  role: Role;
  org_unit: string;
}): Promise<User> {
  const salt = encryptionService.generateSalt();
  const passwordHash = await encryptionService.hashPassword(userData.password, salt);

  const user: User = {
    user_id: crypto.randomUUID(),
    username: userData.username,
    password_hash: passwordHash,
    salt: salt.buffer as ArrayBuffer,
    role: userData.role,
    org_unit: userData.org_unit,
    failed_attempts: 0,
    locked_until: null,
    encryption_enabled: false,
    encryption_salt: null,
    _version: 1,
  };

  await idbAccessLayer.put('users', user);
  return user;
}

// ============================================================
// 7. enableEncryption
// ============================================================

async function enableEncryption(userId: string, password: string): Promise<void> {
  const user: User | undefined = await idbAccessLayer.get('users', userId);
  if (!user) throw new Error('User not found');

  // Verify password
  const hash = await encryptionService.hashPassword(
    password,
    new Uint8Array(user.salt) as unknown as Uint8Array,
  );
  if (!compareBuffers(hash, user.password_hash)) {
    throw new Error('Invalid password');
  }

  // Generate encryption salt and derive key
  const encSalt = encryptionService.generateSalt();
  const encKey = await encryptionService.deriveKey(password, encSalt);

  // Register hooks
  idbAccessLayer.setEncryptionHooks(
    async (data: unknown, _userId: string) => {
      const { ciphertext, iv } = await encryptionService.encrypt(encKey, data);
      return { ciphertext, iv };
    },
    async (data: unknown, _userId: string) => {
      const record = data as { ciphertext: ArrayBuffer; iv: Uint8Array };
      if (record.ciphertext && record.iv) {
        return encryptionService.decrypt(encKey, record.ciphertext, new Uint8Array(record.iv));
      }
      return data;
    },
  );

  // Persist encryption state
  localStorage.setItem(`encryption_enabled_${userId}`, 'true');
  const updatedUser: User = {
    ...user,
    encryption_enabled: true,
    encryption_salt: encSalt.buffer as ArrayBuffer,
    _version: user._version + 1,
  };
  await idbAccessLayer.put('users', updatedUser);
}

// ============================================================
// 8. disableEncryption
// ============================================================

async function disableEncryption(userId: string, password: string): Promise<void> {
  const user: User | undefined = await idbAccessLayer.get('users', userId);
  if (!user) throw new Error('User not found');

  // Verify password
  const hash = await encryptionService.hashPassword(
    password,
    new Uint8Array(user.salt) as unknown as Uint8Array,
  );
  if (!compareBuffers(hash, user.password_hash)) {
    throw new Error('Invalid password');
  }

  // Clear hooks and flag
  idbAccessLayer.clearEncryptionHooks();
  localStorage.removeItem(`encryption_enabled_${userId}`);

  const updatedUser: User = {
    ...user,
    encryption_enabled: false,
    encryption_salt: null,
    _version: user._version + 1,
  };
  await idbAccessLayer.put('users', updatedUser);
}

// ============================================================
// Export
// ============================================================

export const authService = {
  login,
  logout,
  restoreSession,
  changePassword,
  initCrossTabSync,
  createUser,
  enableEncryption,
  disableEncryption,
};

export default authService;
