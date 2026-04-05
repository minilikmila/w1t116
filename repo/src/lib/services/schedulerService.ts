import { idbAccessLayer } from './idbAccessLayer';
import { channelManager, CHANNELS } from '../utils/broadcastChannels';
import type { SchedulerTask, ErrorLogEntry, SchedulerSyncMessage } from '../types';

// ============================================================
// Constants
// ============================================================

const POLL_INTERVAL_MS = 60_000; // 60 seconds
const HEARTBEAT_INTERVAL_MS = 5_000; // 5 seconds
const HEARTBEAT_TIMEOUT_MS = 5_000; // 5 seconds without heartbeat = takeover
const PRIMARY_ELECTION_WAIT_MS = 100;
const MAX_RETRIES = 5;
const INITIAL_RETRY_MS = 60_000; // 1 minute
const MAX_RETRY_MS = 30 * 60_000; // 30 minutes

// ============================================================
// State
// ============================================================

const tabId = crypto.randomUUID();
let isPrimary = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatWatchdog: ReturnType<typeof setTimeout> | null = null;
let lastHeartbeat = 0;
let initialized = false;
let retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

// Task handlers registered by other services
const taskHandlers: Map<string, () => Promise<void>> = new Map();

// Progress callback for catch-up UI
let onCatchUpProgress: ((message: string) => void) | null = null;

// ============================================================
// Task Priority (for catch-up ordering)
// ============================================================

const TASK_PRIORITY: Record<string, number> = {
  billing: 0,
  messaging: 1,
  reminder: 2,
  cleanup: 3,
};

function getTaskPriority(taskType: string): number {
  return TASK_PRIORITY[taskType] ?? 99;
}

// ============================================================
// DND Check
// ============================================================

function isDndActive(): boolean {
  try {
    const config = localStorage.getItem('dnd_config');
    const { start, end } = config ? JSON.parse(config) : { start: '22:00', end: '07:00' };
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes > endMinutes) {
      // Overnight window (e.g., 22:00 - 07:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } catch {
    return false;
  }
}

function getDndEndTime(): number {
  try {
    const config = localStorage.getItem('dnd_config');
    const { end } = config ? JSON.parse(config) : { end: '07:00' };
    const [endH, endM] = end.split(':').map(Number);
    const now = new Date();
    const dndEnd = new Date(now);
    dndEnd.setHours(endH, endM, 0, 0);

    // If DND end is earlier today, it means tomorrow
    if (dndEnd.getTime() <= now.getTime()) {
      dndEnd.setDate(dndEnd.getDate() + 1);
    }
    return dndEnd.getTime();
  } catch {
    // Default: 7 AM tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(7, 0, 0, 0);
    return tomorrow.getTime();
  }
}

// ============================================================
// Cron-like Schedule Parsing
// ============================================================

function computeNextRun(scheduleDefinition: string, afterTimestamp?: number): number {
  const after = afterTimestamp || Date.now();

  // Simple schedule formats:
  // "monthly:1:00:05" = 1st of month at 00:05
  // "interval:HOURS" = every N hours from now
  // "once:TIMESTAMP" = one-shot at specific time

  if (scheduleDefinition.startsWith('monthly:')) {
    const parts = scheduleDefinition.split(':');
    const day = parseInt(parts[1], 10);
    const hour = parseInt(parts[2], 10);
    const minute = parseInt(parts[3], 10);

    const next = new Date(after);
    next.setDate(day);
    next.setHours(hour, minute, 0, 0);

    // If this month's run has passed, go to next month
    if (next.getTime() <= after) {
      next.setMonth(next.getMonth() + 1);
    }
    return next.getTime();
  }

  if (scheduleDefinition.startsWith('interval:')) {
    const hours = parseInt(scheduleDefinition.split(':')[1], 10);
    return after + hours * 60 * 60 * 1000;
  }

  if (scheduleDefinition.startsWith('once:')) {
    return parseInt(scheduleDefinition.split(':')[1], 10);
  }

  // Default: 24 hours from now
  return after + 24 * 60 * 60 * 1000;
}

