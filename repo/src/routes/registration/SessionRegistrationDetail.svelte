<script lang="ts">
  import { onMount } from 'svelte';
  import { registrationService } from '../../lib/services/registrationService';
  import { rbacService } from '../../lib/services/rbacService';
  import { idbAccessLayer } from '../../lib/services/idbAccessLayer';
  import RetryDrawer from '../../lib/components/RetryDrawer.svelte';
  import { navigate } from '../../lib/utils/router';
  import { addNotification } from '../../lib/stores';
  import type { SessionRecord, Registration, User } from '../../lib/types';
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
  let showConfirmation = $state(false);
  let roomName = $state('Unknown');
  // CONSISTENCY FIX: replaced raw instructor_id with human-readable name
  let instructorName = $state('Unknown');
  // CONSISTENCY FIX: edit button visibility based on role + ownership
  let canEdit = $state(false);
  // Edit mode state
  let editMode = $state(false);
  let editTitle = $state('');
  let editCapacity = $state(0);
  let editFee = $state(0);
  let editDateValue = $state('');
  let editStartTime = $state('');
  let editEndTime = $state('');
  let editSubmitting = $state(false);

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

      // Use service-level filtered session query for INSTRUCTOR
      const sessionData = currentSession.role === 'INSTRUCTOR'
        ? await registrationService.getSession(params.sessionId)
        : await idbAccessLayer.get<SessionRecord>('sessions', params.sessionId);

      // Detail view protection for INSTRUCTOR viewing non-owned session
      if (!sessionData && currentSession.role === 'INSTRUCTOR') {
        addNotification('You do not have permission to view this resource', 'error');
        navigate('/registration');
        return;
      }

      session = sessionData ?? null;

      if (!session) {
        error = 'Session not found.';
        loading = false;
        return;
      }

      // Determine edit permission
      canEdit = currentSession.role === 'SYSTEM_ADMIN' ||
        currentSession.role === 'OPS_COORDINATOR' ||
        (currentSession.role === 'INSTRUCTOR' && session.instructor_id === currentSession.user_id);

      // Fetch all sessions for swap and registrations
      const [sessions, registrations, instructor, room] = await Promise.all([
        idbAccessLayer.getAll<SessionRecord>('sessions'),
        isParticipant
          ? registrationService.getRegistrationsForParticipant(currentSession.user_id)
          : Promise.resolve([]),
        idbAccessLayer.get<User>('users', session.instructor_id),
        idbAccessLayer.get<any>('rooms', session.room_id),
      ]);

      allSessions = sessions;
      myRegistrations = registrations;
      instructorName = instructor?.username ?? 'Unknown';
      roomName = room?.name ?? 'Unknown';
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

  async function handleEditSubmit(): Promise<void> {
    if (!session) return;
    error = null;
    successMessage = null;
    editSubmitting = true;
    try {
      const startTs = new Date(`${editDateValue}T${editStartTime}`).getTime();
      const endTs = new Date(`${editDateValue}T${editEndTime}`).getTime();
      if (endTs <= startTs) {
        error = 'End time must be after start time.';
        editSubmitting = false;
        return;
      }
      const updated = {
        ...session,
        title: editTitle.trim(),
        start_time: startTs,
        end_time: endTs,
        capacity: editCapacity,
        fee: editFee,
      };
      const { version } = await idbAccessLayer.put('sessions', updated);
      session = { ...updated, _version: version };
      editMode = false;
      successMessage = 'Session updated successfully.';
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'Failed to update session.';
    } finally {
      editSubmitting = false;
    }
  }
</script>

