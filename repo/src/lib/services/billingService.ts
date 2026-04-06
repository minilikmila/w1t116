import { idbAccessLayer } from './idbAccessLayer';
import { rbacService } from './rbacService';
import { opsConfigService } from './opsConfigService';
import type { Bill, Payment, PaymentInput, Waiver, BillingRegistry, User } from '../types';

// ============================================================
// Monthly Bill Generation
// ============================================================

interface GenerationResult {
  bills: Bill[];
  created: number;
  skipped: number;
}

async function generateMonthlyBills(): Promise<GenerationResult> {
  // RBAC — allow SYSTEM_ADMIN / OPS_COORDINATOR
  rbacService.checkRole(['SYSTEM_ADMIN', 'OPS_COORDINATOR']);

  // Read configuration values up-front (async, outside transaction)
  const housingFeeRaw = await opsConfigService.getPolicy('housing_fee');
  const defaultHousingFee = typeof housingFeeRaw === 'number' ? housingFeeRaw : 950;

  const rateRaw = await opsConfigService.getPolicy('rate_per_unit');
  const rate_per_unit = typeof rateRaw === 'number' ? rateRaw : 2.0;

  // Load participants
  const participants = await idbAccessLayer.getAll<User>('users', 'idx_role', 'PARTICIPANT');

  // Load all billing registry entries (meter readings)
  const registryEntries = await idbAccessLayer.getAll<BillingRegistry>('billing_registry');

  // Load existing bills to check for duplicates (FIX 1)
  const existingBills = await idbAccessLayer.getAll<Bill>('bills');

  const billing_period = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const periodMonth = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const bills: Bill[] = [];
  let skipped = 0;

  // Build set of participants who already have a bill for this period (FIX 1)
  const existingBillParticipants = new Set(
    existingBills
      .filter((b) => b.billing_period === billing_period)
      .map((b) => b.participant_id),
  );

  for (const user of participants) {
    // FIX 1: skip if bill already exists for this participant and period
    if (existingBillParticipants.has(user.user_id)) {
      skipped++;
      continue;
    }

    // FIX 2: read per-participant housing_fee, fall back to global default
    const participantHousingFee = (user as any).housing_fee;
    const housing_fee = typeof participantHousingFee === 'number' ? participantHousingFee : defaultHousingFee;
    const usedDefaultHousingFee = typeof participantHousingFee !== 'number';

    // Find meter reading for this participant
    const meterEntry = registryEntries.find((r) => r.participant_id === user.user_id);
    let utility_charge = 0;
    let meterUnits = 0;

    if (!meterEntry || meterEntry.meter_reading === 0) {
      console.warn(
        `[billingService] Missing or zero meter reading for participant ${user.user_id}. Utility charge set to 0.`,
      );
    } else {
      meterUnits = meterEntry.meter_reading;
      utility_charge = meterUnits * rate_per_unit;
    }

    const subtotal = housing_fee + utility_charge;

    // Load active waivers for this participant
    const allWaivers = await idbAccessLayer.getAll<Waiver>('waivers', 'idx_participant', user.user_id);
    const activeWaivers = allWaivers.filter((w) => w.status === 'active');

    // Separate fixed vs percentage waivers
    const fixedWaivers = activeWaivers.filter((w) => w.waiver_type === 'fixed');
    const percentageWaivers = activeWaivers.filter((w) => w.waiver_type === 'percentage');

    // Apply fixed waivers first
    let total = subtotal;
    for (const fw of fixedWaivers) {
      total -= fw.value;
    }

    // Apply percentage waivers on the remainder
    for (const pw of percentageWaivers) {
      total *= 1 - pw.value / 100;
    }

    // Cap at 0 — no negative bills
    if (total < 0) {
      console.warn(
        `[billingService] Waivers caused negative total (${total}) for participant ${user.user_id}. Capping at 0.`,
      );
      total = 0;
    }

    const waiver_amount = housing_fee + utility_charge - total;

    // FIX 6: build human-readable description
    const descParts: string[] = [];
    if (housing_fee > 0) descParts.push(`Housing fee \u2014 ${periodMonth}`);
    if (utility_charge > 0) descParts.push(`Utilities \u2014 ${periodMonth}, ${meterUnits} units at $${rate_per_unit.toFixed(2)}`);
    const description = descParts.length > 0 ? descParts.join('; ') : `Monthly bill \u2014 ${periodMonth}`;

    const bill: Bill = {
      bill_id: crypto.randomUUID(),
      participant_id: user.user_id,
      billing_period,
      housing_fee,
      utility_charge,
      waiver_amount,
      total,
      status: 'generated',
      due_date: Date.now() + 10 * 24 * 60 * 60 * 1000,
      generated_at: Date.now(),
      _version: 1,
      description,
      used_default_housing_fee: usedDefaultHousingFee,
    } as any;

    await idbAccessLayer.put('bills', bill);
    bills.push(bill);

    // Reset meter reading to 0
    if (meterEntry) {
      await idbAccessLayer.put('billing_registry', {
        ...meterEntry,
        meter_reading: 0,
      } as any);
    }
  }

  return { bills, created: bills.length, skipped };
}

// ============================================================
// Payment Recording
// ============================================================

