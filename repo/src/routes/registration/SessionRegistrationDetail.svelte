<script lang="ts">
  import { onMount } from 'svelte';
  import { registrationService } from '../../lib/services/registrationService';
  import { rbacService } from '../../lib/services/rbacService';
  import { idbAccessLayer } from '../../lib/services/idbAccessLayer';
  import RetryDrawer from '../../lib/components/RetryDrawer.svelte';
  import type { SessionRecord, Registration } from '../../lib/types';
  import { RateLimitError } from '../../lib/types';

  let { params }: { params: { sessionId: string } } = $props();

  let session = $state<SessionRecord | null>(null);
  let allSessions = $state<SessionRecord[]>([]);
  let myRegistrations = $state<Registration[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let successMessage = $state<string | null>(null);
  let isParticipant = $state(false);
  let currentUserId = $state('');
  let actionInProgress = $state(false);

  // Swap state
  let showSwapSelector = $state(false);
  let swapTargetSessionId = $state('');

  // Retry drawer state
  let drawerVisible = $state(false);
  let drawerRetryAfter = $state(0);

  let isRegistered = $derived(
    myRegistrations.some(
      (r) => r.session_id === params.sessionId && r.status === 'active'
    )
  );

  let availableSeats = $derived(
    session ? Math.max(0, session.capacity - session.current_enrollment) : 0
  );

  let swappableSessions = $derived(
    allSessions.filter(
      (s) =>
        s.session_id !== params.sessionId &&
        s.status === 'active' &&
        s.capacity - s.current_enrollment > 0
    )
  );

  onMount(async () => {
    try {
      const currentSession = rbacService.getCurrentSession();
      currentUserId = currentSession.user_id;
      isParticipant = currentSession.role === 'PARTICIPANT';

      const [sessionData, sessions, registrations] = await Promise.all([
        idbAccessLayer.get<SessionRecord>('sessions', params.sessionId),
        idbAccessLayer.getAll<SessionRecord>('sessions'),
        isParticipant
          ? registrationService.getRegistrationsForParticipant(currentSession.user_id)
          : Promise.resolve([]),
      ]);

      session = sessionData ?? null;
      allSessions = sessions;
      myRegistrations = registrations;

      if (!session) {
        error = 'Session not found.';
      }
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'Failed to load session details.';
    } finally {
      loading = false;
    }
  });

  function clearMessages(): void {
    error = null;
    successMessage = null;
  }

  async function refreshData(): Promise<void> {
    const [updatedSession, registrations] = await Promise.all([
      idbAccessLayer.get<SessionRecord>('sessions', params.sessionId),
      registrationService.getRegistrationsForParticipant(currentUserId),
    ]);
    session = updatedSession ?? null;
    myRegistrations = registrations;
  }

  function handleError(err: unknown, swapContext: boolean = false): void {
    if (err instanceof RateLimitError) {
      drawerRetryAfter = err.retryAfter;
      drawerVisible = true;
    } else if (err instanceof Error) {
      error = err.message;
      if (swapContext && !err.message.includes('preserved')) {
        error += ' Your original registration has been preserved.';
      }
    } else {
      error = 'An unexpected error occurred.';
    }
  }

  async function handleRegister(): Promise<void> {
    clearMessages();
    actionInProgress = true;
    try {
      const idempotencyKey = crypto.randomUUID();
      await registrationService.add(currentUserId, params.sessionId, idempotencyKey);
      successMessage = 'Successfully registered for this session.';
      await refreshData();
    } catch (err: unknown) {
      handleError(err);
    } finally {
      actionInProgress = false;
    }
  }

  async function handleDrop(): Promise<void> {
    clearMessages();
    actionInProgress = true;
    try {
      const idempotencyKey = crypto.randomUUID();
      await registrationService.drop(currentUserId, params.sessionId, idempotencyKey);
      successMessage = 'Successfully dropped from this session.';
      await refreshData();
    } catch (err: unknown) {
      handleError(err);
    } finally {
      actionInProgress = false;
    }
  }

  async function handleSwap(): Promise<void> {
    if (!swapTargetSessionId) {
      error = 'Please select a session to swap into.';
      return;
    }
    clearMessages();
    actionInProgress = true;
    try {
      const idempotencyKey = crypto.randomUUID();
      await registrationService.swap(
        currentUserId,
        params.sessionId,
        swapTargetSessionId,
        idempotencyKey
      );
      successMessage = 'Successfully swapped to the new session.';
      showSwapSelector = false;
      swapTargetSessionId = '';
      await refreshData();
    } catch (err: unknown) {
      handleError(err, true);
    } finally {
      actionInProgress = false;
    }
  }

  function closeDrawer(): void {
    drawerVisible = false;
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }
</script>

<div class="page">
  <h2>Session Details</h2>

  {#if loading}
    <p class="loading-text">Loading session details...</p>
  {:else if !session && error}
    <p class="error-text">{error}</p>
  {:else if session}
    <div class="session-details">
      <div class="detail-row">
        <span class="detail-label">Title:</span>
        <span class="detail-value">{session.title}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Instructor:</span>
        <span class="detail-value">{session.instructor_id}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Time:</span>
        <span class="detail-value">{formatTime(session.start_time)} - {formatTime(session.end_time)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Capacity:</span>
        <span class="detail-value">{session.capacity}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Available Seats:</span>
        <span class="detail-value">{availableSeats}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Status:</span>
        <span class="status-badge status-{session.status}">{session.status}</span>
      </div>
    </div>

    {#if successMessage}
      <p class="success-text">{successMessage}</p>
    {/if}

    {#if error}
      <p class="error-text">{error}</p>
    {/if}

    {#if isParticipant}
      <div class="actions">
        {#if !isRegistered}
          <button
            class="action-button register-button"
            onclick={handleRegister}
            disabled={actionInProgress || session.status !== 'active' || availableSeats <= 0}
          >
            {actionInProgress ? 'Processing...' : 'Register'}
          </button>
        {:else}
          <button
            class="action-button drop-button"
            onclick={handleDrop}
            disabled={actionInProgress}
          >
            {actionInProgress ? 'Processing...' : 'Drop'}
          </button>

          <button
            class="action-button swap-button"
            onclick={() => { showSwapSelector = !showSwapSelector; }}
            disabled={actionInProgress}
          >
            Swap
          </button>

          {#if showSwapSelector}
            <div class="swap-selector">
              <label for="swap-target">Swap to session:</label>
              <select id="swap-target" bind:value={swapTargetSessionId} disabled={actionInProgress}>
                <option value="">-- Select a session --</option>
                {#each swappableSessions as s (s.session_id)}
                  <option value={s.session_id}>
                    {s.title} ({s.capacity - s.current_enrollment} seats available)
                  </option>
                {/each}
              </select>
              <button
                class="action-button confirm-swap-button"
                onclick={handleSwap}
                disabled={actionInProgress || !swapTargetSessionId}
              >
                {actionInProgress ? 'Processing...' : 'Confirm Swap'}
              </button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  {/if}
</div>

<RetryDrawer visible={drawerVisible} retryAfter={drawerRetryAfter} onClose={closeDrawer} />

<style>
  .page {
    padding: 1.5rem;
  }

  h2 {
    margin-bottom: 1rem;
  }

  .loading-text {
    color: #666;
  }

  .error-text {
    color: #e74c3c;
    margin: 0.75rem 0;
  }

  .success-text {
    color: #28a745;
    margin: 0.75rem 0;
  }

  .session-details {
    background: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .detail-row {
    display: flex;
    gap: 0.75rem;
    padding: 0.4rem 0;
  }

  .detail-label {
    font-weight: 600;
    min-width: 140px;
    color: #555;
  }

  .detail-value {
    color: #222;
  }

  .status-badge {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .status-active {
    background: #d4edda;
    color: #155724;
  }

  .status-cancelled {
    background: #f8d7da;
    color: #721c24;
  }

  .status-completed {
    background: #d1ecf1;
    color: #0c5460;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: flex-start;
  }

  .action-button {
    padding: 0.5rem 1.25rem;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    color: #fff;
  }

  .action-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .register-button {
    background: #28a745;
  }

  .register-button:hover:not(:disabled) {
    background: #218838;
  }

  .drop-button {
    background: #dc3545;
  }

  .drop-button:hover:not(:disabled) {
    background: #c82333;
  }

  .swap-button {
    background: #fd7e14;
  }

  .swap-button:hover:not(:disabled) {
    background: #e8690b;
  }

  .confirm-swap-button {
    background: #007bff;
  }

  .confirm-swap-button:hover:not(:disabled) {
    background: #0056b3;
  }

  .swap-selector {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    padding: 1rem;
    background: #f0f4ff;
    border: 1px solid #b8d4fe;
    border-radius: 6px;
    margin-top: 0.5rem;
  }

  .swap-selector label {
    font-weight: 600;
    color: #333;
  }

  .swap-selector select {
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 0.9rem;
  }
</style>
