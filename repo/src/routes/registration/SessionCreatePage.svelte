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
        errorMessage = `Booking conflict detected: ${result.conflicts.map((c) => c.description).join('; ')}`;
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

  {#if conflictResult && conflictResult.alternatives.length > 0}
    <div class="alternatives-panel">
      <h3>Alternative Rooms Available</h3>
      <ul>
        {#each conflictResult.alternatives as alt (alt.room.room_id)}
          <li>
            <strong>{alt.room.name}</strong> ({alt.room.building_code} - Floor {alt.room.floor_code}, Cap: {alt.room.capacity})
            — Score: {(alt.total_score * 100).toFixed(0)}%
          </li>
        {/each}
      </ul>
    </div>
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

  .alternatives-panel {
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }

  .alternatives-panel h3 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    color: #856404;
  }

  .alternatives-panel ul {
    margin: 0;
    padding-left: 1.25rem;
    font-size: 0.88rem;
  }

  .alternatives-panel li {
    margin-bottom: 0.3rem;
  }
</style>
