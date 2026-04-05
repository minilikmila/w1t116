<script lang="ts">
  import { onMount } from 'svelte';
  import { roomSchedulingService } from '../../lib/services/roomSchedulingService';
  import { navigate } from '../../lib/utils/router';
  import type { Booking } from '../../lib/types';

  let { params } = $props<{ params: { id: string } }>();

  let booking = $state<Booking | null>(null);
  let loading = $state(true);
  let error = $state('');
  let cancelling = $state(false);
  let cancelSuccess = $state(false);

  onMount(async () => {
    try {
      booking = await roomSchedulingService.getBooking(params.id);
    } catch (e: any) {
      error = e.message ?? 'Failed to load booking';
    } finally {
      loading = false;
    }
  });

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatDateTime(ts: number): string {
    return new Date(ts).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async function handleCancel() {
    if (!booking) return;
    const confirmed = window.confirm(
      'Are you sure you want to cancel this booking? This action cannot be undone.'
    );
    if (!confirmed) return;

    cancelling = true;
    error = '';
    try {
      await roomSchedulingService.cancelBooking(booking.booking_id);
      cancelSuccess = true;
      booking = { ...booking, status: 'cancelled' };
    } catch (e: any) {
      error = e.message ?? 'Failed to cancel booking.';
    } finally {
      cancelling = false;
    }
  }

  function goBack() {
    navigate('/rooms');
  }
</script>

<div class="page">
  <button class="btn-back" onclick={goBack}>&larr; Back to Bookings</button>

  {#if loading}
    <p class="loading">Loading booking details...</p>
  {:else if error && !booking}
    <p class="error">{error}</p>
  {:else if booking}
    <div class="detail-card">
      <div class="detail-header">
        <h2>Booking Details</h2>
        <span class="status-badge status-{booking.status}">{booking.status}</span>
      </div>

      {#if cancelSuccess}
        <div class="alert alert-success">Booking has been cancelled successfully.</div>
      {/if}
      {#if error}
        <div class="alert alert-error">{error}</div>
      {/if}

      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">Booking ID</span>
          <span class="detail-value">{booking.booking_id}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Room</span>
          <span class="detail-value">{booking.room_id}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Date</span>
          <span class="detail-value">{formatDate(booking.start_time)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Time</span>
          <span class="detail-value">{formatTime(booking.start_time)} &ndash; {formatTime(booking.end_time)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Participants</span>
          <span class="detail-value">{booking.participant_capacity}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Equipment</span>
          <span class="detail-value">
            {#if booking.requested_equipment.length > 0}
              {booking.requested_equipment.join(', ')}
            {:else}
              None
            {/if}
          </span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Created</span>
          <span class="detail-value">{formatDateTime(booking.created_at)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">User</span>
          <span class="detail-value">{booking.user_id}</span>
        </div>
      </div>

      {#if booking.status !== 'cancelled'}
        <div class="detail-actions">
          <button
            class="btn-danger"
            onclick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling...' : 'Cancel Booking'}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 700px;
    margin: 0 auto;
    padding: 1.5rem;
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

  .loading {
    text-align: center;
    color: #666;
    padding: 2rem 0;
  }

  .error {
    text-align: center;
    color: #e63946;
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

  .detail-card {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
    padding: 1.5rem;
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.25rem;
  }

  .detail-header h2 {
    margin: 0;
    font-size: 1.35rem;
    color: #1a1a2e;
  }

  .status-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.8rem;
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

  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .detail-item {
    display: flex;
    flex-direction: column;
  }

  .detail-label {
    font-size: 0.78rem;
    text-transform: uppercase;
    color: #888;
    margin-bottom: 0.2rem;
    font-weight: 500;
  }

  .detail-value {
    font-size: 0.95rem;
    color: #333;
  }

  .detail-actions {
    border-top: 1px solid #e9ecef;
    padding-top: 1rem;
    display: flex;
    justify-content: flex-end;
  }

  .btn-danger {
    background: #e63946;
    color: #fff;
    border: none;
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
  }

  .btn-danger:hover {
    background: #d32f3f;
  }

  .btn-danger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
