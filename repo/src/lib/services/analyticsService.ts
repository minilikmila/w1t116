import { idbAccessLayer } from './idbAccessLayer';
import type { Booking, Attendance, Bill, Payment, DateRange, SessionRecord, Room } from '../types';

// ============================================================
// Helpers
// ============================================================

function getISOWeekLabel(timestamp: number): string {
  const date = new Date(timestamp);
  // Thursday-based ISO week calculation
  const tmp = new Date(date.getTime());
  tmp.setUTCHours(0, 0, 0, 0);
  // Set to nearest Thursday: current date + 4 - current day number (Monday=1 .. Sunday=7)
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getBucketLabel(timestamp: number, granularity: 'daily' | 'weekly' | 'monthly'): string {
  const date = new Date(timestamp);
  if (granularity === 'daily') {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (granularity === 'weekly') {
    return getISOWeekLabel(timestamp);
  }
  // monthly
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// ============================================================
// Analytics Functions
// ============================================================

async function getBookingConversionRate(period: DateRange): Promise<number | 'N/A'> {
  const bookings = await idbAccessLayer.getAll<Booking>('bookings');
  const filtered = bookings.filter((b) => {
    const createdAt = b.created_at ?? 0;
    return createdAt >= period.start && createdAt <= period.end;
  });

  const total = filtered.length;
  if (total === 0) return 'N/A';

  const confirmed = filtered.filter((b) => b.status === 'confirmed').length;
  return confirmed / total;
}

async function getNoShowRate(period: DateRange): Promise<number | 'N/A'> {
  const records = await idbAccessLayer.getAll<Attendance>('attendance');
  const filtered = records.filter((r) => {
    const recordedAt = r.recorded_at ?? 0;
    return recordedAt >= period.start && recordedAt <= period.end;
  });

  const total = filtered.length;
  if (total === 0) return 'N/A';

  const noShows = filtered.filter((r) => r.attendance_status === 'no-show').length;
  return noShows / total;
}

async function getSlotUtilization(roomId: string, period: DateRange): Promise<number> {
  const bookings = await idbAccessLayer.getAll<Booking>('bookings');
  const filtered = bookings.filter((b) => {
    const status = b.status ?? 'pending';
    return (
      b.room_id === roomId &&
      b.start_time >= period.start &&
      b.end_time <= period.end &&
      status !== 'cancelled'
    );
  });

  const bookedHours = filtered.reduce((sum, b) => {
    return sum + (b.end_time - b.start_time) / (1000 * 60 * 60);
  }, 0);

  const availableHours = (period.end - period.start) / (1000 * 60 * 60);
  if (availableHours <= 0) return 0;

  const ratio = bookedHours / availableHours;
  return Math.max(0, Math.min(1, ratio));
}

async function getPaymentSuccessRate(period: DateRange): Promise<number | 'N/A'> {
  const bills = await idbAccessLayer.getAll<Bill>('bills');
  const filtered = bills.filter((b) => {
    const generatedAt = b.generated_at ?? 0;
    return generatedAt >= period.start && generatedAt <= period.end;
  });

  const total = filtered.length;
  if (total === 0) return 'N/A';

  const paid = filtered.filter((b) => b.status === 'paid').length;
  return paid / total;
}

async function getMetricsSummary(
  period: DateRange,
): Promise<{ bookingConversion: number | 'N/A'; noShowRate: number | 'N/A'; paymentSuccess: number | 'N/A' }> {
  const [bookingConversion, noShowRate, paymentSuccess] = await Promise.all([
    getBookingConversionRate(period),
    getNoShowRate(period),
    getPaymentSuccessRate(period),
  ]);

  return { bookingConversion, noShowRate, paymentSuccess };
}

async function getBookingTrend(
  period: DateRange,
  granularity: 'daily' | 'weekly' | 'monthly',
): Promise<Array<{ label: string; total: number; confirmed: number }>> {
  const bookings = await idbAccessLayer.getAll<Booking>('bookings');
  const filtered = bookings.filter((b) => {
    const createdAt = b.created_at ?? 0;
    return createdAt >= period.start && createdAt <= period.end;
  });

  const buckets = new Map<string, { total: number; confirmed: number }>();

  for (const b of filtered) {
    const createdAt = b.created_at ?? 0;
    const label = getBucketLabel(createdAt, granularity);
    const bucket = buckets.get(label) ?? { total: 0, confirmed: 0 };
    bucket.total++;
    if (b.status === 'confirmed') {
      bucket.confirmed++;
    }
    buckets.set(label, bucket);
  }

  const result: Array<{ label: string; total: number; confirmed: number }> = [];
  for (const [label, data] of buckets) {
    result.push({ label, total: data.total, confirmed: data.confirmed });
  }

  result.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return result;
}

async function getBillingTrend(
  period: DateRange,
  granularity: 'daily' | 'weekly' | 'monthly',
): Promise<Array<{ label: string; totalBilled: number; totalPaid: number }>> {
  const bills = await idbAccessLayer.getAll<Bill>('bills');
  const filtered = bills.filter((b) => {
    const generatedAt = b.generated_at ?? 0;
    return generatedAt >= period.start && generatedAt <= period.end;
  });

  const buckets = new Map<string, { totalBilled: number; totalPaid: number }>();

  for (const b of filtered) {
    const generatedAt = b.generated_at ?? 0;
    const label = getBucketLabel(generatedAt, granularity);
    const bucket = buckets.get(label) ?? { totalBilled: 0, totalPaid: 0 };
    bucket.totalBilled += b.total ?? 0;
    if (b.status === 'paid') {
      bucket.totalPaid += b.total ?? 0;
    }
    buckets.set(label, bucket);
  }

  const result: Array<{ label: string; totalBilled: number; totalPaid: number }> = [];
  for (const [label, data] of buckets) {
    result.push({ label, totalBilled: data.totalBilled, totalPaid: data.totalPaid });
  }

  result.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return result;
}

async function getRoomUtilizations(
  period: DateRange,
): Promise<Array<{ room_id: string; room_name: string; utilization: number }>> {
  const rooms = await idbAccessLayer.getAll<Room>('rooms');
  const results: Array<{ room_id: string; room_name: string; utilization: number }> = [];

  for (const room of rooms) {
    const utilization = await getSlotUtilization(room.room_id, period);
    results.push({
      room_id: room.room_id,
      room_name: room.name ?? '',
      utilization,
    });
  }

  return results;
}

// ============================================================
// Exports
// ============================================================

export const analyticsService = {
  getBookingConversionRate,
  getNoShowRate,
  getSlotUtilization,
  getPaymentSuccessRate,
  getMetricsSummary,
  getBookingTrend,
  getBillingTrend,
  getRoomUtilizations,
};

export default analyticsService;
