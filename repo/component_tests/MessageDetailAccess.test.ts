/**
 * Rendered component test: MessageDetailPage access control.
 *
 * Verifies that the message detail page shows an access-denied message
 * when getMessage returns undefined (unauthorized or not found), and
 * renders message content when authorized.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import { writable } from 'svelte/store';

// ============================================================
// Mock dependencies
// ============================================================

const mockCurrentParams = writable<Record<string, string>>({ id: 'msg-1' });

vi.mock('../src/lib/utils/router', () => ({
  navigate: vi.fn(),
  currentParams: mockCurrentParams,
}));

const mockGetMessage = vi.fn();
const mockRecordReadReceipt = vi.fn();
const mockGetAnalytics = vi.fn();

vi.mock('../src/lib/services/messageCenterService', () => ({
  messageCenterService: {
    getMessage: mockGetMessage,
    recordReadReceipt: mockRecordReadReceipt,
    getAnalytics: mockGetAnalytics,
  },
}));

vi.mock('../src/lib/services/rbacService', () => ({
  rbacService: {
    getCurrentSession: vi.fn(() => ({
      user_id: 'participant-1',
      role: 'PARTICIPANT',
      org_unit: 'TestUnit',
      token: 'tok',
      expires_at: Date.now() + 86400000,
    })),
    isPermitted: vi.fn(() => false),
  },
}));

vi.mock('../src/lib/services/idbAccessLayer', () => ({
  idbAccessLayer: {
    get: vi.fn(async () => ({ user_id: 'admin-1', username: 'Admin' })),
  },
}));

// ============================================================
// Tests
// ============================================================

describe('MessageDetailPage — Access Control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentParams.set({ id: 'msg-1' });
  });

  it('shows access-denied message when getMessage returns undefined', async () => {
    mockGetMessage.mockResolvedValue(undefined);

    const { default: MessageDetailPage } = await import(
      '../src/routes/messages/MessageDetailPage.svelte'
    );

    render(MessageDetailPage);

    await waitFor(() => {
      expect(
        screen.getByText(/not found or you do not have access/i),
      ).toBeInTheDocument();
    });

    // Should NOT have attempted to record a read receipt
    expect(mockRecordReadReceipt).not.toHaveBeenCalled();
  });

  it('renders message content when getMessage returns a visible message', async () => {
    mockGetMessage.mockResolvedValue({
      message_id: 'msg-1',
      author_id: 'admin-1',
      title: 'Welcome Notice',
      body: 'Welcome to the platform!',
      category: 'Announcements',
      target_roles: [],
      target_org_scope: 'all',
      target_org_units: [],
      status: 'published',
      pinned: false,
      scheduled_at: null,
      published_at: Date.now() - 60000,
      _version: 1,
    });

    const { default: MessageDetailPage } = await import(
      '../src/routes/messages/MessageDetailPage.svelte'
    );

    render(MessageDetailPage);

    await waitFor(() => {
      expect(screen.getByText('Welcome Notice')).toBeInTheDocument();
    });

    expect(screen.getByText('Welcome to the platform!')).toBeInTheDocument();
    expect(screen.getByText('Announcements')).toBeInTheDocument();

    // Should have recorded a read receipt
    expect(mockRecordReadReceipt).toHaveBeenCalledWith('msg-1', 'participant-1');
  });

  it('shows error when no message ID is provided', async () => {
    mockCurrentParams.set({});

    const { default: MessageDetailPage } = await import(
      '../src/routes/messages/MessageDetailPage.svelte'
    );

    render(MessageDetailPage);

    await waitFor(() => {
      expect(screen.getByText(/No message ID provided/i)).toBeInTheDocument();
    });
  });
});
