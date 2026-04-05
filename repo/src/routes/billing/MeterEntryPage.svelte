<script lang="ts">
  import { onMount } from 'svelte';
  import { idbAccessLayer } from '../../lib/services/idbAccessLayer';
  import { rbacService } from '../../lib/services/rbacService';
  import { navigate } from '../../lib/utils/router';
  import type { BillingRegistry, User } from '../../lib/types';

  let registryRecords = $state<BillingRegistry[]>([]);
  // CONSISTENCY FIX: replaced raw participant_id and entered_by with human-readable names
  let userNames = $state<Record<string, string>>({});
  let loading = $state(true);
  let error = $state('');
  let successMessage = $state('');
  let submitting = $state(false);

  let selectedParticipantId = $state('');
  let meterReading = $state(0);

  let participantIds = $derived(
    [...new Set(registryRecords.map((r) => r.participant_id))].sort()
  );

  onMount(async () => {
    try {
      rbacService.checkRole(['SYSTEM_ADMIN', 'OPS_COORDINATOR']);
      const [records, users] = await Promise.all([
        idbAccessLayer.getAll<BillingRegistry>('billing_registry'),
        idbAccessLayer.getAll<User>('users'),
      ]);
      registryRecords = records;
      userNames = Object.fromEntries(users.map((u) => [u.user_id, u.username]));
    } catch (e: any) {
      error = e.message ?? 'Failed to load meter data';
    } finally {
      loading = false;
    }
  });

  async function handleSubmit(event: Event) {
    event.preventDefault();
    error = '';
    successMessage = '';

    if (!selectedParticipantId) {
      error = 'Please select a participant.';
      return;
    }
    if (meterReading < 0) {
      error = 'Meter reading must be zero or greater.';
      return;
    }

    submitting = true;
    try {
      const session = rbacService.getCurrentSession();
      const existing = registryRecords.find((r) => r.participant_id === selectedParticipantId);

      if (existing) {
        const updated: BillingRegistry = {
          ...existing,
          meter_reading: meterReading,
          entered_by: session.user_id,
          entered_at: Date.now(),
          _version: existing._version + 1,
        };
        await idbAccessLayer.put('billing_registry', updated as any);

        registryRecords = registryRecords.map((r) =>
          r.registry_id === existing.registry_id ? updated : r
        );
      } else {
        const newRecord: BillingRegistry = {
          registry_id: crypto.randomUUID(),
          registry_type: 'meter',
          participant_id: selectedParticipantId,
          meter_reading: meterReading,
          entered_by: session.user_id,
          entered_at: Date.now(),
          _version: 1,
        };
        await idbAccessLayer.put('billing_registry', newRecord as any);
        registryRecords = [...registryRecords, newRecord];
      }

      successMessage = `Meter reading updated for ${userNames[selectedParticipantId] ?? selectedParticipantId}.`;
      meterReading = 0;
    } catch (e: any) {
      error = e.message ?? 'Failed to save meter reading';
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
  <h2>Meter Entry</h2>

  {#if loading}
    <p class="loading">Loading meter data...</p>
  {:else}
    {#if successMessage}
      <div class="alert alert-success">{successMessage}</div>
    {/if}
    {#if error}
      <div class="alert alert-error">{error}</div>
    {/if}

    <div class="content-grid">
      <div class="form-card">
        <h3>Enter Meter Reading</h3>
        <form onsubmit={handleSubmit}>
          <div class="form-group">
            <label for="participant-select">Participant</label>
            <select id="participant-select" bind:value={selectedParticipantId} required>
              <option value="" disabled>Select participant</option>
              <!-- CONSISTENCY FIX: replaced raw participant_id with human-readable name -->
              {#each participantIds as pid (pid)}
                <option value={pid}>{userNames[pid] ?? pid}</option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <label for="meter-reading">Meter Reading</label>
            <input id="meter-reading" type="number" step="0.01" min="0" bind:value={meterReading} required />
          </div>

          <button class="btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Submit Reading'}
          </button>
        </form>
      </div>

      <div class="registry-card">
        <h3>Current Readings</h3>
        {#if registryRecords.length === 0}
          <p class="empty">No meter readings on file.</p>
        {:else}
          <table class="registry-table">
            <thead>
              <tr>
                <th>Participant</th>
                <th>Reading</th>
                <th>Entered By</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              <!-- CONSISTENCY FIX: replaced raw participant_id and entered_by with human-readable names -->
              {#each registryRecords as record (record.registry_id)}
                <tr>
                  <td>{userNames[record.participant_id] ?? 'Unknown'}</td>
                  <td class="reading">{record.meter_reading}</td>
                  <td>{userNames[record.entered_by] ?? 'Unknown'}</td>
                  <td>{new Date(record.entered_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 900px;
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

  .content-grid {
    display: grid;
    grid-template-columns: 1fr 1.5fr;
    gap: 1.5rem;
    align-items: start;
  }

  .form-card,
  .registry-card {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
    padding: 1.25rem;
  }

  .form-card h3,
  .registry-card h3 {
    margin: 0 0 1rem 0;
    font-size: 1.05rem;
    color: #1a1a2e;
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
    padding: 0.55rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
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

  .registry-table {
    width: 100%;
    border-collapse: collapse;
  }

  .registry-table th {
    background: #f8f9fa;
    text-align: left;
    padding: 0.6rem 0.75rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    color: #555;
    border-bottom: 2px solid #e9ecef;
  }

  .registry-table td {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #e9ecef;
    font-size: 0.88rem;
  }

  .reading {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    text-align: center;
    color: #666;
    padding: 1.5rem 0;
  }

  @media (max-width: 700px) {
    .content-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
