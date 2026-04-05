import { idbAccessLayer } from './idbAccessLayer';
import { opsConfigService } from './opsConfigService';
import { schedulerService } from './schedulerService';
import { billingService } from './billingService';
import { todoReminderService } from './todoReminderService';
import { idempotencyService } from './idempotencyService';
import { messageCenterService } from './messageCenterService';
import { registrationService } from './registrationService';
import { featureFlagService } from './featureFlagService';
import { authService } from './authService';
import type { Session } from '../types';
import roomsJson from '../config/rooms.json';

// ============================================================
// App Initialization Sequence
// ============================================================

export async function initializeApp(
  onProgress?: (message: string) => void,
): Promise<Session | null> {
  // 1. Initialize IndexedDB
  onProgress?.('Initializing database...');
  await idbAccessLayer.init();

  // 2. Load default configuration
  onProgress?.('Loading configuration...');
  await opsConfigService.loadDefaults();

  // 3. Seed rooms if empty
  onProgress?.('Checking room data...');
  const existingRooms = await idbAccessLayer.getAll('rooms');
  if (existingRooms.length === 0) {
    for (const room of roomsJson) {
      await idbAccessLayer.put('rooms', { ...room, _version: 1 });
    }
  }

  // 4. Restore session
  onProgress?.('Restoring session...');
  const session = authService.restoreSession();

  // 5. Initialize feature flags
  onProgress?.('Loading feature flags...');
  if (session) {
    await featureFlagService.initialize({ role: session.role, org_unit: session.org_unit });
  } else {
    await featureFlagService.initialize();
  }

  // 6. Initialize cross-tab sync
  authService.initCrossTabSync();
  registrationService.initCrossTabSync();

  // 7. Initialize scheduler and register recurring tasks
  onProgress?.('Initializing scheduler...');
  await schedulerService.initialize(onProgress);

  // Register billing task: 1st of month at 12:05 AM
  await schedulerService.registerTask({
    task_id: 'monthly-billing',
    schedule_definition: 'monthly:1:0:05',
    task_type: 'billing',
    handler: async () => {
      await billingService.generateMonthlyBills();
    },
  });

  // Register overdue bill check: daily
  await schedulerService.registerTask({
    task_id: 'overdue-check',
    schedule_definition: 'interval:24',
    task_type: 'billing',
    handler: async () => {
      await billingService.markOverdueBills();
    },
  });

  // Register reminder delivery check: every hour
  await schedulerService.registerTask({
    task_id: 'reminder-delivery',
    schedule_definition: 'interval:1',
    task_type: 'reminder',
    handler: async () => {
      await todoReminderService.deliverPending();
      await todoReminderService.deliverQueuedBatch();
    },
  });

  // Register idempotency key cleanup: every 6 hours
  await schedulerService.registerTask({
    task_id: 'idempotency-cleanup',
    schedule_definition: 'interval:6',
    task_type: 'cleanup',
    handler: async () => {
      await idempotencyService.cleanup();
    },
  });

  // 8. Run consistency check (non-blocking)
  runConsistencyCheckAsync();

  onProgress?.('');
  return session;
}

async function runConsistencyCheckAsync(): Promise<void> {
  try {
    const { runConsistencyCheck } = await import('../utils/consistencyChecker');
    const report = await runConsistencyCheck();
    if (report.issues.length > 0) {
      console.warn(`Consistency check found ${report.issues.length} issue(s):`, report.issues);
    }
  } catch (err) {
    console.warn('Consistency check failed:', err);
  }
}

export function shutdownApp(): void {
  schedulerService.shutdown();
}
