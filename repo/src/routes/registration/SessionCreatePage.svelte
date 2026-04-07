<script lang="ts">
  import { onMount } from 'svelte';
  import { idbAccessLayer } from '../../lib/services/idbAccessLayer';
  import { roomSchedulingService } from '../../lib/services/roomSchedulingService';
  import { rbacService } from '../../lib/services/rbacService';
  import { navigate } from '../../lib/utils/router';
  import type { Room, ConflictResult, ScoredRoom } from '../../lib/types';

  let rooms = $state<Room[]>([]);
  let selectedRoomId = $state('');
  let title = $state('');
  let dateValue = $state('');
  let startTime = $state('');
  let endTime = $state('');
  let capacity = $state(20);
  let fee = $state(0);

  let loading = $state(false);
  let submitting = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');
  let conflictResult = $state<ConflictResult | null>(null);
  let showConflictModal = $state(false);

  onMount(async () => {
    loading = true;
    try {
      rbacService.checkPermission('session:create');
      rooms = await idbAccessLayer.getAll('rooms');
    } catch (e: any) {
      errorMessage = e.message ?? 'Failed to load rooms';
    } finally {
      loading = false;
    }
  });

  function buildTimestamp(date: string, time: string): number {
    return new Date(`${date}T${time}`).getTime();
  }

  async function handleSubmit() {
    errorMessage = '';
    successMessage = '';

    if (!title.trim()) {
      errorMessage = 'Please enter a session title.';
      return;
    }
    if (!selectedRoomId || !dateValue || !startTime || !endTime) {
      errorMessage = 'Please fill in all required fields.';
      return;
    }

    const startTs = buildTimestamp(dateValue, startTime);
    const endTs = buildTimestamp(dateValue, endTime);
    if (endTs <= startTs) {
      errorMessage = 'End time must be after start time.';
      return;
    }
    if (capacity < 1) {
      errorMessage = 'Capacity must be at least 1.';
      return;
    }

    submitting = true;
    conflictResult = null;
    try {
      const currentSession = rbacService.getCurrentSession();

      const result = await roomSchedulingService.createSessionBooking({
        title: title.trim(),
        room_id: selectedRoomId,
        start_time: startTs,
        end_time: endTs,
        capacity,
        fee,
        instructor_id: currentSession.user_id,
      });

      if ('conflicts' in result) {
        conflictResult = result as ConflictResult;
        showConflictModal = true;
      } else {
        successMessage = 'Session created successfully!';
        setTimeout(() => navigate('/registration'), 800);
      }
    } catch (e: any) {
      errorMessage = e.message ?? 'Failed to create session.';
    } finally {
      submitting = false;
    }
  }

  async function bookAlternativeRoom(alt: ScoredRoom) {
    submitting = true;
    errorMessage = '';
    try {
      const currentSession = rbacService.getCurrentSession();
      const startTs = buildTimestamp(dateValue, startTime);
      const endTs = buildTimestamp(dateValue, endTime);

      const result = await roomSchedulingService.createSessionBooking({
        title: title.trim(),
        room_id: alt.room.room_id,
        start_time: startTs,
        end_time: endTs,
        capacity,
        fee,
        instructor_id: currentSession.user_id,
      });

      if ('conflicts' in result) {
        conflictResult = result as ConflictResult;
      } else {
        showConflictModal = false;
        conflictResult = null;
        successMessage = 'Session created successfully!';
        setTimeout(() => navigate('/registration'), 800);
      }
    } catch (e: any) {
      errorMessage = e.message ?? 'Failed to create session.';
    } finally {
      submitting = false;
    }
  }

  function closeModal() {
    showConflictModal = false;
    conflictResult = null;
  }
</script>

