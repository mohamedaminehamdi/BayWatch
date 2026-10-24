'use client';

import { UserButton } from '@clerk/nextjs';
import { CarFront, Gauge, Map, Ticket, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DemoPanel } from '@/components/demo-panel';
import { chipClass } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { MicButton } from '@/components/voice/mic-button';
import { formatTime, useNow } from '../time';
import { useAppState } from './app-state';

type Item = { href: string; label: string; icon: LucideIcon };

const ITEMS: Item[] = [
  { href: '/explore', label: 'Explore', icon: Map },
  { href: '/bookings', label: 'Bookings', icon: Ticket },
  { href: '/vehicles', label: 'Vehicles', icon: CarFront },
];
const OPERATOR: Item = { href: '/operator', label: 'Operator', icon: Gauge };

// While the driver has a live booking (or a bay held for them), it's one tap away from every screen
// The next or active booking, one tap away from every screen. End times, never a ticking countdown,
// which reads like a clock time next to "15:00–17:00".
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const when = (at: number, now: number) => (sameDay(at, now) ? formatTime(at) : `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${formatTime(at)}`);

function LivePill() {
  const { state } = useAppState();
  const now = useNow();
  const r = state?.viewer?.active ?? state?.viewer?.next ?? null;
  if (!r || !now) return null;
  const label = r.blockedSince
    ? 'Bay occupied · see options'
    : r.status === 'charging'
      ? `Charging until ${formatTime(r.end)}`
      : r.status === 'walkup'
        ? `Walk-up until ${formatTime(r.end)}`
        : r.status === 'arrived'
          ? 'Checked in'
          : r.status === 'live' && now >= r.start
            ? `Held until ${formatTime(r.arriveBy)}`
            : `Starts ${when(r.start, now)}`;
  const warn = !!r.blockedSince;
  return (
    <Link
      href={`/booking/${r.id}`}
      className={`${chipClass} min-h-11 px-3.5 ring-1 ring-inset ${
        warn ? 'bg-warn-tint text-warn ring-warn/25 hover:bg-warn-tint/70' : 'bg-brand-tint text-brand-strong ring-brand/20 hover:bg-brand-soft'
      }`}
    >
      <span className="relative flex size-2">
        <span className={`absolute inset-0 animate-ping rounded-full ${warn ? 'bg-warn/60' : 'bg-brand/60'}`} />
        <span className={`relative size-2 rounded-full ${warn ? 'bg-warn' : 'bg-brand'}`} />
      </span>
      {label}
    </Link>
  );
}

export function AppNav({ operator }: { operator: boolean }) {
  const path = usePathname();
  const items = operator ? [...ITEMS, OPERATOR] : ITEMS;
  const current = (href: string) => path === href || (href === '/bookings' && path.startsWith('/booking'));

  return (
    <>
      <header className="sticky top-0 z-(--z-nav) border-b border-line bg-page/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:h-16">
          <Link href="/explore" aria-label="Baywatch, explore" className="rounded-lg">
            <Logo />
          </Link>
          <nav aria-label="App" className="hidden h-full items-stretch gap-1 lg:flex">
            {/* text only, with Ecurious's violet underline growing in from the left */}
            {items.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={current(href) ? 'page' : undefined}
                className="relative flex items-center px-3 text-[0.9375rem] font-medium text-muted transition-colors hover:text-ink aria-[current=page]:text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-200 hover:after:scale-x-100 aria-[current=page]:after:scale-x-100"
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:block">
              <LivePill />
            </div>
            <DemoPanel />
            <MicButton />
            <UserButton appearance={{ elements: { avatarBox: 'size-9' } }} />
          </div>
        </div>
        {/* the explore map fills the screen under a fixed-height header, so the pill row stays off there */}
        {path !== '/explore' && (
          <div className="flex justify-center border-t border-line px-4 py-2 empty:hidden sm:hidden">
            <LivePill />
          </div>
        )}
      </header>

      <nav
        aria-label="App"
        className="fixed inset-x-0 bottom-0 z-(--z-nav) border-t border-line bg-page/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
      >
        <ul className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={current(href) ? 'page' : undefined}
                className="relative flex min-h-15 flex-col items-center justify-center gap-1 text-xs font-semibold text-faint transition-colors aria-[current=page]:text-ink aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-6 aria-[current=page]:after:top-0 aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-accent"
              >
                <Icon className="size-5.5" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
