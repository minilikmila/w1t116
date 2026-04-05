import { describe, it, expect } from 'vitest';
import type { Message, Role } from '../src/lib/types';

// ============================================================
// Pure targeting logic extracted from messageCenterService
// ============================================================

function matchesTargeting(
  message: Pick<Message, 'target_roles' | 'target_org_scope' | 'target_org_units'>,
  role: Role,
  orgUnit: string,
): boolean {
  if (message.target_org_scope === 'all') {
    if (message.target_roles.length > 0 && !message.target_roles.includes(role)) {
      return false;
    }
    return true;
  }

  if (message.target_roles.length > 0 && !message.target_roles.includes(role)) {
    return false;
  }

  if (message.target_org_units.length > 0 && !message.target_org_units.includes(orgUnit)) {
    return false;
  }

  return true;
}

function sortInbox(messages: Pick<Message, 'pinned' | 'published_at'>[]): typeof messages {
  return [...messages].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.published_at ?? 0) - (a.published_at ?? 0);
  });
}

function searchMessages(
  messages: Pick<Message, 'title' | 'body'>[],
  query: string,
): typeof messages {
  const lower = query.toLowerCase();
  return messages.filter(
    m => m.title.toLowerCase().includes(lower) || m.body.toLowerCase().includes(lower),
  );
}

// ============================================================
// Tests
// ============================================================

describe('message center logic', () => {
  // ----------------------------------------------------------
  // Targeting
  // ----------------------------------------------------------

  describe('matchesTargeting', () => {
    it('scope "all" matches any user', () => {
      expect(matchesTargeting(
        { target_roles: [], target_org_scope: 'all', target_org_units: [] },
        'PARTICIPANT', 'any-unit',
      )).toBe(true);
    });

    it('scope "all" still filters by target_roles if specified', () => {
      expect(matchesTargeting(
        { target_roles: ['INSTRUCTOR'], target_org_scope: 'all', target_org_units: [] },
        'PARTICIPANT', 'any-unit',
      )).toBe(false);

      expect(matchesTargeting(
        { target_roles: ['INSTRUCTOR'], target_org_scope: 'all', target_org_units: [] },
        'INSTRUCTOR', 'any-unit',
      )).toBe(true);
    });

    it('department scope filters by role', () => {
      expect(matchesTargeting(
        { target_roles: ['SYSTEM_ADMIN'], target_org_scope: 'department', target_org_units: ['HQ'] },
        'PARTICIPANT', 'HQ',
      )).toBe(false);
    });

    it('department scope filters by org_unit', () => {
      expect(matchesTargeting(
        { target_roles: [], target_org_scope: 'department', target_org_units: ['HQ'] },
        'SYSTEM_ADMIN', 'Remote',
      )).toBe(false);

      expect(matchesTargeting(
        { target_roles: [], target_org_scope: 'department', target_org_units: ['HQ'] },
        'SYSTEM_ADMIN', 'HQ',
      )).toBe(true);
    });

    it('empty target_roles and target_org_units means everyone (non-all scope)', () => {
      expect(matchesTargeting(
        { target_roles: [], target_org_scope: 'department', target_org_units: [] },
        'PARTICIPANT', 'anything',
      )).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // Inbox sorting
  // ----------------------------------------------------------

  describe('sortInbox', () => {
    it('pinned messages come first', () => {
      const messages = [
        { pinned: false, published_at: 3000 },
        { pinned: true, published_at: 1000 },
        { pinned: false, published_at: 5000 },
      ];
      const sorted = sortInbox(messages);
      expect(sorted[0].pinned).toBe(true);
    });

    it('within same pin status, newer messages come first', () => {
      const messages = [
        { pinned: false, published_at: 1000 },
        { pinned: false, published_at: 3000 },
        { pinned: false, published_at: 2000 },
      ];
      const sorted = sortInbox(messages);
      expect(sorted[0].published_at).toBe(3000);
      expect(sorted[1].published_at).toBe(2000);
      expect(sorted[2].published_at).toBe(1000);
    });

    it('handles null published_at as 0', () => {
      const messages = [
        { pinned: false, published_at: null },
        { pinned: false, published_at: 1000 },
      ];
      const sorted = sortInbox(messages);
      expect(sorted[0].published_at).toBe(1000);
    });
  });

  // ----------------------------------------------------------
  // Search
  // ----------------------------------------------------------

  describe('searchMessages', () => {
    const messages = [
      { title: 'Welcome to the Platform', body: 'Please read the guidelines.' },
      { title: 'Billing Update', body: 'New rates effective next month.' },
      { title: 'Maintenance Notice', body: 'Building A closed this weekend.' },
    ];

    it('matches title substring (case-insensitive)', () => {
      expect(searchMessages(messages, 'billing')).toHaveLength(1);
    });

    it('matches body substring', () => {
      expect(searchMessages(messages, 'guidelines')).toHaveLength(1);
    });

    it('matches across case', () => {
      expect(searchMessages(messages, 'WELCOME')).toHaveLength(1);
    });

    it('returns empty for no match', () => {
      expect(searchMessages(messages, 'nonexistent')).toHaveLength(0);
    });

    it('returns multiple matches', () => {
      // "new" appears in: "New rates effective next month." (title[1] body)
      // Let's use a term that appears in 2 messages
      // "Notice" / "Platform" only appear once. Use a single-char match:
      expect(searchMessages(messages, 'e')).toHaveLength(3); // all messages contain 'e'
    });

    it('returns all messages matching broad query', () => {
      // "a" appears in all 3 messages (Platform, rates, Maintenance/closed/A)
      const results = searchMessages(messages, 'a');
      expect(results.length).toBeGreaterThanOrEqual(3);
    });
  });
});
