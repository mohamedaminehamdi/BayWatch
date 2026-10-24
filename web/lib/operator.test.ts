import test from 'node:test';
import assert from 'node:assert/strict';
import type { BayInfo } from './bays.ts';
import { clash } from './booking-rules.ts';
import { dayKey, hardwarePanel, lastDays, simulateWeek, weekStats } from './operator.ts';
import { createSchedule, type Alert, type Booking } from './schedule.ts';

const MIN = 60_000;
const H = 60 * MIN;
const NOW = Date.UTC(2026, 9, 24, 12); // Sat 24 Oct 2026, 14:00 in Berlin
const BAY = { name: 'Baywatch Bay 1', real: true, guard: 'hardware' as const, class: 'fast' as const };
const BW: BayInfo[] = ['bw-1', 'bw-2', 'bw-3'].map((id, i) => ({
  id,
  name: `Baywatch Bay ${i + 1}`,
  lat: 52.52,
  lng: 13.405 + i * 0.0001,
  address: 'Venue',
  points: [{ type: 'CCS', power: 200, count: 1 }],
  powerKw: 200,
  class: 'fast',
  real: true,
  guard: i < 2 ? 'hardware' : 'simulated',
}));

const rec = (over: Partial<Booking>): Booking => ({
  id: crypto.randomUUID(),
  bayId: 'bw-1',
  bay: BAY,
  ownerId: 'user_x',
  kind: 'booking',
  status: 'completed',
  plate: null,
  extraPlate: null,
  vehicleLabel: 'Car',
  createdAt: NOW - 3 * H,
  start: NOW - 2 * H,
  end: NOW - H,
  blocks: 4,
  feeCents: 250,
  demand: 'Normal',
  creditUsedCents: 0,
  firstFreeUsed: false,
  creditGrantedCents: 0,
  blockedSince: null,
  blockedMs: 0,
  reminders: [],
  sentReminders: [],
  charges: [{ kind: 'reservation', label: 'Reservation', cents: 250, at: NOW - 3 * H }],
  armed: true,
  ...over,
});