function countMissedPeriods(scheduleDefinition: string, nextRunAt: number): number {
  if (!scheduleDefinition.startsWith('monthly:')) return 1;

  let count = 0;
  let cursor = nextRunAt;
  const now = Date.now();

  while (cursor < now) {
    count++;
    cursor = computeNextRun(scheduleDefinition, cursor);
  }

  return Math.max(count, 1);
}

// ============================================================
// Task Execution
// ============================================================

async function executeTask(task: SchedulerTask): Promise<void> {
  const handler = taskHandlers.get(task.task_id);
  if (!handler) {
    console.warn(`No handler registered for task ${task.task_id}`);
    return;
  }

  // For reminder tasks, check DND
  if (task.task_type === 'reminder' && isDndActive()) {
    const dndEnd = getDndEndTime();
    // Recompute fire_at to DND end time
    task.next_run_at = dndEnd;
    await persistNextRunAt(task.task_id, dndEnd);
    return;
  }

  // Mark as executing in IndexedDB (prevents duplicate execution from other tabs)
  const current = await idbAccessLayer.get<SchedulerTask>('scheduler_tasks', task.task_id);
  if (!current || current.status === 'executing') return; // Another tab got it

  await idbAccessLayer.put('scheduler_tasks', {
    ...current,
    status: 'executing',
    _version: current._version,
  });

  try {
    await handler();

    // Success: advance next_run_at
    const nextRun = task.schedule_definition.startsWith('once:')
      ? 0
      : computeNextRun(task.schedule_definition);

    const updated: Partial<SchedulerTask> & { task_id: string; _version: number } = {
      ...current,
      status: task.schedule_definition.startsWith('once:') ? 'completed' as const : 'active' as const,
      consecutive_failures: 0,
      last_error: null,
      next_run_at: nextRun,
      _version: current._version + 1,
    };

    await idbAccessLayer.put('scheduler_tasks', updated);
    await persistNextRunAt(task.task_id, nextRun);

    // Broadcast to other tabs
    channelManager.broadcast(CHANNELS.SCHEDULER_SYNC, {
      type: 'task-executed',
      task_id: task.task_id,
      tab_id: tabId,
      new_next_run_at: nextRun,
    } as SchedulerSyncMessage);
  } catch (err: any) {
    // Failure: log error, schedule retry
    const errorMessage = err?.message || String(err);

    // Log to error_logs
    await idbAccessLayer.put('error_logs', {
      log_id: crypto.randomUUID(),
      task_id: task.task_id,
      error_message: errorMessage,
      stack_trace: err?.stack || null,
      timestamp: Date.now(),
    });

    const failures = (current.consecutive_failures || 0) + 1;

    if (failures >= MAX_RETRIES) {
      // Mark as permanently failed
      await idbAccessLayer.put('scheduler_tasks', {
        ...current,
        status: 'failed' as const,
        consecutive_failures: failures,
        last_error: errorMessage,
        _version: current._version + 1,
      });

      // Notify admins (will be wired to messageCenterService in Phase 4)
      console.error(`Task ${task.task_id} permanently failed after ${MAX_RETRIES} retries: ${errorMessage}`);
    } else {
      // Schedule retry with exponential backoff
      const delay = Math.min(INITIAL_RETRY_MS * Math.pow(2, failures - 1), MAX_RETRY_MS);
      const retryAt = Date.now() + delay;

      await idbAccessLayer.put('scheduler_tasks', {
        ...current,
        status: 'active' as const,
        consecutive_failures: failures,
        last_error: errorMessage,
        next_run_at: retryAt,
        _version: current._version + 1,
      });
      await persistNextRunAt(task.task_id, retryAt);

      // Set local retry timer
      const timer = setTimeout(() => checkAndExecuteTask(task.task_id), delay);
      retryTimers.set(task.task_id, timer);
    }
  }
}

// ============================================================
// Persistence Helpers
// ============================================================

function persistNextRunAt(taskId: string, nextRunAt: number): Promise<void> {
  try {
    localStorage.setItem(`scheduler_next_run_${taskId}`, String(nextRunAt));
  } catch {
    // LocalStorage full — degrade gracefully
    console.warn('LocalStorage full, scheduler next_run_at not persisted');
  }
  return Promise.resolve();
}

