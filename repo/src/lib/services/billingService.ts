import { idbAccessLayer } from './idbAccessLayer';
import { rbacService } from './rbacService';
import { opsConfigService } from './opsConfigService';
import type { Bill, Payment, PaymentInput, Waiver, BillingRegistry, User } from '../types';

// ============================================================
// Monthly Bill Generation
// ============================================================

async function generateMonthlyBills(): Promise<Bill[]> {
  // RBAC — allow SYSTEM_ADMIN / OPS_COORDINATOR
  rbacService.checkRole(['SYSTEM_ADMIN', 'OPS_COORDINATOR']);

  // Read configuration values up-front (async, outside transaction)
  const housingFeeRaw = await opsConfigService.getPolicy('housing_fee');
  const housing_fee = typeof housingFeeRaw === 'number' ? housingFeeRaw : 950;

  const rateRaw = await opsConfigService.getPolicy('rate_per_unit');
  const rate_per_unit = typeof rateRaw === 'number' ? rateRaw : 2.0;

  // Load participants
  const participants = await idbAccessLayer.getAll<User>('users', 'idx_role', 'PARTICIPANT');

  // Load all billing registry entries (meter readings)
  const registryEntries = await idbAccessLayer.getAll<BillingRegistry>('billing_registry');

  const billing_period = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const bills: Bill[] = [];

  for (const user of participants) {
    // Find meter reading for this participant
    const meterEntry = registryEntries.find((r) => r.participant_id === user.user_id);
    let utility_charge = 0;

    if (!meterEntry || meterEntry.meter_reading === 0) {
      console.warn(
        `[billingService] Missing or zero meter reading for participant ${user.user_id}. Utility charge set to 0.`,
      );
    } else {
      utility_charge = meterEntry.meter_reading * rate_per_unit;
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
    };

    await idbAccessLayer.put('bills', bill as any);
    bills.push(bill);

    // Reset meter reading to 0
    if (meterEntry) {
      await idbAccessLayer.put('billing_registry', {
        ...meterEntry,
        meter_reading: 0,
        _version: meterEntry._version + 1,
      } as any);
    }
  }

  return bills;
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

  const paymentRecord: Payment = {
    payment_id: crypto.randomUUID(),
    bill_id: billId,
    amount: payment.amount,
    payment_method: payment.payment_method,
    payment_date: payment.payment_date,
    recorded_by: session.user_id,
    _version: 1,
  };

  await idbAccessLayer.put('payments', paymentRecord as any);

  // Check if bill is fully or partially paid
  const allPayments = await idbAccessLayer.getAll<Payment>('payments', 'idx_bill', billId);
  const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);

  if (totalPaid >= bill.total) {
    await idbAccessLayer.put('bills', {
      ...bill,
      status: 'paid',
      _version: bill._version + 1,
    } as any);
  } else if (totalPaid > 0) {
    await idbAccessLayer.put('bills', {
      ...bill,
      status: 'partial',
      _version: bill._version + 1,
    } as any);
  }

  return paymentRecord;
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
  return idbAccessLayer.get<Bill>('bills', billId);
}

async function getAllBills(participantId?: string): Promise<Bill[]> {
  if (participantId) {
    return idbAccessLayer.getAll<Bill>('bills', 'idx_participant', participantId);
  }
  return idbAccessLayer.getAll<Bill>('bills');
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
};

export default billingService;
