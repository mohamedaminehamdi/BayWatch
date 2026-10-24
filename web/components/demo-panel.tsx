'use client';

import { FlaskConical } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/components/api';
import { useAppState } from '@/components/app/app-state';
import { Dialog } from '@/components/ui/dialog';
import type { Bay, BayDetail, DemandLevel } from '@/lib/booking-types';
import type { Vehicle } from '@/lib/vehicles';

const OTHER_CAR = 'B XY 987';
// null: back to the time of day (busy weekday evenings, quiet nights)
const DEMAND: { level: DemandLevel | null; label: string }[] = [
  { level: null, label: 'Auto' },
  { level: 'quiet', label: 'Quiet' },
  { level: 'normal', label: 'Normal' },
  { level: 'busy', label: 'Busy' },
  { level: 'full', label: 'Full' },
];

// What a tired camera reads: the first look-alike character swapped, else one character dropped
function misread(plate: string) {
  const swaps: Record<string, string> = { B: '8', O: '0', S: '5', I: '1', Z: '2', G: '6' };
  const i = [...plate].findIndex((c) => swaps[c]);
  return i >= 0 ? plate.slice(0, i) + swaps[plate[i]] + plate.slice(i + 1) : plate.slice(0, -1);
}

// Demo only (SIMULATOR=1): plays the bay camera and sensor for simulated bays (GoingElectric, and Baywatch Bay 3).
// Bays with a real lock only listen to the real camera and sensor; the server refuses simulated events for them.
export function DemoPanel() {
  const { state, refresh } = useAppState();
  const [open, setOpen] = useState(false);
  const [cars, setCars] = useState<Vehicle[]>([]);
  const [carId, setCarId] = useState('');
  const [bayId, setBayId] = useState('');
  const [bay, setBay] = useState<BayDetail | Bay | null>(null);
  const [last, setLast] = useState('');

  // the Baywatch bays first, then the bays of your next and active bookings
  const options = useMemo(() => {
    const list = new Map<string, string>();
    for (const b of state?.realBays ?? []) list.set(b.id, b.name);
    for (const r of [state?.viewer?.active, state?.viewer?.next]) if (r) list.set(r.bayId, r.bayName);
    return [...list];
  }, [state?.realBays, state?.viewer?.active, state?.viewer?.next]);

  useEffect(() => {
    if (!open) return;
    api<Vehicle[]>('GET', '/api/vehicles').then((list) => {
      setCars(list);
      setCarId((id) => id || list[0]?.id || '');
    }, () => {});
  }, [open]);

  const selected = bayId || options[0]?.[0] || '';
  // the selected bay's live state (is a car in it?): the shell's poll for Baywatch bays, a fetch for the rest
  const real = state?.realBays.find((b) => b.id === selected);
  useEffect(() => {
    if (!open || !selected || real) return;
    api<BayDetail>('GET', `/api/bays/${encodeURIComponent(selected)}`).then(setBay, () => setBay(null));
  }, [open, selected, real, last]);
  const current = real ?? (bay?.id === selected ? bay : null);

  if (!state?.simulator) return null;
  const car = cars.find((c) => c.id === carId);
  const simulated = current?.guard === 'simulated';

  async function run(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      setLast(`${label}: done`);
      await refresh();
    } catch (e) {
      setLast(`${label}: ${(e as Error).message}`);
    }
  }
  const plateEvent = (label: string, plate: string, direction: 'in' | 'out' = 'in') =>
    run(label, () => api('POST', '/api/sim/plate-events', { bayId: selected, plate, direction }));

  const events = [
    { label: 'My car arrives', hint: car?.display, run: () => car && plateEvent('My car arrives', car.display), needsCar: true },
    { label: 'My car, plate misread', hint: car && misread(car.display), run: () => car && plateEvent('Misread plate', misread(car.display)), needsCar: true },
    { label: 'Camera can’t read the plate', hint: 'nothing readable', run: () => plateEvent('Unreadable plate', '') },
    { label: 'Another car parks', hint: OTHER_CAR, run: () => plateEvent('Another car parks', OTHER_CAR) },
    { label: 'That car leaves', hint: OTHER_CAR, run: () => plateEvent('That car leaves', OTHER_CAR, 'out') },
    { label: 'My car leaves', hint: car?.display, run: () => car && plateEvent('My car leaves', car.display, 'out'), needsCar: true },
  ];

  return (
    <>
      {/* demo-only UI is violet, so it never reads as part of the driver's product */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent-tint px-3.5 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-accent ring-1 ring-inset ring-accent/25 hover:ring-accent"
      >
        <FlaskConical aria-hidden className="size-4" /> Demo
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Demo controls">
        <p className="text-muted">
          Plays the camera and sensor at simulated bays. Only on with <code className="font-mono text-ink">SIMULATOR=1</code>.
        </p>

        <fieldset className="mt-5">
          <legend className="font-semibold">Site demand</legend>
          <p className="text-sm text-muted">Overrides the time-of-day demand, which sets new prices. Auto goes back to the time of day.</p>
          <div className="mt-2 grid grid-cols-5 gap-1 rounded-xl bg-sunken p-1">
            {DEMAND.map((d) => (
              <button
                key={d.label}
                type="button"
                aria-pressed={state.demand === d.level}
                onClick={() => run(`Demand ${d.label.toLowerCase()}`, () => api('POST', '/api/sim/demand', { level: d.level }))}
                className="min-h-11 rounded-lg font-mono text-xs font-semibold uppercase tracking-[0.06em] text-muted transition-colors aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-sm"
              >
                {d.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-5 grid gap-1.5">
          <span className="font-semibold">Bay</span>
          <select value={selected} onChange={(e) => setBayId(e.target.value)} className="min-h-11 rounded-full border border-line-strong bg-surface px-4">
            {options.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>

        {current && !simulated ? (
          <p className="mt-4 rounded-2xl bg-sunken p-4 text-sm">
            <span className="font-semibold">{current.name} has a real lock.</span> It only listens to the real camera and car sensor, so there’s nothing to simulate here.
          </p>
        ) : (
          <>
            <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-2xl bg-sunken px-4 py-3">
              <span>
                <span className="block font-semibold">Car in bay</span>
                <span className="text-sm text-muted">A car with no booking: a booked driver gets re-routed.</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={current?.status === 'occupied'}
                disabled={!selected}
                onChange={(e) => run(e.target.checked ? 'Car in bay' : 'Bay vacated', () => api('POST', '/api/sim/bay', { bayId: selected, occupied: e.target.checked }))}
                className="size-6 shrink-0 accent-brand"
              />
            </label>

            {cars.length > 1 && (
              <label className="mt-4 grid gap-1.5">
                <span className="font-semibold">My car</span>
                <select value={carId} onChange={(e) => setCarId(e.target.value)} className="min-h-11 rounded-full border border-line-strong bg-surface px-4">
                  {cars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display} · {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {events.map((e) => (
                <button
                  key={e.label}
                  type="button"
                  disabled={!selected || (e.needsCar && !car)}
                  onClick={e.run}
                  className="flex min-h-14 flex-col items-start justify-center rounded-lg px-4 py-2 text-left ring-1 ring-line-strong hover:bg-brand-tint hover:ring-ink disabled:opacity-50"
                >
                  <span className="font-semibold">{e.label}</span>
                  {/* mono, so a misread A8 is visibly not AB (Bebas draws 0 and O alike) */}
                  {e.hint && <span className="font-mono text-sm text-muted">{e.hint}</span>}
                </button>
              ))}
            </div>
            {!cars.length && <p className="mt-3 text-sm text-muted">Add a car to send its plate.</p>}
          </>
        )}

        {last && (
          <p role="status" className="mt-4 rounded-xl bg-accent-tint px-4 py-2.5 font-mono text-sm text-ink">
            {last}
          </p>
        )}
      </Dialog>
    </>
  );
}
