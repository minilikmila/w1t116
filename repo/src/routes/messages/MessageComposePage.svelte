<script lang="ts">
  import { onMount } from 'svelte';
  import { messageCenterService } from '../../lib/services/messageCenterService';
  import { rbacService } from '../../lib/services/rbacService';
  import { navigate } from '../../lib/utils/router';
  import type { Message, MessageInput, Role } from '../../lib/types';

  type Category = Message['category'];
  const CATEGORIES: Category[] = ['Announcements', 'Registration', 'Billing', 'Tasks'];
  const TARGET_ROLES: Role[] = ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT'];
  const SCOPES: Message['target_org_scope'][] = ['all', 'department', 'program'];

  let title = $state('');
  let body = $state('');
  let category = $state<Category>('Announcements');
  let targetRoles = $state<Record<Role, boolean>>({
    SYSTEM_ADMIN: false,
    OPS_COORDINATOR: false,
    INSTRUCTOR: false,
    PARTICIPANT: false,
  });
  let targetOrgScope = $state<Message['target_org_scope']>('all');
  let targetOrgUnits = $state('');
  let scheduleDateTime = $state('');
  let pinned = $state(false);

  let loading = $state(false);
  let error = $state('');
  let success = $state('');
  let permitted = $state(false);

  onMount(() => {
    try {
      const session = rbacService.getCurrentSession();
      permitted = ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR'].includes(session.role);
    } catch {
      permitted = false;
    }
  });

  function getSelectedRoles(): Role[] {
    return TARGET_ROLES.filter((r) => targetRoles[r]);
  }

  function getOrgUnits(): string[] {
    return targetOrgUnits
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function buildInput(): MessageInput {
    return {
      title: title.trim(),
      body: body.trim(),
      category,
      target_roles: getSelectedRoles(),
      target_org_scope: targetOrgScope,
      target_org_units: getOrgUnits(),
    };
  }

  function validate(): string | null {
    if (!title.trim()) return 'Title is required.';
    if (!body.trim()) return 'Body is required.';
    return null;
  }

  async function handleSaveDraft() {
    const validationError = validate();
    if (validationError) { error = validationError; return; }
    loading = true;
    error = '';
    success = '';
    try {
      await messageCenterService.compose(buildInput());
      success = 'Draft saved successfully.';
      setTimeout(() => navigate('/messages'), 1200);
    } catch (e: any) {
      error = e.message ?? 'Failed to save draft.';
    } finally {
      loading = false;
    }
  }

  async function handlePublishNow() {
    const validationError = validate();
    if (validationError) { error = validationError; return; }
    loading = true;
    error = '';
    success = '';
    try {
      const msg = await messageCenterService.compose(buildInput());
      await messageCenterService.publish(msg.message_id);
      if (pinned) {
        await messageCenterService.pin(msg.message_id, true);
      }
      success = 'Message published successfully.';
      setTimeout(() => navigate('/messages'), 1200);
    } catch (e: any) {
      error = e.message ?? 'Failed to publish message.';
    } finally {
      loading = false;
    }
  }

  async function handleSchedule() {
    const validationError = validate();
    if (validationError) { error = validationError; return; }
    if (!scheduleDateTime) {
      error = 'Please select a schedule date and time.';
      return;
    }
    loading = true;
    error = '';
    success = '';
    try {
      const timestamp = new Date(scheduleDateTime).getTime();
      const msg = await messageCenterService.compose(buildInput());
      await messageCenterService.schedule(msg.message_id, timestamp);
      if (pinned) {
        await messageCenterService.pin(msg.message_id, true);
      }
      success = 'Message scheduled successfully.';
      setTimeout(() => navigate('/messages'), 1200);
    } catch (e: any) {
      error = e.message ?? 'Failed to schedule message.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="page">
  <div class="header">
    <button class="back-btn" onclick={() => navigate('/messages')}>&larr; Back</button>
    <h2>Compose Message</h2>
  </div>

  {#if !permitted}
    <div class="error">You do not have permission to compose messages.</div>
  {:else}
    {#if error}
      <div class="error">{error}</div>
    {/if}
    {#if success}
      <div class="success">{success}</div>
    {/if}

    <form class="compose-form" onsubmit={(e) => { e.preventDefault(); }}>
      <div class="form-group">
        <label for="msg-title">Title</label>
        <input id="msg-title" type="text" bind:value={title} placeholder="Message title" />
      </div>

      <div class="form-group">
        <label for="msg-body">Body</label>
        <textarea id="msg-body" bind:value={body} rows="6" placeholder="Message body"></textarea>
      </div>

      <div class="form-group">
        <label for="msg-category">Category</label>
        <select id="msg-category" bind:value={category}>
          {#each CATEGORIES as cat}
            <option value={cat}>{cat}</option>
          {/each}
        </select>
      </div>

      <div class="form-group">
        <label>Target Roles</label>
        <div class="checkbox-group">
          {#each TARGET_ROLES as role}
            <label class="checkbox-label">
              <input type="checkbox" bind:checked={targetRoles[role]} />
              {role}
            </label>
          {/each}
        </div>
      </div>

      <div class="form-group">
        <label for="msg-scope">Target Org Scope</label>
        <select id="msg-scope" bind:value={targetOrgScope}>
          {#each SCOPES as scope}
            <option value={scope}>{scope}</option>
          {/each}
        </select>
      </div>

      <div class="form-group">
        <label for="msg-org-units">Target Org Units</label>
        <input
          id="msg-org-units"
          type="text"
          bind:value={targetOrgUnits}
          placeholder="Comma-separated, e.g. dept-a, prog-b"
        />
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="msg-schedule">Schedule (optional)</label>
          <input id="msg-schedule" type="datetime-local" bind:value={scheduleDateTime} />
        </div>

        <div class="form-group toggle-group">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={pinned} />
            Pin message
          </label>
        </div>
      </div>

      <div class="actions">
        <button
          type="button"
          class="btn btn-secondary"
          onclick={handleSaveDraft}
          disabled={loading}
        >Save Draft</button>
        <button
          type="button"
          class="btn btn-primary"
          onclick={handlePublishNow}
          disabled={loading}
        >Publish Now</button>
        <button
          type="button"
          class="btn btn-schedule"
          onclick={handleSchedule}
          disabled={loading || !scheduleDateTime}
        >Schedule</button>
      </div>
    </form>
  {/if}
</div>

<style>
  .page {
    max-width: 700px;
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

  .compose-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .form-group label {
    font-size: 0.8rem;
    font-weight: 600;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .form-group input[type='text'],
  .form-group input[type='datetime-local'],
  .form-group textarea,
  .form-group select {
    padding: 0.5rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.875rem;
    font-family: inherit;
    color: #1e293b;
    background: #fff;
  }

  .form-group input:focus,
  .form-group textarea:focus,
  .form-group select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .form-group textarea {
    resize: vertical;
    min-height: 100px;
  }

  .checkbox-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding-top: 0.25rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    font-weight: 400;
    color: #374151;
    cursor: pointer;
    text-transform: none;
    letter-spacing: 0;
  }

  .checkbox-label input[type='checkbox'] {
    accent-color: #3b82f6;
    width: 16px;
    height: 16px;
  }

  .form-row {
    display: flex;
    gap: 1.5rem;
    align-items: flex-end;
  }

  .toggle-group {
    justify-content: flex-end;
    padding-bottom: 0.35rem;
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
  }

  .btn {
    padding: 0.55rem 1.25rem;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #d1d5db;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #e5e7eb;
  }

  .btn-primary {
    background: #3b82f6;
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-schedule {
    background: #7c3aed;
    color: #fff;
  }

  .btn-schedule:hover:not(:disabled) {
    background: #6d28d9;
  }
</style>
