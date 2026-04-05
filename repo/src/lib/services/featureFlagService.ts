import { idbAccessLayer } from './idbAccessLayer';
import { channelManager, CHANNELS } from '../utils/broadcastChannels';
import { flagStore } from '../stores';
import type { FeatureFlag, FlagInput, FlagSyncMessage, Role } from '../types';

const STORE = 'feature_flags';

// In-memory cache
const cache = new Map<string, FeatureFlag>();

let unsubscribe: (() => void) | null = null;

async function initialize(context?: { role: string; org_unit: string }): Promise<void> {
  const flags = await idbAccessLayer.getAll<FeatureFlag>(STORE);

  cache.clear();
  for (const flag of flags) {
    cache.set(flag.flag_id, flag);
  }

  if (context) {
    refreshFlagStore(context);
  }

  // Subscribe to cross-tab flag sync for cache invalidation
  if (unsubscribe) {
    unsubscribe();
  }

  unsubscribe = channelManager.onMessage(CHANNELS.FLAG_SYNC, async (message: FlagSyncMessage) => {
    if (message.type === 'flag-changed') {
      // Re-read the flag from IndexedDB to get the latest state
      const updated = await idbAccessLayer.get<FeatureFlag>(STORE, message.flag_id);
      if (updated) {
        cache.set(updated.flag_id, updated);
      } else {
        cache.delete(message.flag_id);
      }

      if (context) {
        refreshFlagStore(context);
      }
    }
  });
}

function evaluateFlag(flagId: string, context: { role: string; org_unit: string }): boolean {
  const flag = cache.get(flagId);
  if (!flag) return false;

  if (!flag.enabled) return false;

  if (flag.target_roles.length > 0 && !flag.target_roles.includes(context.role as Role)) {
    return false;
  }

  if (flag.target_org_units.length > 0 && !flag.target_org_units.includes(context.org_unit)) {
    return false;
  }

  return true;
}

function refreshFlagStore(context: { role: string; org_unit: string }): void {
  const result: Record<string, boolean> = {};
  for (const [flagId, _flag] of cache) {
    result[flagId] = evaluateFlag(flagId, context);
  }
  flagStore.set(result);
}

async function createFlag(flag: FlagInput, createdBy: string): Promise<FeatureFlag> {
  const now = Date.now();
  const fullFlag: FeatureFlag = {
    flag_id: flag.flag_id,
    display_name: flag.display_name,
    description: flag.description,
    enabled: flag.enabled,
    target_roles: flag.target_roles,
    target_org_units: flag.target_org_units,
    created_by: createdBy,
    created_at: now,
    updated_at: now,
  };

  await idbAccessLayer.put(STORE, fullFlag as unknown as Record<string, unknown>);
  cache.set(fullFlag.flag_id, fullFlag);

  channelManager.broadcast(CHANNELS.FLAG_SYNC, {
    type: 'flag-changed',
    flag_id: fullFlag.flag_id,
    enabled: fullFlag.enabled,
    target_roles: fullFlag.target_roles,
    target_org_units: fullFlag.target_org_units,
  });

  return fullFlag;
}

async function updateFlag(flagId: string, updates: Partial<FeatureFlag>): Promise<void> {
  const current = await idbAccessLayer.get<FeatureFlag>(STORE, flagId);
  if (!current) {
    throw new Error(`Flag not found: ${flagId}`);
  }

  const merged: FeatureFlag = {
    ...current,
    ...updates,
    flag_id: current.flag_id, // prevent overwriting the key
    updated_at: Date.now(),
  };

  await idbAccessLayer.put(STORE, merged as unknown as Record<string, unknown>);
  cache.set(flagId, merged);

  channelManager.broadcast(CHANNELS.FLAG_SYNC, {
    type: 'flag-changed',
    flag_id: merged.flag_id,
    enabled: merged.enabled,
    target_roles: merged.target_roles,
    target_org_units: merged.target_org_units,
  });
}

async function deleteFlag(flagId: string): Promise<void> {
  await idbAccessLayer.delete(STORE, flagId);
  cache.delete(flagId);

  channelManager.broadcast(CHANNELS.FLAG_SYNC, {
    type: 'flag-changed',
    flag_id: flagId,
    enabled: false,
    target_roles: [],
    target_org_units: [],
  });
}

function getAllFlags(): FeatureFlag[] {
  return Array.from(cache.values());
}

export const featureFlagService = {
  initialize,
  evaluateFlag,
  refreshFlagStore,
  createFlag,
  updateFlag,
  deleteFlag,
  getAllFlags,
};

export default featureFlagService;
