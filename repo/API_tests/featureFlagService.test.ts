import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockIdb, loginAs, logout } from './helpers';

// ============================================================
// Mock dependencies
// ============================================================

const mockIdb = createMockIdb();

vi.mock('../src/lib/services/idbAccessLayer', () => ({
  idbAccessLayer: mockIdb,
}));

vi.mock('../src/lib/utils/broadcastChannels', () => ({
  channelManager: {
    broadcast: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  },
  CHANNELS: { FLAG_SYNC: 'flag-sync' },
}));

const { featureFlagService } = await import('../src/lib/services/featureFlagService');

// ============================================================
// Tests
// ============================================================

describe('featureFlagService (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdb._clear();

    mockIdb.getAll.mockImplementation(async (store: string) => {
      return Array.from(mockIdb._getStore(store).values());
    });
  });

  // ----------------------------------------------------------
  // initialize
  // ----------------------------------------------------------

  describe('initialize', () => {
    it('loads flags from IDB into cache', async () => {
      mockIdb._seed('feature_flags', [{
        flag_id: 'beta-ui',
        display_name: 'Beta UI',
        description: 'Enable new UI',
        enabled: true,
        target_roles: [],
        target_org_units: [],
        created_by: 'admin',
        created_at: Date.now(),
        updated_at: Date.now(),
      }]);

      await featureFlagService.initialize({ role: 'SYSTEM_ADMIN', org_unit: 'HQ' });

      const flags = featureFlagService.getAllFlags();
      expect(flags).toHaveLength(1);
      expect(flags[0].flag_id).toBe('beta-ui');
    });
  });

  // ----------------------------------------------------------
  // createFlag
  // ----------------------------------------------------------

  describe('createFlag', () => {
    it('creates and caches a flag', async () => {
      const flag = await featureFlagService.createFlag({
        flag_id: 'new-feature',
        display_name: 'New Feature',
        description: 'A new feature',
        enabled: true,
        target_roles: ['INSTRUCTOR'],
        target_org_units: [],
      }, 'admin');

      expect(flag.flag_id).toBe('new-feature');
      expect(flag.enabled).toBe(true);
      expect(flag.created_by).toBe('admin');

      // Should be in cache
      const allFlags = featureFlagService.getAllFlags();
      expect(allFlags.some(f => f.flag_id === 'new-feature')).toBe(true);
    });

    it('persists to IDB', async () => {
      await featureFlagService.createFlag({
        flag_id: 'persisted-flag',
        display_name: 'Persisted',
        description: 'Test',
        enabled: false,
        target_roles: [],
        target_org_units: [],
      }, 'admin');

      expect(mockIdb.put).toHaveBeenCalledWith('feature_flags', expect.objectContaining({
        flag_id: 'persisted-flag',
      }));
    });
  });

  // ----------------------------------------------------------
  // evaluateFlag
  // ----------------------------------------------------------

  describe('evaluateFlag', () => {
    it('returns false for nonexistent flag', async () => {
      await featureFlagService.initialize();
      expect(featureFlagService.evaluateFlag('nope', { role: 'SYSTEM_ADMIN', org_unit: 'HQ' })).toBe(false);
    });

    it('evaluates enabled flag with matching context', async () => {
      await featureFlagService.createFlag({
        flag_id: 'eval-test',
        display_name: 'Eval',
        description: 'Test',
        enabled: true,
        target_roles: ['INSTRUCTOR'],
        target_org_units: ['Science'],
      }, 'admin');

      expect(featureFlagService.evaluateFlag('eval-test', { role: 'INSTRUCTOR', org_unit: 'Science' })).toBe(true);
      expect(featureFlagService.evaluateFlag('eval-test', { role: 'PARTICIPANT', org_unit: 'Science' })).toBe(false);
      expect(featureFlagService.evaluateFlag('eval-test', { role: 'INSTRUCTOR', org_unit: 'Math' })).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // updateFlag
  // ----------------------------------------------------------

  describe('updateFlag', () => {
    it('updates a flag and refreshes cache', async () => {
      await featureFlagService.createFlag({
        flag_id: 'update-me',
        display_name: 'Original',
        description: 'Test',
        enabled: true,
        target_roles: [],
        target_org_units: [],
      }, 'admin');

      await featureFlagService.updateFlag('update-me', { enabled: false });

      expect(featureFlagService.evaluateFlag('update-me', { role: 'SYSTEM_ADMIN', org_unit: 'HQ' })).toBe(false);
    });

    it('throws for nonexistent flag', async () => {
      await expect(featureFlagService.updateFlag('nope', { enabled: false }))
        .rejects.toThrow('Flag not found');
    });
  });

  // ----------------------------------------------------------
  // deleteFlag
  // ----------------------------------------------------------

  describe('deleteFlag', () => {
    it('removes flag from cache and IDB', async () => {
      await featureFlagService.createFlag({
        flag_id: 'delete-me',
        display_name: 'Delete',
        description: 'Test',
        enabled: true,
        target_roles: [],
        target_org_units: [],
      }, 'admin');

      await featureFlagService.deleteFlag('delete-me');

      expect(featureFlagService.evaluateFlag('delete-me', { role: 'SYSTEM_ADMIN', org_unit: 'HQ' })).toBe(false);
      expect(mockIdb.delete).toHaveBeenCalledWith('feature_flags', 'delete-me');
    });
  });
});
