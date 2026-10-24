import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, lastDays, simulateWeek, weekStats } from './operator.ts';
import { createReservations, type Alert, type Reservation } from './reservation.ts';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 24, 12); // Sat 24 Oct 2026, 14:00 in Berlin
const BAY = { lat: 52.52, lng: 13.405 };

const rec = (over: Partial<Reservation>): Reservation => ({
  id: crypto.randomUUID(),
  ownerId: 'user_x',
  plate: null,
  extraPlate: null,
  vehicleLabel: 'Car',
  status: 'completed',
  type: 'fast',
  createdAt: NOW - 60 * MIN,
  start: NOW - 60 * MIN,
  end: NOW,
  expiresAt: NOW - 45 * MIN,
  feeCents: 150,
  demand: 'Normal',
  prepaid: false,
  reminders: [],
  sentReminders: [],
  blockedSince: null,
  blockedMs: 0,
  charges: [{ kind: 'reservation', label: 'Reservation', cents: 150, at: NOW - 60 * MIN }],
  ...over,
});

test('the last 7 days are consecutive calendar days, even across the end of daylight saving time', () => {
  assert.deepEqual(lastDays(NOW), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
  const afterDst = lastDays(Date.UTC(2026, 9, 28, 12)); // DST ended on Sun 25 Oct
  assert.equal(new Set(afterDst).size, 7);
  assert.deepEqual([afterDst[0], afterDst[6]], ['2026-10-22', '2026-10-28']);
});

test('week stats: rates, arrival time, check-in methods, blocked time and the CPO share', () => {
  const records = [
    rec({ arrivedAt: NOW - 50 * MIN, checkInMethod: 'camera', matchedBy: 'exact' }),
    rec({ arrivedAt: NOW - 40 * MIN, createdAt: NOW - 60 * MIN, checkInMethod: 'camera', matchedBy: 'fuzzy' }),
    rec({ arrivedAt: NOW - 54 * MIN, checkInMethod: 'fallback' }),
    rec({ status: 'no_show' }),
    rec({ status: 'cancelled', charges: [{ kind: 'reservation', label: 'R', cents: 150, at: 0 }, { kind: 'refund', label: 'Refund', cents: -150, at: 0 }] }),
    rec({ createdAt: NOW - 9 * 24 * 60 * MIN }), // older than the week: ignored
  ];
  const alerts: Alert[] = [
    { id: 'a', since: NOW - 30 * MIN, reservationId: 'x', plate: null, status: 'resolved', resolvedAt: NOW - 20 * MIN, emailStatus: 'sent' },
  ];
  const { kpis, days, simulated } = weekStats(records, alerts, NOW);
  assert.equal(kpis.reservations, 5);
  assert.equal(kpis.ended, 5);
  assert.equal(kpis.completionRate, 3 / 5);
  assert.equal(kpis.noShowRate, 1 / 5);
  assert.equal(kpis.avgArriveMs, ((10 + 20 + 6) / 3) * MIN);
  assert.deepEqual([kpis.cameraCheckIns, kpis.fallbackCheckIns, kpis.fuzzyMatches], [2, 1, 1]);
  assert.deepEqual([kpis.blockedIncidents, kpis.blockedMinutes], [1, 10]);
  assert.equal(kpis.revenueCents, 4 * 150, 'the refund cancels one fee');
  assert.equal(kpis.cpoShareCents, 420);
  assert.equal(days.at(-1)?.total, 5, 'all five fall on today');
  assert.equal(simulated, false);
});

test('revenue is what drivers paid under the booking rules', async () => {
  let t = NOW;
  const hw = { reserve: async () => {}, release: async () => {} };
  const r = createReservations({ hw, type: 'fast', bay: BAY, now: () => t });
  const tick = async (ms: number) => {
    t += ms;
    await r.expire();
  };
  await r.reserve('user_a', 'MAB1234', 'Car', 30 * MIN);
  await tick(16 * MIN); // no-show: half of €2.50
  await r.reserve('user_b', 'BXY1', 'Car', 30 * MIN);
  await tick(5 * MIN);
  await r.cancel('user_b'); // after the free minutes: 60% of the €1.25 no-show fee
  await r.reserve('user_c', 'BCD2', 'Car', 30 * MIN);
  await r.plateEvent('BCD2');
  r.startCharging('user_c');
  await tick(50 * MIN);
  r.finish('user_c'); // 5 min past the session's 15-min grace: €2.50 + 5 × €0.25
  assert.equal(weekStats(r.analytics().records, [], t).kpis.revenueCents, 125 + 75 + 250 + 125);
});

test('a simulated week is repeatable, stays inside the week and never in the future', () => {
  const a = simulateWeek(NOW, { type: 'fast', graceMs: 15 * MIN });
  assert.deepEqual(simulateWeek(NOW, { type: 'fast', graceMs: 15 * MIN }), a, 'same seed, same week');
  const week = new Set(lastDays(NOW));
  assert.ok(a.records.length >= 20);
  assert.ok(a.records.every((r) => r.simulated && week.has(dayKey(r.createdAt)) && r.createdAt <= NOW - 30 * MIN));
  assert.deepEqual(new Set(a.records.map((r) => r.status)), new Set(['completed', 'cancelled', 'no_show']));
  assert.ok(a.records.every((r) => r.ownerId.startsWith('sim:')), 'fake drivers only');
  assert.equal(weekStats(a.records, a.alerts, NOW).simulated, true);
  // priced like real bookings: a no-show pays half its fee, nobody pays more than the fee plus extras
  for (const r of a.records.filter((x) => x.status === 'no_show')) assert.equal(r.charges.reduce((s, c) => s + c.cents, 0), Math.floor(r.feeCents / 2));
  assert.ok(a.records.every((r) => r.endedAt! <= NOW), 'nothing ends in the future');
});

test('simulating again replaces the simulated data, and real drivers never see it', async () => {
  const hw = { reserve: async () => {}, release: async () => {} };
  const r = createReservations({ hw, type: 'fast', bay: BAY });
  await r.reserve('user_anna', 'MAB1234', 'Car', 60 * MIN);
  await r.cancel('user_anna');
  const sim = simulateWeek(Date.now(), { type: 'fast', graceMs: 15 * MIN });
  r.setSimulated(sim.records, sim.alerts);
  r.setSimulated(sim.records, sim.alerts);
  const { records, alerts } = r.analytics();
  assert.equal(records.filter((x) => x.simulated).length, sim.records.length, 'not doubled');
  assert.equal(alerts.filter((x) => x.simulated).length, sim.alerts.length);
  assert.deepEqual(r.bookings('user_anna').map((b) => b.status), ['cancelled'], 'her own booking only');
  assert.ok(r.operatorState().alerts.every((a) => a.status === 'resolved'), 'simulated alerts are all closed');
});
