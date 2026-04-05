<script lang="ts">
  import { onMount } from 'svelte';
  import { billingService } from '../../lib/services/billingService';
  import { idbAccessLayer } from '../../lib/services/idbAccessLayer';
  import { navigate } from '../../lib/utils/router';
  import type { Bill, User } from '../../lib/types';

  let bills = $state<Bill[]>([]);
  // CONSISTENCY FIX: replaced raw participant_id with human-readable names
  let userNames = $state<Record<string, string>>({});
  let loading = $state(true);
  let error = $state('');

  let filterStatus = $state('all');
  let filterPeriod = $state('');
  let exportPeriod = $state('');
  let exporting = $state(false);

  let filteredBills = $derived(
    bills.filter((b) => {
      if (filterStatus !== 'all' && b.status !== filterStatus) return false;
      if (filterPeriod && b.billing_period !== filterPeriod) return false;
      return true;
    })
  );

  // CONSISTENCY FIX: moved participant filtering from UI to billingService.getAllBills
  onMount(async () => {
    try {
      const [loadedBills, users] = await Promise.all([
        billingService.getAllBills(),
        idbAccessLayer.getAll<User>('users'),
      ]);
      bills = loadedBills;
      userNames = Object.fromEntries(users.map((u) => [u.user_id, u.username]));
    } catch (e: any) {
      error = e.message ?? 'Failed to load bills';
    } finally {
      loading = false;
    }
  });

  function formatCurrency(amount: number): string {
    return '$' + amount.toFixed(2);
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function handleRowClick(billId: string) {
    navigate(`/billing/${billId}`);
  }

  async function handleExportCSV() {
    if (!exportPeriod) return;
    exporting = true;
    try {
      const blob = await billingService.exportReconciliationCSV(exportPeriod);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reconciliation-${exportPeriod}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      error = e.message ?? 'Export failed';
    } finally {
      exporting = false;
    }
  }
</script>

<div class="page">
  <div class="header">
    <h2>Billing</h2>
  </div>

  <div class="filters">
    <div class="filter-group">
      <label for="filter-status">Status</label>
      <select id="filter-status" bind:value={filterStatus}>
        <option value="all">All</option>
        <option value="generated">Generated</option>
        <option value="paid">Paid</option>
        <option value="partial">Partial</option>
        <option value="overdue">Overdue</option>
      </select>
    </div>
    <div class="filter-group">
      <label for="filter-period">Period</label>
      <input id="filter-period" type="month" bind:value={filterPeriod} placeholder="YYYY-MM" />
    </div>
    <div class="filter-group export-group">
      <label for="export-period">Export Period</label>
      <div class="export-row">
        <input id="export-period" type="month" bind:value={exportPeriod} />
        <button class="btn-secondary" onclick={handleExportCSV} disabled={!exportPeriod || exporting}>
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>
    </div>
  </div>

  {#if loading}
    <p class="loading">Loading bills...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if filteredBills.length === 0}
    <p class="empty">No bills found matching the current filters.</p>
  {:else}
    <table class="bills-table">
      <thead>
        <tr>
          <th>Participant</th>
          <th>Period</th>
          <th>Housing</th>
          <th>Utility</th>
          <th>Waivers</th>
          <th>Total</th>
          <th>Status</th>
          <th>Due Date</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredBills as bill (bill.bill_id)}
          <tr
            class="bill-row"
            onclick={() => handleRowClick(bill.bill_id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => { if (e.key === 'Enter') handleRowClick(bill.bill_id); }}
          >
            <!-- CONSISTENCY FIX: replaced raw participant_id with human-readable name -->
            <td>{userNames[bill.participant_id] ?? 'Unknown'}</td>
            <td>{bill.billing_period}</td>
            <td>{formatCurrency(bill.housing_fee)}</td>
            <td>{formatCurrency(bill.utility_charge)}</td>
            <td>{formatCurrency(bill.waiver_amount)}</td>
            <td class="total">{formatCurrency(bill.total)}</td>
            <td>
              <span class="status-badge status-{bill.status}">{bill.status}</span>
            </td>
            <td>{formatDate(bill.due_date)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .page {
    max-width: 1000px;
    margin: 0 auto;
    padding: 1.5rem;
  }

  .header {
    margin-bottom: 1rem;
  }

  .header h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #1a1a2e;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: #f8f9fa;
    border-radius: 8px;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .filter-group label {
    font-size: 0.8rem;
    font-weight: 600;
    color: #555;
    text-transform: uppercase;
  }

  .filter-group select,
  .filter-group input {
    padding: 0.4rem 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .export-group {
    margin-left: auto;
  }

  .export-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .btn-secondary {
    background: #6c757d;
    color: #fff;
    border: none;
    padding: 0.4rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    white-space: nowrap;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #5a6268;
  }

  .btn-secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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

  .bills-table {
    width: 100%;
    border-collapse: collapse;
    background: #fff;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }

  .bills-table th {
    background: #f8f9fa;
    text-align: left;
    padding: 0.75rem 0.75rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    color: #555;
    border-bottom: 2px solid #e9ecef;
  }

  .bills-table td {
    padding: 0.75rem 0.75rem;
    border-bottom: 1px solid #e9ecef;
    font-size: 0.88rem;
  }

  .bill-row {
    cursor: pointer;
    transition: background 0.15s;
  }

  .bill-row:hover {
    background: #f0f4ff;
  }

  .total {
    font-weight: 600;
  }

  .status-badge {
    display: inline-block;
    padding: 0.2rem 0.55rem;
    border-radius: 12px;
    font-size: 0.76rem;
    font-weight: 600;
    text-transform: capitalize;
  }

  .status-generated {
    background: #cce5ff;
    color: #004085;
  }

  .status-paid {
    background: #d4edda;
    color: #155724;
  }

  .status-partial {
    background: #fff3cd;
    color: #856404;
  }

  .status-overdue {
    background: #f8d7da;
    color: #721c24;
  }
</style>
