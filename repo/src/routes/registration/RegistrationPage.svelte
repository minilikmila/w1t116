<script lang="ts">
  import { onMount } from 'svelte';
  import { registrationService } from '../../lib/services/registrationService';
  import { rbacService } from '../../lib/services/rbacService';
  import { idbAccessLayer } from '../../lib/services/idbAccessLayer';
  import { navigate } from '../../lib/utils/router';
  import type { SessionRecord, Registration } from '../../lib/types';

  let sessions = $state<SessionRecord[]>([]);
  let myRegistrations = $state<Registration[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let isParticipant = $state(false);

  let registeredSessionIds = $derived(
    new Set(
      myRegistrations
        .filter((r) => r.status === 'active')
        .map((r) => r.session_id)
    )
  );

  onMount(async () => {
    try {
      const currentSession = rbacService.getCurrentSession();
      isParticipant = currentSession.role === 'PARTICIPANT';

      const [allSessions, registrations] = await Promise.all([
        idbAccessLayer.getAll<SessionRecord>('sessions'),
        isParticipant
          ? registrationService.getRegistrationsForParticipant(currentSession.user_id)
          : Promise.resolve([]),
      ]);

      sessions = allSessions;
      myRegistrations = registrations;
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'Failed to load sessions.';
    } finally {
      loading = false;
    }
  });

  function availableSeats(session: SessionRecord): number {
    return Math.max(0, session.capacity - session.current_enrollment);
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  function viewSession(sessionId: string): void {
    navigate(`/registration/${sessionId}`);
  }
</script>

<div class="page">
  <h2>Session Registration</h2>

  {#if loading}
    <p class="loading-text">Loading sessions...</p>
  {:else if error}
    <p class="error-text">{error}</p>
  {:else if sessions.length === 0}
    <p>No sessions available.</p>
  {:else}
    <table class="sessions-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Time</th>
          <th>Available Seats</th>
          <th>Status</th>
          {#if isParticipant}
            <th>Registered</th>
          {/if}
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {#each sessions as session (session.session_id)}
          <tr class:registered-row={isParticipant && registeredSessionIds.has(session.session_id)}>
            <td>{session.title}</td>
            <td>{formatTime(session.start_time)}</td>
            <td>{availableSeats(session)}</td>
            <td>
              <span class="status-badge status-{session.status}">{session.status}</span>
            </td>
            {#if isParticipant}
              <td>
                {#if registeredSessionIds.has(session.session_id)}
                  <span class="registered-badge">Registered</span>
                {:else}
                  <span class="not-registered-text">--</span>
                {/if}
              </td>
            {/if}
            <td>
              <button class="view-button" onclick={() => viewSession(session.session_id)}>View</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

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
  }

  .sessions-table {
    width: 100%;
    border-collapse: collapse;
  }

  .sessions-table th,
  .sessions-table td {
    padding: 0.75rem 1rem;
    text-align: left;
    border-bottom: 1px solid #e0e0e0;
  }

  .sessions-table th {
    background: #f5f5f5;
    font-weight: 600;
  }

  .registered-row {
    background: #eaf7ea;
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

  .registered-badge {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    background: #28a745;
    color: #fff;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .not-registered-text {
    color: #999;
  }

  .view-button {
    padding: 0.35rem 0.9rem;
    background: #007bff;
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .view-button:hover {
    background: #0056b3;
  }
</style>
