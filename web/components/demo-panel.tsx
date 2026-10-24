'use client';

import { FlaskConical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/components/api';
import { useAppState } from '@/components/app/app-state';
import { formatTime } from '@/components/time';
import { Dialog } from '@/components/ui/dialog';
import { formatEuro } from '@/lib/pricing';
import type { Vehicle } from '@/lib/vehicles';

const OTHER_CAR = 'B XY 987';

// The demand tier each "Site demand" level lands in (booking-rules.ts), to show which one is on
const DEMAND = [
  { level: 'quiet', label: 'Quiet', tier: 'Quiet' },
  { level: 'normal', label: 'Normal', tier: 'Normal' },
  { level: 'busy', label: 'Busy', tier: 'Busy' },
  { level: 'full', label: 'Full', tier: 'Peak' },
];

// What a tired camera reads: the first look-alike character swapped, else one character dropped
function misread(plate: string) {
  const swaps: Record<string, string> = { B: '8', O: '0', S: '5', I: '1', Z: '2', G: '6' };
  const i = [...plate].findIndex((c) => swaps[c]);
  return i >= 0 ? plate.slice(0, i) + swaps[plate[i]] + plate.slice(i + 1) : plate.slice(0, -1);
}

// Demo only (SIMULATOR=1): sends the plate events the bay camera will send, so check-in can be shown without hardware
export function DemoPanel() {
  const { state, refresh } = useAppState();
  const [open, setOpen] = useState(false);
  const [cars, setCars] = useState<Vehicle[]>([]);
  const [carId, setCarId] = useState('');
  const [last, setLast] = useState('');

  useEffect(() => {
    if (!open) return;
    api<Vehicle[]>('GET', '/api/vehicles').then((list) => {
      setCars(list);
      setCarId((id) => id || list[0]?.id || '');
    }, () => {});
  }, [open]);

  if (!state?.simulator) return null;
  const car = cars.find((c) => c.id === carId);

  async function setDemand(level: string) {
    try {
      await api('POST', '/api/sim/demand', { level });
      await refresh();
    } catch (e) {
      setLast(`Demand: ${(e as Error).message}`);
    }
  }

  async function send(label: string, plate: string, direction: 'in' | 'out' = 'in') {
    try {
      const res = await api<{ matched: boolean; matchedBy?: string }>('POST', '/api/sim/plate-events', { plate, direction });
      setLast(`${label}: ${res.matched ? `matched${res.matchedBy ? ` (${res.matchedBy})` : ''}` : 'no match'}`);
      await refresh();
    } catch (e) {
      setLast(`${label}: ${(e as Error).message}`);
    }
  }

  const events = [
    { label: 'My car arrives', hint: car?.display, run: () => car && send('My car arrives', car.display), needsCar: true },
    { label: 'My car, plate misread', hint: car && misread(car.display), run: () => car && send('Misread plate', misread(car.display)), needsCar: true },
    { label: 'Camera can’t read the plate', hint: 'nothing readable', run: () => send('Unreadable plate', '') },
    { label: 'Another car parks', hint: OTHER_CAR, run: () => send('Another car parks', OTHER_CAR) },
    { label: 'That car leaves', hint: OTHER_CAR, run: () => send('That car leaves', OTHER_CAR, 'out') },
    { label: 'My car leaves', hint: car?.display, run: () => car && send('My car leaves', car.display, 'out'), needsCar: true },
  ];

  return (
    <>
      {/* demo-only UI is violet, so it never reads as part of the driver's product */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent-tint px-3.5 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-accent ring-1 ring-inset ring-accent/25 hover:ring-accent"
      >
        <FlaskConical className="size-4" /> Demo
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Demo: bay camera">
        <p className="text-muted">
          Sends what the camera at the bay would see. Only on with <code className="font-mono text-ink">SIMULATOR=1</code>, never next to real hardware.
        </p>
        <fieldset className="mt-4">
          <legend className="font-semibold">Site demand</legend>
          <p className="text-sm text-muted">
            Sets how busy the site is, which sets the price: now {formatEuro(state.quote.cents)} ({state.quote.demand.toLowerCase()}).
          </p>
          <div className="mt-2 grid grid-cols-4 gap-1 rounded-xl bg-sunken p-1">
            {DEMAND.map((d) => (
              <button
                key={d.level}
                type="button"
                aria-pressed={state.quote.demand === d.tier}
                onClick={() => setDemand(d.level)}
                className="min-h-11 rounded-lg font-mono text-xs font-semibold uppercase tracking-[0.06em] text-muted transition-colors aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-sm"
              >
                {d.label}
              </button>
            ))}
          </div>
        </fieldset>
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
              disabled={e.needsCar && !car}
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
        {last && (
          <p role="status" className="mt-4 rounded-xl bg-accent-tint px-4 py-2.5 font-mono text-sm text-ink">
            {last}
          </p>
        )}
        <h3 className="mt-6 font-semibold">Event log</h3>
        <ol className="mt-2 grid max-h-56 gap-1.5 overflow-y-auto text-sm">
          {state.log.map((l, i) => (
            <li key={`${l.at}-${i}`} className="flex gap-3">
              <span className="shrink-0 font-mono text-muted">{formatTime(l.at)}</span>
              <span>
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.08em]">{l.type.replace(/_/g, ' ')}</span>
                {l.detail && <span className="text-muted"> · {l.detail}</span>}
              </span>
            </li>
          ))}
          {!state.log.length && <li className="text-muted">Nothing yet.</li>}
        </ol>
      </Dialog>
    </>
  );
}
