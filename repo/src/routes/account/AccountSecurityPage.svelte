<script lang="ts">
  import { authStore } from '../../lib/stores';
  import { addNotification } from '../../lib/stores';
  import { authService } from '../../lib/services/authService';
  import { idbAccessLayer } from '../../lib/services/idbAccessLayer';
  import type { User } from '../../lib/types';

  // Password change state
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let changingPassword = $state(false);

  // Encryption state
  let encryptionEnabled = $state(false);
  let encryptionPassword = $state('');
  let togglingEncryption = $state(false);
  let loadingEncryption = $state(true);

  // Feedback
  let passwordFeedback: { type: 'success' | 'error'; message: string } | null = $state(null);
  let encryptionFeedback: { type: 'success' | 'error'; message: string } | null = $state(null);

  let passwordsMatch = $derived(newPassword === confirmPassword);
  let canSubmitPassword = $derived(
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    passwordsMatch &&
    !changingPassword
  );

  async function loadEncryptionStatus(): Promise<void> {
    loadingEncryption = true;
    try {
      const session = $authStore;
      if (session) {
        const user = await idbAccessLayer.get<User>('users', session.user_id);
        encryptionEnabled = user?.encryption_enabled ?? false;
      }
    } catch {
      encryptionEnabled = false;
    } finally {
      loadingEncryption = false;
    }
  }

  async function handleChangePassword(e: Event): Promise<void> {
    e.preventDefault();
    passwordFeedback = null;

    if (!passwordsMatch) {
      passwordFeedback = { type: 'error', message: 'New passwords do not match.' };
      return;
    }

    if (newPassword.length < 4) {
      passwordFeedback = { type: 'error', message: 'New password must be at least 4 characters.' };
      return;
    }

    const session = $authStore;
    if (!session) return;

    changingPassword = true;
    try {
      await authService.changePassword(session.user_id, currentPassword, newPassword);
      passwordFeedback = { type: 'success', message: 'Password changed successfully.' };
      addNotification('Password changed successfully.', 'success');
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
    } catch (err: any) {
      passwordFeedback = { type: 'error', message: err.message || 'Failed to change password.' };
    } finally {
      changingPassword = false;
    }
  }

  async function handleToggleEncryption(e: Event): Promise<void> {
    e.preventDefault();
    encryptionFeedback = null;

    const session = $authStore;
    if (!session) return;

    if (encryptionPassword.length === 0) {
      encryptionFeedback = { type: 'error', message: 'Password is required to change encryption settings.' };
      return;
    }

    togglingEncryption = true;
    try {
      if (encryptionEnabled) {
        await authService.disableEncryption(session.user_id, encryptionPassword);
        encryptionEnabled = false;
        encryptionFeedback = { type: 'success', message: 'At-rest encryption disabled.' };
        addNotification('Encryption disabled.', 'info');
      } else {
        await authService.enableEncryption(session.user_id, encryptionPassword);
        encryptionEnabled = true;
        encryptionFeedback = { type: 'success', message: 'At-rest encryption enabled.' };
        addNotification('Encryption enabled.', 'success');
      }
      encryptionPassword = '';
    } catch (err: any) {
      encryptionFeedback = { type: 'error', message: err.message || 'Failed to toggle encryption.' };
    } finally {
      togglingEncryption = false;
    }
  }

  loadEncryptionStatus();
</script>

<div class="page">
  <h2>Account Security</h2>
  <p class="subtitle">Manage your password and data encryption settings.</p>

  <!-- Password Change Section -->
  <section class="section">
    <h3>Change Password</h3>

    {#if passwordFeedback}
      <div class="feedback {passwordFeedback.type}">{passwordFeedback.message}</div>
    {/if}

    <form onsubmit={handleChangePassword}>
      <label class="field">
        <span class="label-text">Current Password</span>
        <input
          type="password"
          bind:value={currentPassword}
          autocomplete="current-password"
        />
      </label>

      <label class="field">
        <span class="label-text">New Password</span>
        <input
          type="password"
          bind:value={newPassword}
          autocomplete="new-password"
        />
      </label>

      <label class="field">
        <span class="label-text">Confirm New Password</span>
        <input
          type="password"
          bind:value={confirmPassword}
          autocomplete="new-password"
        />
        {#if confirmPassword.length > 0 && !passwordsMatch}
          <span class="field-error">Passwords do not match.</span>
        {/if}
      </label>

      <div class="actions">
        <button type="submit" disabled={!canSubmitPassword}>
          {changingPassword ? 'Changing...' : 'Change Password'}
        </button>
      </div>
    </form>
  </section>

  <!-- Encryption Section -->
  <section class="section">
    <h3>At-Rest Encryption</h3>
    <p class="description">
      When enabled, your personal data is encrypted in the browser database.
      You must re-enter your password each time you log in to decrypt your data.
    </p>

    {#if encryptionFeedback}
      <div class="feedback {encryptionFeedback.type}">{encryptionFeedback.message}</div>
    {/if}

    {#if loadingEncryption}
      <p class="loading">Loading encryption status...</p>
    {:else}
      <div class="status-row">
        <span class="status-label">Status:</span>
        <span class="status-value" class:enabled={encryptionEnabled} class:disabled={!encryptionEnabled}>
          {encryptionEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      <form onsubmit={handleToggleEncryption}>
        <label class="field">
          <span class="label-text">Confirm Password</span>
          <input
            type="password"
            bind:value={encryptionPassword}
            autocomplete="current-password"
            placeholder="Enter your password to confirm"
          />
        </label>

        <div class="actions">
          <button
            type="submit"
            disabled={encryptionPassword.length === 0 || togglingEncryption}
            class:danger={encryptionEnabled}
          >
            {#if togglingEncryption}
              {encryptionEnabled ? 'Disabling...' : 'Enabling...'}
            {:else}
              {encryptionEnabled ? 'Disable Encryption' : 'Enable Encryption'}
            {/if}
          </button>
        </div>
      </form>
    {/if}
  </section>
</div>

<style>
  .page {
    max-width: 600px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  h2 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
  }

  .subtitle {
    color: #555;
    margin: 0 0 1.5rem;
  }

  h3 {
    margin: 0 0 0.75rem;
    font-size: 1.15rem;
    color: #2c3e50;
  }

  .section {
    margin-bottom: 2rem;
    padding: 1.25rem;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #fafbfc;
  }

  .description {
    font-size: 0.875rem;
    color: #666;
    margin: 0 0 1rem;
    line-height: 1.5;
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

  .loading {
    color: #666;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }

  .label-text {
    font-size: 0.85rem;
    font-weight: 600;
    color: #333;
  }

  input[type="password"] {
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  input[type="password"]:focus {
    outline: none;
    border-color: #4a90d9;
    box-shadow: 0 0 0 2px rgba(74, 144, 217, 0.2);
  }

  .field-error {
    font-size: 0.8rem;
    color: #dc2626;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  .status-label {
    font-weight: 600;
    color: #333;
  }

  .status-value.enabled {
    color: #16a34a;
    font-weight: 600;
  }

  .status-value.disabled {
    color: #6b7280;
  }

  .actions {
    margin-top: 1rem;
  }

  button {
    padding: 0.6rem 1.5rem;
    background: #4a90d9;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 0.9rem;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button:hover:not(:disabled) {
    background: #357abd;
  }

  button.danger {
    background: #dc2626;
  }

  button.danger:hover:not(:disabled) {
    background: #b91c1c;
  }
</style>
