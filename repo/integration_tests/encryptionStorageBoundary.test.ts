/**
 * Storage-boundary encryption tests.
 *
 * These tests use the REAL idbAccessLayer (no mocking) with fake-indexeddb
 * to verify that encrypted records are actually stored encrypted and
 * correctly decrypted on read.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

// Import real modules — no vi.mock for idbAccessLayer here
const { idbAccessLayer } = await import('../src/lib/services/idbAccessLayer');
const { encryptionService } = await import('../src/lib/services/encryptionService');

// ============================================================
// Setup
// ============================================================

beforeAll(async () => {
  await idbAccessLayer.init();
});

afterEach(async () => {
  idbAccessLayer.clearEncryptionHooks();
  // Clear test data from stores to prevent cross-test interference
  const db = idbAccessLayer.getDb();
  for (const storeName of ['bookings', 'configuration']) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
});

// ============================================================
// Helpers
// ============================================================

async function setupEncryption(password: string, userId: string) {
  const salt = encryptionService.generateSalt();
  const key = await encryptionService.deriveKey(password, salt);

  idbAccessLayer.setEncryptionHooks(
    async (data: unknown, _uid: string) => {
      const { ciphertext, iv } = await encryptionService.encrypt(key, data);
      return { ciphertext, iv };
    },
    async (data: unknown, _uid: string) => {
      const record = data as { ciphertext: ArrayBuffer; iv: Uint8Array };
      if (record.ciphertext && record.iv) {
        return encryptionService.decrypt(key, record.ciphertext, new Uint8Array(record.iv));
      }
      return data;
    },
    userId,
  );

  // Set the localStorage flag so isEncryptionEnabled returns true
  localStorage.setItem(`encryption_enabled_${userId}`, 'true');

  return { salt, key };
}

// ============================================================
// Tests
// ============================================================

describe('Storage Boundary Encryption', () => {
  it('put encrypts and get decrypts a record in a non-excluded store', async () => {
    await setupEncryption('test-password', 'user-enc-1');

    const original = {
      booking_id: `enc-test-${Date.now()}`,
      room_id: 'r-1',
      user_id: 'user-enc-1',
      start_time: Date.now(),
      end_time: Date.now() + 3600000,
      requested_equipment: [],
      participant_capacity: 20,
      status: 'confirmed',
      created_at: Date.now(),
      _version: 1,
    };

    // Write through idbAccessLayer (should auto-encrypt)
    await idbAccessLayer.put('bookings', original);

    // Read raw from IndexedDB to verify stored data is encrypted
    const db = idbAccessLayer.getDb();
    const rawRecord = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction('bookings', 'readonly');
      const store = tx.objectStore('bookings');
      const request = store.get(original.booking_id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // The raw record should have _encrypted wrapper with ciphertext/iv
    expect(rawRecord).toBeTruthy();
    expect(rawRecord._encrypted).toBeTruthy();
    expect(rawRecord._encrypted.ciphertext).toBeTruthy();
    expect(rawRecord._encrypted.iv).toBeTruthy();
    // The keyPath field is preserved for IDB indexing
    expect(rawRecord.booking_id).toBe(original.booking_id);
    // But plaintext data fields should NOT be at the raw level
    expect(rawRecord.room_id).toBeUndefined();

    // Read through idbAccessLayer (should auto-decrypt)
    const decrypted = await idbAccessLayer.get<typeof original>('bookings', original.booking_id);
    expect(decrypted).toBeTruthy();
    expect(decrypted!.booking_id).toBe(original.booking_id);
    expect(decrypted!.room_id).toBe('r-1');
    expect(decrypted!.status).toBe('confirmed');
  });

  it('getAll decrypts all records in a non-excluded store', async () => {
    await setupEncryption('test-password-2', 'user-enc-2');

    const id1 = `enc-getall-1-${Date.now()}`;
    const id2 = `enc-getall-2-${Date.now()}`;

    await idbAccessLayer.put('bookings', {
      booking_id: id1,
      room_id: 'r-a',
      user_id: 'user-enc-2',
      start_time: Date.now(),
      end_time: Date.now() + 3600000,
      requested_equipment: [],
      participant_capacity: 10,
      status: 'confirmed',
      created_at: Date.now(),
      _version: 1,
    });

    await idbAccessLayer.put('bookings', {
      booking_id: id2,
      room_id: 'r-b',
      user_id: 'user-enc-2',
      start_time: Date.now(),
      end_time: Date.now() + 7200000,
      requested_equipment: [],
      participant_capacity: 15,
      status: 'confirmed',
      created_at: Date.now(),
      _version: 1,
    });

    const all = await idbAccessLayer.getAll<any>('bookings');
    const ours = all.filter((r: any) => r.booking_id === id1 || r.booking_id === id2);

    expect(ours.length).toBe(2);
    expect(ours.find((r: any) => r.booking_id === id1)?.room_id).toBe('r-a');
    expect(ours.find((r: any) => r.booking_id === id2)?.room_id).toBe('r-b');
  });

  it('does NOT encrypt records in excluded stores', async () => {
    await setupEncryption('test-password-3', 'user-enc-3');

    const configRecord = {
      config_key: `test-config-${Date.now()}`,
      value: 'plaintext-value',
    };

    // 'configuration' is in ENCRYPTION_EXCLUDED_STORES
    await idbAccessLayer.put('configuration', configRecord);

    // Read raw from IndexedDB
    const db = idbAccessLayer.getDb();
    const rawRecord = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction('configuration', 'readonly');
      const store = tx.objectStore('configuration');
      const request = store.get(configRecord.config_key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // Should be stored as plaintext — no ciphertext/iv wrapper
    expect(rawRecord).toBeTruthy();
    expect(rawRecord.value).toBe('plaintext-value');
    expect(rawRecord.ciphertext).toBeUndefined();
  });

  it('getEncryptedStoreNames returns only non-excluded stores', () => {
    const names = idbAccessLayer.getEncryptedStoreNames();

    // Should include data stores
    expect(names).toContain('bookings');
    expect(names).toContain('sessions');
    expect(names).toContain('messages');
    expect(names).toContain('registrations');

    // Should NOT include excluded stores
    expect(names).not.toContain('users');
    expect(names).not.toContain('configuration');
    expect(names).not.toContain('feature_flags');
    expect(names).not.toContain('scheduler_tasks');
  });
});
