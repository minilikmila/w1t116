import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockIdb, loginAs, logout } from '../API_tests/helpers';

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

describe('Scheduled Message Publication (Phase 2)', () => {
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

    mockIdb.put.mockImplementation(async (store: string, record: any) => {
      const keyMap: Record<string, string> = { messages: 'message_id', read_receipts: 'receipt_id' };
      const keyPath = keyMap[store] || 'id';
      mockIdb._getStore(store).set(record[keyPath], { ...record });
      return { version: record._version ?? 1 };
    });
  });

  it('publishes due scheduled messages', async () => {
    loginAs('SYSTEM_ADMIN');

    // Seed a scheduled message with scheduled_at in the past
    mockIdb._seed('messages', [{
      message_id: 'msg-1',
      author_id: 'admin-1',
      title: 'Due Notice',
      body: 'Should be published',
      category: 'Announcements',
      target_roles: [],
      target_org_scope: 'all',
      target_org_units: [],
      status: 'scheduled',
      pinned: false,
      scheduled_at: Date.now() - 60_000, // 1 minute ago
      published_at: null,
      _version: 1,
    }]);

    const count = await messageCenterService.publishDueMessages();

    expect(count).toBe(1);
    const stored = mockIdb._getStore('messages').get('msg-1');
    expect(stored.status).toBe('published');
    expect(stored.published_at).toBeGreaterThan(0);
  });

  it('does not publish future scheduled messages', async () => {
    loginAs('SYSTEM_ADMIN');

    mockIdb._seed('messages', [{
      message_id: 'msg-future',
      author_id: 'admin-1',
      title: 'Future Notice',
      body: 'Not yet',
      category: 'Announcements',
      target_roles: [],
      target_org_scope: 'all',
      target_org_units: [],
      status: 'scheduled',
      pinned: false,
      scheduled_at: Date.now() + 3_600_000, // 1 hour from now
      published_at: null,
      _version: 1,
    }]);

    const count = await messageCenterService.publishDueMessages();

    expect(count).toBe(0);
    const stored = mockIdb._getStore('messages').get('msg-future');
    expect(stored.status).toBe('scheduled');
  });

  it('does not publish retracted messages even if they are past due', async () => {
    loginAs('SYSTEM_ADMIN');

    mockIdb._seed('messages', [{
      message_id: 'msg-retracted',
      author_id: 'admin-1',
      title: 'Retracted Notice',
      body: 'Was retracted',
      category: 'Announcements',
      target_roles: [],
      target_org_scope: 'all',
      target_org_units: [],
      status: 'retracted',
      pinned: false,
      scheduled_at: Date.now() - 60_000,
      published_at: null,
      _version: 1,
    }]);

    const count = await messageCenterService.publishDueMessages();

    expect(count).toBe(0);
    const stored = mockIdb._getStore('messages').get('msg-retracted');
    expect(stored.status).toBe('retracted');
  });

  it('publishes multiple due messages in one call', async () => {
    loginAs('SYSTEM_ADMIN');

    mockIdb._seed('messages', [
      {
        message_id: 'msg-a',
        author_id: 'admin-1',
        title: 'Notice A',
        body: 'A',
        category: 'Announcements',
        target_roles: [],
        target_org_scope: 'all',
        target_org_units: [],
        status: 'scheduled',
        pinned: false,
        scheduled_at: Date.now() - 120_000,
        published_at: null,
        _version: 1,
      },
      {
        message_id: 'msg-b',
        author_id: 'admin-1',
        title: 'Notice B',
        body: 'B',
        category: 'Announcements',
        target_roles: [],
        target_org_scope: 'all',
        target_org_units: [],
        status: 'scheduled',
        pinned: false,
        scheduled_at: Date.now() - 60_000,
        published_at: null,
        _version: 1,
      },
    ]);

    const count = await messageCenterService.publishDueMessages();

    expect(count).toBe(2);
    expect(mockIdb._getStore('messages').get('msg-a').status).toBe('published');
    expect(mockIdb._getStore('messages').get('msg-b').status).toBe('published');
  });
});
