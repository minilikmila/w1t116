<script lang="ts">
  import { featureFlagService } from '../../lib/services/featureFlagService';
  import { rbacService } from '../../lib/services/rbacService';
  import type { FeatureFlag, FlagInput, Role } from '../../lib/types';
  import { ROLES } from '../../lib/types';

  let flags: FeatureFlag[] = $state([]);
  let loading: boolean = $state(true);
  let feedback: { type: 'success' | 'error'; message: string } | null = $state(null);
  let showCreateForm: boolean = $state(false);

  let newFlagId: string = $state('');
  let newDisplayName: string = $state('');
  let newDescription: string = $state('');
  let newEnabled: boolean = $state(false);
  let newTargetRoles: Role[] = $state([]);
  let newTargetOrgUnits: string = $state('');

  function loadFlags(): void {
    loading = true;
    feedback = null;
    try {
      flags = featureFlagService.getAllFlags();
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to load flags' };
    } finally {
      loading = false;
    }
  }

  function toggleRole(role: Role): void {
    if (newTargetRoles.includes(role)) {
      newTargetRoles = newTargetRoles.filter((r) => r !== role);
    } else {
      newTargetRoles = [...newTargetRoles, role];
    }
  }

  async function toggleFlagEnabled(flag: FeatureFlag): Promise<void> {
    feedback = null;
    try {
      await featureFlagService.updateFlag(flag.flag_id, { enabled: !flag.enabled });
      loadFlags();
      feedback = { type: 'success', message: `Flag "${flag.display_name}" ${!flag.enabled ? 'enabled' : 'disabled'}.` };
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to toggle flag' };
    }
  }

  async function createFlag(): Promise<void> {
    feedback = null;
    try {
      const session = rbacService.getCurrentSession();
      const orgUnits = newTargetOrgUnits
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const input: FlagInput = {
        flag_id: newFlagId,
        display_name: newDisplayName,
        description: newDescription,
        enabled: newEnabled,
        target_roles: newTargetRoles,
        target_org_units: orgUnits,
      };

      await featureFlagService.createFlag(input, session.user_id);
      resetForm();
      loadFlags();
      feedback = { type: 'success', message: 'Flag created successfully.' };
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to create flag' };
    }
  }

  async function deleteFlag(flagId: string): Promise<void> {
    feedback = null;
    try {
      await featureFlagService.deleteFlag(flagId);
      loadFlags();
      feedback = { type: 'success', message: 'Flag deleted.' };
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to delete flag' };
    }
  }

  function resetForm(): void {
    newFlagId = '';
    newDisplayName = '';
    newDescription = '';
    newEnabled = false;
    newTargetRoles = [];
    newTargetOrgUnits = '';
    showCreateForm = false;
  }

  loadFlags();
</script>

<div class="page">
  <h2>Feature Flags</h2>

  {#if feedback}
    <div class="feedback {feedback.type}">{feedback.message}</div>
  {/if}

  <div class="toolbar">
    <button class="btn-primary" onclick={() => { showCreateForm = !showCreateForm; }}>
      {showCreateForm ? 'Cancel' : 'Create Flag'}
    </button>
  </div>

  {#if showCreateForm}
    <form class="create-form" onsubmit={(e) => { e.preventDefault(); createFlag(); }}>
      <h3>New Feature Flag</h3>
      <label class="field">
        <span>Flag ID</span>
        <input type="text" bind:value={newFlagId} required placeholder="e.g. dark_mode" />
      </label>
      <label class="field">
        <span>Display Name</span>
        <input type="text" bind:value={newDisplayName} required placeholder="e.g. Dark Mode" />
      </label>
      <label class="field">
        <span>Description</span>
        <input type="text" bind:value={newDescription} placeholder="What does this flag control?" />
      </label>
      <label class="field-inline">
        <input type="checkbox" bind:checked={newEnabled} />
        <span>Enabled</span>
      </label>
      <fieldset class="role-fieldset">
        <legend>Target Roles</legend>
        {#each ROLES as role}
          <label class="field-inline">
            <input
              type="checkbox"
              checked={newTargetRoles.includes(role)}
              onchange={() => toggleRole(role)}
            />
            <span>{role}</span>
          </label>
        {/each}
      </fieldset>
      <label class="field">
        <span>Target Org Units (comma-separated)</span>
        <input type="text" bind:value={newTargetOrgUnits} placeholder="e.g. dept-a, dept-b" />
      </label>
      <button type="submit" class="btn-primary">Create</button>
    </form>
  {/if}

  {#if loading}
    <p class="loading">Loading flags...</p>
  {:else if flags.length === 0}
    <p>No feature flags configured.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Enabled</th>
            <th>Target Roles</th>
            <th>Target Org Units</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each flags as flag (flag.flag_id)}
            <tr>
              <td>
                <strong>{flag.display_name}</strong>
                <div class="sub">{flag.flag_id}</div>
              </td>
              <td>
                <button
                  class="toggle-btn"
                  class:enabled={flag.enabled}
                  onclick={() => toggleFlagEnabled(flag)}
                >
                  {flag.enabled ? 'ON' : 'OFF'}
                </button>
              </td>
              <td>{flag.target_roles.length > 0 ? flag.target_roles.join(', ') : 'All'}</td>
              <td>{flag.target_org_units.length > 0 ? flag.target_org_units.join(', ') : 'All'}</td>
              <td>
                <button class="btn-danger" onclick={() => deleteFlag(flag.flag_id)}>Delete</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
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

  .create-form h3 {
    margin: 0 0 1rem;
    font-size: 1.1rem;
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

  .field input[type="text"] {
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .field-inline {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
    cursor: pointer;
  }

  .field-inline span {
    font-size: 0.85rem;
  }

  .role-fieldset {
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .role-fieldset legend {
    font-size: 0.85rem;
    font-weight: 600;
    color: #333;
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

  .sub {
    font-size: 0.75rem;
    color: #888;
  }

  .toggle-btn {
    padding: 0.25rem 0.75rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
    background: #f0f0f0;
    color: #666;
  }

  .toggle-btn.enabled {
    background: #28a745;
    color: #fff;
    border-color: #28a745;
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
