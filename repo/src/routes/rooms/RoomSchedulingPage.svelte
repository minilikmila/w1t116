<script lang="ts">
  import { onMount } from 'svelte';
  import { roomSchedulingService } from '../../lib/services/roomSchedulingService';
  import { idbAccessLayer } from '../../lib/services/idbAccessLayer';
  import { navigate } from '../../lib/utils/router';
  import type { Booking, Room } from '../../lib/types';

  let bookings = $state<Booking[]>([]);
  // CONSISTENCY FIX: replaced raw room_id display with human-readable room names
  let roomNames = $state<Record<string, string>>({});
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    try {
      // Service-level filtering now enforced in getAllBookings
      const [loadedBookings, rooms] = await Promise.all([
        roomSchedulingService.getAllBookings(),
        idbAccessLayer.getAll<Room>('rooms'),
      ]);
      bookings = loadedBookings;
      roomNames = Object.fromEntries(rooms.map((r) => [r.room_id, r.name]));
    } catch (e: any) {
      error = e.message ?? 'Failed to load bookings';
    } finally {
      loading = false;
    }
  });

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function handleRowClick(bookingId: string) {
    navigate(`/rooms/${bookingId}`);
  }

  function handleNewBooking() {
    navigate('/rooms/new');
  }
</script>

<div class="page">
  <div class="header">
    <h2>Room Scheduling</h2>
    <button class="btn-primary" onclick={handleNewBooking}>New Booking</button>
  </div>

  {#if loading}
    <p class="loading">Loading bookings...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if bookings.length === 0}
    <p class="empty">No bookings found. Create one to get started.</p>
  {:else}
    <table class="bookings-table">
      <thead>
        <tr>
          <th>Room</th>
          <th>Date</th>
          <th>Time</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each bookings as booking (booking.booking_id)}
          <tr
            class="booking-row"
            onclick={() => handleRowClick(booking.booking_id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => { if (e.key === 'Enter') handleRowClick(booking.booking_id); }}
          >
            <td>{roomNames[booking.room_id] ?? 'Unknown'}</td>
            <td>{formatDate(booking.start_time)}</td>
            <td>{formatTime(booking.start_time)} &ndash; {formatTime(booking.end_time)}</td>
            <td>
              <span class="status-badge status-{booking.status}">{booking.status}</span>
            </td>
            <td>
              <button
                class="btn-link"
                onclick={(e) => { e.stopPropagation(); handleRowClick(booking.booking_id); }}
              >
                View
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .page {
    max-width: 900px;
    margin: 0 auto;
    padding: 1.5rem;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .header h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #1a1a2e;
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

  .loading,
  .empty {
    text-align: center;
    color: #666;
    padding: 2rem 0;
  }

  .error {
    text-align: center;
    color: #e63946;
    padding: 2rem 0;
  }

  .bookings-table {
    width: 100%;
    border-collapse: collapse;
    background: #fff;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }

  .bookings-table th {
    background: #f8f9fa;
    text-align: left;
    padding: 0.75rem 1rem;
    font-size: 0.8rem;
    text-transform: uppercase;
    color: #555;
    border-bottom: 2px solid #e9ecef;
  }

  .bookings-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #e9ecef;
    font-size: 0.9rem;
  }

  .booking-row {
    cursor: pointer;
    transition: background 0.15s;
  }

  .booking-row:hover {
    background: #f0f4ff;
  }

  .status-badge {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    border-radius: 12px;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: capitalize;
  }

  .status-confirmed {
    background: #d4edda;
    color: #155724;
  }

  .status-pending {
    background: #fff3cd;
    color: #856404;
  }

  .status-cancelled {
    background: #f8d7da;
    color: #721c24;
  }

  .btn-link {
    background: none;
    border: none;
    color: #4361ee;
    cursor: pointer;
    font-size: 0.85rem;
    text-decoration: underline;
    padding: 0;
  }

  .btn-link:hover {
    color: #3a56d4;
  }
</style>
