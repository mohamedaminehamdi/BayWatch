import { fail } from '@/lib/errors';
import { simulateWeek } from '@/lib/operator';
import { handle, requireOperator, schedule, simulator } from '@/lib/server';

// Demo only (SIMULATOR=1): fills the past week of the Baywatch bays with plausible bookings, so the dashboard has
// something to show. Replaces earlier simulated data; real bookings are untouched.
export const POST = () =>
  handle(async () => {
    if (!simulator) fail(404, 'Not found');
    await requireOperator();
    const week = simulateWeek(Date.now(), schedule.realBays());
    schedule.setSimulated(week.records, week.alerts);
    return { bookings: week.records.length, incidents: week.alerts.length };
  });
