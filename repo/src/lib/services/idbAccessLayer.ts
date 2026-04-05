import { VersionConflictError } from '../types';
import type { DataSyncMessage } from '../types';

const DB_NAME = 'learning_center_db';
const DB_VERSION = 1;

// Stores that are system-wide (no user_id namespace filtering)
const SYSTEM_STORES = new Set(['configuration', 'feature_flags']);

// Stores whose records have _version field for optimistic locking
const VERSIONED_STORES = new Set([
  'users', 'bookings', 'sessions', 'registrations', 'bills', 'payments',
  'messages', 'reminders', 'billing_registry', 'maintenance_windows',
  'blacklist_rules', 'attendance', 'rooms', 'equipment', 'waivers',
  'scheduler_tasks',
]);

let db: IDBDatabase | null = null;
let dataSyncChannel: BroadcastChannel | null = null;

// Encryption hooks — set by encryptionService when encryption is enabled
let encryptHook: ((data: unknown, userId: string) => Promise<unknown>) | null = null;
let decryptHook: ((data: unknown, userId: string) => Promise<unknown>) | null = null;

function isEncryptionEnabled(userId: string): boolean {
  try {
    return localStorage.getItem(`encryption_enabled_${userId}`) === 'true';
  } catch {
    return false;
  }
}

// ============================================================
// Schema Definition
// ============================================================

interface StoreDefinition {
  keyPath: string;
  indexes: Array<{
    name: string;
    keyPath: string | string[];
    options?: IDBIndexParameters;
  }>;
}

const STORE_DEFINITIONS: Record<string, StoreDefinition> = {
  users: {
    keyPath: 'user_id',
    indexes: [
      { name: 'idx_username', keyPath: 'username', options: { unique: true } },
      { name: 'idx_role', keyPath: 'role' },
      { name: 'idx_org_unit', keyPath: 'org_unit' },
    ],
  },
  bookings: {
    keyPath: 'booking_id',
    indexes: [
      { name: 'idx_room_time', keyPath: ['room_id', 'start_time'] },
      { name: 'idx_user', keyPath: 'user_id' },
      { name: 'idx_status', keyPath: 'status' },
      { name: 'idx_date_range', keyPath: ['start_time', 'end_time'] },
    ],
  },
  sessions: {
    keyPath: 'session_id',
    indexes: [
      { name: 'idx_instructor', keyPath: 'instructor_id' },
      { name: 'idx_room', keyPath: 'room_id' },
      { name: 'idx_start_time', keyPath: 'start_time' },
      { name: 'idx_status', keyPath: 'status' },
    ],
  },
  registrations: {
    keyPath: 'registration_id',
    indexes: [
      { name: 'idx_participant_session', keyPath: ['participant_id', 'session_id'], options: { unique: true } },
      { name: 'idx_participant', keyPath: 'participant_id' },
      { name: 'idx_session', keyPath: 'session_id' },
      { name: 'idx_status', keyPath: 'status' },
    ],
  },
  bills: {
    keyPath: 'bill_id',
    indexes: [
      { name: 'idx_participant', keyPath: 'participant_id' },
      { name: 'idx_period', keyPath: 'billing_period' },
      { name: 'idx_status', keyPath: 'status' },
      { name: 'idx_due_date', keyPath: 'due_date' },
    ],
  },
  payments: {
    keyPath: 'payment_id',
    indexes: [
      { name: 'idx_bill', keyPath: 'bill_id' },
      { name: 'idx_date', keyPath: 'payment_date' },
      { name: 'idx_method', keyPath: 'payment_method' },
    ],
  },
  messages: {
    keyPath: 'message_id',
    indexes: [
      { name: 'idx_status', keyPath: 'status' },
      { name: 'idx_author', keyPath: 'author_id' },
      { name: 'idx_scheduled_at', keyPath: 'scheduled_at' },
      { name: 'idx_category', keyPath: 'category' },
    ],
  },
  read_receipts: {
    keyPath: 'receipt_id',
    indexes: [
      { name: 'idx_message_user', keyPath: ['message_id', 'user_id'], options: { unique: true } },
      { name: 'idx_message', keyPath: 'message_id' },
      { name: 'idx_user', keyPath: 'user_id' },
    ],
  },
  reminders: {
    keyPath: 'reminder_id',
    indexes: [
      { name: 'idx_user', keyPath: 'user_id' },
      { name: 'idx_trigger_time', keyPath: 'trigger_time' },
      { name: 'idx_status', keyPath: 'status' },
    ],
  },
  send_logs: {
    keyPath: 'log_id',
    indexes: [
      { name: 'idx_reminder', keyPath: 'reminder_id' },
      { name: 'idx_timestamp', keyPath: 'sent_at' },
    ],
  },
  billing_registry: {
    keyPath: 'registry_id',
    indexes: [
      { name: 'idx_type', keyPath: 'registry_type' },
    ],
  },
  configuration: {
    keyPath: 'config_key',
    indexes: [],
  },
  feature_flags: {
    keyPath: 'flag_id',
    indexes: [
      { name: 'idx_enabled', keyPath: 'enabled' },
    ],
  },
  idempotency_keys: {
    keyPath: 'key_id',
    indexes: [
      { name: 'idx_status', keyPath: 'status' },
      { name: 'idx_created_at', keyPath: 'created_at' },
    ],
  },
  scheduler_tasks: {
    keyPath: 'task_id',
    indexes: [
      { name: 'idx_next_run', keyPath: 'next_run_at' },
      { name: 'idx_status', keyPath: 'status' },
    ],
  },
  error_logs: {
    keyPath: 'log_id',
    indexes: [
      { name: 'idx_task', keyPath: 'task_id' },
      { name: 'idx_timestamp', keyPath: 'timestamp' },
    ],
  },
  maintenance_windows: {
    keyPath: 'window_id',
    indexes: [
      { name: 'idx_room', keyPath: 'room_id' },
      { name: 'idx_time_range', keyPath: ['start_time', 'end_time'] },
    ],
  },
  blacklist_rules: {
    keyPath: 'rule_id',
    indexes: [
      { name: 'idx_target_type', keyPath: 'target_type' },
      { name: 'idx_target_id', keyPath: 'target_id' },
    ],
  },
  attendance: {
    keyPath: 'attendance_id',
    indexes: [
      { name: 'idx_session', keyPath: 'session_id' },
      { name: 'idx_participant', keyPath: 'participant_id' },
      { name: 'idx_status', keyPath: 'attendance_status' },
    ],
  },
  rooms: {
    keyPath: 'room_id',
    indexes: [
      { name: 'idx_building', keyPath: 'building_code' },
      { name: 'idx_capacity', keyPath: 'capacity' },
    ],
  },
  equipment: {
    keyPath: 'equipment_id',
    indexes: [
      { name: 'idx_room', keyPath: 'room_id' },
      { name: 'idx_type', keyPath: 'equipment_type' },
    ],
  },
  waivers: {
    keyPath: 'waiver_id',
    indexes: [
      { name: 'idx_participant', keyPath: 'participant_id' },
      { name: 'idx_type', keyPath: 'waiver_type' },
      { name: 'idx_status', keyPath: 'status' },
    ],
  },
};

