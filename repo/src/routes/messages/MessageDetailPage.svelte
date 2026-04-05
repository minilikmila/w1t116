<script lang="ts">
  import { onMount } from 'svelte';
  import { messageCenterService } from '../../lib/services/messageCenterService';
  import { rbacService } from '../../lib/services/rbacService';
  import { navigate } from '../../lib/utils/router';
  import { currentParams } from '../../lib/utils/router';
  import { get } from 'svelte/store';
  import type { Message } from '../../lib/types';

  let message = $state<Message | null>(null);
  let loading = $state(true);
  let error = $state('');
  let actionError = $state('');
  let actionSuccess = $state('');
  let analytics = $state<{ uniqueOpens: number; timeToFirstRead: number | null } | null>(null);
  let canManage = $state(false);
  let retractLoading = $state(false);
  let pinLoading = $state(false);

  onMount(async () => {
    try {
      const params = get(currentParams);
      const id = params.id;
      if (!id) {
        error = 'No message ID provided.';
        loading = false;
        return;
      }

      const session = rbacService.getCurrentSession();
      canManage = rbacService.isPermitted(session.role, 'message:retract');

      const msg = await messageCenterService.getMessage(id);
      if (!msg) {
        error = 'Message not found.';
        loading = false;
        return;
      }
      message = msg;

      // Record read receipt
      await messageCenterService.recordReadReceipt(id, session.user_id);

      // Load analytics if permitted
      if (canManage) {
        analytics = await messageCenterService.getAnalytics(id);
      }
    } catch (e: any) {
      error = e.message ?? 'Failed to load message.';
    } finally {
      loading = false;
    }
  });

  async function handleRetract() {
    if (!message) return;
    retractLoading = true;
    actionError = '';
    actionSuccess = '';
    try {
      await messageCenterService.retract(message.message_id);
      message = { ...message, status: 'retracted' };
      actionSuccess = 'Message retracted.';
    } catch (e: any) {
      actionError = e.message ?? 'Failed to retract.';
    } finally {
      retractLoading = false;
    }
  }

  async function handleTogglePin() {
    if (!message) return;
    pinLoading = true;
    actionError = '';
    actionSuccess = '';
    try {
      const newPinned = !message.pinned;
      await messageCenterService.pin(message.message_id, newPinned);
      message = { ...message, pinned: newPinned };
      actionSuccess = newPinned ? 'Message pinned.' : 'Message unpinned.';
    } catch (e: any) {
      actionError = e.message ?? 'Failed to toggle pin.';
    } finally {
      pinLoading = false;
    }
  }

  function formatDate(ts: number | null): string {
    if (!ts) return 'N/A';
    return new Date(ts).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatDuration(ms: number | null): string {
    if (ms === null) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  function categoryColor(cat: string): string {
    switch (cat) {
      case 'Announcements': return '#2563eb';
      case 'Registration': return '#059669';
      case 'Billing': return '#d97706';
      case 'Tasks': return '#7c3aed';
      default: return '#6b7280';
    }
  }

  function statusColor(status: string): string {
    switch (status) {
      case 'published': return '#16a34a';
      case 'draft': return '#6b7280';
      case 'scheduled': return '#7c3aed';
      case 'retracted': return '#dc2626';
      default: return '#6b7280';
    }
  }
</script>

<div class="page">
  <div class="header">
    <button class="back-btn" onclick={() => navigate('/messages')}>&larr; Back</button>
    <h2>Message Detail</h2>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="loading">Loading message...</div>
  {:else if message}
    {#if actionError}
      <div class="error">{actionError}</div>
    {/if}
    {#if actionSuccess}
      <div class="success">{actionSuccess}</div>
    {/if}

    <article class="message-detail">
      <div class="message-header">
        <h3 class="message-title">{message.title}</h3>
        <div class="meta-row">
          <span class="category-badge" style="background-color: {categoryColor(message.category)}">{message.category}</span>
          <span class="status-badge" style="background-color: {statusColor(message.status)}">{message.status}</span>
          {#if message.pinned}
            <span class="pinned-label">Pinned</span>
          {/if}
        </div>
      </div>

      <div class="message-body">
        <p>{message.body}</p>
      </div>

      <div class="message-meta">
        <div class="meta-item">
          <span class="meta-label">Author</span>
          <span class="meta-value">{message.author_id}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Published</span>
          <span class="meta-value">{formatDate(message.published_at)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Target Roles</span>
          <span class="meta-value">{message.target_roles.length > 0 ? message.target_roles.join(', ') : 'All'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Org Scope</span>
          <span class="meta-value">{message.target_org_scope}</span>
        </div>
        {#if message.target_org_units.length > 0}
          <div class="meta-item">
            <span class="meta-label">Org Units</span>
            <span class="meta-value">{message.target_org_units.join(', ')}</span>
          </div>
        {/if}
      </div>

      {#if canManage}
        <div class="admin-section">
          <h4>Actions</h4>
          <div class="admin-actions">
            {#if message.status !== 'retracted'}
              <button
                class="btn btn-danger"
                onclick={handleRetract}
                disabled={retractLoading}
              >{retractLoading ? 'Retracting...' : 'Retract'}</button>
            {/if}
            <button
              class="btn btn-secondary"
              onclick={handleTogglePin}
              disabled={pinLoading}
            >{pinLoading ? '...' : message.pinned ? 'Unpin' : 'Pin'}</button>
          </div>
        </div>

        {#if analytics}
          <div class="analytics-section">
            <h4>Analytics</h4>
            <div class="analytics-grid">
              <div class="analytics-card">
                <span class="analytics-value">{analytics.uniqueOpens}</span>
                <span class="analytics-label">Unique Opens</span>
              </div>
              <div class="analytics-card">
                <span class="analytics-value">{formatDuration(analytics.timeToFirstRead)}</span>
                <span class="analytics-label">Time to First Read</span>
              </div>
            </div>
          </div>
        {/if}
      {/if}
    </article>
  {/if}
</div>

<style>
  .page {
    max-width: 750px;
    margin: 0 auto;
    padding: 1.5rem;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .header h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #1e293b;
  }

  .back-btn {
    background: none;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
    color: #374151;
    font-size: 0.85rem;
  }

  .back-btn:hover {
    background: #f3f4f6;
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

  .success {
    padding: 0.75rem 1rem;
    background: #f0fdf4;
    color: #16a34a;
    border: 1px solid #bbf7d0;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: #6b7280;
    font-size: 0.9rem;
  }

  .message-detail {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
  }

  .message-header {
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid #f3f4f6;
  }

  .message-title {
    margin: 0 0 0.5rem 0;
    font-size: 1.25rem;
    color: #1e293b;
  }

  .meta-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .category-badge,
  .status-badge {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    color: #fff;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .pinned-label {
    font-size: 0.75rem;
    color: #d97706;
    font-weight: 600;
  }

  .message-body {
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid #f3f4f6;
  }

  .message-body p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.65;
    color: #374151;
    white-space: pre-wrap;
  }

  .message-meta {
    padding: 1rem 1.5rem;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    background: #f9fafb;
  }

  .meta-item {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .meta-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .meta-value {
    font-size: 0.85rem;
    color: #1e293b;
  }

  .admin-section {
    padding: 1rem 1.5rem;
    border-top: 1px solid #e5e7eb;
  }

  .admin-section h4 {
    margin: 0 0 0.65rem 0;
    font-size: 0.85rem;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .admin-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn {
    padding: 0.45rem 1rem;
    border: none;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-danger {
    background: #dc2626;
    color: #fff;
  }

  .btn-danger:hover:not(:disabled) {
    background: #b91c1c;
  }

  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #d1d5db;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #e5e7eb;
  }

  .analytics-section {
    padding: 1rem 1.5rem;
    border-top: 1px solid #e5e7eb;
  }

  .analytics-section h4 {
    margin: 0 0 0.65rem 0;
    font-size: 0.85rem;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .analytics-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  .analytics-card {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .analytics-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1e40af;
  }

  .analytics-label {
    font-size: 0.75rem;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
</style>
