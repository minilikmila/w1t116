<script lang="ts">
  import { onMount } from 'svelte';
  import { todoReminderService } from '../../lib/services/todoReminderService';
  import { rbacService } from '../../lib/services/rbacService';
  import type { Reminder, ReminderInput, SendLog } from '../../lib/types';

  let reminders: Reminder[] = $state([]);
  let loading = $state(true);
  let error = $state('');

  // Create form state
  let templateText = $state('');
  let triggerType: 'event' | 'scheduled' = $state('event');
  let triggerTime = $state('');
  let linkedEntityType = $state('');
  let linkedEntityId = $state('');
  let creating = $state(false);

  // DND config state
  let dndStart = $state('22:00');
  let dndEnd = $state('07:00');
  let dndActive = $state(false);

  // Send logs state
  let expandedLogs: Record<string, SendLog[]> = $state({});
  let loadingLogs: Record<string, boolean> = $state({});

  let templatePreview = $derived(
    templateText
      .replace(/\{\{room_name\}\}/g, '[Room Name]')
      .replace(/\{\{start_time\}\}/g, '[Start Time]')
      .replace(/\{\{coordinator\}\}/g, '[Coordinator]')
      .replace(/\{\{\w+\}\}/g, '[Unknown]')
  );

  let pendingReminders = $derived(reminders.filter((r) => r.status === 'pending'));

  async function loadReminders() {
    loading = true;
    error = '';
    try {
      const session = rbacService.getCurrentSession();
      reminders = await todoReminderService.getRemindersForUser(session.user_id);
    } catch (e: any) {
      error = e.message ?? 'Failed to load reminders';
    } finally {
      loading = false;
    }
  }

  function loadDndConfig() {
    try {
      const raw = localStorage.getItem('dnd_config');
      if (raw) {
        const config = JSON.parse(raw);
        dndStart = config.start ?? '22:00';
        dndEnd = config.end ?? '07:00';
      }
    } catch {
      // use defaults
    }
    dndActive = todoReminderService.isDndActive();
  }

  function saveDndConfig() {
    const config = { start: dndStart, end: dndEnd };
    localStorage.setItem('dnd_config', JSON.stringify(config));
    dndActive = todoReminderService.isDndActive();
  }

  async function handleCreate() {
    creating = true;
    error = '';
    try {
      const session = rbacService.getCurrentSession();
      const input: ReminderInput = {
        user_id: session.user_id,
        template: templateText,
        trigger_type: triggerType,
      };
      if (triggerType === 'scheduled' && triggerTime) {
        input.trigger_time = new Date(triggerTime).getTime();
      }
      if (linkedEntityType) {
        input.linked_entity_type = linkedEntityType;
      }
      if (linkedEntityId) {
        input.linked_entity_id = linkedEntityId;
      }
      await todoReminderService.createReminder(input);
      templateText = '';
      triggerType = 'event';
      triggerTime = '';
      linkedEntityType = '';
      linkedEntityId = '';
      await loadReminders();
    } catch (e: any) {
      error = e.message ?? 'Failed to create reminder';
    } finally {
      creating = false;
    }
  }

  async function handleCancel(id: string) {
    try {
      await todoReminderService.cancelReminder(id);
      await loadReminders();
    } catch (e: any) {
      error = e.message ?? 'Failed to cancel reminder';
    }
  }

  async function toggleLogs(reminderId: string) {
    if (expandedLogs[reminderId]) {
      const next = { ...expandedLogs };
      delete next[reminderId];
      expandedLogs = next;
      return;
    }
    loadingLogs = { ...loadingLogs, [reminderId]: true };
    try {
      const logs = await todoReminderService.getSendLogs(reminderId);
      expandedLogs = { ...expandedLogs, [reminderId]: logs };
    } catch {
      // ignore
    } finally {
      loadingLogs = { ...loadingLogs, [reminderId]: false };
    }
  }

  function formatDate(ts: number | null): string {
    if (ts === null) return '-';
    return new Date(ts).toLocaleString();
  }

  onMount(() => {
    loadDndConfig();
    loadReminders();
  });
</script>