// ============================================================
// Initialization
// ============================================================

function getDb(): IDBDatabase {
  if (!db) {
    throw new Error('IndexedDB not initialized. Call idbAccessLayer.init() first.');
  }
  return db;
}

async function init(): Promise<void> {
  if (db) return;

  if (!window.indexedDB) {
    throw new Error(
      'IndexedDB is not available. This application requires IndexedDB to function. ' +
      'If you are in private browsing mode, please switch to a regular window.'
    );
  }

  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      for (const [storeName, definition] of Object.entries(STORE_DEFINITIONS)) {
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { keyPath: definition.keyPath });
          for (const index of definition.indexes) {
            store.createIndex(index.name, index.keyPath, index.options || {});
          }
        }
      }
    };

    request.onsuccess = (event) => {
      db = (event.target as IDBOpenDBRequest).result;

      db.onversionchange = () => {
        db?.close();
        db = null;
      };

      // Initialize BroadcastChannel for data-sync
      try {
        dataSyncChannel = new BroadcastChannel('data-sync');
      } catch {
        console.warn('BroadcastChannel not supported. Cross-tab data sync disabled.');
      }

      resolve();
    };
  });
}

// ============================================================
// Encryption Hook Registration
// ============================================================

function setEncryptionHooks(
  encrypt: (data: unknown, userId: string) => Promise<unknown>,
  decrypt: (data: unknown, userId: string) => Promise<unknown>,
): void {
  encryptHook = encrypt;
  decryptHook = decrypt;
}

function clearEncryptionHooks(): void {
  encryptHook = null;
  decryptHook = null;
}

// ============================================================
// Internal Helpers
// ============================================================

async function maybeEncrypt(record: Record<string, unknown>, userId?: string): Promise<Record<string, unknown>> {
  if (!encryptHook || !userId || !isEncryptionEnabled(userId)) return record;
  return (await encryptHook(record, userId)) as Record<string, unknown>;
}

async function maybeDecrypt(record: Record<string, unknown>, userId?: string): Promise<Record<string, unknown>> {
  if (!decryptHook || !userId || !isEncryptionEnabled(userId)) return record;
  return (await decryptHook(record, userId)) as Record<string, unknown>;
}

