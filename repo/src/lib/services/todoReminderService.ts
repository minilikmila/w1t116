import { idbAccessLayer } from './idbAccessLayer';
import type { Reminder, ReminderInput, SendLog, SessionRecord, Room } from '../types';

// ============================================================
// Helper: DND Configuration
// ============================================================

interface DndConfig {
  start: string;
  end: string;
}

function parseDndConfig(): DndConfig {
  try {
    const raw = localStorage.getItem('dnd_config');
    if (raw) {
      return JSON.parse(raw) as DndConfig;
    }
  } catch {
    // fall through to default
  }
  return { start: '22:00', end: '07:00' };
}

function parseTimeString(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

function currentMinuteOfDay(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

// ============================================================
// 5. isDndActive
// ============================================================

function isDndActive(): boolean {
  const config = parseDndConfig();
  const start = parseTimeString(config.start);
  const end = parseTimeString(config.end);
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  const now = currentMinuteOfDay();

  if (startMinutes > endMinutes) {
    // Overnight window: e.g. 22:00 - 07:00
    return now >= startMinutes || now < endMinutes;
  } else {
    return now >= startMinutes && now < endMinutes;
  }
}

// ============================================================
// 6. getDndEndTime
// ============================================================

function getDndEndTime(): number {
  const config = parseDndConfig();
  const end = parseTimeString(config.end);

  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(end.hour, end.minute, 0, 0);

  // If todayEnd is in the future, that's the next end time
  if (todayEnd.getTime() > now.getTime()) {
    return todayEnd.getTime();
  }

  // Otherwise, it's tomorrow's end time
  todayEnd.setDate(todayEnd.getDate() + 1);
  return todayEnd.getTime();
}

// ============================================================
// 1. createReminder
// ============================================================

async function createReminder(input: ReminderInput): Promise<Reminder> {
  const reminder: Reminder = {
    reminder_id: crypto.randomUUID(),
    user_id: input.user_id,
    template: input.template,
    resolved_text: null,
    trigger_type: input.trigger_type,
    trigger_time: input.trigger_time || null,
    linked_entity_type: input.linked_entity_type || null,
    linked_entity_id: input.linked_entity_id || null,
    status: 'pending',
    fire_at: input.trigger_time || null,
    _version: 1,
  };

  await idbAccessLayer.put('reminders', reminder);
  return reminder;
}

// ============================================================
// 2. resolveTemplateVariables
// ============================================================

async function resolveTemplateVariables(
  template: string,
  linkedType?: string,
  linkedId?: string,
): Promise<string> {
  let result = template;
  const vars = template.match(/\{\{\w+\}\}/g) || [];
  const resolved = new Set<string>();

  // {{room_name}}
  if (vars.some((v) => v === '{{room_name}}')) {
    let roomName = '[Unknown]';
    try {
      if (linkedType === 'room' && linkedId) {
        const room = await idbAccessLayer.get<Room>('rooms', linkedId);
        roomName = room ? room.name : '[Room removed]';
      } else if (linkedType === 'booking' && linkedId) {
        const booking = await idbAccessLayer.get<{ room_id: string }>('bookings', linkedId);
        if (booking) {
          const room = await idbAccessLayer.get<Room>('rooms', booking.room_id);
          roomName = room ? room.name : '[Room removed]';
        } else {
          roomName = '[Room removed]';
        }
      }
    } catch {
      roomName = '[Room removed]';
    }
    result = result.replace(/\{\{room_name\}\}/g, roomName);
    resolved.add('{{room_name}}');
  }

  // {{start_time}}
  if (vars.some((v) => v === '{{start_time}}')) {
    let startTime = '[Unknown time]';
    try {
      if ((linkedType === 'session' || linkedType === 'booking') && linkedId) {
        if (linkedType === 'session') {
          const session = await idbAccessLayer.get<SessionRecord>('sessions', linkedId);
          if (session) {
            startTime = new Date(session.start_time).toLocaleString();
          }
        } else {
          const booking = await idbAccessLayer.get<{ start_time: number }>('bookings', linkedId);
          if (booking) {
            startTime = new Date(booking.start_time).toLocaleString();
          }
        }
      }
    } catch {
      startTime = '[Unknown time]';
    }
    result = result.replace(/\{\{start_time\}\}/g, startTime);
    resolved.add('{{start_time}}');
  }

  // {{coordinator}}
  if (vars.some((v) => v === '{{coordinator}}')) {
    let coordinator = '[Unknown coordinator]';
    try {
      if (linkedType === 'session' && linkedId) {
        const session = await idbAccessLayer.get<SessionRecord>('sessions', linkedId);
        if (session) {
          const instructor = await idbAccessLayer.get<{ username: string }>('users', session.instructor_id);
          coordinator = instructor ? instructor.username : '[Unknown coordinator]';
        }
      }
    } catch {
      coordinator = '[Unknown coordinator]';
    }
    result = result.replace(/\{\{coordinator\}\}/g, coordinator);
    resolved.add('{{coordinator}}');
  }

  // Replace any remaining unresolved template variables with [Unknown]
  result = result.replace(/\{\{\w+\}\}/g, '[Unknown]');

  return result;
}

// ============================================================
// 3. deliverPending
// ============================================================

async function deliverPending(): Promise<void> {
  const allReminders = await idbAccessLayer.getAll<Reminder>('reminders', 'idx_status', 'pending');
  const now = Date.now();

  // Filter: fire_at <= now, or fire_at is null and trigger_type='event'
  const due = allReminders.filter((r) => {
    if (r.fire_at !== null && r.fire_at <= now) return true;
    if (r.fire_at === null && r.trigger_type === 'event') return true;
    return false;
  });

  // Collect recently delivered reminders for dedup check
  const allDeliveredReminders = await idbAccessLayer.getAll<Reminder>('reminders', 'idx_status', 'delivered');
  const recentDelivered = allDeliveredReminders.filter(
    (r) => r.trigger_time !== null && r.trigger_time > now - 60_000,
  );

  for (const reminder of due) {
    // Check DND
    if (isDndActive()) {
      reminder.status = 'queued';
      reminder.fire_at = getDndEndTime();
      await idbAccessLayer.put('reminders', reminder);

      const log: SendLog = {
        log_id: crypto.randomUUID(),
        reminder_id: reminder.reminder_id,
        user_id: reminder.user_id,
        sent_at: Date.now(),
        delivery_status: 'suppressed_dnd',
      };
      await idbAccessLayer.put('send_logs', log);
      continue;
    }

    // Resolve template first for dedup comparison
    const resolvedText = await resolveTemplateVariables(
      reminder.template,
      reminder.linked_entity_type || undefined,
      reminder.linked_entity_id || undefined,
    );

    // Check deduplication using original trigger_time
    const isDuplicate = recentDelivered.some(
      (r) =>
        r.user_id === reminder.user_id &&
        r.resolved_text === resolvedText,
    );
    if (isDuplicate) {
      continue;
    }

    // Before delivering event-triggered reminders: check if linked session is cancelled
    if (reminder.trigger_type === 'event' && reminder.linked_entity_type === 'session' && reminder.linked_entity_id) {
      const session = await idbAccessLayer.get<SessionRecord>('sessions', reminder.linked_entity_id);
      if (session && session.status === 'cancelled') {
        continue;
      }
    }

    // Deliver
    reminder.status = 'delivered';
    reminder.resolved_text = resolvedText;
    await idbAccessLayer.put('reminders', reminder);

    const log: SendLog = {
      log_id: crypto.randomUUID(),
      reminder_id: reminder.reminder_id,
      user_id: reminder.user_id,
      sent_at: Date.now(),
      delivery_status: 'delivered',
    };
    await idbAccessLayer.put('send_logs', log);
  }
}

// ============================================================
// 4. deliverQueuedBatch
// ============================================================

async function deliverQueuedBatch(): Promise<void> {
  const queued = await idbAccessLayer.getAll<Reminder>('reminders', 'idx_status', 'queued');

  if (isDndActive()) {
    return;
  }

  const batches: Reminder[][] = [];
  for (let i = 0; i < queued.length; i += 10) {
    batches.push(queued.slice(i, i + 10));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    if (batchIndex > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    for (const reminder of batches[batchIndex]) {
      const resolvedText = await resolveTemplateVariables(
        reminder.template,
        reminder.linked_entity_type || undefined,
        reminder.linked_entity_id || undefined,
      );

      reminder.status = 'delivered';
      reminder.resolved_text = resolvedText;
      await idbAccessLayer.put('reminders', reminder);

      const log: SendLog = {
        log_id: crypto.randomUUID(),
        reminder_id: reminder.reminder_id,
        user_id: reminder.user_id,
        sent_at: Date.now(),
        delivery_status: 'delivered',
      };
      await idbAccessLayer.put('send_logs', log);
    }
  }
}

// ============================================================
// 7. getRemindersForUser
// ============================================================

async function getRemindersForUser(userId: string): Promise<Reminder[]> {
  return idbAccessLayer.getAll<Reminder>('reminders', 'idx_user', userId);
}

// ============================================================
// 8. getSendLogs
// ============================================================

async function getSendLogs(reminderId: string): Promise<SendLog[]> {
  return idbAccessLayer.getAll<SendLog>('send_logs', 'idx_reminder', reminderId);
}

// ============================================================
// 9. cancelReminder
// ============================================================

async function cancelReminder(reminderId: string): Promise<void> {
  const reminder = await idbAccessLayer.get<Reminder>('reminders', reminderId);
  if (!reminder) return;
  reminder.status = 'cancelled';
  await idbAccessLayer.put('reminders', reminder);
}

// ============================================================
// Export
// ============================================================

export const todoReminderService = {
  createReminder,
  resolveTemplateVariables,
  deliverPending,
  deliverQueuedBatch,
  isDndActive,
  getDndEndTime,
  getRemindersForUser,
  getSendLogs,
  cancelReminder,
};

export default todoReminderService;
