import { describe, it, expect } from 'vitest';

// ============================================================
// Pure billing calculation logic — extracted for testability
// ============================================================

/**
 * Mirrors the waiver application algorithm from billingService.generateMonthlyBills.
 * Fixed waivers first, then percentage waivers on the remainder, capped at 0.
 */
function computeBillTotal(
  housingFee: number,
  utilityCharge: number,
  fixedWaivers: number[],
  percentageWaivers: number[],
): number {
  let total = housingFee + utilityCharge;

  for (const fixed of fixedWaivers) {
    total -= fixed;
  }

  for (const pct of percentageWaivers) {
    total *= 1 - pct / 100;
  }

  return Math.max(total, 0);
}

function computeUtilityCharge(meterReading: number, ratePerUnit: number): number {
  return meterReading * ratePerUnit;
}

function isOverdue(status: string, dueDate: number, now: number): boolean {
  return status === 'generated' && now > dueDate;
}

function determineBillStatus(
  totalBilled: number,
  totalPaid: number,
): 'generated' | 'paid' | 'partial' {
  if (totalPaid >= totalBilled) return 'paid';
  if (totalPaid > 0) return 'partial';
  return 'generated';
}

// ============================================================
// Tests
// ============================================================

describe('billing calculation logic', () => {
  // ----------------------------------------------------------
  // Utility charge
  // ----------------------------------------------------------

  describe('computeUtilityCharge', () => {
    it('computes charge = reading * rate', () => {
      expect(computeUtilityCharge(100, 2.0)).toBe(200);
    });

    it('returns 0 for zero meter reading', () => {
      expect(computeUtilityCharge(0, 2.0)).toBe(0);
    });

    it('handles fractional rates', () => {
      expect(computeUtilityCharge(150, 1.5)).toBe(225);
    });
  });

  // ----------------------------------------------------------
  // Bill total with waivers
  // ----------------------------------------------------------

  describe('computeBillTotal', () => {
    it('computes subtotal when no waivers exist', () => {
      expect(computeBillTotal(950, 200, [], [])).toBe(1150);
    });

    it('applies fixed waivers first', () => {
      // 950 + 200 = 1150, minus 100 fixed = 1050
      expect(computeBillTotal(950, 200, [100], [])).toBe(1050);
    });

    it('applies percentage waivers on remainder after fixed', () => {
      // 950 + 200 = 1150, minus 150 fixed = 1000, then 10% off = 900
      expect(computeBillTotal(950, 200, [150], [10])).toBe(900);
    });

    it('applies multiple fixed waivers cumulatively', () => {
      // 950 + 200 = 1150, minus 100 - 50 = 1000
      expect(computeBillTotal(950, 200, [100, 50], [])).toBe(1000);
    });

    it('applies multiple percentage waivers sequentially', () => {
      // 1000, 10% off = 900, 20% off = 720
      expect(computeBillTotal(800, 200, [], [10, 20])).toBe(720);
    });

    it('caps negative totals at 0', () => {
      // 950 + 0 = 950, minus 1000 = -50, capped to 0
      expect(computeBillTotal(950, 0, [1000], [])).toBe(0);
    });

    it('handles 100% percentage waiver', () => {
      expect(computeBillTotal(950, 200, [], [100])).toBe(0);
    });

    it('handles zero housing fee and zero utility', () => {
      expect(computeBillTotal(0, 0, [], [])).toBe(0);
    });

    it('large combined waivers exceed subtotal and cap at 0', () => {
      expect(computeBillTotal(100, 50, [200, 100], [50])).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // Overdue detection
  // ----------------------------------------------------------

  describe('isOverdue', () => {
    it('returns true when generated and past due', () => {
      expect(isOverdue('generated', 1000, 2000)).toBe(true);
    });

    it('returns false when generated but not yet past due', () => {
      expect(isOverdue('generated', 2000, 1000)).toBe(false);
    });

    it('returns false when already paid even if past due', () => {
      expect(isOverdue('paid', 1000, 2000)).toBe(false);
    });

    it('returns false for partial status', () => {
      expect(isOverdue('partial', 1000, 2000)).toBe(false);
    });

    it('boundary: returns false when now === dueDate', () => {
      expect(isOverdue('generated', 1000, 1000)).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // Bill status determination
  // ----------------------------------------------------------

  describe('determineBillStatus', () => {
    it('returns "paid" when totalPaid >= totalBilled', () => {
      expect(determineBillStatus(1000, 1000)).toBe('paid');
      expect(determineBillStatus(1000, 1500)).toBe('paid');
    });

    it('returns "partial" when some paid but not full', () => {
      expect(determineBillStatus(1000, 500)).toBe('partial');
      expect(determineBillStatus(1000, 1)).toBe('partial');
    });

    it('returns "generated" when nothing paid', () => {
      expect(determineBillStatus(1000, 0)).toBe('generated');
    });

    it('handles zero bill total (paid immediately)', () => {
      expect(determineBillStatus(0, 0)).toBe('paid');
    });
  });
});