/**
 * Recursively convert a value to a plain JS object/array, stripping Svelte 5
 * reactive proxies so the result is safe for IndexedDB's structured-clone.
 * ArrayBuffer and TypedArray values are preserved as-is.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlain(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof ArrayBuffer) return obj;
  if (ArrayBuffer.isView(obj)) return obj;
  if (Array.isArray(obj)) return obj.map(toPlain);
  const plain: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    plain[key] = toPlain(obj[key]);
  }
  return plain;
}

function broadcastChange(type: 'record-updated' | 'record-deleted', store: string, recordId: string, version?: number, userId?: string): void {
  if (!dataSyncChannel) return;
  const message: DataSyncMessage = { type, store, record_id: recordId, version, user_id: userId };
  dataSyncChannel.postMessage(message);
}

function getKeyPathValue(record: Record<string, unknown>, keyPath: string): string {
  return String(record[keyPath]);
}

// ============================================================
// CRUD Operations
// ============================================================

async function get<T = Record<string, unknown>>(store: string, key: string, userId?: string): Promise<T | undefined> {
  const database = getDb();

  return new Promise<T | undefined>((resolve, reject) => {
    const tx = database.transaction(store, 'readonly');
    const objectStore = tx.objectStore(store);
    const request = objectStore.get(key);

    request.onsuccess = async () => {
      const record = request.result;
      if (!record) {
        resolve(undefined);
        return;
      }

      // Namespace filtering: if not a system store, check user_id
      if (!SYSTEM_STORES.has(store) && userId && record.user_id && record.user_id !== userId) {
        resolve(undefined);
        return;
      }

      try {
        const decrypted = await maybeDecrypt(record, userId);
        resolve(decrypted as T);
      } catch (err) {
        reject(err);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

async function getAll<T = Record<string, unknown>>(
  store: string,
  indexName?: string,
  query?: IDBKeyRange | IDBValidKey,
  userId?: string,
): Promise<T[]> {
  const database = getDb();

  return new Promise<T[]>((resolve, reject) => {
    const tx = database.transaction(store, 'readonly');
    const objectStore = tx.objectStore(store);
    const source = indexName ? objectStore.index(indexName) : objectStore;
    const request = source.getAll(query);

    request.onsuccess = async () => {
      let records: Record<string, unknown>[] = request.result;

      // Namespace filtering
      if (!SYSTEM_STORES.has(store) && userId) {
        records = records.filter((r) => !r.user_id || r.user_id === userId);
      }

      try {
        const decrypted = await Promise.all(records.map((r) => maybeDecrypt(r, userId)));
        resolve(decrypted as T[]);
      } catch (err) {
        reject(err);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function put(store: string, record: any, userId?: string): Promise<{ version: number }> {
  // Strip Svelte 5 reactive proxies so IndexedDB can serialize the record.
  record = toPlain(record);

  const database = getDb();
  const storeDef = STORE_DEFINITIONS[store];
  if (!storeDef) throw new Error(`Unknown store: ${store}`);

  const keyPath = storeDef.keyPath;
  const recordKey = getKeyPathValue(record, keyPath);
  const isVersioned = VERSIONED_STORES.has(store);

  return new Promise<{ version: number }>((resolve, reject) => {
    const tx = database.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);

    // If versioned, do optimistic locking
    if (isVersioned) {
      const readRequest = objectStore.get(recordKey);

      readRequest.onsuccess = async () => {
        const existing = readRequest.result;

        if (existing) {
          // Optimistic locking: compare versions
          const existingVersion = existing._version as number;
          const expectedVersion = record._version as number;

          if (expectedVersion !== undefined && expectedVersion !== existingVersion) {
            tx.abort();
            reject(new VersionConflictError(
              `Version conflict on ${store}/${recordKey}: expected ${expectedVersion}, found ${existingVersion}`
            ));
            return;
          }

          record._version = existingVersion + 1;
        } else {
          // New record
          record._version = 1;
        }

        try {
          const toWrite = await maybeEncrypt({ ...record }, userId);
          const writeRequest = objectStore.put(toWrite);

          writeRequest.onsuccess = () => {
            broadcastChange('record-updated', store, recordKey, record._version as number, userId);
            resolve({ version: record._version as number });
          };

          writeRequest.onerror = () => reject(writeRequest.error);
        } catch (err) {
          tx.abort();
          reject(err);
        }
      };

      readRequest.onerror = () => reject(readRequest.error);
    } else {
      // Non-versioned store: direct put
      (async () => {
        try {
          const toWrite = await maybeEncrypt({ ...record }, userId);
          const writeRequest = objectStore.put(toWrite);

          writeRequest.onsuccess = () => {
            broadcastChange('record-updated', store, recordKey, undefined, userId);
            resolve({ version: 0 });
          };

          writeRequest.onerror = () => reject(writeRequest.error);
        } catch (err) {
          tx.abort();
          reject(err);
        }
      })();
    }

    tx.onerror = () => {
      if (tx.error?.name !== 'AbortError') {
        reject(tx.error);
      }
    };
  });
}

async function del(store: string, key: string, userId?: string): Promise<void> {
  const database = getDb();

  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);

    // If namespace filtering, verify ownership before deleting
    if (!SYSTEM_STORES.has(store) && userId) {
      const readRequest = objectStore.get(key);
      readRequest.onsuccess = () => {
        const existing = readRequest.result;
        if (!existing) {
          resolve();
          return;
        }
        if (existing.user_id && existing.user_id !== userId) {
          reject(new Error('Access denied: cannot delete record owned by another user'));
          return;
        }
        const deleteRequest = objectStore.delete(key);
        deleteRequest.onsuccess = () => {
          broadcastChange('record-deleted', store, key, undefined, userId);
          resolve();
        };
        deleteRequest.onerror = () => reject(deleteRequest.error);
      };
      readRequest.onerror = () => reject(readRequest.error);
    } else {
      const request = objectStore.delete(key);
      request.onsuccess = () => {
        broadcastChange('record-deleted', store, key, undefined, userId);
        resolve();
      };
      request.onerror = () => reject(request.error);
    }
  });
}

/**
 * Execute a function within an IndexedDB transaction spanning one or more stores.
 * The function receives a helper object with get/getAll/put/delete methods scoped to the transaction.
 * All operations within the function are atomic.
 */
