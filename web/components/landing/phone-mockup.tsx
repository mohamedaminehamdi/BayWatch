'use client';

import { CarFront, Navigation, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PlateBadge } from '@/components/ui/plate-badge';
import { ARRIVAL_GRACE_MS } from '@/lib/booking-rules';

// the booking screen's stepper (components/booking/status-stepper.tsx), at "Live"
const STEPS = ['Booked', 'Live', 'Checked in', 'Charging', 'Done'];
const AT = 1;
const GRACE_S = ARRIVAL_GRACE_MS / 1000;

// The booking screen as the driver sees it on the way to the bay. Decorative: hidden from screen readers,
// the hero copy says the same thing in words.
export function PhoneMockup() {
  const [left, setLeft] = useState(GRACE_S - 139);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : GRACE_S)), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div aria-hidden className="w-[17.5rem] select-none rounded-[2.75rem] bg-ink p-2.5 shadow-[0_24px_50px_rgb(15_20_25/0.32),0_0_0_1px_rgb(255_255_255/0.08)_inset] sm:w-[19rem]">
      <div className="relative overflow-hidden rounded-[2.25rem] bg-page pb-6 text-ink">
        <div className="flex items-center justify-between px-6 pt-3.5 text-[0.7rem] font-semibold text-ink">
          <span>9:41</span>
          <span className="h-5 w-20 rounded-full bg-ink" />
          <span className="flex items-end gap-0.5">
            {[5, 7, 9, 11].map((h) => (
              <span key={h} className="w-1 rounded-sm bg-ink" style={{ height: h }} />
            ))}
          </span>
        </div>

        <div className="px-4 pt-5">
          <p className="font-display text-xl leading-none tracking-[0.012em]">Your booking</p>

          {/* mirrors the live-booking card: ink, with the countdown in lime */}
          <div className="mt-3 rounded-2xl bg-brand-deep p-4 text-on-brand">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-signal px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-ink">
              <span className="relative flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-ink/50" />
                <span className="relative size-2 rounded-full bg-ink" />
              </span>
              Held for you
            </span>
            <p className="mt-2 font-display text-[4rem] leading-[0.85] text-signal">
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
            </p>
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-on-brand-muted">
              <Timer className="size-3.5" /> Left to arrive · guard up
            </p>
            <div className="mt-4 border-t border-white/14 pt-3.5">
              <p className="font-semibold leading-tight">Baywatch Bay 1</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-on-brand-muted">CCS · 200 kW · 1.2 km</p>
                <PlateBadge plate="M AB 1234" size="sm" />
              </div>
            </div>
          </div>

          <ol className="mt-4 grid grid-cols-5 gap-1">
            {STEPS.map((s, i) => (
              <li key={s} className="flex flex-col gap-1.5">
                <span className={`h-1 rounded-full ${i <= AT ? 'bg-brand' : 'bg-line'}`} />
                <span className={`text-[0.6rem] font-semibold leading-tight ${i === AT ? 'text-ink' : i < AT ? 'text-muted' : 'text-faint'}`}>{s}</span>
              </li>
            ))}
          </ol>

          <div className="mt-4 grid gap-2">
            <span className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand font-mono text-xs font-semibold uppercase tracking-[0.06em] text-on-brand">
              <Navigation className="size-4" /> Navigate by car
            </span>
            <span className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-surface px-3 font-mono text-xs font-semibold uppercase tracking-[0.06em] ring-1 ring-line-strong">
              <CarFront className="size-4" /> Different car today
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
