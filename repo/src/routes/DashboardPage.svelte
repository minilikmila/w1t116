<script lang="ts">
  import { onMount } from 'svelte';
  import { authStore } from '../lib/stores';
  import { idbAccessLayer } from '../lib/services/idbAccessLayer';
  import { navigate } from '../lib/utils/router';
  import type { Booking, SessionRecord, Registration, Bill, Message } from '../lib/types';

  let activeBookings = $state(0);
  let activeSessions = $state(0);
  let outstandingBills = $state(0);
  let unreadMessages = $state(0);

  // Recent items for quick-access lists
  let recentBookings = $state<Booking[]>([]);
  let upcomingSessions = $state<SessionRecord[]>([]);
  let myRegistrations = $state<Registration[]>([]);

  let loading = $state(true);

  onMount(async () => {
    const session = $authStore;
    if (!session) return;

    try {
      const now = Date.now();
      const role = session.role;

      // Load data in parallel
      const [bookings, sessions, registrations, bills, messages, readReceipts] = await Promise.all([
        idbAccessLayer.getAll<Booking>('bookings'),
        idbAccessLayer.getAll<SessionRecord>('sessions'),
        idbAccessLayer.getAll<Registration>('registrations'),
        idbAccessLayer.getAll<Bill>('bills'),
        idbAccessLayer.getAll<Message>('messages'),
        idbAccessLayer.getAll<{ receipt_id: string; message_id: string; user_id: string }>('read_receipts'),
      ]);

      // Active bookings: non-cancelled, future or ongoing
      const relevantBookings = bookings.filter((b) =>
        b.status !== 'cancelled' && b.end_time > now
      );
      if (role === 'SYSTEM_ADMIN' || role === 'OPS_COORDINATOR') {
        activeBookings = relevantBookings.length;
        recentBookings = relevantBookings
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, 5);
      } else if (role === 'INSTRUCTOR') {
        const mine = relevantBookings.filter((b) => b.user_id === session.user_id);
        activeBookings = mine.length;
        recentBookings = mine
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, 5);
      }

      // Active sessions
      const activeSess = sessions.filter((s) => s.status === 'active' && s.end_time > now);
      if (role === 'INSTRUCTOR') {
        upcomingSessions = activeSess
          .filter((s) => s.instructor_id === session.user_id)
          .sort((a, b) => a.start_time - b.start_time)
          .slice(0, 5);
        activeSessions = upcomingSessions.length;
      } else {
        upcomingSessions = activeSess
          .sort((a, b) => a.start_time - b.start_time)
          .slice(0, 5);
        activeSessions = activeSess.length;
      }

      // Registrations (for PARTICIPANT)
      if (role === 'PARTICIPANT') {
        const mine = registrations.filter(
          (r) => r.participant_id === session.user_id && r.status === 'active'
        );
        myRegistrations = mine;
        activeSessions = mine.length;
      }

      // Outstanding bills
      const unpaid = bills.filter((b) =>
        b.status === 'generated' || b.status === 'overdue' || b.status === 'partial'
      );
      if (role === 'PARTICIPANT') {
        outstandingBills = unpaid.filter((b) => b.participant_id === session.user_id).length;
      } else if (role === 'SYSTEM_ADMIN' || role === 'OPS_COORDINATOR') {
        outstandingBills = unpaid.length;
      }

      // Unread messages: published messages targeting user's role, minus read receipts
      const myReadIds = new Set(
        readReceipts
          .filter((r) => r.user_id === session.user_id)
          .map((r) => r.message_id)
      );
      const publishedForMe = messages.filter(
        (m) => m.status === 'published' && m.target_roles.includes(role)
      );
      unreadMessages = publishedForMe.filter((m) => !myReadIds.has(m.message_id)).length;
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      loading = false;
    }
  });

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString();
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
</script>

