<script lang="ts">
  import { authStore } from '../lib/stores';
</script>

<div class="dashboard">
  <h2>Dashboard</h2>

  {#if $authStore}
    <p class="welcome">Welcome! You are signed in as <strong>{$authStore.role.replace(/_/g, ' ')}</strong>.</p>

    <div class="cards">
      <div class="card">
        <h3>Room Scheduling</h3>
        <p class="stat">--</p>
        <p class="label">Active Bookings</p>
      </div>
      <div class="card">
        <h3>Registration</h3>
        <p class="stat">--</p>
        <p class="label">Active Sessions</p>
      </div>
      <div class="card">
        <h3>Billing</h3>
        <p class="stat">--</p>
        <p class="label">Outstanding Bills</p>
      </div>
      <div class="card">
        <h3>Messages</h3>
        <p class="stat">--</p>
        <p class="label">Unread</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .dashboard {
    max-width: 900px;
  }

  .welcome {
    color: #475569;
    margin-bottom: 1.5rem;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
  }

  .card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1.25rem;
  }

  .card h3 {
    font-size: 0.875rem;
    color: #64748b;
    margin-bottom: 0.5rem;
  }

  .stat {
    font-size: 2rem;
    font-weight: 700;
    color: #1e293b;
  }

  .label {
    font-size: 0.8rem;
    color: #94a3b8;
  }
</style>