function readNextRunAt(taskId: string): number | null {
  try {
    const val = localStorage.getItem(`scheduler_next_run_${taskId}`);
    return val ? parseInt(val, 10) : null;
  } catch {
    return null;
  }
}

// ============================================================
// Polling & Execution
// ============================================================

async function checkAndExecuteTask(taskId: string): Promise<void> {
  if (!isPrimary) return;

  const task = await idbAccessLayer.get<SchedulerTask>('scheduler_tasks', taskId);
  if (!task || task.status !== 'active') return;

  const nextRun = readNextRunAt(taskId) || task.next_run_at;
  if (nextRun > Date.now()) return;

  await executeTask(task);
}

async function pollAllTasks(): Promise<void> {
  if (!isPrimary) return;

  const tasks = await idbAccessLayer.getAll<SchedulerTask>('scheduler_tasks');
  for (const task of tasks) {
    if (task.status !== 'active') continue;

    const nextRun = readNextRunAt(task.task_id) || task.next_run_at;
    if (nextRun <= Date.now()) {
      await executeTask(task);
    }
  }
}

// ============================================================
// Catch-Up Execution
// ============================================================

async function executeCatchUp(): Promise<void> {
  const tasks = await idbAccessLayer.getAll<SchedulerTask>('scheduler_tasks');
  const overdueTasks = tasks
    .filter((t) => {
      if (t.status !== 'active') return false;
      const nextRun = readNextRunAt(t.task_id) || t.next_run_at;
      return nextRun < Date.now();
    })
    .sort((a, b) => getTaskPriority(a.task_type) - getTaskPriority(b.task_type));

  if (overdueTasks.length === 0) return;

  for (const task of overdueTasks) {
    const missedPeriods = countMissedPeriods(task.schedule_definition, task.next_run_at);
    const progressMsg = `Processing ${missedPeriods} missed ${task.task_type} run(s)...`;
    onCatchUpProgress?.(progressMsg);

    for (let i = 0; i < missedPeriods; i++) {
      onCatchUpProgress?.(`${task.task_type}: executing period ${i + 1} of ${missedPeriods}`);
      await executeTask(task);
    }
  }

  onCatchUpProgress?.('');
}

// ============================================================
// Primary/Secondary Election
// ============================================================

async function electPrimary(): Promise<void> {
  return new Promise((resolve) => {
    let receivedPrimary = false;

    const unsub = channelManager.onMessage(CHANNELS.SCHEDULER_SYNC, (msg: SchedulerSyncMessage) => {
      if (msg.type === 'scheduler-primary' && msg.tab_id !== tabId) {
        receivedPrimary = true;
      }
    });

    // Announce ourselves
    channelManager.broadcast(CHANNELS.SCHEDULER_SYNC, {
      type: 'scheduler-active',
      tab_id: tabId,
    } as SchedulerSyncMessage);

    // Wait for response
    setTimeout(() => {
      unsub();
      if (receivedPrimary) {
        isPrimary = false;
        startSecondaryMode();
      } else {
        isPrimary = true;
        startPrimaryMode();
      }
      resolve();
    }, PRIMARY_ELECTION_WAIT_MS);
  });
}

