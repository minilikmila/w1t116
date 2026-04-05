import { writable } from 'svelte/store';
import type { Session, Message } from '../types';

// ============================================================
// Interface Types
// ============================================================

export interface UIState {
  activeModal: string | null;
  drawerVisible: boolean;
  retryCountdown: number;
  sidebarCollapsed: boolean;
}

export interface InboxState {
  messages: Message[];
  searchQuery: string;
  paginationCursor: number;
  category: string | null;
  total: number;
}

// ============================================================
// Notification type
// ============================================================

export interface Notification {
  id: string;
  text: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: number;
}

// ============================================================
// 1. authStore
// ============================================================

function findValidSession(): Session | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && /^session_/.test(key)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed: Session = JSON.parse(raw);
          if (parsed.expires_at > Date.now()) {
            return parsed;
          }
        }
      }
    }
  } catch {
    // localStorage may be unavailable (SSR, security restrictions, etc.)
  }
  return null;
}

export const authStore = writable<Session | null>(null);

export function initAuthStore(): void {
  const session = findValidSession();
  authStore.set(session);
}

// ============================================================
// 2. flagStore
// ============================================================

export const flagStore = writable<Record<string, boolean>>({});

// ============================================================
// 3. uiStore
// ============================================================

export const uiStore = writable<UIState>({
  activeModal: null,
  drawerVisible: false,
  retryCountdown: 0,
  sidebarCollapsed: false,
});

// ============================================================
// 4. inboxStore
// ============================================================

export const inboxStore = writable<InboxState>({
  messages: [],
  searchQuery: '',
  paginationCursor: 0,
  category: null,
  total: 0,
});

// ============================================================
// 5. notificationStore
// ============================================================

export const notificationStore = writable<Notification[]>([]);

/**
 * Add a toast notification. Auto-removes after 4 seconds.
 */
export function addNotification(text: string, type: Notification['type'] = 'info'): void {
  const id = crypto.randomUUID();
  const notification: Notification = { id, text, type, timestamp: Date.now() };
  notificationStore.update((list) => [...list, notification]);
  setTimeout(() => {
    notificationStore.update((list) => list.filter((n) => n.id !== id));
  }, 4000);
}
