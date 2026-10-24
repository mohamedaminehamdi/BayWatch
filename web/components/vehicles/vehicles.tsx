'use client';

import { CarFront, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/components/api';
import { formatDay } from '@/components/time';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PlateBadge } from '@/components/ui/plate-badge';
import type { Vehicle } from '@/lib/vehicles';
import { VehicleForm } from './vehicle-form';

const MAX = 5;

export function Vehicles() {
  const [cars, setCars] = useState<Vehicle[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Vehicle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Vehicle[]>('GET', '/api/vehicles').then(setCars, (e) => setError((e as Error).message));
  }, []);

  async function remove(v: Vehicle) {
    setBusy(true);
    try {
      await api('DELETE', `/api/vehicles/${v.id}`);
      setCars((list) => list?.filter((c) => c.id !== v.id) ?? null);
      setRemoving(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const form = (
    <VehicleForm
      onAdded={(v) => {
        setCars((list) => [...(list ?? []), v]);
        setAdding(false);
      }}
    />
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Your cars</h1>
          <p className="mt-1 text-muted">The camera at a reserved bay uses these plates to let you in.</p>
        </div>
        {cars && cars.length > 0 && cars.length < MAX && !adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-5" /> Add a car
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-danger">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-4">
        {cars === null && !error && <div className="h-28 animate-pulse rounded-3xl bg-sunken" />}
        {cars?.length === 0 && (
          <EmptyState icon={CarFront} title="No cars yet">
            Add the car you drive. You agree to plate recognition once, per car.
          </EmptyState>
        )}
        {cars?.map((c) => (
          <article key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 rounded-3xl bg-surface p-5 ring-1 ring-line sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <div className="col-span-2 sm:col-span-1">
              <PlateBadge plate={c.display} size="lg" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{c.label}</p>
              <p className="text-sm text-muted">Plate recognition on since {formatDay(c.consentAt)}</p>
            </div>
            <Button variant="ghost" onClick={() => setRemoving(c)} aria-label={`Delete ${c.label}`}>
              <Trash2 className="size-5" /> Delete
            </Button>
          </article>
        ))}
        {cars && (cars.length === 0 || adding) && (
          <section className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
            <h2 className="mb-5 font-display text-2xl">Add a car</h2>
            {form}
          </section>
        )}
        {cars && cars.length >= MAX && <p className="text-sm text-muted">You can add up to {MAX} cars.</p>}
      </div>

      <Dialog open={!!removing} onClose={() => setRemoving(null)} title="Delete this car?">
        {removing && (
          <>
            <div className="flex items-center gap-3">
              <PlateBadge plate={removing.display} />
              <span className="font-semibold">{removing.label}</span>
            </div>
            <p className="mt-4 text-muted">Its plate is deleted from your account. A booking that’s already running keeps working until it ends.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="danger" size="lg" loading={busy} onClick={() => remove(removing)}>
                Delete car
              </Button>
              <Button variant="secondary" size="lg" onClick={() => setRemoving(null)}>
                Keep it
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
