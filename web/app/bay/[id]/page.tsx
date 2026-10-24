import { auth } from '@clerk/nextjs/server';
import { ArrowRight, Navigation, Zap } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BaySketch } from '@/components/landing/bay-sketch';
import { buttonClass, chipClass } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { directionsUrl } from '@/lib/geo';
import { bayId, partnerBay, reserveLink } from '@/lib/partners';
import { formatEuro, FREE_CANCEL_MIN } from '@/lib/pricing';
import { bay, holdMinutes, reservations } from '@/lib/server';

// Public, shareable page for one bay: what it is, whether it's free, and one way in.
// Partner apps and shared links point here; a native app would take these URLs over as universal / app links.
const AVAILABILITY = {
  free: { label: 'Free · reservable', tone: 'bg-brand-tint text-brand-strong', scene: 'find' },
  reserved: { label: 'Reserved', tone: 'bg-warn-tint text-warn', scene: 'guarded' },
  in_use: { label: 'In use', tone: 'bg-warn-tint text-warn', scene: 'charging' },
  occupied: { label: 'Car in bay', tone: 'bg-warn-tint text-warn', scene: 'blocked' },
  held: { label: 'Held for a waiting driver', tone: 'bg-warn-tint text-warn', scene: 'guarded' },
} as const;

const isOurBay = async (params: Promise<{ id: string }>) => (await params).id.toUpperCase() === bayId.toUpperCase();

// Link previews need absolute URLs: take the host the link was opened on, so it works behind a tunnel too
async function origin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto')?.split(',')[0].trim() ?? (host.startsWith('localhost') ? 'http' : 'https');
  return /^[\w.-]+(:\d+)?$/.test(host) && (proto === 'http' || proto === 'https') ? new URL(`${proto}://${host}`) : undefined;
}

export async function generateMetadata({ params }: PageProps<'/bay/[id]'>): Promise<Metadata> {
  if (!(await isOurBay(params))) return {};
  const title = `Reserve ${bay.name}`;
  const description = `${bay.powerKw} kW charging at ${bay.address}. Reserve before you set off: a guard keeps the bay free until your car arrives.`;
  const url = `/bay/${bayId}`;
  const image = { url: '/icon-512.png', width: 512, height: 512, alt: 'Ecurious Reserve' };
  return {
    metadataBase: await origin(),
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: 'Ecurious Reserve', url, title, description, images: [image] },
    twitter: { card: 'summary', title, description, images: [image.url] },
  };
}

export default async function BayPage({ params }: PageProps<'/bay/[id]'>) {
  if (!(await isOurBay(params))) notFound();
  const { status, feeCents, demand } = partnerBay(reservations).availability();
  const a = AVAILABILITY[status];
  const free = status === 'free';
  // signed-out visitors sign in first, then land straight on the bay
  const target = free ? reserveLink() : `/explore?bay=${encodeURIComponent(bayId)}`;
  const { userId } = await auth();
  const href = userId ? target : `/sign-in?redirect_url=${encodeURIComponent(target)}`;

  return (
    <div className="min-h-dvh bg-page">
      <header className="mx-auto max-w-4xl px-5 py-5 sm:px-8">
        <Link href="/" aria-label="Ecurious Reserve home" className="inline-flex rounded-lg">
          <Logo />
        </Link>
      </header>

      <main id="main" className="mx-auto max-w-4xl px-5 pb-16 sm:px-8">
        <article className="grid items-center gap-8 rounded-4xl bg-surface p-6 ring-1 ring-line sm:grid-cols-[1fr_13rem] sm:p-10">
          <div>
            <span className={`${chipClass} ${a.tone}`}>{a.label}</span>
            <h1 className="mt-3 font-display text-[clamp(2.2rem,6vw,3.2rem)] font-bold leading-none tracking-[-0.02em]">{bay.name}</h1>
            <p className="mt-2 text-lg text-muted">{bay.address}</p>
            <p className="mt-5 flex items-center gap-2 font-semibold">
              <Zap aria-hidden className="size-5 shrink-0 text-brand" /> {bay.powerKw} kW · one bay, kept free by a guard
            </p>
            <p className="mt-2 max-w-[48ch] text-muted">
              {free
                ? `Reserve for ${formatEuro(feeCents)} (${demand.toLowerCase()} demand right now). Arrive within ${holdMinutes} min; cancelling is free in the first ${FREE_CANCEL_MIN} min.`
                : 'Another driver has this bay right now. Open it in the app to be told when it’s free.'}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href={href} className={buttonClass('primary', 'lg')}>
                {free ? 'Reserve in Ecurious Reserve' : 'Open in Ecurious Reserve'} <ArrowRight aria-hidden className="size-5" />
              </Link>
              <a href={directionsUrl(bay)} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'lg')}>
                <Navigation aria-hidden className="size-5" /> Directions
              </a>
            </div>
            {!userId && <p className="mt-3 text-sm text-muted">You’ll sign in first, then come straight back to this bay.</p>}
          </div>
          <BaySketch scene={a.scene} className="mx-auto w-full max-w-52 max-sm:order-first" />
        </article>

        <p className="mt-6 text-sm text-muted">
          Building a charging app? Your drivers can reserve this bay through the{' '}
          <a href="/openapi.json" className="font-semibold text-brand underline underline-offset-2 hover:text-brand-strong">
            Ecurious partner API
          </a>
          .
        </p>
      </main>
    </div>
  );
}
