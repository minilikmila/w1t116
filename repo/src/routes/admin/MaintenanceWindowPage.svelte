<script lang="ts">
  import { opsConfigService } from '../../lib/services/opsConfigService';
  import type { MaintenanceWindow, MaintenanceWindowInput, BlacklistRule } from '../../lib/types';

  // --- Maintenance Windows ---
  let windows: MaintenanceWindow[] = $state([]);
  let loadingWindows: boolean = $state(true);

  let showWindowForm: boolean = $state(false);
  let windowRoomId: string = $state('');
  let windowStart: string = $state('');
  let windowEnd: string = $state('');
  let windowDescription: string = $state('');
  let creatingWindow: boolean = $state(false);

  // --- Blacklist Rules ---
  let rules: BlacklistRule[] = $state([]);
  let loadingRules: boolean = $state(true);

  let showRuleForm: boolean = $state(false);
  let ruleTargetType: 'participant' | 'room' = $state('participant');
  let ruleTargetId: string = $state('');
  let ruleReason: string = $state('');
  let creatingRule: boolean = $state(false);

  // --- Shared ---
  let feedback: { type: 'success' | 'error'; message: string } | null = $state(null);

  function formatTimestamp(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  // --- Window operations ---

  async function loadWindows(): Promise<void> {
    loadingWindows = true;
    try {
      windows = await opsConfigService.getMaintenanceWindows();
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to load maintenance windows' };
    } finally {
      loadingWindows = false;
    }
  }

  async function createWindow(): Promise<void> {
    creatingWindow = true;
    feedback = null;
    try {
      const input: MaintenanceWindowInput = {
        room_id: windowRoomId,
        start_time: new Date(windowStart).getTime(),
        end_time: new Date(windowEnd).getTime(),
        description: windowDescription,
      };
      await opsConfigService.createMaintenanceWindow(input);
      resetWindowForm();
      await loadWindows();
      feedback = { type: 'success', message: 'Maintenance window created.' };
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to create maintenance window' };
    } finally {
      creatingWindow = false;
    }
  }

  async function deleteWindow(id: string): Promise<void> {
    feedback = null;
    try {
      await opsConfigService.deleteMaintenanceWindow(id);
      await loadWindows();
      feedback = { type: 'success', message: 'Maintenance window deleted.' };
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to delete maintenance window' };
    }
  }

  function resetWindowForm(): void {
    windowRoomId = '';
    windowStart = '';
    windowEnd = '';
    windowDescription = '';
    showWindowForm = false;
  }

  // --- Blacklist operations ---

  async function loadRules(): Promise<void> {
    loadingRules = true;
    try {
      rules = await opsConfigService.getBlacklistRules();
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to load blacklist rules' };
    } finally {
      loadingRules = false;
    }
  }

  async function createRule(): Promise<void> {
    creatingRule = true;
    feedback = null;
    try {
      await opsConfigService.createBlacklistRule(ruleTargetType, ruleTargetId, ruleReason);
      resetRuleForm();
      await loadRules();
      feedback = { type: 'success', message: 'Blacklist rule created.' };
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to create blacklist rule' };
    } finally {
      creatingRule = false;
    }
  }

  async function deleteRule(id: string): Promise<void> {
    feedback = null;
    try {
      await opsConfigService.deleteBlacklistRule(id);
      await loadRules();
      feedback = { type: 'success', message: 'Blacklist rule deleted.' };
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to delete blacklist rule' };
    }
  }

  function resetRuleForm(): void {
    ruleTargetType = 'participant';
    ruleTargetId = '';
    ruleReason = '';
    showRuleForm = false;
  }

  // --- Init ---
  loadWindows();
  loadRules();
</script>

<div class="page">
  <h2>Maintenance & Blacklist</h2>

  {#if feedback}
    <div class="feedback {feedback.type}">{feedback.message}</div>
  {/if}

  <!-- Maintenance Windows Section -->
  <section class="section">
    <h3>Maintenance Windows</h3>

    <div class="toolbar">
      <button class="btn-primary" onclick={() => { showWindowForm = !showWindowForm; }}>
        {showWindowForm ? 'Cancel' : 'Create Window'}
      </button>
    </div>

    {#if showWindowForm}
      <form class="create-form" onsubmit={(e) => { e.preventDefault(); createWindow(); }}>
        <label class="field">
          <span>Room ID</span>
          <input type="text" bind:value={windowRoomId} required placeholder="e.g. room-101" />
        </label>
        <label class="field">
          <span>Start Time</span>
          <input type="datetime-local" bind:value={windowStart} required />
        </label>
        <label class="field">
          <span>End Time</span>
          <input type="datetime-local" bind:value={windowEnd} required />
        </label>
        <label class="field">
          <span>Description</span>
          <input type="text" bind:value={windowDescription} required placeholder="Reason for maintenance" />
        </label>
        <button type="submit" class="btn-primary" disabled={creatingWindow}>
          {creatingWindow ? 'Creating...' : 'Create'}
        </button>
      </form>
    {/if}

    {#if loadingWindows}
      <p class="loading">Loading maintenance windows...</p>
    {:else if windows.length === 0}
      <p>No maintenance windows scheduled.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Room</th>
              <th>Start Time</th>
              <th>End Time</th>
              <th>Description</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each windows as win (win.window_id)}
              <tr>
                <td>{win.room_id}</td>
                <td>{formatTimestamp(win.start_time)}</td>
                <td>{formatTimestamp(win.end_time)}</td>
                <td>{win.description}</td>
                <td>
                  <button class="btn-danger" onclick={() => deleteWindow(win.window_id)}>Delete</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- Blacklist Rules Section -->
  <section class="section">
    <h3>Blacklist Rules</h3>

    <div class="toolbar">
      <button class="btn-primary" onclick={() => { showRuleForm = !showRuleForm; }}>
        {showRuleForm ? 'Cancel' : 'Create Rule'}
      </button>
    </div>

    {#if showRuleForm}
      <form class="create-form" onsubmit={(e) => { e.preventDefault(); createRule(); }}>
        <label class="field">
          <span>Target Type</span>
          <select bind:value={ruleTargetType}>
            <option value="participant">Participant</option>
            <option value="room">Room</option>
          </select>
        </label>
        <label class="field">
          <span>Target ID</span>
          <input type="text" bind:value={ruleTargetId} required placeholder="ID of participant or room" />
        </label>
        <label class="field">
          <span>Reason</span>
          <input type="text" bind:value={ruleReason} required placeholder="Why is this being blacklisted?" />
        </label>
        <button type="submit" class="btn-primary" disabled={creatingRule}>
          {creatingRule ? 'Creating...' : 'Create'}
        </button>
      </form>
    {/if}

    {#if loadingRules}
      <p class="loading">Loading blacklist rules...</p>
    {:else if rules.length === 0}
      <p>No blacklist rules configured.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Target ID</th>
              <th>Reason</th>
              <th>Created By</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each rules as rule (rule.rule_id)}
              <tr>
                <td><span class="type-badge">{rule.target_type}</span></td>
                <td>{rule.target_id}</td>
                <td>{rule.reason}</td>
                <td>{rule.created_by}</td>
                <td>{formatTimestamp(rule.created_at)}</td>
                <td>
                  <button class="btn-danger" onclick={() => deleteRule(rule.rule_id)}>Delete</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  .page {
    max-width: 950px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  h2 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
  }

  .section {
    margin-bottom: 2.5rem;
  }

  .section h3 {
    margin: 0 0 0.75rem;
    font-size: 1.15rem;
    color: #2c3e50;
    border-bottom: 1px solid #eee;
    padding-bottom: 0.4rem;
  }

  .feedback {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  .feedback.success {
    background: #d4edda;
    color: #155724;
    border: 1px solid #c3e6cb;
  }

  .feedback.error {
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
  }

  .toolbar {
    margin-bottom: 1rem;
  }

  .create-form {
    background: #f9f9f9;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }

  .field span {
    font-size: 0.85rem;
    font-weight: 600;
    color: #333;
  }

  .field input,
  .field select {
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .loading {
    color: #666;
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  th, td {
    text-align: left;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #eee;
  }

  th {
    background: #f5f5f5;
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    color: #555;
  }

  .type-badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    background: #e9ecef;
    border-radius: 3px;
    font-size: 0.8rem;
    font-weight: 600;
    color: #495057;
    text-transform: capitalize;
  }

  .btn-primary {
    padding: 0.5rem 1.25rem;
    background: #4a90d9;
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .btn-primary:hover {
    background: #357abd;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-danger {
    padding: 0.3rem 0.75rem;
    background: #dc3545;
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .btn-danger:hover {
    background: #c82333;
  }
</style>
