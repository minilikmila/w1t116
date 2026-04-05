import { idbAccessLayer } from './idbAccessLayer';
import { rbacService } from './rbacService';

const SCHEMA_VERSION = 1;
const ALL_STORES = [
  'users', 'bookings', 'sessions', 'registrations', 'bills', 'payments',
  'messages', 'read_receipts', 'reminders', 'send_logs', 'billing_registry',
  'configuration', 'feature_flags', 'idempotency_keys', 'scheduler_tasks',
  'error_logs', 'maintenance_windows', 'blacklist_rules', 'attendance',
  'rooms', 'equipment', 'waivers',
];

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const byteArray = new Uint8Array(buffer);
  return Array.from(byteArray)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

type MigrationFn = (data: Record<string, any[]>) => Record<string, any[]>;

const MIGRATIONS: Record<number, MigrationFn> = {};

function applyMigrations(data: Record<string, any[]>, fromVersion: number): Record<string, any[]> {
  let migrated = data;
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    const migrationFn = MIGRATIONS[v];
    if (!migrationFn) {
      throw new Error(`Missing migration function for version ${v}`);
    }
    migrated = migrationFn(migrated);
  }
  return migrated;
}

async function exportAll(): Promise<Blob> {
  rbacService.checkPermission('export_import:manage');

  const data: Record<string, any[]> = {};
  for (const store of ALL_STORES) {
    data[store] = await idbAccessLayer.getAll(store);
  }

  const payload = JSON.stringify(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const hexHash = arrayBufferToHex(hashBuffer);

  const envelope = {
    schema_version: SCHEMA_VERSION,
    sha256: hexHash,
    data,
    exported_at: new Date().toISOString(),
  };

  return new Blob([JSON.stringify(envelope)], { type: 'application/json' });
}

async function importData(file: File): Promise<{ success: boolean; error?: string }> {
  rbacService.checkPermission('export_import:manage');

  const text = await file.text();
  const envelope = JSON.parse(text);

  // Verify SHA-256 integrity
  const computedHashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(envelope.data)),
  );
  const computedHash = arrayBufferToHex(computedHashBuffer);

  if (computedHash !== envelope.sha256) {
    return { success: false, error: 'Integrity check failed: SHA-256 hash mismatch' };
  }

  // Check schema version
  if (envelope.schema_version > SCHEMA_VERSION) {
    return {
      success: false,
      error: 'Import file is from a newer version. Please update the application.',
    };
  }

  let data: Record<string, any[]> = envelope.data;

  if (envelope.schema_version < SCHEMA_VERSION) {
    data = applyMigrations(data, envelope.schema_version);
  }

  // Write all data to IndexedDB
  try {
    for (const store of Object.keys(data)) {
      for (const record of data[store]) {
        await idbAccessLayer.put(store, record);
      }
    }
  } catch (err) {
    return {
      success: false,
      error: `Import failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { success: true };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const exportImportService = { exportAll, importData, triggerDownload };
export default exportImportService;