test('the last 7 days are consecutive calendar days, even across the end of daylight saving time', () => {
  assert.deepEqual(lastDays(NOW), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
  const afterDst = lastDays(Date.UTC(2026, 9, 28, 12)); // DST ended on Sun 25 Oct
  assert.equal(new Set(afterDst).size, 7);
  assert.deepEqual([afterDst[0], afterDst[6]], ['2026-10-22', '2026-10-28']);
});

test('week stats: rates, arrivals vs the start, check-ins, blocked time, credits, the overstay split and the CPO share', () => {
  const records = [
    rec({ arrivedAt: NOW - 2 * H + 4 * MIN, checkInMethod: 'camera', matchedBy: 'exact' }),
    rec({ arrivedAt: NOW - 2 * H - 2 * MIN, checkInMethod: 'camera', matchedBy: 'fuzzy', creditGrantedCents: 500 }),
    rec({ bayId: 'bw-2', arrivedAt: NOW - 2 * H + 10 * MIN, checkInMethod: 'fallback', charges: [{ kind: 'reservation', label: 'R', cents: 250, at: 0 }, { kind: 'overstay', label: 'Idle', cents: 300, at: 0 }] }),
    rec({ status: 'no_show' }),
    rec({ status: 'cancelled', charges: [{ kind: 'reservation', label: 'R', cents: 250, at: 0 }, { kind: 'released', label: 'Back', cents: -125, at: 0 }] }),
    rec({ firstFreeUsed: true, creditUsedCents: 250, charges: [{ kind: 'reservation', label: 'R', cents: 250, at: 0 }, { kind: 'credit', label: 'Free', cents: -250, at: 0 }] }),
    rec({ kind: 'walkup', feeCents: 0, charges: [{ kind: 'overstay', label: 'Idle', cents: 60, at: 0 }], arrivedAt: NOW - 2 * H, checkInMethod: 'walkup' }),
    rec({ start: NOW - 9 * 24 * H }), // older than the week: ignored
    rec({ status: 'booked', start: NOW + H, end: NOW + 2 * H }), // not started yet: not counted
  ];
  const alerts: Alert[] = [{ id: 'a', bayId: 'bw-1', since: NOW - 30 * MIN, bookingId: 'x', plate: null, status: 'resolved', resolvedAt: NOW - 20 * MIN, emailStatus: 'sent' }];
  const { kpis, days, bays, simulated } = weekStats(records, alerts, NOW);
  assert.deepEqual([kpis.reservations, kpis.walkups, kpis.ended], [6, 1, 6]);
  assert.equal(kpis.completionRate, 4 / 6);
  assert.equal(kpis.noShowRate, 1 / 6);
  assert.equal(kpis.avgArriveMs, ((4 - 2 + 10) / 3) * MIN, 'minutes after the start, on average');
  assert.deepEqual([kpis.cameraCheckIns, kpis.fallbackCheckIns, kpis.fuzzyMatches], [2, 1, 1]);
  assert.deepEqual([kpis.blockedIncidents, kpis.blockedMinutes], [1, 10]);
  assert.equal(kpis.revenueCents, 250 + 250 + 550 + 250 + 125 + 0 + 60);
  assert.deepEqual([kpis.overstayCents, kpis.overstaySplit], [360, { operatorCents: 180, platformCents: 180 }]);
  assert.deepEqual([kpis.creditsIssuedCents, kpis.creditsUsedCents], [500, 250]);
  assert.equal(kpis.cpoShareCents, Math.round((1485 - 360) * 0.7) + 180);
  assert.equal(days.at(-1)?.total, 6, 'all on today');
  assert.deepEqual(bays.map((b) => [b.bayId, b.reservations, b.walkups]), [['bw-1', 5, 1], ['bw-2', 1, 0]]);
  assert.equal(simulated, false);
});

test('revenue is what drivers paid under the booking rules: a no-show, a late cancel, an overstay and a walk-up idle fee', async () => {
  let t = Date.UTC(2026, 9, 26, 9); // Mon 26 Oct, 10:00 in Berlin
  const hw = { raise: async () => {}, lower: async () => {}, setPlates: async () => {}, status: async () => ({ state: 'blocked', mock: true }) };
  const r = createSchedule({ bays: [BW[2]], hw, wallets: { load: async () => ({ creditCents: 0, firstFree: false }), save: async () => {} }, now: () => t });
  const tick = async (ms: number) => {
    t += ms;
    await r.tick();
  };
  const book = (who: string, start: number) => r.reserve(who, { bayId: 'bw-3', start, blocks: 2, plate: 'MAB1234', vehicleLabel: 'Car' });
  await book('user_a', t + H); // 11:00, missed: the whole €2.50
  await tick(H + 16 * MIN);
  const late = await book('user_b', t + 44 * MIN); // 12:00, cancelled 20 min before: 50%
  await tick(24 * MIN);
  await r.cancel('user_b', late.id);
  const kept = await book('user_c', t + 80 * MIN); // 13:00–13:30, left at 13:40: 5 min past the free 5
  await tick(75 * MIN);
  await r.plateEvent('bw-3', 'MAB1234');
  await tick(45 * MIN);
  await r.vacated('bw-3');
  assert.equal(r.get('user_c', kept.id).totalCents, 250 + 5 * 30);
  const walk = await r.unlock('user_d', 'bw-3', { lat: 52.52, lng: 13.4052 });
  t = walk.end + 7 * MIN;
  await r.vacated('bw-3');
  assert.equal(weekStats(r.analytics().records, [], t).kpis.revenueCents, 250 + 125 + 400 + 60);
});

test('a simulated week is repeatable, inside the week, never in the future, never overlapping, and priced by the rules', () => {
  const a = simulateWeek(NOW, BW);
  assert.deepEqual(simulateWeek(NOW, BW), a, 'same seed, same week');
  const week = new Set(lastDays(NOW));
  assert.ok(a.records.length >= 30);
  assert.ok(a.records.every((r) => r.simulated && week.has(dayKey(r.start)) && r.end <= NOW && r.endedAt! <= NOW));
  assert.deepEqual(new Set(a.records.map((r) => r.status)), new Set(['completed', 'cancelled', 'no_show']));
  assert.ok(a.records.some((r) => r.kind === 'walkup') && a.records.some((r) => r.creditGrantedCents === 500));
  assert.ok(a.records.every((r) => r.ownerId.startsWith('sim:')), 'fake drivers only');
  for (const bay of BW) {
    const mine = a.records.filter((r) => r.bayId === bay.id).sort((x, y) => x.start - y.start);
    for (let i = 1; i < mine.length; i++) assert.ok(!clash(mine[i - 1].start, mine[i - 1].endedAt!, mine[i].start, mine[i].end), `no overlap on ${bay.id}`);
  }
  for (const r of a.records.filter((x) => x.status === 'no_show')) assert.equal(r.charges.reduce((s, c) => s + c.cents, 0), r.firstFreeUsed ? 0 : r.feeCents, 'a no-show keeps the fee');
  assert.equal(weekStats(a.records, a.alerts, NOW).simulated, true);
});

test('simulating again replaces the simulated data, and real drivers never see it', async () => {
  const hw = { raise: async () => {}, lower: async () => {}, setPlates: async () => {}, status: async () => ({ state: 'blocked', mock: true }) };
  const r = createSchedule({ bays: BW, hw, wallets: { load: async () => ({ creditCents: 0, firstFree: false }), save: async () => {} } });
  const sim = simulateWeek(Date.now(), BW);
  r.setSimulated(sim.records, sim.alerts);
  r.setSimulated(sim.records, sim.alerts);
  const { records, alerts } = r.analytics();
  assert.equal(records.filter((x) => x.simulated).length, sim.records.length, 'not doubled');
  assert.equal(alerts.filter((x) => x.simulated).length, sim.alerts.length);
  assert.deepEqual((await r.bookingsOf('user_anna')).past, [], 'nobody’s bookings but the simulated drivers’');
  assert.ok(r.alerts().every((a) => a.status === 'resolved'), 'simulated alerts are all closed');
});

test('hardware panel: the guard and its warnings, and the device readings with real hardware only', () => {
  const time = (at: number) => new Date(at).toISOString().slice(11, 16);
  assert.deepEqual(hardwarePanel({ state: 'blocked', mock: true, online: true }, false, time), { guard: 'up', online: true, warnings: [], rows: [] });
  const live = hardwarePanel(
    {
      state: 'free',
      mock: false,
      lockId: 'lock-0002',
      online: false,
      carPresence: 'vacant',
      autoUnlock: 'any',
      battery12V: 15.04,
      signalStrength4G: 0,
      waterIngress: false,
      activeErrors: [],
      lastSeenAt: '2026-10-24T11:20:57.105Z',
      events: true,
      stale: true,
      error: 'GET /locks/lock-0002: no answer in 5 s',
      updatedAt: Date.parse('2026-10-24T11:21:00Z'),
    },
    false,
    time,
  );
  assert.equal(live.guard, 'down');
  assert.equal(live.online, false);
  assert.deepEqual(live.warnings, ['The camera lowers the arm for any car: the hold isn’t enforced.', 'The arm is down with nobody checked in: the bay isn’t guarded.']);
  assert.deepEqual(Object.fromEntries(live.rows), {
    Lock: 'lock-0002',
    'Car sensor': 'vacant',
    'Live events': 'on',
    '12 V battery': '15.0 V',
    Signal: '0',
    Water: 'dry',
    Errors: 'none',
    'Last seen': '11:20',
    Reading: 'stale since 11:21: GET /locks/lock-0002: no answer in 5 s',
  });
  assert.deepEqual(hardwarePanel({ state: 'free', mock: false, online: true }, true, time).warnings, [], 'down for a driver checked in: as it should be');
  assert.equal(hardwarePanel({ state: 'unknown', mock: false }, false, time).guard, 'unknown');
});
