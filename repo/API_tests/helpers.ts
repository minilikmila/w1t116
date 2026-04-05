/**
 * Shared test helpers for API-level (service integration) tests.
 *
 * Since this is a browser-only app with no REST API, "API tests" exercise
 * the service layer as the public interface — testing end-to-end flows
 * through IDB-backed services with mocked dependencies.
 */
import { vi } from 'vitest';
import { authStore } from '../src/lib/stores';
import type { Session, Role } from '../src/lib/types';

/**
 * Set the auth store to simulate a logged-in user with a given role.
 */
export function loginAs(role: Role, overrides: Partial<Session> = {}): Session {
  const session: Session = {
    user_id: `test-${role.toLowerCase()}-${Date.now()}`,
    role,
    org_unit: 'TestUnit',
    token: crypto.randomUUID(),
    expires_at: Date.now() + 24 * 60 * 60 * 1000,
    ...overrides,
  };
  authStore.set(session);
  return session;
}

/**
 * Clear the auth store (simulate logout).
 */
export function logout(): void {
  authStore.set(null);
}

/**
 * Create a mock for idbAccessLayer with in-memory stores.
 * Each store is a Map keyed by the record's primary key.
 */
export function createMockIdb() {
  const stores: Record<string, Map<string, any>> = {};

  function getStore(name: string): Map<string, any> {
    if (!stores[name]) stores[name] = new Map();
    return stores[name];
  }

  // Infer key path from known store schemas
  function getKeyPath(storeName: string): string {
    const keyMap: Record<string, string> = {
      users: 'user_id',
      bookings: 'booking_id',
      sessions: 'session_id',
      registrations: 'registration_id',
      bills: 'bill_id',
      payments: 'payment_id',
      messages: 'message_id',
      read_receipts: 'receipt_id',
      reminders: 'reminder_id',
      send_logs: 'log_id',
      billing_registry: 'registry_id',
      configuration: 'config_key',
      feature_flags: 'flag_id',
      idempotency_keys: 'key_id',
      scheduler_tasks: 'task_id',
      error_logs: 'log_id',
      maintenance_windows: 'window_id',
      blacklist_rules: 'rule_id',
      attendance: 'attendance_id',
      rooms: 'room_id',
      equipment: 'equipment_id',
      waivers: 'waiver_id',
    };
    return keyMap[storeName] || 'id';
  }

  return {
    get: vi.fn(async <T = any>(store: string, key: string): Promise<T | undefined> => {
      return getStore(store).get(key) as T | undefined;
    }),

    getAll: vi.fn(async <T = any>(store: string, _index?: string, _value?: any): Promise<T[]> => {
      const all = Array.from(getStore(store).values());
      if (_index && _value !== undefined) {
        // Simple index simulation: filter by field matching index name pattern
        const fieldName = _index.replace('idx_', '');
        return all.filter((r: any) => {
          if (Array.isArray(_value)) {
            // Compound index: check each element
            return _value.every((v: any, i: number) => {
              const keys = fieldName.split('_');
              return r[keys[i]] === v || r[`${keys[i]}_id`] === v;
            });
          }
          return r[fieldName] === _value || r[`${fieldName}_id`] === _value;
        }) as T[];
      }
      return all as T[];
    }),

    put: vi.fn(async (store: string, record: any) => {
      const keyPath = getKeyPath(store);
      const key = record[keyPath];
      getStore(store).set(key, { ...record });
    }),

    delete: vi.fn(async (store: string, key: string) => {
      getStore(store).delete(key);
    }),

    transaction: vi.fn(async <T>(
      _storeNames: string[],
      _mode: string,
      fn: (tx: any) => Promise<T>,
    ): Promise<T> => {
      // Run the callback with a tx proxy that delegates to the same mock
      const tx = {
        get: async <U = any>(store: string, key: string): Promise<U | undefined> => {
          return getStore(store).get(key) as U | undefined;
        },
        getAll: async <U = any>(store: string, index?: string, value?: any): Promise<U[]> => {
          const all = Array.from(getStore(store).values());
          if (index && value !== undefined) {
            const fieldName = index.replace('idx_', '');
            return all.filter((r: any) =>
              r[fieldName] === value || r[`${fieldName}_id`] === value
            ) as U[];
          }
          return all as U[];
        },
        put: async (store: string, record: any) => {
          const keyPath = getKeyPath(store);
          getStore(store).set(record[keyPath], { ...record });
        },
        delete: async (store: string, key: string) => {
          getStore(store).delete(key);
        },
      };
      return fn(tx);
    }),

    // Expose internals for test setup
    _seed: (storeName: string, records: any[]) => {
      const store = getStore(storeName);
      const keyPath = getKeyPath(storeName);
      for (const r of records) {
        store.set(r[keyPath], { ...r });
      }
    },

    _clear: () => {
      Object.keys(stores).forEach(k => stores[k].clear());
    },

    _getStore: getStore,
  };
}
