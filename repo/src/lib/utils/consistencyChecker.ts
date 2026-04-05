import { idbAccessLayer } from '../services/idbAccessLayer';
import type { Registration, Payment, Booking, Attendance, ReadReceipt } from '../types';

export interface ConsistencyIssue {
  store: string;
  record_id: string;
  issue: string;
}

export interface ConsistencyReport {
  issues: ConsistencyIssue[];
  checkedAt: number;
  storesChecked: number;
}

export async function runConsistencyCheck(): Promise<ConsistencyReport> {
  const issues: ConsistencyIssue[] = [];

  // Load reference data
  const sessions = await idbAccessLayer.getAll('sessions');
  const sessionIds = new Set(sessions.map((s: any) => s.session_id));

  const bills = await idbAccessLayer.getAll('bills');
  const billIds = new Set(bills.map((b: any) => b.bill_id));

  const rooms = await idbAccessLayer.getAll('rooms');
  const roomIds = new Set(rooms.map((r: any) => r.room_id));

  const messages = await idbAccessLayer.getAll('messages');
  const messageIds = new Set(messages.map((m: any) => m.message_id));

  // 1. Registrations → Sessions
  const registrations = await idbAccessLayer.getAll<Registration>('registrations');
  for (const reg of registrations) {
    if (!sessionIds.has(reg.session_id)) {
      issues.push({ store: 'registrations', record_id: reg.registration_id, issue: 'References non-existent session' });
    }
  }

  // 2. Payments → Bills
  const payments = await idbAccessLayer.getAll<Payment>('payments');
  for (const p of payments) {
    if (!billIds.has(p.bill_id)) {
      issues.push({ store: 'payments', record_id: p.payment_id, issue: 'References non-existent bill' });
    }
  }

  // 3. Bookings → Rooms
  const bookings = await idbAccessLayer.getAll<Booking>('bookings');
  for (const b of bookings) {
    if (!roomIds.has(b.room_id)) {
      issues.push({ store: 'bookings', record_id: b.booking_id, issue: 'References non-existent room' });
    }
  }

  // 4. Attendance → Sessions
  const attendance = await idbAccessLayer.getAll<Attendance>('attendance');
  for (const a of attendance) {
    if (!sessionIds.has(a.session_id)) {
      issues.push({ store: 'attendance', record_id: a.attendance_id, issue: 'References non-existent session' });
    }
  }

  // 5. Attendance → Registrations (soft warning)
  const regKeys = new Set(registrations.map((r) => `${r.participant_id}:${r.session_id}`));
  for (const a of attendance) {
    if (!regKeys.has(`${a.participant_id}:${a.session_id}`)) {
      issues.push({ store: 'attendance', record_id: a.attendance_id, issue: 'Warning: no matching registration for participant+session' });
    }
  }

  // 6. Read Receipts → Messages
  const receipts = await idbAccessLayer.getAll<ReadReceipt>('read_receipts');
  for (const r of receipts) {
    if (!messageIds.has(r.message_id)) {
      issues.push({ store: 'read_receipts', record_id: r.receipt_id, issue: 'References non-existent message' });
    }
  }

  return { issues, checkedAt: Date.now(), storesChecked: 6 };
}
