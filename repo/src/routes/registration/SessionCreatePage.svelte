<script lang="ts">
  import { onMount } from 'svelte';
  import { idbAccessLayer } from '../../lib/services/idbAccessLayer';
  import { rbacService } from '../../lib/services/rbacService';
  import { navigate } from '../../lib/utils/router';
  import type { Room } from '../../lib/types';

  let rooms = $state<Room[]>([]);
  let selectedRoomId = $state('');
  let title = $state('');
  let dateValue = $state('');
  let startTime = $state('');
  let endTime = $state('');
  let capacity = $state(20);

  let loading = $state(false);
  let submitting = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');

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
    try {
      const session = rbacService.getCurrentSession();
      const sessionId = crypto.randomUUID();
      const bookingId = crypto.randomUUID();

      // Create a corresponding booking for the room
      await idbAccessLayer.put('bookings', {
        booking_id: bookingId,
        room_id: selectedRoomId,
        user_id: session.user_id,
        start_time: startTs,
        end_time: endTs,
        requested_equipment: [],
        participant_capacity: capacity,
        status: 'confirmed',
        created_at: Date.now(),
        _version: 1,
      });

      // Create the session record
      await idbAccessLayer.put('sessions', {
        session_id: sessionId,
        instructor_id: session.user_id,
        room_id: selectedRoomId,
        booking_id: bookingId,
        title: title.trim(),
        start_time: startTs,
        end_time: endTs,
        capacity,
        current_enrollment: 0,
        status: 'active',
        _version: 1,
      });

      successMessage = 'Session created successfully!';
      setTimeout(() => navigate('/registration'), 800);
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
</style>
