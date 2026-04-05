import { idbAccessLayer } from './idbAccessLayer';
import type { IdempotencyKey } from '../types';
import { ConcurrencyError } from '../types';

const STORE = 'idempotency_keys';
const IN_PROGRESS_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const COMPLETED_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function checkKey(key: string): Promise<{ isDuplicate: boolean; cachedResult?: unknown }> {
  const record = await idbAccessLayer.get(STORE, key) as IdempotencyKey | undefined;

  if (record) {
    if (record.status === 'completed') {
      return { isDuplicate: true, cachedResult: record.result };
    }

    if (record.status === 'in-progress') {
      if (Date.now() - record.created_at < IN_PROGRESS_TIMEOUT) {
        throw new ConcurrencyError('Operation is already in progress in another tab');
      }

      // Abandoned in-progress record — reclaim it
      const updated: IdempotencyKey = {
        ...record,
        created_at: Date.now(),
      };
      await idbAccessLayer.put(STORE, updated);
      return { isDuplicate: false };
    }
  }

  // Not found — create new in-progress record
  const newRecord: IdempotencyKey = {
    key_id: key,
    status: 'in-progress',
    result: null,
    created_at: Date.now(),
    completed_at: null,
  };
  await idbAccessLayer.put(STORE, newRecord);
  return { isDuplicate: false };
}

async function markComplete(key: string, result: unknown): Promise<void> {
  const record = await idbAccessLayer.get(STORE, key) as IdempotencyKey | undefined;

  if (record) {
    const updated: IdempotencyKey = {
      ...record,
      status: 'completed',
      result,
      completed_at: Date.now(),
    };
    await idbAccessLayer.put(STORE, updated);
  }
}

async function cleanup(): Promise<void> {
  const records = await idbAccessLayer.getAll(STORE) as IdempotencyKey[];
  const now = Date.now();

  for (const record of records) {
    if (record.status === 'completed' && now - record.created_at > COMPLETED_TTL) {
      await idbAccessLayer.delete(STORE, record.key_id);
    }
  }
}

export const idempotencyService = { checkKey, markComplete, cleanup };
export default idempotencyService;
