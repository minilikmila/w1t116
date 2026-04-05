<script lang="ts">
  import { authService } from '../../lib/services/authService';
  import { idbAccessLayer } from '../../lib/services/idbAccessLayer';
  import type { User, Role } from '../../lib/types';
  import { ROLES } from '../../lib/types';

  let users: User[] = $state([]);
  let loading: boolean = $state(true);
  let feedback: { type: 'success' | 'error'; message: string } | null = $state(null);
  let showCreateForm: boolean = $state(false);

  let newUsername: string = $state('');
  let newPassword: string = $state('');
  let newRole: Role = $state('PARTICIPANT');
  let newOrgUnit: string = $state('');
  let creating: boolean = $state(false);

  async function loadUsers(): Promise<void> {
    loading = true;
    feedback = null;
    try {
      users = await idbAccessLayer.getAll<User>('users');
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to load users' };
    } finally {
      loading = false;
    }
  }

  async function createUser(): Promise<void> {
    creating = true;
    feedback = null;
    try {
      await authService.createUser({
        username: newUsername,
        password: newPassword,
        role: newRole,
        org_unit: newOrgUnit,
      });
      resetForm();
      await loadUsers();
      feedback = { type: 'success', message: 'User created successfully.' };
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to create user' };
    } finally {
      creating = false;
    }
  }

  function resetForm(): void {
    newUsername = '';
    newPassword = '';
    newRole = 'PARTICIPANT';
    newOrgUnit = '';
    showCreateForm = false;
  }

  loadUsers();
</script>

<div class="page">
  <h2>User Management</h2>

  {#if feedback}
    <div class="feedback {feedback.type}">{feedback.message}</div>
  {/if}

  <div class="toolbar">
    <button class="btn-primary" onclick={() => { showCreateForm = !showCreateForm; }}>
      {showCreateForm ? 'Cancel' : 'Create User'}
    </button>
  </div>

  {#if showCreateForm}
    <form class="create-form" onsubmit={(e) => { e.preventDefault(); createUser(); }}>
      <h3>New User</h3>
      <label class="field">
        <span>Username</span>
        <input type="text" bind:value={newUsername} required placeholder="Enter username" />
      </label>
      <label class="field">
        <span>Password</span>
        <input type="password" bind:value={newPassword} required placeholder="Enter password" />
      </label>
      <label class="field">
        <span>Role</span>
        <select bind:value={newRole}>
          {#each ROLES as role}
            <option value={role}>{role}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>Org Unit</span>
        <input type="text" bind:value={newOrgUnit} required placeholder="e.g. dept-a" />
      </label>
      <button type="submit" class="btn-primary" disabled={creating}>
        {creating ? 'Creating...' : 'Create'}
      </button>
    </form>
  {/if}

  {#if loading}
    <p class="loading">Loading users...</p>
  {:else if users.length === 0}
    <p>No users found.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Org Unit</th>
          </tr>
        </thead>
        <tbody>
          {#each users as user (user.user_id)}
            <tr>
              <td>{user.username}</td>
              <td><span class="role-badge">{user.role}</span></td>
              <td>{user.org_unit}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 800px;
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

  .role-badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    background: #e9ecef;
    border-radius: 3px;
    font-size: 0.8rem;
    font-weight: 600;
    color: #495057;
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
</style>