async function recordPayment(billId: string, payment: PaymentInput): Promise<Payment> {
  rbacService.checkPermission('payment:record');

  const bill = await idbAccessLayer.get<Bill>('bills', billId);
  if (!bill) {
    throw new Error(`Bill not found: ${billId}`);
  }

  const session = rbacService.getCurrentSession();

  // FIX 6: build payment description
  const billDesc = (bill as any).description || `Bill ${bill.billing_period}`;
  const recorderUser = await idbAccessLayer.get<User>('users', session.user_id);
  const recorderName = recorderUser?.username ?? session.user_id;
  const paymentDescription = `Payment for: ${billDesc}, method: ${payment.payment_method}, recorded by: ${recorderName}`;

  const paymentRecord: Payment = {
    payment_id: crypto.randomUUID(),
    bill_id: billId,
    amount: payment.amount,
    payment_method: payment.payment_method,
    payment_date: payment.payment_date,
    recorded_by: session.user_id,
    _version: 1,
    description: paymentDescription,
  } as any;

  await idbAccessLayer.put('payments', paymentRecord as any);

  // FIX 3 + FIX 4: re-read bill from IDB to get latest version, then derive status
  const freshBill = await idbAccessLayer.get<Bill>('bills', billId);
  if (freshBill) {
    const derivedStatus = await computeBillStatus(freshBill);
    if (freshBill.status !== derivedStatus) {
      try {
        await idbAccessLayer.put('bills', {
          ...freshBill,
          status: derivedStatus,
        } as any);
      } catch (err: any) {
        if (err.name === 'VersionConflictError') {
          throw new Error('This bill was updated elsewhere. Please refresh and try again.');
        }
        throw err;
      }
    }
  }

  return paymentRecord;
}

/**
 * FIX 3: Compute bill status dynamically from payments and due date.
 */
async function computeBillStatus(bill: Bill): Promise<Bill['status']> {
  const allPayments = await idbAccessLayer.getAll<Payment>('payments', 'idx_bill', bill.bill_id);
  const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);

  if (totalPaid >= bill.total) return 'paid';
  if (totalPaid > 0) return 'partial';
  if (Date.now() > bill.due_date) return 'overdue';
  return 'generated';
}

/**
 * FIX 3: Get bill with dynamically derived status and payment summary.
 */
async function getBillWithBalance(billId: string): Promise<{
  bill: Bill;
  totalPaid: number;
  remainingBalance: number;
  derivedStatus: Bill['status'];
} | undefined> {
  const bill = await getBill(billId);
  if (!bill) return undefined;

  const allPayments = await idbAccessLayer.getAll<Payment>('payments', 'idx_bill', billId);
  const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = Math.max(0, bill.total - totalPaid);
  const derivedStatus = await computeBillStatus(bill);

  return { bill, totalPaid, remainingBalance, derivedStatus };
}

// ============================================================
// Overdue Bill Detection
// ============================================================

async function markOverdueBills(): Promise<void> {
  const allBills = await idbAccessLayer.getAll<Bill>('bills');
  const now = Date.now();

  for (const bill of allBills) {
    if (bill.status === 'generated' && now > bill.due_date) {
      await idbAccessLayer.put('bills', {
        ...bill,
        status: 'overdue',
        _version: bill._version + 1,
      } as any);
    }
  }
}

// ============================================================
// CSV Export for Reconciliation
// ============================================================

async function exportReconciliationCSV(period: string): Promise<Blob> {
  rbacService.checkPermission('billing:export_csv');

  const allBills = await idbAccessLayer.getAll<Bill>('bills');
  const periodBills = allBills.filter((b) => b.billing_period === period);

  const rows: string[] = [
    'Participant ID,Billing Period,Housing Fee,Utility Charge,Waiver Amount,Total,Payments Total,Payment Methods,Status',
  ];

  for (const bill of periodBills) {
    const payments = await idbAccessLayer.getAll<Payment>('payments', 'idx_bill', bill.bill_id);
    const paymentsTotal = payments.reduce((sum, p) => sum + p.amount, 0);
    const paymentMethods = [...new Set(payments.map((p) => p.payment_method))].join(';');

    rows.push(
      [
        bill.participant_id,
        bill.billing_period,
        bill.housing_fee,
        bill.utility_charge,
        bill.waiver_amount,
        bill.total,
        paymentsTotal,
        paymentMethods,
        bill.status,
      ].join(','),
    );
  }

  const csvString = rows.join('\n');
  return new Blob([csvString], { type: 'text/csv' });
}

// ============================================================
// Simple Accessors
// ============================================================

async function getBill(billId: string): Promise<Bill | undefined> {
  const bill = await idbAccessLayer.get<Bill>('bills', billId);
  if (!bill) return undefined;

  // Role-based visibility: PARTICIPANT can only view own bills
  const session = rbacService.getCurrentSession();
  if (session.role === 'PARTICIPANT' && bill.participant_id !== session.user_id) {
    return undefined;
  }
  return bill;
}

async function getAllBills(): Promise<Bill[]> {
  const session = rbacService.getCurrentSession();

  // PARTICIPANT: only own bills
  if (session.role === 'PARTICIPANT') {
    return idbAccessLayer.getAll<Bill>('bills', 'idx_participant', session.user_id);
  }
  // SYSTEM_ADMIN, OPS_COORDINATOR: full access
  if (session.role === 'SYSTEM_ADMIN' || session.role === 'OPS_COORDINATOR') {
    return idbAccessLayer.getAll<Bill>('bills');
  }
  // INSTRUCTOR: no bill access
  return [];
}

async function getPaymentsForBill(billId: string): Promise<Payment[]> {
  return idbAccessLayer.getAll<Payment>('payments', 'idx_bill', billId);
}

// ============================================================
// Public API
// ============================================================

export const billingService = {
  generateMonthlyBills,
  recordPayment,
  markOverdueBills,
  exportReconciliationCSV,
  getBill,
  getAllBills,
  getPaymentsForBill,
  computeBillStatus,
  getBillWithBalance,
};

export default billingService;
