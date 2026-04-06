<script lang="ts">
  import { onMount } from 'svelte';
  import { analyticsService } from '../../lib/services/analyticsService';
  import type { DateRange } from '../../lib/types';

  let startDate = $state('');
  let endDate = $state('');
  let loading = $state(true);
  let error = $state('');

  let bookingConversion: number | 'N/A' = $state('N/A');
  let noShowRate: number | 'N/A' = $state('N/A');
  let paymentSuccess: number | 'N/A' = $state('N/A');
  let roomUtilizations: Array<{ room_id: string; room_name: string; utilization: number }> = $state([]);

  function defaultPeriod(): { start: string; end: string } {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const start = past.toISOString().slice(0, 10);
    return { start, end };
  }

  function buildDateRange(): DateRange {
    const s = startDate ? new Date(startDate).getTime() : Date.now() - 30 * 24 * 60 * 60 * 1000;
    const e = endDate ? new Date(endDate + 'T23:59:59').getTime() : Date.now();
    return { start: s, end: e };
  }

  function formatPercent(value: number | 'N/A'): string {
    if (value === 'N/A') return 'N/A';
    return (value * 100).toFixed(1) + '%';
  }

  async function loadData() {
    loading = true;
    error = '';
    try {
      const period = buildDateRange();
      const [metrics, rooms] = await Promise.all([
        analyticsService.getMetricsSummary(period),
        analyticsService.getRoomUtilizations(period),
      ]);
      bookingConversion = metrics.bookingConversion;
      noShowRate = metrics.noShowRate;
      paymentSuccess = metrics.paymentSuccess;
      roomUtilizations = rooms;
    } catch (e: any) {
      error = e.message ?? 'Failed to load analytics';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    const defaults = defaultPeriod();
    startDate = defaults.start;
    endDate = defaults.end;
    loadData();
  });
</script>

<div class="page">
  <div class="page-header">
    <h2>Analytics Dashboard</h2>
    <nav class="sub-nav">
      <a href="#/analytics/bookings" class="sub-nav-link">Booking Analytics</a>
      <a href="#/analytics/billing" class="sub-nav-link">Billing Analytics</a>
    </nav>
  </div>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <!-- Period selector -->
  <section class="section">
    <h3>Period</h3>
    <div class="period-row">
      <label>
        Start Date
        <input type="date" bind:value={startDate} />
      </label>
      <label>
        End Date
        <input type="date" bind:value={endDate} />
      </label>
      <button class="btn btn-primary" onclick={loadData} disabled={loading}>
        {loading ? 'Loading...' : 'Apply'}
      </button>
    </div>
  </section>

  <!-- Metric Cards -->
  <section class="cards">
    <div class="card">
      <div class="card-label">Booking Conversion Rate</div>
      <div class="card-value">{formatPercent(bookingConversion)}</div>
    </div>
    <div class="card">
      <div class="card-label">No-Show Rate</div>
      <div class="card-value">{formatPercent(noShowRate)}</div>
    </div>
    <div class="card">
      <div class="card-label">Payment Success Rate</div>
      <div class="card-value">{formatPercent(paymentSuccess)}</div>
    </div>
    <div class="card">
      <div class="card-label">Rooms Tracked</div>
      <div class="card-value">{roomUtilizations.length}</div>
    </div>
  </section>

  <!-- Room Utilization -->
  <section class="section">
    <h3>Room Utilization</h3>
    {#if loading}
      <p class="loading">Loading...</p>
    {:else if roomUtilizations.length === 0}
      <p class="empty">No room data available.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Room Name</th>
              <th>Utilization %</th>
            </tr>
          </thead>
          <tbody>
            {#each roomUtilizations as room (room.room_id)}
              <tr>
                <td>{room.room_name || room.room_id}</td>
                <td>
                  <div class="util-bar-container">
                    <div class="util-bar" style="width: {Math.round(room.utilization * 100)}%"></div>
                    <span class="util-label">{(room.utilization * 100).toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 1.5rem;
    font-family: system-ui, -apple-system, sans-serif;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #1a1a2e;
  }

  .sub-nav {
    display: flex;
    gap: 0.75rem;
  }

  .sub-nav-link {
    padding: 0.4rem 0.85rem;
    background: #f0f4ff;
    color: #4361ee;
    border-radius: 6px;
    text-decoration: none;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .sub-nav-link:hover {
    background: #dbeafe;
  }

  h3 {
    margin-bottom: 0.75rem;
    font-size: 1.15rem;
    color: #16213e;
  }

  .section {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .error-banner {
    background: #fee;
    color: #c00;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    border: 1px solid #fcc;
  }

  .loading,
  .empty {
    color: #888;
    font-style: italic;
  }

  /* Period selector */
  .period-row {
    display: flex;
    gap: 1rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: #444;
  }

  input {
    padding: 0.5rem 0.625rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 0.875rem;
    font-family: inherit;
  }

  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #1a73e8;
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #1565c0;
  }

  /* Cards */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .card {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 1.25rem;
    text-align: center;
  }

  .card-label {
    font-size: 0.8rem;
    color: #777;
    font-weight: 500;
    margin-bottom: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .card-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: #1a1a2e;
  }

  /* Table */
  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    text-align: left;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #eee;
    font-size: 0.875rem;
  }

  th {
    background: #f9f9f9;
    font-weight: 600;
    color: #555;
  }

  /* Utilization bar */
  .util-bar-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .util-bar {
    height: 18px;
    background: #1a73e8;
    border-radius: 4px;
    min-width: 2px;
    transition: width 0.3s;
  }

  .util-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: #444;
    white-space: nowrap;
  }
</style>
