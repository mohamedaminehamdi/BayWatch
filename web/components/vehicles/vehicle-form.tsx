'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/components/api';
import { Button } from '@/components/ui/button';
import { Field, inputClass } from '@/components/ui/field';
import { PlateBadge } from '@/components/ui/plate-badge';
import type { Vehicle } from '@/lib/vehicles';

// Add a car: plate, nickname, and consent to plate recognition (asked once, per car)
export function VehicleForm({ onAdded, submitLabel = 'Add car' }: { onAdded: (v: Vehicle) => void; submitLabel?: string }) {
  const [plate, setPlate] = useState('');
  const [label, setLabel] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onAdded(await api<Vehicle>('POST', '/api/vehicles', { plate, label, consent }));
      setPlate('');
      setLabel('');
      setConsent(false);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <Field label="License plate" hint="As it is on the plate, for example M AB 1234">
        <input
          value={plate}
          onChange={(e) => setPlate(e.target.value.toUpperCase())}
          required
          maxLength={14}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="M AB 1234"
          className={`${inputClass} font-mono text-lg font-semibold uppercase tracking-[0.06em]`}
        />
      </Field>
      {plate.trim() && (
        <div aria-hidden className="-mt-2">
          <PlateBadge plate={plate.trim()} />
        </div>
      )}
      <Field label="Nickname (optional)">
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} placeholder="Blue Zoe" className={inputClass} />
      </Field>
      <label className="flex cursor-pointer gap-3 rounded-2xl bg-sunken p-4">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
        <span className="text-[0.95rem] leading-relaxed">
          <span className="font-semibold">Use this plate to check me in at Baywatch bays.</span> The camera compares what it reads
          with your booking only. Each booking forgets the plate when it ends, and you can delete this car at any time.
        </span>
      </label>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" loading={busy} disabled={!plate.trim() || !consent}>
        {submitLabel}
      </Button>
    </form>
  );
}
