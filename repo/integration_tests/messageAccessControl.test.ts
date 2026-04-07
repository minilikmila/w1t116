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
// Helpers
// ============================================================

function seedMessage(overrides: Record<string, any> = {}) {
  const msg = {
    message_id: 'msg-1',
    author_id: 'admin-1',
    title: 'Test Message',
    body: 'Content',
    category: 'Announcements',
    target_roles: ['INSTRUCTOR'],
    target_org_scope: 'specific',
    target_org_units: ['TestUnit'],
    status: 'published',
    pinned: false,
    scheduled_at: null,
    published_at: Date.now(),
    _version: 1,
    ...overrides,
  };
  mockIdb._seed('messages', [msg]);
  return msg;
}

// ============================================================
// Tests
// ============================================================

describe('Message Detail Access Control (Phase 3)', () => {
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

  it('SYSTEM_ADMIN can access any message regardless of targeting', async () => {
    loginAs('SYSTEM_ADMIN');
    seedMessage({ target_roles: ['PARTICIPANT'], target_org_units: ['OtherUnit'] });

    const msg = await messageCenterService.getMessage('msg-1');
    expect(msg).toBeTruthy();
    expect(msg!.message_id).toBe('msg-1');
  });

  it('SYSTEM_ADMIN can access draft messages', async () => {
    loginAs('SYSTEM_ADMIN');
    seedMessage({ status: 'draft', published_at: null });

    const msg = await messageCenterService.getMessage('msg-1');
    expect(msg).toBeTruthy();
  });

  it('INSTRUCTOR targeted by role and org can access published message', async () => {
    loginAs('INSTRUCTOR', { org_unit: 'TestUnit' });
    seedMessage({ target_roles: ['INSTRUCTOR'], target_org_units: ['TestUnit'] });

    const msg = await messageCenterService.getMessage('msg-1');
    expect(msg).toBeTruthy();
  });

  it('PARTICIPANT cannot access message targeted only to INSTRUCTOR', async () => {
    loginAs('PARTICIPANT', { org_unit: 'TestUnit' });
    seedMessage({ target_roles: ['INSTRUCTOR'], target_org_units: ['TestUnit'] });

    const msg = await messageCenterService.getMessage('msg-1');
    expect(msg).toBeUndefined();
  });

  it('INSTRUCTOR cannot access draft message', async () => {
    loginAs('INSTRUCTOR', { org_unit: 'TestUnit' });
    seedMessage({ status: 'draft', published_at: null });

    const msg = await messageCenterService.getMessage('msg-1');
    expect(msg).toBeUndefined();
  });

  it('INSTRUCTOR cannot access scheduled message', async () => {
    loginAs('INSTRUCTOR', { org_unit: 'TestUnit' });
    seedMessage({ status: 'scheduled', published_at: null, scheduled_at: Date.now() + 3600000 });

    const msg = await messageCenterService.getMessage('msg-1');
    expect(msg).toBeUndefined();
  });

  it('INSTRUCTOR cannot access retracted message', async () => {
    loginAs('INSTRUCTOR', { org_unit: 'TestUnit' });
    seedMessage({ status: 'retracted' });

    const msg = await messageCenterService.getMessage('msg-1');
    expect(msg).toBeUndefined();
  });

  it('non-existent message returns undefined', async () => {
    loginAs('SYSTEM_ADMIN');

    const msg = await messageCenterService.getMessage('does-not-exist');
    expect(msg).toBeUndefined();
  });

  it('INSTRUCTOR in wrong org_unit cannot access message', async () => {
    loginAs('INSTRUCTOR', { org_unit: 'WrongUnit' });
    seedMessage({ target_roles: ['INSTRUCTOR'], target_org_units: ['TestUnit'] });

    const msg = await messageCenterService.getMessage('msg-1');
    expect(msg).toBeUndefined();
  });

  it('message with target_org_scope=all and no role filter is visible to everyone', async () => {
    loginAs('PARTICIPANT', { org_unit: 'AnyUnit' });
    seedMessage({ target_roles: [], target_org_scope: 'all', target_org_units: [] });

    const msg = await messageCenterService.getMessage('msg-1');
    expect(msg).toBeTruthy();
  });
});
