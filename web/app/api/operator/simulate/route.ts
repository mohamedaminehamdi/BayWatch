import { simulateWeek } from '@/lib/operator';
import { fail } from '@/lib/reservation';
import { bayType, handle, holdMinutes, requireOperator, reservations, simulator } from '@/lib/server';

// Demo only (SIMULATOR=1): fills the past week with plausible bookings so the dashboard has something to show.
// Replaces earlier simulated data; real bookings are untouched.
export const POST = () =>
  handle(async () => {
    if (!simulator) fail(404, 'Not found');
    await requireOperator();
    const week = simulateWeek(Date.now(), { type: bayType, graceMs: holdMinutes * 60_000 });
    reservations.setSimulated(week.records, week.alerts);
    return { bookings: week.records.length, incidents: week.alerts.length };
  });
