import { auth } from '@clerk/nextjs/server';
import { ArrowRight, CarFront, LockOpen, Navigation, WifiOff, Zap } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BaySketch } from '@/components/landing/bay-sketch';
import { buttonClass, chipClass } from '@/components/ui/button';
import { Led } from '@/components/ui/led';
import { Logo } from '@/components/ui/logo';
import { BLOCK_MS, CLASSES, HORIZON_MS, MIN_GAP_MS, TZ } from '@/lib/booking-rules';
import type { Bay } from '@/lib/booking-types';
import { directionsUrl } from '@/lib/geo';
import { reserveLink } from '@/lib/partners';
import { formatEuro } from '@/lib/pricing';
import { resolveBay, schedule } from '@/lib/server';

// Public, shareable page for any bay (bw-1…3, or a GoingElectric charger as ge-<id>): what it is, whether it's free,
// and one way in. Partner apps and shared links point here; a native app would take these URLs over as app links.
const STATUS = {
  free: { label: 'Free', tone: 'bg-brand-tint text-brand-strong', scene: 'find' },
  reserved: { label: 'Reserved', tone: 'bg-warn-tint text-warn', scene: 'guarded' },
  occupied: { label: 'Car in bay', tone: 'bg-warn-tint text-warn', scene: 'blocked' },
  offline: { label: 'Offline', tone: 'bg-warn-tint text-warn', scene: 'guarded' },
} as const;

const HOUR = 3_600_000;
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
// The three Baywatch bays say honestly whether a real barrier stands behind them
const guardNote = (b: Bay) => (b.guard === 'hardware' ? 'Real barrier' : b.real ? 'No hardware assigned yet' : 'Demo: simulated guard');

async function find(params: Promise<{ id: string }>): Promise<Bay | null> {
  try {
    return schedule.bayView(await resolveBay((await params).id.toLowerCase()));
  } catch {
    return null; // unknown id, or GoingElectric can't be reached
  }
}

// Link previews need absolute URLs: take the host the link was opened on, so it works behind a tunnel too
async function origin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto')?.split(',')[0].trim() ?? (host.startsWith('localhost') ? 'http' : 'https');
  return /^[\w.-]+(:\d+)?$/.test(host) && (proto === 'http' || proto === 'https') ? new URL(`${proto}://${host}`) : undefined;
}

export async function generateMetadata({ params }: PageProps<'/bay/[id]'>): Promise<Metadata> {
  const b = await find(params);
  if (!b) return {};
  const title = `Book ${b.name}`;
  const description = `${b.powerKw} kW charging at ${b.address}. Book a time before you set off: a guard keeps the bay free until your car arrives.`;
  const url = `/bay/${b.id}`;
  const image = { url: '/icon-512.png', width: 512, height: 512, alt: 'Baywatch' };
  return {
    metadataBase: await origin(),
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: 'Baywatch', url, title, description, images: [image] },
    twitter: { card: 'summary', title, description, images: [image.url] },
  };
}

export default async function BayPage({ params }: PageProps<'/bay/[id]'>) {
  const b = await find(params);
  if (!b) notFound();
  const s = STATUS[b.status];
  const offline = b.status === 'offline';
  // signed-out visitors sign in first, then land straight in the booking flow for this bay
  const target = reserveLink(b.id);
  const { userId } = await auth();
  const href = userId ? target : `/sign-in?redirect_url=${encodeURIComponent(target)}`;
  const longest = (CLASSES[b.class].maxBlocks * BLOCK_MS) / HOUR;

  return (
    <div className="min-h-dvh bg-page">
      <header className="mx-auto max-w-4xl px-5 py-5 sm:px-8">
        <Link href="/" aria-label="Baywatch home" className="inline-flex rounded-lg">
          <Logo />
        </Link>
      </header>

      <main id="main" className="mx-auto max-w-4xl px-5 pb-16 sm:px-8">
        <article className="grid items-center gap-8 rounded-3xl bg-surface p-6 ring-1 ring-line sm:grid-cols-[1fr_13rem] sm:p-10">
          <div>
            {/* two chips, so a long guard note wraps as a whole on a phone */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${chipClass} ${s.tone}`}>
                {!offline && <Led led={b.led} />}
                {s.label}
              </span>
              <span className={`${chipClass} ${b.guard === 'hardware' ? 'bg-sunken text-ink' : 'bg-accent-tint text-accent'}`}>{guardNote(b)}</span>
            </div>
            <h1 className="mt-4 font-display text-[clamp(2.5rem,6vw,3.5rem)] leading-[0.9] tracking-[0.012em]">{b.name}</h1>
            <p className="mt-2 text-lg text-muted">{b.address}</p>
            <p className="mt-5 flex items-center gap-2 font-semibold">
              <Zap aria-hidden className="size-5 shrink-0 text-ink" /> {b.powerKw} kW · {CLASSES[b.class].label}
            </p>
            {offline ? (
              <p role="status" className="mt-3 flex max-w-[48ch] gap-3 rounded-2xl bg-warn-tint p-4 font-semibold text-ink">
                <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
                The bay is offline right now. Try again in a few minutes.
              </p>
            ) : (
              <p className="mt-2 max-w-[48ch] text-muted">
                Book from {formatEuro(b.priceFromCents)}, in {BLOCK_MS / 60_000}-minute blocks of up to {longest} h, up to {Math.round(HORIZON_MS / (24 * HOUR))} days
                ahead. The fee is set by demand when you book.
              </p>
            )}
            {b.status === 'occupied' && (
              <p className="mt-3 flex max-w-[48ch] gap-3 rounded-2xl bg-warn-tint p-4 text-ink">
                <CarFront aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
                <span>
                  <span className="font-semibold">A car is in the bay right now.</span> You can still book a later start.
                </span>
              </p>
            )}
            {b.led === 'green' && b.status === 'free' && (
              <p className="mt-3 flex max-w-[48ch] gap-3 rounded-2xl bg-brand-tint p-4 text-ink">
                <LockOpen aria-hidden className="mt-0.5 size-5 shrink-0" />
                <span>
                  <span className="font-semibold">Free now{b.nextBookingAt ? ` until ${time.format(b.nextBookingAt - MIN_GAP_MS)}` : ''}.</span> At the bay, unlock it in the app,
                  no booking needed.
                </span>
              </p>
            )}
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href={href} className={buttonClass('primary', 'lg')}>
                Book now <ArrowRight aria-hidden className="size-5 transition-transform duration-200 group-hover:translate-x-1" />
              </Link>
              <a href={directionsUrl(b)} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'lg')}>
                <Navigation aria-hidden className="size-5" /> Navigate by car
              </a>
            </div>
            {!userId && <p className="mt-3 text-sm text-muted">You’ll sign in first, then come straight back to this bay.</p>}
          </div>
          <BaySketch scene={s.scene} className="mx-auto w-full max-w-52 max-sm:order-first" />
        </article>

        <p className="mt-6 text-sm text-muted">
          Building a charging app? Your drivers can book this bay through the{' '}
          <a href="/openapi.json" className="font-semibold text-accent underline underline-offset-2 hover:text-ink">
            Baywatch partner API
          </a>
          .
        </p>
      </main>
    </div>
  );
}
