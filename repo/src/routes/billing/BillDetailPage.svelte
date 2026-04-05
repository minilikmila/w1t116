<script lang="ts">
  import { onMount } from 'svelte';
  import { currentParams } from '../../lib/utils/router';
  import { billingService } from '../../lib/services/billingService';
  import { rbacService } from '../../lib/services/rbacService';
  import { navigate } from '../../lib/utils/router';
  import { get } from 'svelte/store';
  import type { Bill, Payment } from '../../lib/types';

  let bill = $state<Bill | null>(null);
  let payments = $state<Payment[]>([]);
  let loading = $state(true);
  let error = $state('');
  let canRecordPayment = $state(false);

  let billId = $derived(get(currentParams).billId ?? '');

  onMount(async () => {
    try {
      const params = get(currentParams);
      const id = params.billId;
      if (!id) {
        error = 'No bill ID provided.';
        loading = false;
        return;
      }

      const session = rbacService.getCurrentSession();
      canRecordPayment = session.role === 'SYSTEM_ADMIN' || session.role === 'OPS_COORDINATOR';

      const loadedBill = await billingService.getBill(id);
      if (!loadedBill) {
        error = 'Bill not found.';
        loading = false;
        return;
      }
      bill = loadedBill;
      payments = await billingService.getPaymentsForBill(id);
    } catch (e: any) {
      error = e.message ?? 'Failed to load bill details';
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

  function handleRecordPayment() {
    if (bill) {
      navigate('/billing/payments', { billId: bill.bill_id });
    }
  }

  function handleBack() {
    navigate('/billing');
  }
</script>

<div class="page">
  <button class="btn-link back-link" onclick={handleBack}>Back to Billing</button>

  {#if loading}
    <p class="loading">Loading bill details...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if bill}
    <div class="bill-header">
      <h2>Bill Detail</h2>
      <span class="status-badge status-{bill.status}">{bill.status}</span>
    </div>

    <div class="detail-card">
      <h3>Line Items</h3>
      <table class="line-items-table">
        <tbody>
          <tr>
            <td class="label">Participant</td>
            <td>{bill.participant_id}</td>
          </tr>
          <tr>
            <td class="label">Billing Period</td>
            <td>{bill.billing_period}</td>
          </tr>
          <tr>
            <td class="label">Housing Fee</td>
            <td>{formatCurrency(bill.housing_fee)}</td>
          </tr>
          <tr>
            <td class="label">Utility Charge</td>
            <td>{formatCurrency(bill.utility_charge)}</td>
          </tr>
          <tr>
            <td class="label">Waiver Amount</td>
            <td class="waiver">-{formatCurrency(bill.waiver_amount)}</td>
          </tr>
          <tr class="total-row">
            <td class="label">Total</td>
            <td class="total">{formatCurrency(bill.total)}</td>
          </tr>
          <tr>
            <td class="label">Due Date</td>
            <td>{formatDate(bill.due_date)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="detail-card">
      <div class="section-header">
        <h3>Payments</h3>
        {#if canRecordPayment}
          <button class="btn-primary" onclick={handleRecordPayment}>Record Payment</button>
        {/if}
      </div>

      {#if payments.length === 0}
        <p class="empty">No payments recorded for this bill.</p>
      {:else}
        <table class="payments-table">
          <thead>
            <tr>
              <th>Amount</th>
              <th>Method</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {#each payments as payment (payment.payment_id)}
              <tr>
                <td>{formatCurrency(payment.amount)}</td>
                <td class="method">{payment.payment_method}</td>
                <td>{formatDate(payment.payment_date)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 750px;
    margin: 0 auto;
    padding: 1.5rem;
  }

  .back-link {
    background: none;
    border: none;
    color: #4361ee;
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0;
    margin-bottom: 1rem;
    display: inline-block;
  }

  .back-link:hover {
    text-decoration: underline;
  }

  .bill-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .bill-header h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #1a1a2e;
  }

  .detail-card {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .detail-card h3 {
    margin: 0 0 1rem 0;
    font-size: 1.1rem;
    color: #1a1a2e;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .section-header h3 {
    margin: 0;
  }

  .line-items-table {
    width: 100%;
    border-collapse: collapse;
  }

  .line-items-table td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #f0f0f0;
    font-size: 0.9rem;
  }

  .line-items-table .label {
    font-weight: 600;
    color: #555;
    width: 40%;
  }

  .waiver {
    color: #28a745;
  }

  .total-row td {
    border-top: 2px solid #e9ecef;
    font-weight: 700;
  }

  .total {
    font-size: 1rem;
    color: #1a1a2e;
  }

  .payments-table {
    width: 100%;
    border-collapse: collapse;
  }

  .payments-table th {
    background: #f8f9fa;
    text-align: left;
    padding: 0.6rem 0.75rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    color: #555;
    border-bottom: 2px solid #e9ecef;
  }

  .payments-table td {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #e9ecef;
    font-size: 0.88rem;
  }

  .method {
    text-transform: capitalize;
  }

  .btn-primary {
    background: #4361ee;
    color: #fff;
    border: none;
    padding: 0.45rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .btn-primary:hover {
    background: #3a56d4;
  }

  .loading,
  .empty {
    text-align: center;
    color: #666;
    padding: 1.5rem 0;
  }

  .error {
    text-align: center;
    color: #e63946;
    padding: 2rem 0;
  }

  .status-badge {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    border-radius: 12px;
    font-size: 0.78rem;
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