<div class="page">
  <!-- CONSISTENCY FIX: added back navigation to registration list for all roles -->
  <button class="btn-back" onclick={() => navigate('/registration')}>&larr; Back to Registration</button>

  <h2>Session Details</h2>

  {#if loading}
    <p class="loading-text">Loading session details...</p>
  {:else if !session && error}
    <p class="error-text">{error}</p>
  {:else if session}
    {#if !editMode}
    <div class="session-details">
      <div class="detail-row">
        <span class="detail-label">Title:</span>
        <span class="detail-value">{session.title}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Instructor:</span>
        <!-- CONSISTENCY FIX: replaced raw instructor_id with human-readable name -->
        <span class="detail-value">{instructorName}</span>
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
      <div class="detail-row">
        <span class="detail-label">Location:</span>
        <span class="detail-value">{roomName}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Fee:</span>
        <span class="detail-value fee-value">{(session as any).fee > 0 ? `$${((session as any).fee).toFixed(2)}` : 'Free'}</span>
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
          {#if !showConfirmation}
            <button
              class="action-button register-button"
              onclick={() => { showConfirmation = true; }}
              disabled={session.status !== 'active' || availableSeats <= 0}
            >
              Register
            </button>
          {:else}
            <div class="confirmation-box">
              <h4>Confirm Registration</h4>
              <div class="confirm-summary">
                <div><strong>Session:</strong> {session.title}</div>
                <div><strong>Date:</strong> {formatTime(session.start_time)}</div>
                <div><strong>Location:</strong> {roomName}</div>
                <div><strong>Fee:</strong> {(session as any).fee > 0 ? `$${((session as any).fee).toFixed(2)}` : 'Free'}</div>
              </div>
              {#if (session as any).fee > 0}
                <p class="billing-notice">A bill will be generated for this session. You can view it in your Billing section.</p>
              {/if}
              <div class="confirm-actions">
                <button class="action-button cancel-edit-button" onclick={() => { showConfirmation = false; }}>Cancel</button>
                <button
                  class="action-button register-button"
                  onclick={handleRegister}
                  disabled={actionInProgress}
                >
                  {actionInProgress ? 'Processing...' : 'Confirm Registration'}
                </button>
              </div>
            </div>
          {/if}
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

    <!-- CONSISTENCY FIX: edit button visible only if owner or privileged role -->
    {#if canEdit}
      <div class="actions" style="margin-top: 1rem;">
        <button
          class="action-button edit-button"
          onclick={() => {
            editMode = true;
            editTitle = session?.title ?? '';
            editCapacity = session?.capacity ?? 0;
            editFee = (session as any)?.fee ?? 0;
            const d = new Date(session?.start_time ?? 0);
            editDateValue = d.toISOString().slice(0, 10);
            editStartTime = d.toTimeString().slice(0, 5);
            const e = new Date(session?.end_time ?? 0);
            editEndTime = e.toTimeString().slice(0, 5);
          }}
        >
          Edit Session
        </button>
      </div>
    {/if}
    {:else}
    <!-- Edit mode: reuse session creation form layout -->
    <div class="session-details">
      <h3>Edit Session</h3>
      <form class="edit-form" onsubmit={(e) => { e.preventDefault(); handleEditSubmit(); }}>
        <div class="form-group">
          <label for="edit-title">Title</label>
          <input id="edit-title" type="text" bind:value={editTitle} required />
        </div>
        <div class="form-group">
          <label for="edit-date">Date</label>
          <input id="edit-date" type="date" bind:value={editDateValue} required />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="edit-start">Start Time</label>
            <input id="edit-start" type="time" bind:value={editStartTime} required />
          </div>
          <div class="form-group">
            <label for="edit-end">End Time</label>
            <input id="edit-end" type="time" bind:value={editEndTime} required />
          </div>
        </div>
        <div class="form-group">
          <label for="edit-capacity">Capacity</label>
          <input id="edit-capacity" type="number" bind:value={editCapacity} min="1" required />
        </div>
        <div class="form-group">
          <label for="edit-fee">Session Fee ($)</label>
          <input id="edit-fee" type="number" step="0.01" min="0" bind:value={editFee} />
        </div>
        <div class="edit-actions">
          <button type="button" class="action-button cancel-edit-button" onclick={() => { editMode = false; }}>Cancel</button>
          <button type="submit" class="action-button save-edit-button" disabled={editSubmitting}>
            {editSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
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

  .btn-back {
    background: none;
    border: none;
    color: #4361ee;
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0;
    margin-bottom: 1rem;
    display: inline-block;
  }

  .btn-back:hover {
    text-decoration: underline;
  }

  .edit-button {
    background: #4361ee;
  }

  .edit-button:hover:not(:disabled) {
    background: #3a56d4;
  }

  .edit-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .edit-form h3 {
    margin: 0 0 0.5rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .form-group label {
    font-weight: 600;
    font-size: 0.85rem;
    color: #555;
  }

  .form-group input {
    padding: 0.5rem 0.75rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 0.9rem;
    box-sizing: border-box;
  }

  .form-row {
    display: flex;
    gap: 1rem;
  }

  .form-row .form-group {
    flex: 1;
  }

  .edit-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .cancel-edit-button {
    background: #e9ecef;
    color: #333;
  }

  .cancel-edit-button:hover {
    background: #dee2e6;
  }

  .save-edit-button {
    background: #28a745;
  }

  .save-edit-button:hover:not(:disabled) {
    background: #218838;
  }

  .fee-value {
    font-weight: 600;
    color: #1a1a2e;
  }

  .confirmation-box {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 8px;
    padding: 1.25rem;
    width: 100%;
  }

  .confirmation-box h4 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #0c4a6e;
  }

  .confirm-summary {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
  }

  .billing-notice {
    background: #fef3c7;
    border: 1px solid #fde68a;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    color: #92400e;
    margin-bottom: 0.75rem;
  }

  .confirm-actions {
    display: flex;
    gap: 0.75rem;
  }
</style>
