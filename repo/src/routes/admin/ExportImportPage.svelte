<script lang="ts">
  import { onMount } from 'svelte';

  let exporting = $state(false);
  let importing = $state(false);
  let message = $state('');
  let messageType = $state<'success' | 'error'>('success');
  let fileInput: HTMLInputElement;

  async function handleExport() {
    exporting = true;
    message = '';
    try {
      const { exportImportService } = await import('../../lib/services/exportImportService');
      const blob = await exportImportService.exportAll();
      const filename = `learning-center-backup-${new Date().toISOString().slice(0, 10)}.json`;
      exportImportService.triggerDownload(blob, filename);
      message = 'Export completed successfully.';
      messageType = 'success';
    } catch (err: any) {
      message = err.message || 'Export failed';
      messageType = 'error';
    } finally {
      exporting = false;
    }
  }

  async function handleImport() {
    const file = fileInput?.files?.[0];
    if (!file) {
      message = 'Please select a file to import.';
      messageType = 'error';
      return;
    }

    importing = true;
    message = '';
    try {
      const { exportImportService } = await import('../../lib/services/exportImportService');
      const result = await exportImportService.importData(file);
      if (result.success) {
        message = 'Import completed successfully. Refreshing...';
        messageType = 'success';
        setTimeout(() => window.location.reload(), 1500);
      } else {
        message = result.error || 'Import failed';
        messageType = 'error';
      }
    } catch (err: any) {
      message = err.message || 'Import failed';
      messageType = 'error';
    } finally {
      importing = false;
    }
  }
</script>

<div class="page">
  <h2>Export / Import</h2>
  <p class="description">Backup and restore all application data.</p>

  <div class="sections">
    <div class="section">
      <h3>Export Data</h3>
      <p>Download a complete backup of all data as a JSON file with SHA-256 integrity verification.</p>
      <button onclick={handleExport} disabled={exporting}>
        {exporting ? 'Exporting...' : 'Export All Data'}
      </button>
    </div>

    <div class="section">
      <h3>Import Data</h3>
      <p>Restore data from a previously exported JSON backup. The file's integrity will be verified before import.</p>
      <div class="import-controls">
        <input
          bind:this={fileInput}
          type="file"
          accept=".json"
          disabled={importing}
        />
        <button onclick={handleImport} disabled={importing}>
          {importing ? 'Importing...' : 'Import Data'}
        </button>
      </div>
      <p class="warning">Warning: Importing will overwrite existing data. Export a backup first.</p>
    </div>
  </div>

  {#if message}
    <div class="message" class:error={messageType === 'error'} class:success={messageType === 'success'}>
      {message}
    </div>
  {/if}
</div>

<style>
  .page { max-width: 700px; }
  .description { color: #64748b; margin-bottom: 1.5rem; }

  .sections { display: flex; flex-direction: column; gap: 1.5rem; }

  .section {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1.25rem;
  }

  h3 { font-size: 1rem; margin-bottom: 0.5rem; }
  .section p { font-size: 0.875rem; color: #64748b; margin-bottom: 0.75rem; }

  .import-controls { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0.5rem; }
  input[type="file"] { font-size: 0.875rem; }

  .warning { color: #d97706; font-size: 0.8rem; font-style: italic; }

  button {
    padding: 0.5rem 1rem;
    background: #4a90d9;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
  }
  button:hover:not(:disabled) { background: #3a7bc8; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  .message {
    margin-top: 1rem;
    padding: 0.75rem;
    border-radius: 4px;
    font-size: 0.875rem;
  }
  .message.success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
  .message.error { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
</style>