async function transaction<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  fn: (helpers: TransactionHelpers) => Promise<T>,
): Promise<T> {
  const database = getDb();

  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(storeNames, mode);
    let result: T;
    let completed = false;

    const helpers: TransactionHelpers = {
      getStore(storeName: string): IDBObjectStore {
        return tx.objectStore(storeName);
      },

      get<R = Record<string, unknown>>(storeName: string, key: string): Promise<R | undefined> {
        return new Promise((res, rej) => {
          const store = tx.objectStore(storeName);
          const request = store.get(key);
          request.onsuccess = () => res(request.result as R | undefined);
          request.onerror = () => rej(request.error);
        });
      },

      getAll<R = Record<string, unknown>>(storeName: string, indexName?: string, query?: IDBKeyRange | IDBValidKey): Promise<R[]> {
        return new Promise((res, rej) => {
          const store = tx.objectStore(storeName);
          const source = indexName ? store.index(indexName) : store;
          const request = source.getAll(query);
          request.onsuccess = () => res(request.result as R[]);
          request.onerror = () => rej(request.error);
        });
      },

      put(storeName: string, record: Record<string, unknown>): Promise<void> {
        return new Promise((res, rej) => {
          const store = tx.objectStore(storeName);
          const request = store.put(toPlain(record));
          request.onsuccess = () => res();
          request.onerror = () => rej(request.error);
        });
      },

      delete(storeName: string, key: string): Promise<void> {
        return new Promise((res, rej) => {
          const store = tx.objectStore(storeName);
          const request = store.delete(key);
          request.onsuccess = () => res();
          request.onerror = () => rej(request.error);
        });
      },

      abort(): void {
        tx.abort();
      },
    };

    tx.oncomplete = () => {
      completed = true;
      resolve(result);
    };

    tx.onerror = () => {
      if (!completed) {
        reject(tx.error);
      }
    };

    tx.onabort = () => {
      if (!completed) {
        reject(tx.error || new Error('Transaction aborted'));
      }
    };

    // Execute the user function
    fn(helpers)
      .then((r) => {
        result = r;
      })
      .catch((err) => {
        try { tx.abort(); } catch { /* already aborted */ }
        reject(err);
      });
  });
}

// ============================================================
// Types
// ============================================================

export interface TransactionHelpers {
  getStore(storeName: string): IDBObjectStore;
  get<R = Record<string, unknown>>(storeName: string, key: string): Promise<R | undefined>;
  getAll<R = Record<string, unknown>>(storeName: string, indexName?: string, query?: IDBKeyRange | IDBValidKey): Promise<R[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  put(storeName: string, record: any): Promise<void>;
  delete(storeName: string, key: string): Promise<void>;
  abort(): void;
}

// ============================================================
// Exported API
// ============================================================

export const idbAccessLayer = {
  init,
  get,
  getAll,
  put,
  delete: del,
  transaction,
  setEncryptionHooks,
  clearEncryptionHooks,
  getDb,
};

export default idbAccessLayer;