<div class="page">
  <h2>To-Do Center</h2>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <!-- DND Configuration -->
  <section class="section">
    <h3>Do Not Disturb</h3>
    <div class="dnd-status" class:dnd-active={dndActive}>
      Status: {dndActive ? 'Active' : 'Inactive'}
    </div>
    <div class="dnd-form">
      <label>
        Start
        <input type="time" bind:value={dndStart} />
      </label>
      <label>
        End
        <input type="time" bind:value={dndEnd} />
      </label>
      <button class="btn btn-secondary" onclick={saveDndConfig}>Save DND</button>
    </div>
  </section>

  <!-- Create Reminder -->
  <section class="section">
    <h3>Create Reminder</h3>
    <form class="create-form" onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
      <label>
        Template Text
        <textarea rows="3" bind:value={templateText} placeholder="e.g. Session in {{room_name}} starts at {{start_time}}"></textarea>
      </label>
      {#if templateText}
        <div class="preview">
          <strong>Preview:</strong> {templatePreview}
        </div>
      {/if}
      <div class="form-row">
        <label>
          Trigger Type
          <select bind:value={triggerType}>
            <option value="event">Event</option>
            <option value="scheduled">Scheduled</option>
          </select>
        </label>
        {#if triggerType === 'scheduled'}
          <label>
            Trigger Time
            <input type="datetime-local" bind:value={triggerTime} />
          </label>
        {/if}
      </div>
      <div class="form-row">
        <label>
          Linked Entity Type
          <input type="text" bind:value={linkedEntityType} placeholder="e.g. room, booking, session" />
        </label>
        <label>
          Linked Entity ID
          <input type="text" bind:value={linkedEntityId} placeholder="Entity ID" />
        </label>
      </div>
      <button class="btn btn-primary" type="submit" disabled={creating || !templateText}>
        {creating ? 'Creating...' : 'Create Reminder'}
      </button>
    </form>
  </section>

  <!-- Reminders Table -->
  <section class="section">
    <h3>Reminders</h3>
    {#if loading}
      <p class="loading">Loading reminders...</p>
    {:else if reminders.length === 0}
      <p class="empty">No reminders found.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Template</th>
              <th>Status</th>
              <th>Trigger Type</th>
              <th>Fire At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each reminders as reminder (reminder.reminder_id)}
              <tr>
                <td class="template-cell">{reminder.resolved_text ?? reminder.template}</td>
                <td>
                  <span class="status-badge status-{reminder.status}">{reminder.status}</span>
                </td>
                <td>{reminder.trigger_type}</td>
                <td>{formatDate(reminder.fire_at)}</td>
                <td class="actions-cell">
                  {#if reminder.status === 'pending'}
                    <button class="btn btn-danger btn-sm" onclick={() => handleCancel(reminder.reminder_id)}>Cancel</button>
                  {/if}
                  <button class="btn btn-secondary btn-sm" onclick={() => toggleLogs(reminder.reminder_id)}>
                    {expandedLogs[reminder.reminder_id] ? 'Hide Logs' : 'Logs'}
                  </button>
                </td>
              </tr>
              {#if expandedLogs[reminder.reminder_id]}
                <tr class="logs-row">
                  <td colspan="5">
                    {#if loadingLogs[reminder.reminder_id]}
                      <p class="loading">Loading logs...</p>
                    {:else if expandedLogs[reminder.reminder_id].length === 0}
                      <p class="empty">No send logs.</p>
                    {:else}
                      <table class="logs-table">
                        <thead>
                          <tr>
                            <th>Sent At</th>
                            <th>Delivery Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each expandedLogs[reminder.reminder_id] as log (log.log_id)}
                            <tr>
                              <td>{formatDate(log.sent_at)}</td>
                              <td>{log.delivery_status}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 1.5rem;
    font-family: system-ui, -apple-system, sans-serif;
  }

  h2 {
    margin-bottom: 1.5rem;
    font-size: 1.5rem;
    color: #1a1a2e;
  }

  h3 {
    margin-bottom: 0.75rem;
    font-size: 1.15rem;
    color: #16213e;
  }

  .section {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .error-banner {
    background: #fee;
    color: #c00;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    border: 1px solid #fcc;
  }

  .loading,
  .empty {
    color: #888;
    font-style: italic;
  }

  /* DND */
  .dnd-status {
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    background: #e8f5e9;
    color: #2e7d32;
    font-weight: 600;
    margin-bottom: 0.75rem;
    display: inline-block;
  }

  .dnd-status.dnd-active {
    background: #fff3e0;
    color: #e65100;
  }

  .dnd-form {
    display: flex;
    gap: 1rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  /* Form */
  .create-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .form-row {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .form-row label {
    flex: 1;
    min-width: 180px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: #444;
  }

  input,
  select,
  textarea {
    padding: 0.5rem 0.625rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 0.875rem;
    font-family: inherit;
  }

  textarea {
    resize: vertical;
  }

  .preview {
    background: #f5f5ff;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.85rem;
    color: #555;
    border: 1px dashed #bbb;
  }

  /* Buttons */
  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #1a73e8;
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #1565c0;
  }

  .btn-secondary {
    background: #e0e0e0;
    color: #333;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #bdbdbd;
  }

  .btn-danger {
    background: #e53935;
    color: #fff;
  }

  .btn-danger:hover:not(:disabled) {
    background: #c62828;
  }

  .btn-sm {
    padding: 0.3rem 0.6rem;
    font-size: 0.8rem;
  }

  /* Table */
  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    text-align: left;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #eee;
    font-size: 0.875rem;
  }

  th {
    background: #f9f9f9;
    font-weight: 600;
    color: #555;
  }

  .template-cell {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions-cell {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  /* Status badges */
  .status-badge {
    padding: 0.2rem 0.5rem;
    border-radius: 10px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: capitalize;
  }

  .status-pending {
    background: #fff9c4;
    color: #f9a825;
  }

  .status-delivered {
    background: #c8e6c9;
    color: #2e7d32;
  }

  .status-queued {
    background: #bbdefb;
    color: #1565c0;
  }

  .status-cancelled {
    background: #ffcdd2;
    color: #c62828;
  }

  /* Logs */
  .logs-row td {
    background: #fafafa;
    padding: 0.5rem 1rem;
  }

  .logs-table {
    width: 100%;
    margin-top: 0.25rem;
  }

  .logs-table th {
    background: #f0f0f0;
  }
</style>
