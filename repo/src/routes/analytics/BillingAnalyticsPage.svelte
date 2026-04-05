<script lang="ts">
  import { onMount } from 'svelte';
  import { analyticsService } from '../../lib/services/analyticsService';
  import type { DateRange } from '../../lib/types';

  let startDate = $state('');
  let endDate = $state('');
  let granularity: 'daily' | 'weekly' | 'monthly' = $state('daily');
  let loading = $state(true);
  let error = $state('');

  let trendData: Array<{ label: string; totalBilled: number; totalPaid: number }> = $state([]);

  let maxBilled = $derived(Math.max(1, ...trendData.map((d) => d.totalBilled)));

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

  function formatDollar(value: number): string {
    return '$' + value.toFixed(2);
  }

  function collectionRate(billed: number, paid: number): string {
    if (billed === 0) return 'N/A';
    return ((paid / billed) * 100).toFixed(1) + '%';
  }

  async function loadData() {
    loading = true;
    error = '';
    try {
      const period = buildDateRange();
      trendData = await analyticsService.getBillingTrend(period, granularity);
    } catch (e: any) {
      error = e.message ?? 'Failed to load billing trend';
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
  <h2>Billing Analytics</h2>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <!-- Controls -->
  <section class="section">
    <h3>Filters</h3>
    <div class="controls-row">
      <label>
        Start Date
        <input type="date" bind:value={startDate} />
      </label>
      <label>
        End Date
        <input type="date" bind:value={endDate} />
      </label>
      <label>
        Granularity
        <select bind:value={granularity}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <button class="btn btn-primary" onclick={loadData} disabled={loading}>
        {loading ? 'Loading...' : 'Apply'}
      </button>
    </div>
  </section>

  <!-- Trend Table -->
  <section class="section">
    <h3>Billing Trend</h3>
    {#if loading}
      <p class="loading">Loading...</p>
    {:else if trendData.length === 0}
      <p class="empty">No billing data for the selected period.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Total Billed</th>
              <th>Total Paid</th>
              <th>Collection Rate</th>
              <th>Bar</th>
            </tr>
          </thead>
          <tbody>
            {#each trendData as row (row.label)}
              <tr>
                <td>{row.label}</td>
                <td>{formatDollar(row.totalBilled)}</td>
                <td>{formatDollar(row.totalPaid)}</td>
                <td>{collectionRate(row.totalBilled, row.totalPaid)}</td>
                <td class="bar-cell">
                  <div class="bar-track">
                    <div
                      class="bar-fill bar-billed"
                      style="width: {(row.totalBilled / maxBilled) * 100}%"
                    ></div>
                    <div
                      class="bar-fill bar-paid"
                      style="width: {(row.totalPaid / maxBilled) * 100}%"
                    ></div>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="legend">
        <span class="legend-item"><span class="legend-swatch swatch-billed"></span> Billed</span>
        <span class="legend-item"><span class="legend-swatch swatch-paid"></span> Paid</span>
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

  h2 {
    margin-bottom: 1.5rem;
    font-size: 1.5rem;
    color: #1a1a2e;
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

  /* Controls */
  .controls-row {
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

  input,
  select {
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

  /* Bar chart */
  .bar-cell {
    min-width: 160px;
  }

  .bar-track {
    position: relative;
    height: 20px;
    background: #f0f0f0;
    border-radius: 4px;
    overflow: hidden;
  }

  .bar-fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s;
  }

  .bar-billed {
    background: #ffe0b2;
    z-index: 1;
  }

  .bar-paid {
    background: #43a047;
    z-index: 2;
  }

  /* Legend */
  .legend {
    display: flex;
    gap: 1.5rem;
    margin-top: 0.75rem;
    font-size: 0.8rem;
    color: #666;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .legend-swatch {
    display: inline-block;
    width: 14px;
    height: 14px;
    border-radius: 3px;
  }

  .swatch-billed {
    background: #ffe0b2;
  }

  .swatch-paid {
    background: #43a047;
  }
</style>
