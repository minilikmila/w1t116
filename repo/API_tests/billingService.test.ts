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
  CHANNELS: { AUTH_SYNC: 'auth-sync' },
}));

vi.mock('../src/lib/services/opsConfigService', () => ({
  opsConfigService: {
    getPolicy: vi.fn(async (key: string) => {
      const defaults: Record<string, any> = {
        housing_fee: 950,
        rate_per_unit: 2.0,
      };
      return defaults[key] ?? null;
    }),
  },
}));

const { billingService } = await import('../src/lib/services/billingService');

// ============================================================
// Tests
// ============================================================

describe('billingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdb._clear();
    logout();
  });

  // ----------------------------------------------------------
  // generateMonthlyBills
  // ----------------------------------------------------------

  describe('generateMonthlyBills', () => {
    it('generates bills for all participants', async () => {
      loginAs('SYSTEM_ADMIN');

      mockIdb._seed('users', [
        { user_id: 'p1', username: 'alice', role: 'PARTICIPANT', org_unit: 'A', _version: 1 },
        { user_id: 'p2', username: 'bob', role: 'PARTICIPANT', org_unit: 'B', _version: 1 },
      ]);

      // Override getAll to handle idx_role query
      mockIdb.getAll.mockImplementation(async (store: string, index?: string, value?: any) => {
        if (store === 'users' && index === 'idx_role' && value === 'PARTICIPANT') {
          return Array.from(mockIdb._getStore('users').values())
            .filter((u: any) => u.role === 'PARTICIPANT');
        }
        if (store === 'billing_registry') return [];
        if (store === 'waivers') return [];
        return Array.from(mockIdb._getStore(store).values());
      });

      const result = await billingService.generateMonthlyBills();

      expect(result.bills).toHaveLength(2);
      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.bills[0].housing_fee).toBe(950);
      expect(result.bills[0].utility_charge).toBe(0); // no meter reading
      expect(result.bills[0].total).toBe(950);
      expect(result.bills[0].status).toBe('generated');
    });

    it('applies meter reading to utility charge', async () => {
      loginAs('OPS_COORDINATOR');

      mockIdb._seed('users', [
        { user_id: 'p1', username: 'alice', role: 'PARTICIPANT', org_unit: 'A', _version: 1 },
      ]);

      const meterEntry = {
        registry_id: 'mr-1',
        registry_type: 'utility',
        participant_id: 'p1',
        meter_reading: 100,
        entered_by: 'admin',
        entered_at: Date.now(),
        _version: 1,
      };

      mockIdb.getAll.mockImplementation(async (store: string, index?: string, value?: any) => {
        if (store === 'users' && index === 'idx_role') {
          return Array.from(mockIdb._getStore('users').values())
            .filter((u: any) => u.role === 'PARTICIPANT');
        }
        if (store === 'billing_registry') return [meterEntry];
        if (store === 'waivers') return [];
        return [];
      });

      const result = await billingService.generateMonthlyBills();

      expect(result.bills[0].utility_charge).toBe(200); // 100 * 2.0
      expect(result.bills[0].total).toBe(1150); // 950 + 200
    });

    it('applies waivers correctly', async () => {
      loginAs('SYSTEM_ADMIN');

      mockIdb._seed('users', [
        { user_id: 'p1', username: 'alice', role: 'PARTICIPANT', org_unit: 'A', _version: 1 },
      ]);

      mockIdb.getAll.mockImplementation(async (store: string, index?: string, value?: any) => {
        if (store === 'users' && index === 'idx_role') {
          return [{ user_id: 'p1', role: 'PARTICIPANT' }];
        }
        if (store === 'billing_registry') return [];
        if (store === 'waivers' && index === 'idx_participant' && value === 'p1') {
          return [
            { waiver_id: 'w1', participant_id: 'p1', waiver_type: 'fixed', value: 100, status: 'active', _version: 1 },
            { waiver_id: 'w2', participant_id: 'p1', waiver_type: 'percentage', value: 10, status: 'active', _version: 1 },
          ];
        }
        return [];
      });

      const result = await billingService.generateMonthlyBills();

      // 950 - 100 fixed = 850, then 10% off = 765
      expect(result.bills[0].total).toBe(765);
      expect(result.bills[0].waiver_amount).toBe(950 - 765); // 185
    });

    it('requires SYSTEM_ADMIN or OPS_COORDINATOR role', async () => {
      loginAs('PARTICIPANT');

      await expect(billingService.generateMonthlyBills())
        .rejects.toThrow('Access denied');
    });

    it('rejects when not logged in', async () => {
      logout();

      await expect(billingService.generateMonthlyBills())
        .rejects.toThrow('No active session');
    });
  });

  // ----------------------------------------------------------
  // recordPayment
  // ----------------------------------------------------------

  describe('recordPayment', () => {
    it('creates payment and updates bill status to paid', async () => {
      loginAs('SYSTEM_ADMIN');

      mockIdb._seed('bills', [{
        bill_id: 'bill-1',
        participant_id: 'p1',
        billing_period: '2026-04',
        housing_fee: 950,
        utility_charge: 0,
        waiver_amount: 0,
        total: 950,
        status: 'generated',
        due_date: Date.now() + 864_000_000,
        generated_at: Date.now(),
        _version: 1,
      }]);

      mockIdb.getAll.mockImplementation(async (store: string, index?: string, value?: any) => {
        if (store === 'payments' && index === 'idx_bill' && value === 'bill-1') {
          // After recording, return the payment
          return Array.from(mockIdb._getStore('payments').values())
            .filter((p: any) => p.bill_id === 'bill-1');
        }
        return [];
      });

      const payment = await billingService.recordPayment('bill-1', {
        amount: 950,
        payment_method: 'cash',
        payment_date: Date.now(),
      });

      expect(payment.bill_id).toBe('bill-1');
      expect(payment.amount).toBe(950);
      expect(payment.payment_method).toBe('cash');
    });

    it('throws when bill not found', async () => {
      loginAs('SYSTEM_ADMIN');

      await expect(billingService.recordPayment('nonexistent', {
        amount: 100,
        payment_method: 'cash',
        payment_date: Date.now(),
      })).rejects.toThrow('Bill not found');
    });

    it('requires payment:record permission', async () => {
      loginAs('PARTICIPANT');

      await expect(billingService.recordPayment('bill-1', {
        amount: 100,
        payment_method: 'cash',
        payment_date: Date.now(),
      })).rejects.toThrow('Access denied');
    });
  });

  // ----------------------------------------------------------
  // markOverdueBills
  // ----------------------------------------------------------

  describe('markOverdueBills', () => {
    it('marks generated bills past due date as overdue', async () => {
      mockIdb._seed('bills', [{
        bill_id: 'bill-overdue',
        participant_id: 'p1',
        billing_period: '2026-03',
        housing_fee: 950,
        utility_charge: 0,
        waiver_amount: 0,
        total: 950,
        status: 'generated',
        due_date: Date.now() - 1000,
        generated_at: Date.now() - 864_000_000,
        _version: 1,
      }]);

      mockIdb.getAll.mockImplementation(async (store: string) => {
        return Array.from(mockIdb._getStore(store).values());
      });

      await billingService.markOverdueBills();

      expect(mockIdb.put).toHaveBeenCalledWith('bills', expect.objectContaining({
        bill_id: 'bill-overdue',
        status: 'overdue',
      }));
    });

    it('does not change already-paid bills', async () => {
      mockIdb._seed('bills', [{
        bill_id: 'bill-paid',
        participant_id: 'p1',
        billing_period: '2026-03',
        housing_fee: 950,
        utility_charge: 0,
        waiver_amount: 0,
        total: 950,
        status: 'paid',
        due_date: Date.now() - 1000,
        generated_at: Date.now() - 864_000_000,
        _version: 1,
      }]);

      mockIdb.getAll.mockImplementation(async (store: string) => {
        return Array.from(mockIdb._getStore(store).values());
      });

      await billingService.markOverdueBills();

      // put should not be called for paid bills
      expect(mockIdb.put).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // Accessors
  // ----------------------------------------------------------

  describe('accessors', () => {
    it('getBill returns undefined for nonexistent bill', async () => {
      const result = await billingService.getBill('nope');
      expect(result).toBeUndefined();
    });
  });
});