<div class="dashboard">
  <h2>Dashboard</h2>

  {#if $authStore}
    <p class="welcome">Welcome! You are signed in as <strong>{$authStore.role.replace(/_/g, ' ')}</strong>.</p>

    {#if loading}
      <p class="loading-text">Loading dashboard...</p>
    {:else}
      <div class="cards">
        {#if ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR'].includes($authStore.role)}
          <button class="card clickable" onclick={() => navigate('/rooms')}>
            <h3>Room Scheduling</h3>
            <p class="stat">{activeBookings}</p>
            <p class="label">Active Bookings</p>
          </button>
        {/if}

        <button class="card clickable" onclick={() => navigate('/registration')}>
          <h3>Registration</h3>
          <p class="stat">{activeSessions}</p>
          <p class="label">{$authStore.role === 'PARTICIPANT' ? 'My Registrations' : 'Active Sessions'}</p>
        </button>

        {#if ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'PARTICIPANT'].includes($authStore.role)}
          <button class="card clickable" onclick={() => navigate('/billing')}>
            <h3>Billing</h3>
            <p class="stat">{outstandingBills}</p>
            <p class="label">Outstanding Bills</p>
          </button>
        {/if}

        <button class="card clickable" onclick={() => navigate('/messages')}>
          <h3>Messages</h3>
          <p class="stat">{unreadMessages}</p>
          <p class="label">Unread</p>
        </button>
      </div>

      <!-- Recent / Upcoming sections -->
      {#if recentBookings.length > 0}
        <section class="section">
          <h3>Recent Bookings</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {#each recentBookings as b (b.booking_id)}
                <tr class="clickable-row" onclick={() => navigate(`/rooms/${b.booking_id}`)}>
                  <td>{b.room_id}</td>
                  <td>{formatTime(b.start_time)}</td>
                  <td><span class="badge badge-{b.status}">{b.status}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/if}

      {#if upcomingSessions.length > 0}
        <section class="section">
          <h3>Upcoming Sessions</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Time</th>
                <th>Enrollment</th>
              </tr>
            </thead>
            <tbody>
              {#each upcomingSessions as s (s.session_id)}
                <tr class="clickable-row" onclick={() => navigate(`/registration/${s.session_id}`)}>
                  <td>{s.title}</td>
                  <td>{formatTime(s.start_time)}</td>
                  <td>{s.current_enrollment} / {s.capacity}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/if}

      {#if myRegistrations.length > 0}
        <section class="section">
          <h3>My Registrations</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Registered</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {#each myRegistrations as r (r.registration_id)}
                <tr class="clickable-row" onclick={() => navigate(`/registration/${r.session_id}`)}>
                  <td>{r.session_id}</td>
                  <td>{formatDate(r.registered_at)}</td>
                  <td><span class="badge badge-active">{r.status}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .dashboard {
    max-width: 960px;
  }

  .welcome {
    color: #475569;
    margin-bottom: 1.5rem;
  }

  .loading-text {
    color: #666;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1.25rem;
    text-align: left;
    font-family: inherit;
  }

  .card.clickable {
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .card.clickable:hover {
    border-color: #4361ee;
    box-shadow: 0 2px 8px rgba(67, 97, 238, 0.12);
  }

  .card h3 {
    font-size: 0.875rem;
    color: #64748b;
    margin: 0 0 0.5rem;
  }

  .stat {
    font-size: 2rem;
    font-weight: 700;
    color: #1e293b;
    margin: 0;
  }

  .label {
    font-size: 0.8rem;
    color: #94a3b8;
    margin: 0.25rem 0 0;
  }

  .section {
    margin-bottom: 1.5rem;
  }

  .section h3 {
    font-size: 1rem;
    color: #334155;
    margin: 0 0 0.75rem;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
  }

  .data-table th,
  .data-table td {
    padding: 0.6rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid #e2e8f0;
    font-size: 0.875rem;
  }

  .data-table th {
    color: #64748b;
    font-weight: 600;
    background: #f8fafc;
  }

  .clickable-row {
    cursor: pointer;
  }

  .clickable-row:hover td {
    background: #f1f5f9;
  }

  .badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .badge-confirmed, .badge-active {
    background: #d4edda;
    color: #155724;
  }

  .badge-pending {
    background: #fff3cd;
    color: #856404;
  }

  .badge-cancelled {
    background: #f8d7da;
    color: #721c24;
  }
</style>
