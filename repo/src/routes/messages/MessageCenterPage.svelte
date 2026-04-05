<script lang="ts">
  import { onMount } from 'svelte';
  import { messageCenterService } from '../../lib/services/messageCenterService';
  import { rbacService } from '../../lib/services/rbacService';
  import { navigate } from '../../lib/utils/router';
  import type { Message, PaginatedMessages } from '../../lib/types';

  type Category = Message['category'];
  const CATEGORIES: Category[] = ['Announcements', 'Registration', 'Billing', 'Tasks'];

  let messages = $state<Message[]>([]);
  let loading = $state(true);
  let error = $state('');
  let activeCategory = $state<Category | 'All'>('All');
  let searchQuery = $state('');
  let searching = $state(false);
  let page = $state(0);
  let pageSize = $state(20);
  let total = $state(0);
  let readMessageIds = $state<Set<string>>(new Set());
  let unreadCount = $state(0);
  let userId = $state('');

  let totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

  onMount(async () => {
    try {
      const session = rbacService.getCurrentSession();
      userId = session.user_id;
      unreadCount = await messageCenterService.getUnreadCount(userId);
      await loadInbox();
    } catch (e: any) {
      error = e.message ?? 'Failed to load messages';
      loading = false;
    }
  });

  async function loadInbox() {
    loading = true;
    error = '';
    try {
      const filters: { category?: Category; page: number; pageSize: number } = {
        page,
        pageSize,
      };
      if (activeCategory !== 'All') {
        filters.category = activeCategory;
      }
      const result: PaginatedMessages = await messageCenterService.getInbox(userId, filters);
      messages = result.messages;
      total = result.total;

      // Build read set by checking receipts for visible messages
      const ids = new Set<string>();
      for (const m of messages) {
        try {
          const analytics = await messageCenterService.getAnalytics(m.message_id);
          if (analytics.uniqueOpens > 0) {
            ids.add(m.message_id);
          }
        } catch {
          // ignore
        }
      }
      readMessageIds = ids;
    } catch (e: any) {
      error = e.message ?? 'Failed to load inbox';
    } finally {
      loading = false;
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) {
      page = 0;
      await loadInbox();
      return;
    }
    searching = true;
    error = '';
    try {
      const result = await messageCenterService.search(searchQuery.trim(), userId);
      messages = result.messages;
      total = result.total;
      page = 0;
    } catch (e: any) {
      error = e.message ?? 'Search failed';
    } finally {
      searching = false;
    }
  }

  async function selectCategory(cat: Category | 'All') {
    activeCategory = cat;
    page = 0;
    searchQuery = '';
    await loadInbox();
  }

  async function goToPage(p: number) {
    page = p;
    await loadInbox();
  }

  function handleMessageClick(id: string) {
    navigate(`/messages/${id}`);
  }

  function formatDate(ts: number | null): string {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function categoryColor(cat: Category): string {
    switch (cat) {
      case 'Announcements': return '#2563eb';
      case 'Registration': return '#059669';
      case 'Billing': return '#d97706';
      case 'Tasks': return '#7c3aed';
      default: return '#6b7280';
    }
  }
</script>

<div class="page">
  <div class="header">
    <h2>Message Center</h2>
    {#if unreadCount > 0}
      <span class="unread-badge">{unreadCount} unread</span>
    {/if}
  </div>

  <div class="search-bar">
    <input
      type="text"
      placeholder="Search messages..."
      bind:value={searchQuery}
      onkeydown={(e) => { if (e.key === 'Enter') handleSearch(); }}
    />
    <button onclick={handleSearch} disabled={searching}>
      {searching ? 'Searching...' : 'Search'}
    </button>
  </div>

  <div class="tabs">
    <button
      class="tab"
      class:active={activeCategory === 'All'}
      onclick={() => selectCategory('All')}
    >All</button>
    {#each CATEGORIES as cat}
      <button
        class="tab"
        class:active={activeCategory === cat}
        onclick={() => selectCategory(cat)}
      >{cat}</button>
    {/each}
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="loading">Loading messages...</div>
  {:else if messages.length === 0}
    <div class="empty">No messages found.</div>
  {:else}
    <ul class="message-list">
      {#each messages as msg}
        <li
          class="message-item"
          class:unread={!readMessageIds.has(msg.message_id)}
          class:pinned={msg.pinned}
          onclick={() => handleMessageClick(msg.message_id)}
        >
          <div class="message-row">
            <div class="message-left">
              {#if msg.pinned}
                <span class="pin-icon" title="Pinned">&#128204;</span>
              {/if}
              {#if !readMessageIds.has(msg.message_id)}
                <span class="unread-dot"></span>
              {/if}
              <span class="message-title">{msg.title}</span>
            </div>
            <div class="message-right">
              <span class="category-badge" style="background-color: {categoryColor(msg.category)}">{msg.category}</span>
              <span class="message-date">{formatDate(msg.published_at)}</span>
            </div>
          </div>
        </li>
      {/each}
    </ul>

    <div class="pagination">
      <button
        disabled={page === 0}
        onclick={() => goToPage(page - 1)}
      >Previous</button>
      <span class="page-info">Page {page + 1} of {totalPages}</span>
      <button
        disabled={page + 1 >= totalPages}
        onclick={() => goToPage(page + 1)}
      >Next</button>
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 800px;
    margin: 0 auto;
    padding: 1.5rem;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .header h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #1e293b;
  }

  .unread-badge {
    background: #ef4444;
    color: #fff;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .search-bar {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .search-bar input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.875rem;
  }

  .search-bar input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .search-bar button {
    padding: 0.5rem 1rem;
    background: #3b82f6;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .search-bar button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1rem;
    border-bottom: 2px solid #e5e7eb;
    padding-bottom: 0;
  }

  .tab {
    padding: 0.5rem 1rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    cursor: pointer;
    font-size: 0.875rem;
    color: #6b7280;
    font-weight: 500;
    transition: color 0.15s, border-color 0.15s;
  }

  .tab:hover {
    color: #1e293b;
  }

  .tab.active {
    color: #3b82f6;
    border-bottom-color: #3b82f6;
  }

  .error {
    padding: 0.75rem 1rem;
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .loading,
  .empty {
    text-align: center;
    padding: 2rem;
    color: #6b7280;
    font-size: 0.9rem;
  }

  .message-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .message-item {
    padding: 0.75rem 1rem;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.15s, box-shadow 0.15s;
    background: #fff;
  }

  .message-item:hover {
    background: #f8fafc;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }

  .message-item.unread {
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .message-item.pinned {
    border-left: 3px solid #f59e0b;
  }

  .message-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  .message-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .pin-icon {
    font-size: 0.85rem;
    flex-shrink: 0;
  }

  .unread-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #3b82f6;
    flex-shrink: 0;
  }

  .message-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: #1e293b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .unread .message-title {
    font-weight: 600;
  }

  .message-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  .category-badge {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    color: #fff;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .message-date {
    font-size: 0.8rem;
    color: #6b7280;
    white-space: nowrap;
  }

  .pagination {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 1rem;
    margin-top: 1.25rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  .pagination button {
    padding: 0.4rem 0.85rem;
    background: #fff;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
    color: #374151;
    font-weight: 500;
  }

  .pagination button:hover:not(:disabled) {
    background: #f3f4f6;
  }

  .pagination button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .page-info {
    font-size: 0.8rem;
    color: #6b7280;
  }
</style>
