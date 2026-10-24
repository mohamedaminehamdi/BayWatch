'use client';

import { Check, CreditCard, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/components/api';
import { useAppState } from '@/components/app/app-state';
import { formatTime, useNow } from '@/components/time';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { PlateBadge } from '@/components/ui/plate-badge';
import { VehicleForm } from '@/components/vehicles/vehicle-form';
import { bookingTerms, formatEuro, MAX_RESERVATION_CENTS } from '@/lib/pricing';
import type { Vehicle } from '@/lib/vehicles';

const MIN = 60_000;
export const formatLength = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60}` : ''}`;

export function ReserveDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { state, refresh } = useAppState();
  const now = useNow();
  const [cars, setCars] = useState<Vehicle[] | null>(null);
  const [carId, setCarId] = useState('');
  const [minutes, setMinutes] = useState<number | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<Vehicle[]>('GET', '/api/vehicles').then(
      (list) => {
        setCars(list);
        setCarId((id) => id || list[0]?.id || '');
      },
      (e) => setError((e as Error).message),
    );
  }, [open]);

  if (!state) return null;
  const { quote: q, session } = state;
  const length = minutes ?? (session.presets.includes(60) ? 60 : session.presets[0]);
  const terms = bookingTerms({ type: q.type, feeCents: q.cents, prepaid: q.prepaid, graceMinutes: state.holdMinutes });

  async function pay() {
    setBusy(true);
    setError('');
    try {
      await api('POST', '/api/reservations', { vehicleId: carId, minutes: length, priceCents: q.cents, acceptFees: true, payment: 'demo' });
      await refresh();
      router.push('/booking');
    } catch (e) {
      setError((e as Error).message);
      await refresh(); // a price change shows up straight away
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Reserve ${state.bay.name}`}>
      {cars === null && !error && <div className="h-40 animate-pulse rounded-2xl bg-sunken" />}

      {cars?.length === 0 && (
        <div>
          <p className="mb-5 text-muted">Add the car you’re driving. The camera at the bay uses its plate to let you in.</p>
          <VehicleForm
            submitLabel="Add car and continue"
            onAdded={(v) => {
              setCars([v]);
              setCarId(v.id);
            }}
          />
        </div>
      )}

      {cars && cars.length > 0 && (
        <div className="grid gap-6">
          <fieldset>
            <legend className="font-semibold">Which car?</legend>
            <div className="mt-3 grid gap-2">
              {cars.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-4 rounded-2xl p-4 ring-1 ring-line transition-shadow has-checked:bg-brand-tint has-checked:ring-2 has-checked:ring-brand"
                >
                  <input type="radio" name="car" value={c.id} checked={carId === c.id} onChange={() => setCarId(c.id)} className="sr-only" />
                  <PlateBadge plate={c.display} size="sm" />
                  <span className="flex-1 font-medium">{c.label}</span>
                  {carId === c.id && <Check className="size-5 text-brand" />}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-semibold">How long do you want to charge?</legend>
            <p className="text-sm text-muted">
              {session.label}: up to {formatLength(session.maxMinutes)}. Your session starts now and ends at {formatTime(now + length * MIN)}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {session.presets.map((m) => (
                <label
                  key={m}
                  className="cursor-pointer rounded-full px-4 py-2 font-semibold ring-1 ring-line transition-colors has-checked:bg-ink has-checked:text-white has-checked:ring-ink"
                >
                  <input type="radio" name="length" value={m} checked={length === m} onChange={() => setMinutes(m)} className="sr-only" />
                  {formatLength(m)}
                  {m === 16 && state.simulator ? ' · demo' : ''}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <h3 className="font-semibold">Price</h3>
            <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-4xl font-semibold">{formatEuro(q.cents)}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${q.multiplier > 1 ? 'bg-warn-tint text-warn' : 'bg-brand-tint text-brand-strong'}`}>
                {q.demand} demand{q.multiplier !== 1 ? ` · ${q.multiplier}×` : ''}
              </span>
              <span className="text-sm text-muted">never more than {formatEuro(MAX_RESERVATION_CENTS)}</span>
            </p>
            <p className="mt-1 text-sm text-muted">Charging itself is paid at the charger, as usual.</p>
          </div>

          {q.warning && (
            <div role="alert" className="flex gap-3 rounded-2xl bg-warn-tint p-4 text-warn">
              <TriangleAlert className="mt-0.5 size-5 shrink-0" />
              <div>
                {q.prepaid && <p className="font-semibold">You pay the fee up front</p>}
                <p className="text-ink">{q.warning}</p>
              </div>
            </div>
          )}

          <ul className="grid gap-2.5 rounded-2xl bg-sunken p-4 text-[0.95rem]">
            {[terms.arrive, terms.noShow, terms.cancel, terms.extend, terms.overstay].map((t) => (
              <li key={t} className="flex gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                {t}
              </li>
            ))}
          </ul>

          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
            <span className="font-medium">I accept these fees</span>
          </label>

          <div>
            <Button size="lg" className="w-full" loading={busy} disabled={!carId || !accepted} onClick={pay}>
              <CreditCard className="size-5" /> Pay {formatEuro(q.cents)} and reserve
            </Button>
            <p className="mt-2 text-center text-sm text-muted">Demo payment: no card is charged.</p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
