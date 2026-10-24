'use client';

import { EyeOff, ScanLine, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/components/api';
import { BaySketch } from '@/components/landing/bay-sketch';
import { buttonClass } from '@/components/ui/button';
import { PlateBadge } from '@/components/ui/plate-badge';
import type { Vehicle } from '@/lib/vehicles';
import { VehicleForm } from './vehicle-form';

const facts = [
  { icon: ScanLine, text: 'At an Ecurious bay, the camera reads your plate and lowers the guard for you.' },
  { icon: UserCheck, text: 'It only compares the plate with your own booking.' },
  { icon: EyeOff, text: 'Each booking forgets the plate when it ends. Delete the car any time.' },
];

// First step after sign-up: the plate is what lets the driver into a reserved bay
export function Welcome() {
  const router = useRouter();
  const [cars, setCars] = useState<Vehicle[] | null>(null);
  useEffect(() => {
    api<Vehicle[]>('GET', '/api/vehicles').then(setCars, () => setCars([]));
  }, []);

  return (
    <div className="mx-auto grid w-full max-w-5xl items-start gap-10 px-5 py-8 lg:grid-cols-[1fr_1.05fr] lg:gap-16 lg:py-16">
      <div>
        <p className="font-semibold text-brand-strong">Welcome to Ecurious Reserve</p>
        <h1 className="mt-2 font-display text-5xl leading-[0.98] tracking-tight">Add your car</h1>
        <p className="mt-4 max-w-[40ch] text-lg text-muted">It takes a minute, and it’s how a reserved bay knows to let you in.</p>
        <BaySketch scene="arriving" className="mt-6 hidden w-64 lg:block" />
        <ul className="mt-6 grid gap-4">
          {facts.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-3">
              <Icon className="mt-0.5 size-5 shrink-0 text-brand" />
              <span className="text-muted">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <section className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
        {cars === null ? (
          <div className="h-80 animate-pulse rounded-2xl bg-sunken" />
        ) : cars.length ? (
          <div>
            <h2 className="font-display text-2xl">You’re all set</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              {cars.map((c) => (
                <PlateBadge key={c.id} plate={c.display} />
              ))}
            </div>
            <Link href="/explore" className={buttonClass('primary', 'lg', 'mt-6')}>
              Find a charger
            </Link>
          </div>
        ) : (
          <>
            <VehicleForm submitLabel="Add car and find a bay" onAdded={() => router.push('/explore')} />
            <Link href="/explore" className="mt-4 inline-block text-sm font-semibold text-muted underline underline-offset-2 hover:text-ink">
              Skip for now
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
