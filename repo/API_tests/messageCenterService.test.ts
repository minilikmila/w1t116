import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockIdb, loginAs, logout } from './helpers';

// ============================================================
// Mock dependencies
// ============================================================

const mockIdb = createMockIdb();

vi.mock('../src/lib/services/idbAccessLayer', () => ({
  idbAccessLayer: mockIdb,
}));

vi.mock('../src/lib/utils/broadcastChannels', () => ({
  channelManager: {
    broadcast: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  },
  CHANNELS: { AUTH_SYNC: 'auth-sync' },
}));

const { messageCenterService } = await import('../src/lib/services/messageCenterService');

// ============================================================
// Tests
// ============================================================

describe('messageCenterService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdb._clear();
    logout();

    mockIdb.getAll.mockImplementation(async (store: string, index?: string, value?: any) => {
      const all = Array.from(mockIdb._getStore(store).values());
      if (index && value !== undefined) {
        const field = index.replace('idx_', '');
        return all.filter((r: any) => r[field] === value || r.status === value);
      }
      return all;
    });
  });

  // ----------------------------------------------------------
  // compose
  // ----------------------------------------------------------

  describe('compose', () => {
    it('creates a draft message', async () => {
      loginAs('SYSTEM_ADMIN');

      const msg = await messageCenterService.compose({
        title: 'Test Announcement',
        body: 'This is a test.',
        category: 'Announcements',
        target_roles: [],
        target_org_scope: 'all',
        target_org_units: [],
      });

      expect(msg.status).toBe('draft');
      expect(msg.title).toBe('Test Announcement');
      expect(msg.pinned).toBe(false);
      expect(msg.published_at).toBeNull();
    });

    it('requires SYSTEM_ADMIN, OPS_COORDINATOR, or INSTRUCTOR role', async () => {
      loginAs('PARTICIPANT');

      await expect(messageCenterService.compose({
        title: 'X',
        body: 'Y',
        category: 'Announcements',
        target_roles: [],
        target_org_scope: 'all',
        target_org_units: [],
      })).rejects.toThrow('Access denied');
    });
  });

  // ----------------------------------------------------------
  // publish
  // ----------------------------------------------------------

  describe('publish', () => {
    it('sets status to published and timestamps it', async () => {
      loginAs('SYSTEM_ADMIN');

      mockIdb._seed('messages', [{
        message_id: 'msg-1',
        author_id: 'admin',
        title: 'Draft',
        body: 'Content',
        category: 'Announcements',
        target_roles: [],
        target_org_scope: 'all',
        target_org_units: [],
        status: 'draft',
        pinned: false,
        scheduled_at: null,
        published_at: null,
        _version: 1,
      }]);

      await messageCenterService.publish('msg-1');

      const saved = mockIdb.put.mock.calls.find(
        (c: any) => c[0] === 'messages' && c[1].message_id === 'msg-1',
      );
      expect(saved).toBeTruthy();
      expect(saved![1].status).toBe('published');
      expect(saved![1].published_at).toBeGreaterThan(0);
    });

    it('throws when message not found', async () => {
      loginAs('SYSTEM_ADMIN');

      await expect(messageCenterService.publish('nonexistent'))
        .rejects.toThrow('Message not found');
    });

    it('requires message:publish permission', async () => {
      loginAs('PARTICIPANT');

      await expect(messageCenterService.publish('msg-1'))
        .rejects.toThrow('Access denied');
    });
  });

  // ----------------------------------------------------------
  // retract
  // ----------------------------------------------------------

  describe('retract', () => {
    it('sets status to retracted', async () => {
      loginAs('OPS_COORDINATOR');

      mockIdb._seed('messages', [{
        message_id: 'msg-retract',
        author_id: 'admin',
        title: 'Published',
        body: 'Content',
        category: 'Announcements',
        target_roles: [],
        target_org_scope: 'all',
        target_org_units: [],
        status: 'published',
        pinned: false,
        scheduled_at: null,
        published_at: Date.now(),
        _version: 1,
      }]);

      await messageCenterService.retract('msg-retract');

      const saved = mockIdb.put.mock.calls.find(
        (c: any) => c[0] === 'messages' && c[1].message_id === 'msg-retract',
      );
      expect(saved![1].status).toBe('retracted');
    });
  });

  // ----------------------------------------------------------
  // pin
  // ----------------------------------------------------------

  describe('pin', () => {
    it('pins a message', async () => {
      loginAs('SYSTEM_ADMIN');

      mockIdb._seed('messages', [{
        message_id: 'msg-pin',
        author_id: 'admin',
        title: 'Pinnable',
        body: 'Content',
        category: 'Announcements',
        target_roles: [],
        target_org_scope: 'all',
        target_org_units: [],
        status: 'published',
        pinned: false,
        scheduled_at: null,
        published_at: Date.now(),
        _version: 1,
      }]);

      await messageCenterService.pin('msg-pin', true);

      const saved = mockIdb.put.mock.calls.find(
        (c: any) => c[0] === 'messages' && c[1].message_id === 'msg-pin',
      );
      expect(saved![1].pinned).toBe(true);
    });

    it('unpins a message', async () => {
      loginAs('SYSTEM_ADMIN');

      mockIdb._seed('messages', [{
        message_id: 'msg-unpin',
        author_id: 'admin',
        title: 'Pinned',
        body: 'Content',
        category: 'Announcements',
        target_roles: [],
        target_org_scope: 'all',
        target_org_units: [],
        status: 'published',
        pinned: true,
        scheduled_at: null,
        published_at: Date.now(),
        _version: 1,
      }]);

      await messageCenterService.pin('msg-unpin', false);

      const saved = mockIdb.put.mock.calls.find(
        (c: any) => c[0] === 'messages' && c[1].message_id === 'msg-unpin',
      );
      expect(saved![1].pinned).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // recordReadReceipt
  // ----------------------------------------------------------

  describe('recordReadReceipt', () => {
    it('creates a read receipt', async () => {
      await messageCenterService.recordReadReceipt('msg-1', 'user-1');

      expect(mockIdb.put).toHaveBeenCalledWith('read_receipts', expect.objectContaining({
        message_id: 'msg-1',
        user_id: 'user-1',
      }));
    });

    it('does not duplicate receipts', async () => {
      mockIdb._seed('read_receipts', [{
        receipt_id: 'rr-existing',
        message_id: 'msg-1',
        user_id: 'user-1',
        read_at: Date.now(),
      }]);

      // Override getAll for the duplicate check
      mockIdb.getAll.mockImplementation(async (store: string, index?: string, value?: any) => {
        if (store === 'read_receipts' && index === 'idx_message_user') {
          return Array.from(mockIdb._getStore('read_receipts').values()).filter(
            (r: any) => r.message_id === (value as any)?.[0] && r.user_id === (value as any)?.[1],
          );
        }
        return Array.from(mockIdb._getStore(store).values());
      });

      await messageCenterService.recordReadReceipt('msg-1', 'user-1');

      // put should not be called since receipt already exists
      expect(mockIdb.put).not.toHaveBeenCalledWith('read_receipts', expect.anything());
    });
  });

  // ----------------------------------------------------------
  // getAnalytics
  // ----------------------------------------------------------

  describe('getAnalytics', () => {
    it('returns zero opens and null timeToFirstRead when no receipts', async () => {
      mockIdb._seed('messages', [{
        message_id: 'msg-analytics',
        author_id: 'admin',
        title: 'Msg',
        body: 'Body',
        category: 'Announcements',
        target_roles: [],
        target_org_scope: 'all',
        target_org_units: [],
        status: 'published',
        pinned: false,
        scheduled_at: null,
        published_at: Date.now() - 60_000,
        _version: 1,
      }]);

      mockIdb.getAll.mockImplementation(async (store: string, index?: string, value?: any) => {
        if (store === 'read_receipts') return [];
        return Array.from(mockIdb._getStore(store).values());
      });

      const analytics = await messageCenterService.getAnalytics('msg-analytics');
      expect(analytics.uniqueOpens).toBe(0);
      expect(analytics.timeToFirstRead).toBeNull();
    });
  });
});
