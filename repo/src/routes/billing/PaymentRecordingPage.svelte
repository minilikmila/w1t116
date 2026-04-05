<script lang="ts">
  import { onMount } from 'svelte';
  import { billingService } from '../../lib/services/billingService';
  import { rbacService } from '../../lib/services/rbacService';
  import { idbAccessLayer } from '../../lib/services/idbAccessLayer';
  import { navigate, currentQuery } from '../../lib/utils/router';
  import { get } from 'svelte/store';
  import type { Bill, PaymentInput, User } from '../../lib/types';

  let bills = $state<Bill[]>([]);
  // CONSISTENCY FIX: replaced raw participant_id in bill dropdown with human-readable names
  let userNames = $state<Record<string, string>>({});
  let loading = $state(true);
  let error = $state('');
  let successMessage = $state('');
  let submitting = $state(false);

  let selectedBillId = $state('');
  let amount = $state(0);
  let paymentMethod = $state<'cash' | 'check' | 'manual'>('cash');
  let paymentDate = $state(new Date().toISOString().slice(0, 10));

  onMount(async () => {
    try {
      rbacService.checkPermission('payment:record');
      const [loadedBills, users] = await Promise.all([
        billingService.getAllBills(),
        idbAccessLayer.getAll<User>('users'),
      ]);
      bills = loadedBills;
      userNames = Object.fromEntries(users.map((u) => [u.user_id, u.username]));

      const query = get(currentQuery);
      if (query.billId) {
        selectedBillId = query.billId;
      }
    } catch (e: any) {
      error = e.message ?? 'Failed to initialize payment form';
    } finally {
      loading = false;
    }
  });

  async function handleSubmit(event: Event) {
    event.preventDefault();
    error = '';
    successMessage = '';

    if (!selectedBillId) {
      error = 'Please select a bill.';
      return;
    }
    if (amount <= 0) {
      error = 'Amount must be greater than zero.';
      return;
    }

    submitting = true;
    try {
      const input: PaymentInput = {
        amount,
        payment_method: paymentMethod,
        payment_date: new Date(paymentDate).getTime(),
      };
      await billingService.recordPayment(selectedBillId, input);
      successMessage = 'Payment recorded successfully.';
      amount = 0;
    } catch (e: any) {
      error = e.message ?? 'Failed to record payment';
    } finally {
      submitting = false;
    }
  }

  function handleBack() {
    navigate('/billing');
  }
</script>

<div class="page">
  <button class="btn-link back-link" onclick={handleBack}>Back to Billing</button>
  <h2>Record Payment</h2>

  {#if loading}
    <p class="loading">Loading...</p>
  {:else}
    {#if successMessage}
      <div class="alert alert-success">{successMessage}</div>
    {/if}
    {#if error}
      <div class="alert alert-error">{error}</div>
    {/if}

    <form class="payment-form" onsubmit={handleSubmit}>
      <div class="form-group">
        <label for="bill-select">Bill</label>
        <select id="bill-select" bind:value={selectedBillId} required>
          <option value="" disabled>Select a bill</option>
          <!-- CONSISTENCY FIX: replaced raw participant_id with human-readable name, replaced raw bill_id with descriptive label -->
          {#each bills as b (b.bill_id)}
            <option value={b.bill_id}>
              Bill &mdash; {b.billing_period} | {userNames[b.participant_id] ?? 'Unknown'} (${b.total.toFixed(2)}) [{b.status}]
            </option>
          {/each}
        </select>
      </div>

      <div class="form-group">
        <label for="amount">Amount ($)</label>
        <input id="amount" type="number" step="0.01" min="0.01" bind:value={amount} required />
      </div>

      <div class="form-group">
        <label for="method">Payment Method</label>
        <select id="method" bind:value={paymentMethod}>
          <option value="cash">Cash</option>
          <option value="check">Check</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      <div class="form-group">
        <label for="payment-date">Payment Date</label>
        <input id="payment-date" type="date" bind:value={paymentDate} required />
      </div>

      <button class="btn-primary" type="submit" disabled={submitting}>
        {submitting ? 'Recording...' : 'Record Payment'}
      </button>
    </form>
  {/if}
</div>

<style>
  .page {
    max-width: 550px;
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

  h2 {
    margin: 0 0 1.5rem 0;
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

  .payment-form {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
    padding: 1.5rem;
  }

  .form-group {
    margin-bottom: 1.25rem;
  }

  .form-group label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: #333;
    margin-bottom: 0.35rem;
  }

  .form-group select,
  .form-group input {
    width: 100%;
    padding: 0.5rem 0.6rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 0.9rem;
    box-sizing: border-box;
  }

  .form-group select:focus,
  .form-group input:focus {
    outline: none;
    border-color: #4361ee;
    box-shadow: 0 0 0 2px rgba(67, 97, 238, 0.15);
  }

  .btn-primary {
    background: #4361ee;
    color: #fff;
    border: none;
    padding: 0.6rem 1.5rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.95rem;
    font-weight: 500;
    width: 100%;
  }

  .btn-primary:hover:not(:disabled) {
    background: #3a56d4;
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
