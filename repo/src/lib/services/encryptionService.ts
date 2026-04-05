import type { User } from '../types';

const PBKDF2_ITERATIONS = 310_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_BITS = 256;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

async function encrypt(
  key: CryptoKey,
  data: unknown
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plaintext
  );

  return { ciphertext, iv };
}

async function decrypt(
  key: CryptoKey,
  ciphertext: ArrayBuffer,
  iv: Uint8Array
): Promise<unknown> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decrypted));
}

async function hashPassword(
  password: string,
  salt: Uint8Array
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BITS
  );
}

async function reEncryptAll(
  userId: string,
  oldPassword: string,
  newPassword: string,
  getAllEncryptedRecords: () => Promise<
    Array<{ store: string; record: Record<string, unknown> }>
  >,
  writeRecords: (
    records: Array<{ store: string; record: Record<string, unknown> }>
  ) => Promise<void>,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const flagKey = `encryption_migration_${userId}`;
  localStorage.setItem(flagKey, 'true');

  try {
    const allRecords = await getAllEncryptedRecords();
    const total = allRecords.length;

    // Derive old key from the first record's salt (stored on the user record)
    // The caller is responsible for including the user record which contains the salt
    const oldSalt = new Uint8Array(
      allRecords.find((r) => r.store === 'users')?.record['encryption_salt'] as ArrayBuffer
    );
    const oldKey = await deriveKey(oldPassword, oldSalt);

    // Generate new salt and derive new key
    const newSalt = generateSalt();
    const newKey = await deriveKey(newPassword, newSalt);

    const reEncryptedRecords: Array<{
      store: string;
      record: Record<string, unknown>;
    }> = [];

    for (let i = 0; i < total; i++) {
      const { store, record } = allRecords[i];

      if (record['ciphertext'] && record['iv']) {
        const plaintext = await decrypt(
          oldKey,
          record['ciphertext'] as ArrayBuffer,
          new Uint8Array(record['iv'] as ArrayBuffer)
        );

        const { ciphertext, iv } = await encrypt(newKey, plaintext);

        reEncryptedRecords.push({
          store,
          record: { ...record, ciphertext, iv },
        });
      } else if (store === 'users' && record['encryption_salt']) {
        // Update the user record with the new salt
        reEncryptedRecords.push({
          store,
          record: { ...record, encryption_salt: newSalt.buffer },
        });
      } else {
        reEncryptedRecords.push({ store, record });
      }

      if (onProgress) {
        onProgress(i + 1, total);
      }
    }

    await writeRecords(reEncryptedRecords);
    localStorage.removeItem(flagKey);
  } catch (error) {
    localStorage.removeItem(flagKey);
    throw error;
  }
}

function isMigrationInProgress(userId: string): boolean {
  return localStorage.getItem(`encryption_migration_${userId}`) === 'true';
}

export const encryptionService = {
  deriveKey,
  generateSalt,
  encrypt,
  decrypt,
  hashPassword,
  reEncryptAll,
  isMigrationInProgress,
};

export default encryptionService;