<div class="page">
  <div class="header">
    <h2>Create New Session</h2>
  </div>

  {#if successMessage}
    <div class="alert alert-success">{successMessage}</div>
  {/if}
  {#if errorMessage}
    <div class="alert alert-error">{errorMessage}</div>
  {/if}

  {#if loading}
    <p class="loading">Loading rooms...</p>
  {:else}
    <form class="session-form" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      <div class="form-group">
        <label for="session-title">Session Title</label>
        <input
          id="session-title"
          type="text"
          bind:value={title}
          placeholder="e.g. Introduction to Chemistry"
          required
        />
      </div>

      <div class="form-group">
        <label for="room-select">Room</label>
        <select id="room-select" bind:value={selectedRoomId} required>
          <option value="" disabled>Select a room</option>
          {#each rooms as room (room.room_id)}
            <option value={room.room_id}>
              {room.name} ({room.building_code} - Floor {room.floor_code}, Cap: {room.capacity})
            </option>
          {/each}
        </select>
      </div>

      <div class="form-group">
        <label for="date-picker">Date</label>
        <input id="date-picker" type="date" bind:value={dateValue} required />
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="start-time">Start Time</label>
          <input id="start-time" type="time" bind:value={startTime} required />
        </div>
        <div class="form-group">
          <label for="end-time">End Time</label>
          <input id="end-time" type="time" bind:value={endTime} required />
        </div>
      </div>

      <div class="form-group">
        <label for="capacity">Capacity</label>
        <input
          id="capacity"
          type="number"
          bind:value={capacity}
          min="1"
          required
        />
      </div>

      <div class="form-group">
        <label for="fee">Session Fee ($)</label>
        <input
          id="fee"
          type="number"
          step="0.01"
          min="0"
          bind:value={fee}
        />
        <span class="field-hint">Set to 0 for free sessions</span>
      </div>

      <div class="form-actions">
        <button type="button" class="btn-secondary" onclick={() => navigate('/registration')}>
          Cancel
        </button>
        <button type="submit" class="btn-primary" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Session'}
        </button>
      </div>
    </form>
  {/if}
</div>

{#if showConflictModal && conflictResult}
  <div class="modal-backdrop" onclick={closeModal} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>Scheduling Conflict</h3>
        <button class="modal-close" onclick={closeModal} aria-label="Close">&times;</button>
      </div>

      <div class="modal-body">
        <h4>Conflicts</h4>
        <ul class="conflict-list">
          {#each conflictResult.conflicts as conflict (conflict.conflicting_record_id)}
            <li>
              <span class="conflict-type">{conflict.type.replace('_', ' ')}</span>
              <span class="conflict-desc">{conflict.description}</span>
            </li>
          {/each}
        </ul>

        {#if conflictResult.alternatives.length > 0}
          <h4>Alternative Rooms</h4>
          <div class="alternatives">
            {#each conflictResult.alternatives.slice(0, 5) as alt (alt.room.room_id)}
              <div class="alt-card">
                <div class="alt-header">
                  <strong>{alt.room.name}</strong>
                  <span class="total-score">Score: {alt.total_score.toFixed(2)}</span>
                </div>
                <div class="alt-scores">
                  <span>Capacity: {alt.scores.capacity_fit.toFixed(2)}</span>
                  <span>Equipment: {alt.scores.equipment_match.toFixed(2)}</span>
                  <span>Availability: {alt.scores.availability.toFixed(2)}</span>
                  <span>Distance: {alt.scores.distance.toFixed(2)}</span>
                </div>
                <button
                  class="btn-primary btn-sm"
                  disabled={submitting}
                  onclick={() => bookAlternativeRoom(alt)}
                >
                  Book This Room
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" onclick={closeModal}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page {
    max-width: 640px;
    margin: 0 auto;
    padding: 1.5rem;
  }

  .header h2 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
    color: #1a1a2e;
  }

  .loading {
    text-align: center;
    color: #666;
    padding: 2rem 0;
  }

  .alert {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  .alert-success {
    background: #d4edda;
    color: #155724;
    border: 1px solid #c3e6cb;
  }

  .alert-error {
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
  }

  .session-form {
    background: #fff;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.35rem;
    font-weight: 500;
    font-size: 0.9rem;
    color: #333;
  }

  .form-group input[type='text'],
  .form-group select,
  .form-group input[type='date'],
  .form-group input[type='time'],
  .form-group input[type='number'] {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 0.9rem;
    box-sizing: border-box;
  }

  .field-hint {
    font-size: 0.78rem;
    color: #888;
    margin-top: 0.15rem;
  }

  .form-row {
    display: flex;
    gap: 1rem;
  }

  .form-row .form-group {
    flex: 1;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.25rem;
  }

  .btn-primary {
    background: #4361ee;
    color: #fff;
    border: none;
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
  }

  .btn-primary:hover {
    background: #3a56d4;
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: #e9ecef;
    color: #333;
    border: none;
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .btn-secondary:hover {
    background: #dee2e6;
  }

  .btn-sm {
    padding: 0.35rem 0.9rem;
    font-size: 0.82rem;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: #fff;
    border-radius: 10px;
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e9ecef;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.15rem;
    color: #e63946;
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #666;
    line-height: 1;
  }

  .modal-body {
    padding: 1.25rem;
  }

  .modal-body h4 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    color: #333;
  }

  .modal-footer {
    padding: 0.75rem 1.25rem;
    border-top: 1px solid #e9ecef;
    display: flex;
    justify-content: flex-end;
  }

  .conflict-list {
    list-style: none;
    padding: 0;
    margin: 0 0 1.25rem;
  }

  .conflict-list li {
    padding: 0.5rem 0.75rem;
    background: #fff3cd;
    border-radius: 6px;
    margin-bottom: 0.4rem;
    font-size: 0.88rem;
  }

  .conflict-type {
    font-weight: 600;
    text-transform: capitalize;
    margin-right: 0.5rem;
    color: #856404;
  }

  .conflict-desc {
    color: #555;
  }

  .alternatives {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .alt-card {
    border: 1px solid #dee2e6;
    border-radius: 8px;
    padding: 0.75rem 1rem;
  }

  .alt-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.4rem;
  }

  .total-score {
    font-weight: 600;
    color: #4361ee;
    font-size: 0.88rem;
  }

  .alt-scores {
    display: flex;
    gap: 0.75rem;
    font-size: 0.78rem;
    color: #666;
    margin-bottom: 0.5rem;
  }
</style>
