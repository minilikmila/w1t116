<script lang="ts">
  import { opsConfigService } from '../../lib/services/opsConfigService';
  import type { Configuration } from '../../lib/types';

  let policies: Configuration[] = $state([]);
  let editedValues: Record<string, string> = $state({});
  let originalValues: Record<string, string> = $state({});
  let loading: boolean = $state(true);
  let saving: boolean = $state(false);
  let feedback: { type: 'success' | 'error'; message: string } | null = $state(null);

  let hasChanges: boolean = $derived(
    Object.keys(editedValues).some((key) => editedValues[key] !== originalValues[key])
  );

  async function loadPolicies(): Promise<void> {
    loading = true;
    feedback = null;
    try {
      policies = await opsConfigService.getAllPolicies();
      const vals: Record<string, string> = {};
      for (const p of policies) {
        vals[p.config_key] = String(p.value);
      }
      editedValues = { ...vals };
      originalValues = { ...vals };
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to load policies' };
    } finally {
      loading = false;
    }
  }

  async function saveChanges(): Promise<void> {
    saving = true;
    feedback = null;
    try {
      for (const key of Object.keys(editedValues)) {
        if (editedValues[key] !== originalValues[key]) {
          let parsed: unknown = editedValues[key];
          const num = Number(editedValues[key]);
          if (!isNaN(num) && editedValues[key].trim() !== '') {
            parsed = num;
          }
          await opsConfigService.setPolicy(key, parsed);
        }
      }
      feedback = { type: 'success', message: 'Policies saved successfully.' };
      await loadPolicies();
    } catch (err: any) {
      feedback = { type: 'error', message: err.message || 'Failed to save policies' };
    } finally {
      saving = false;
    }
  }

  function formatLabel(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  loadPolicies();
</script>

<div class="page">
  <h2>Policy Configuration</h2>

  {#if feedback}
    <div class="feedback {feedback.type}">{feedback.message}</div>
  {/if}

  {#if loading}
    <p class="loading">Loading policies...</p>
  {:else if policies.length === 0}
    <p>No policies found.</p>
  {:else}
    <form onsubmit={(e) => { e.preventDefault(); saveChanges(); }}>
      <div class="form-grid">
        {#each policies as policy (policy.config_key)}
          <label class="field">
            <span class="label-text">{formatLabel(policy.config_key)}</span>
            <input
              type="text"
              value={editedValues[policy.config_key] ?? ''}
              oninput={(e) => { editedValues[policy.config_key] = (e.target as HTMLInputElement).value; }}
            />
          </label>
        {/each}
      </div>

      <div class="actions">
        <button type="submit" disabled={!hasChanges || saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  {/if}
</div>

<style>
  .page {
    max-width: 700px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  h2 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
  }

  .feedback {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  .feedback.success {
    background: #d4edda;
    color: #155724;
    border: 1px solid #c3e6cb;
  }

  .feedback.error {
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
  }

  .loading {
    color: #666;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .label-text {
    font-size: 0.85rem;
    font-weight: 600;
    color: #333;
  }

  input[type="text"] {
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  input[type="text"]:focus {
    outline: none;
    border-color: #4a90d9;
    box-shadow: 0 0 0 2px rgba(74, 144, 217, 0.2);
  }

  .actions {
    margin-top: 1.5rem;
  }

  button {
    padding: 0.6rem 1.5rem;
    background: #4a90d9;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 0.9rem;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button:hover:not(:disabled) {
    background: #357abd;
  }
</style>
