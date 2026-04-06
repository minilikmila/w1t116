import { idbAccessLayer } from './idbAccessLayer';
import { rbacService } from './rbacService';
import type { Message, MessageInput, ReadReceipt, InboxFilters, PaginatedMessages, Role } from '../types';

// ============================================================
// Helpers
// ============================================================

async function getMessageOrThrow(messageId: string): Promise<Message> {
  const message = await idbAccessLayer.get<Message>('messages', messageId);
  if (!message) {
    throw new Error(`Message not found: ${messageId}`);
  }
  return message;
}

function matchesTargeting(message: Message, role: Role, orgUnit: string): boolean {
  // target_org_scope 'all' means everyone
  if (message.target_org_scope === 'all') {
    // Still check target_roles if specified
    if (message.target_roles.length > 0 && !message.target_roles.includes(role)) {
      return false;
    }
    return true;
  }

  // Check role targeting: empty means all roles
  if (message.target_roles.length > 0 && !message.target_roles.includes(role)) {
    return false;
  }

  // Check org_unit targeting: empty means all org units
  if (message.target_org_units.length > 0 && !message.target_org_units.includes(orgUnit)) {
    return false;
  }

  return true;
}

async function getVisibleMessages(userId: string): Promise<Message[]> {
  const session = rbacService.getCurrentSession();

  // SYSTEM_ADMIN sees all messages at all statuses
  if (session.role === 'SYSTEM_ADMIN') {
    return idbAccessLayer.getAll<Message>('messages');
  }

  // Other roles see only published messages targeted to their role
  const allMessages = await idbAccessLayer.getAll<Message>('messages', 'idx_status', 'published');
  return allMessages.filter((m) => matchesTargeting(m, session.role, session.org_unit));
}

// ============================================================
// 1. compose
// ============================================================

async function compose(input: MessageInput): Promise<Message> {
  rbacService.checkRole(['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR']);
  const session = rbacService.getCurrentSession();

  const message: Message = {
    message_id: crypto.randomUUID(),
    author_id: session.user_id,
    title: input.title,
    body: input.body,
    category: input.category,
    target_roles: input.target_roles,
    target_org_scope: input.target_org_scope,
    target_org_units: input.target_org_units,
    status: 'draft',
    pinned: false,
    scheduled_at: null,
    published_at: null,
    _version: 1,
  };

  await idbAccessLayer.put('messages', message);
  return message;
}

// ============================================================
// 2. publish
// ============================================================

async function publish(messageId: string): Promise<void> {
  rbacService.checkPermission('message:publish');
  const message = await getMessageOrThrow(messageId);

  message.status = 'published';
  message.published_at = Date.now();

  await idbAccessLayer.put('messages', message);
}

// ============================================================
// 3. schedule
// ============================================================

async function schedule(messageId: string, scheduledAt: number): Promise<void> {
  rbacService.checkPermission('message:schedule');
  const message = await getMessageOrThrow(messageId);

  message.status = 'scheduled';
  message.scheduled_at = scheduledAt;

  // NOTE: Scheduler integration will be wired in Phase 4.
  // For now just persist the scheduled state.
  await idbAccessLayer.put('messages', message);
}

// ============================================================
// 4. retract
// ============================================================

async function retract(messageId: string): Promise<void> {
  rbacService.checkPermission('message:retract');
  const message = await getMessageOrThrow(messageId);

  message.status = 'retracted';

  // Retain record + receipts for audit
  await idbAccessLayer.put('messages', message);
}

// ============================================================
// 5. pin
// ============================================================

async function pin(messageId: string, pinned: boolean): Promise<void> {
  rbacService.checkPermission('message:pin');
  const message = await getMessageOrThrow(messageId);

  message.pinned = pinned;

  await idbAccessLayer.put('messages', message);
}

// ============================================================
// 6. recordReadReceipt
// ============================================================

async function recordReadReceipt(messageId: string, userId: string): Promise<void> {
  const existing = await idbAccessLayer.getAll<ReadReceipt>(
    'read_receipts',
    'idx_message_user',
    [messageId, userId],
  );

  if (existing.length > 0) {
    return;
  }

  const receipt: ReadReceipt = {
    receipt_id: crypto.randomUUID(),
    message_id: messageId,
    user_id: userId,
    read_at: Date.now(),
  };

  await idbAccessLayer.put('read_receipts', receipt);
}

// ============================================================
// 7. getAnalytics
// ============================================================

async function getAnalytics(messageId: string): Promise<{ uniqueOpens: number; timeToFirstRead: number | null }> {
  const receipts = await idbAccessLayer.getAll<ReadReceipt>('read_receipts', 'idx_message', messageId);

  const uniqueOpens = receipts.length;

  if (uniqueOpens === 0) {
    return { uniqueOpens: 0, timeToFirstRead: null };
  }

  const message = await getMessageOrThrow(messageId);

  if (message.published_at === null) {
    return { uniqueOpens, timeToFirstRead: null };
  }

  const earliestRead = Math.min(...receipts.map((r) => r.read_at));
  const timeToFirstRead = earliestRead - message.published_at;

  return { uniqueOpens, timeToFirstRead };
}

// ============================================================
// 8. getInbox
// ============================================================

async function getInbox(userId: string, filters: InboxFilters): Promise<PaginatedMessages> {
  let messages = await getVisibleMessages(userId);

  // Filter by category if specified
  if (filters.category) {
    messages = messages.filter((m) => m.category === filters.category);
  }

  // Sort: pinned first, then by published_at descending
  messages.sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return (b.published_at ?? 0) - (a.published_at ?? 0);
  });

  const total = messages.length;
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 20;
  const start = page * pageSize;
  const paged = messages.slice(start, start + pageSize);

  return { messages: paged, total, page, pageSize };
}

// ============================================================
// 9. search
// ============================================================

async function search(query: string, userId: string): Promise<PaginatedMessages> {
  let messages = await getVisibleMessages(userId);

  const lowerQuery = query.toLowerCase();
  messages = messages.filter(
    (m) =>
      m.title.toLowerCase().includes(lowerQuery) ||
      m.body.toLowerCase().includes(lowerQuery),
  );

  // Sort by recency (published_at desc)
  messages.sort((a, b) => (b.published_at ?? 0) - (a.published_at ?? 0));

  return { messages, total: messages.length, page: 0, pageSize: messages.length };
}

// ============================================================
// 10. getMessage
// ============================================================

async function getMessage(messageId: string): Promise<Message | undefined> {
  return idbAccessLayer.get<Message>('messages', messageId);
}

// ============================================================
// 11. getUnreadCount
// ============================================================

async function getUnreadCount(userId: string): Promise<number> {
  const visibleMessages = await getVisibleMessages(userId);

  const userReceipts = await idbAccessLayer.getAll<ReadReceipt>('read_receipts', 'idx_user', userId);
  const readMessageIds = new Set(userReceipts.map((r) => r.message_id));

  return visibleMessages.filter((m) => !readMessageIds.has(m.message_id)).length;
}

// ============================================================
// Export
// ============================================================

export const messageCenterService = {
  compose,
  publish,
  schedule,
  retract,
  pin,
  recordReadReceipt,
  getAnalytics,
  getInbox,
  search,
  getMessage,
  getUnreadCount,
};

export default messageCenterService;
