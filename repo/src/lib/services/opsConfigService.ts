import { idbAccessLayer } from './idbAccessLayer';
import { rbacService } from './rbacService';
import type { MaintenanceWindow, MaintenanceWindowInput, BlacklistRule, Configuration } from '../types';
import defaults from '../config/defaults.json';

// ============================================================
// Configuration Management
// ============================================================

async function loadDefaults(): Promise<void> {
  try {
    for (const [key, value] of Object.entries(defaults)) {
      const existing = await idbAccessLayer.get<Configuration>('configuration', key);
      if (!existing) {
        await idbAccessLayer.put('configuration', {
          config_key: key,
          value,
          updated_at: Date.now(),
          updated_by: 'system',
        });
      }
    }
  } catch (err) {
    console.warn('Failed to load config from JSON, using hardcoded defaults:', err);
    // Hardcoded fallbacks for critical values
    const hardcoded: Record<string, unknown> = {
      housing_fee: 950,
      rate_per_unit: 2.0,
      booking_window_days: 14,
      max_active_reservations: 3,
      lockout_duration_minutes: 15,
      max_login_attempts: 10,
      rate_limit_attempts: 5,
      rate_limit_window_seconds: 10,
      overdue_days: 10,
      dnd_start: '22:00',
      dnd_end: '07:00',
      pbkdf2_iterations: 310000,
    };
    for (const [key, value] of Object.entries(hardcoded)) {
      const existing = await idbAccessLayer.get<Configuration>('configuration', key);
      if (!existing) {
        await idbAccessLayer.put('configuration', {
          config_key: key,
          value,
          updated_at: Date.now(),
          updated_by: 'system',
        });
      }
    }
  }
}

async function getPolicy(key: string): Promise<unknown> {
  const record = await idbAccessLayer.get<Configuration>('configuration', key);
  if (record) return record.value;
  // Fallback to defaults.json
  const def = (defaults as Record<string, unknown>)[key];
  return def !== undefined ? def : null;
}

async function setPolicy(key: string, value: unknown): Promise<void> {
  rbacService.checkPermission('policy:modify');

  // Validate
  if (key === 'booking_window_days' && (typeof value !== 'number' || value < 1)) {
    throw new Error('Booking window must be a positive number');
  }
  if (key === 'max_active_reservations' && (typeof value !== 'number' || value < 1)) {
    throw new Error('Max active reservations must be a positive number');
  }
  if (key === 'housing_fee' && (typeof value !== 'number' || value < 0)) {
    throw new Error('Housing fee cannot be negative');
  }
  if (key === 'rate_per_unit' && (typeof value !== 'number' || value < 0)) {
    throw new Error('Rate per unit cannot be negative');
  }

  const session = rbacService.getCurrentSession();
  const existing = await idbAccessLayer.get<Configuration>('configuration', key);

  await idbAccessLayer.put('configuration', {
    config_key: key,
    value,
    updated_at: Date.now(),
    updated_by: session.user_id,
  });
}

async function getAllPolicies(): Promise<Configuration[]> {
  return idbAccessLayer.getAll<Configuration>('configuration');
}

// ============================================================
// Maintenance Windows
// ============================================================

async function createMaintenanceWindow(input: MaintenanceWindowInput): Promise<MaintenanceWindow> {
  rbacService.checkRole(['SYSTEM_ADMIN', 'OPS_COORDINATOR']);

  if (input.start_time >= input.end_time) {
    throw new Error('Maintenance window start time must be before end time');
  }

  const window: MaintenanceWindow = {
    window_id: crypto.randomUUID(),
    room_id: input.room_id,
    start_time: input.start_time,
    end_time: input.end_time,
    description: input.description,
    _version: 1,
  };

  await idbAccessLayer.put('maintenance_windows', window);

  // Check for overlapping confirmed bookings and flag them
  const bookings = await idbAccessLayer.getAll('bookings');
  const overlapping = bookings.filter(
    (b: any) =>
      b.room_id === input.room_id &&
      b.status !== 'cancelled' &&
      b.start_time < input.end_time &&
      b.end_time > input.start_time
  );

  if (overlapping.length > 0) {
    console.warn(
      `Maintenance window overlaps ${overlapping.length} existing booking(s). ` +
      `Affected booking IDs: ${overlapping.map((b: any) => b.booking_id).join(', ')}`
    );
  }

  return window;
}

async function updateMaintenanceWindow(windowId: string, updates: Partial<MaintenanceWindowInput>): Promise<MaintenanceWindow> {
  rbacService.checkRole(['SYSTEM_ADMIN', 'OPS_COORDINATOR']);

  const existing = await idbAccessLayer.get<MaintenanceWindow>('maintenance_windows', windowId);
  if (!existing) throw new Error(`Maintenance window ${windowId} not found`);

  const updated: MaintenanceWindow = {
    ...existing,
    ...updates,
  };

  if (updated.start_time >= updated.end_time) {
    throw new Error('Maintenance window start time must be before end time');
  }

  await idbAccessLayer.put('maintenance_windows', updated);
  return updated;
}

async function deleteMaintenanceWindow(windowId: string): Promise<void> {
  rbacService.checkRole(['SYSTEM_ADMIN', 'OPS_COORDINATOR']);
  await idbAccessLayer.delete('maintenance_windows', windowId);
}

async function getMaintenanceWindows(roomId?: string): Promise<MaintenanceWindow[]> {
  if (roomId) {
    return idbAccessLayer.getAll<MaintenanceWindow>('maintenance_windows', 'idx_room', roomId);
  }
  return idbAccessLayer.getAll<MaintenanceWindow>('maintenance_windows');
}

// ============================================================
// Blacklist Rules
// ============================================================

async function createBlacklistRule(
  targetType: 'participant' | 'room',
  targetId: string,
  reason: string,
): Promise<BlacklistRule> {
  rbacService.checkPermission('blacklist:manage');

  const session = rbacService.getCurrentSession();
  const rule: BlacklistRule = {
    rule_id: crypto.randomUUID(),
    target_type: targetType,
    target_id: targetId,
    reason,
    created_by: session.user_id,
    created_at: Date.now(),
    _version: 1,
  };

  await idbAccessLayer.put('blacklist_rules', rule);
  return rule;
}

async function deleteBlacklistRule(ruleId: string): Promise<void> {
  rbacService.checkPermission('blacklist:manage');
  await idbAccessLayer.delete('blacklist_rules', ruleId);
}

async function getBlacklistRules(): Promise<BlacklistRule[]> {
  return idbAccessLayer.getAll<BlacklistRule>('blacklist_rules');
}

async function isBlacklisted(targetType: 'participant' | 'room', targetId: string): Promise<boolean> {
  const rules = await idbAccessLayer.getAll<BlacklistRule>('blacklist_rules', 'idx_target_type', targetType);
  return rules.some((r) => r.target_id === targetId);
}

// ============================================================
// Export
// ============================================================

export const opsConfigService = {
  loadDefaults,
  getPolicy,
  setPolicy,
  getAllPolicies,
  createMaintenanceWindow,
  updateMaintenanceWindow,
  deleteMaintenanceWindow,
  getMaintenanceWindows,
  createBlacklistRule,
  deleteBlacklistRule,
  getBlacklistRules,
  isBlacklisted,
};

export default opsConfigService;