function startPrimaryMode(): void {
  // Respond to other tabs' active announcements
  channelManager.onMessage(CHANNELS.SCHEDULER_SYNC, (msg: SchedulerSyncMessage) => {
    if (msg.type === 'scheduler-active' && msg.tab_id !== tabId) {
      channelManager.broadcast(CHANNELS.SCHEDULER_SYNC, {
        type: 'scheduler-primary',
        tab_id: tabId,
      } as SchedulerSyncMessage);
    }
    if (msg.type === 'task-executed' && msg.tab_id !== tabId) {
      // Another tab executed (shouldn't happen but handle gracefully)
      if (msg.task_id && msg.new_next_run_at) {
        persistNextRunAt(msg.task_id, msg.new_next_run_at);
      }
    }
  });

  // Start heartbeat
  heartbeatInterval = setInterval(() => {
    channelManager.broadcast(CHANNELS.SCHEDULER_SYNC, {
      type: 'scheduler-heartbeat',
      tab_id: tabId,
      timestamp: Date.now(),
    } as SchedulerSyncMessage);
  }, HEARTBEAT_INTERVAL_MS);

  // Start polling
  pollInterval = setInterval(pollAllTasks, POLL_INTERVAL_MS);

  // Also check on visibility change
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function startSecondaryMode(): void {
  lastHeartbeat = Date.now();

  channelManager.onMessage(CHANNELS.SCHEDULER_SYNC, (msg: SchedulerSyncMessage) => {
    if (msg.type === 'scheduler-heartbeat') {
      lastHeartbeat = Date.now();
    }
    if (msg.type === 'task-executed' && msg.task_id && msg.new_next_run_at) {
      persistNextRunAt(msg.task_id, msg.new_next_run_at);
    }
  });

  // Watch for primary going away
  heartbeatWatchdog = setInterval(() => {
    if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      // Primary is gone, take over
      if (heartbeatWatchdog) clearInterval(heartbeatWatchdog);
      isPrimary = true;
      startPrimaryMode();
      // Run immediate check
      pollAllTasks();
    }
  }, 1000);
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible' && isPrimary) {
    // Tab regained focus — immediately check all tasks
    pollAllTasks();
  }
}

// ============================================================
// Public API
// ============================================================

async function initialize(progressCallback?: (msg: string) => void): Promise<void> {
  if (initialized) return;
  initialized = true;
  onCatchUpProgress = progressCallback || null;

  // Elect primary/secondary
  await electPrimary();

  if (isPrimary) {
    // Run catch-up before normal polling
    await executeCatchUp();
  }
}

async function registerTask(registration: {
  task_id: string;
  schedule_definition: string;
  task_type: SchedulerTask['task_type'];
  handler: () => Promise<void>;
}): Promise<void> {
  taskHandlers.set(registration.task_id, registration.handler);

  // Check if task already exists in IndexedDB
  const existing = await idbAccessLayer.get<SchedulerTask>('scheduler_tasks', registration.task_id);
  if (!existing) {
    const nextRun = computeNextRun(registration.schedule_definition);
    const task: SchedulerTask = {
      task_id: registration.task_id,
      schedule_definition: registration.schedule_definition,
      task_type: registration.task_type,
      next_run_at: nextRun,
      status: 'active',
      consecutive_failures: 0,
      last_error: null,
      _version: 1,
    };
    await idbAccessLayer.put('scheduler_tasks', task);
    await persistNextRunAt(registration.task_id, nextRun);
  }
}

async function reEnableTask(taskId: string): Promise<void> {
  const task = await idbAccessLayer.get<SchedulerTask>('scheduler_tasks', taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const nextRun = computeNextRun(task.schedule_definition);
  await idbAccessLayer.put('scheduler_tasks', {
    ...task,
    status: 'active' as const,
    consecutive_failures: 0,
    last_error: null,
    next_run_at: nextRun,
    _version: task._version,
  });
  await persistNextRunAt(taskId, nextRun);
}

function shutdown(): void {
  if (pollInterval) clearInterval(pollInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (heartbeatWatchdog) clearInterval(heartbeatWatchdog);
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  document.removeEventListener('visibilitychange', onVisibilityChange);
  isPrimary = false;
  initialized = false;
}

async function getAllTasks(): Promise<SchedulerTask[]> {
  return idbAccessLayer.getAll<SchedulerTask>('scheduler_tasks');
}

async function getErrorLogs(taskId?: string): Promise<ErrorLogEntry[]> {
  if (taskId) {
    return idbAccessLayer.getAll<ErrorLogEntry>('error_logs', 'idx_task', taskId);
  }
  return idbAccessLayer.getAll<ErrorLogEntry>('error_logs');
}

// ============================================================
// Export
// ============================================================

export const schedulerService = {
  initialize,
  registerTask,
  reEnableTask,
  shutdown,
  getAllTasks,
  getErrorLogs,
  isPrimary: () => isPrimary,
};

export default schedulerService;
