import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { authStore, flagStore, uiStore, inboxStore, notificationStore } from '../src/lib/stores';

describe('Svelte store initialization', () => {
  describe('authStore', () => {
    beforeEach(() => {
      authStore.set(null);
    });

    it('defaults to null', () => {
      expect(get(authStore)).toBeNull();
    });

    it('can be set with a session', () => {
      const session = {
        user_id: 'u1',
        role: 'SYSTEM_ADMIN' as const,
        org_unit: 'HQ',
        token: 'tok',
        expires_at: Date.now() + 60_000,
      };
      authStore.set(session);
      expect(get(authStore)).toEqual(session);
    });

    it('can be cleared', () => {
      authStore.set({
        user_id: 'u1', role: 'SYSTEM_ADMIN', org_unit: 'HQ',
        token: 'tok', expires_at: Date.now() + 60_000,
      });
      authStore.set(null);
      expect(get(authStore)).toBeNull();
    });
  });

  describe('flagStore', () => {
    it('defaults to empty object', () => {
      expect(get(flagStore)).toEqual({});
    });

    it('can store flag evaluations', () => {
      flagStore.set({ feature_x: true, feature_y: false });
      const flags = get(flagStore);
      expect(flags.feature_x).toBe(true);
      expect(flags.feature_y).toBe(false);
    });
  });

  describe('uiStore', () => {
    it('has correct default values', () => {
      const ui = get(uiStore);
      expect(ui.activeModal).toBeNull();
      expect(ui.drawerVisible).toBe(false);
      expect(ui.retryCountdown).toBe(0);
      expect(ui.sidebarCollapsed).toBe(false);
    });
  });

  describe('inboxStore', () => {
    it('has correct default values', () => {
      const inbox = get(inboxStore);
      expect(inbox.messages).toEqual([]);
      expect(inbox.searchQuery).toBe('');
      expect(inbox.paginationCursor).toBe(0);
      expect(inbox.category).toBeNull();
      expect(inbox.total).toBe(0);
    });
  });

  describe('notificationStore', () => {
    it('defaults to empty array', () => {
      expect(get(notificationStore)).toEqual([]);
    });

    it('can queue notifications', () => {
      notificationStore.set([
        { id: 'n1', text: 'Test', type: 'info', timestamp: Date.now() },
      ]);
      expect(get(notificationStore)).toHaveLength(1);
    });
  });
});
