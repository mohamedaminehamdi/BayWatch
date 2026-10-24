import { Show } from '@clerk/nextjs';
import { ArrowRight, CarFront, MessagesSquare, ScanLine, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { BaySketch } from '@/components/landing/bay-sketch';
import { LiveBayStatus } from '@/components/landing/live-bay-status';
import { NearbyChargers } from '@/components/landing/nearby-chargers';
import { PhoneMockup } from '@/components/landing/phone-mockup';
import { buttonClass } from '@/components/ui/button';
import { Logo, PoweredByEcurious } from '@/components/ui/logo';
import { BLOCKED_DC_HOUR_MARGIN, CPO_SHARE, EXTENSION_MIN, feeRules, formatEuro, FREE_CANCEL_MIN, PRICES, RESERVATION_FROM_CENTS } from '@/lib/pricing';
import { holdMinutes } from '@/lib/server';

// Ecurious's container: 1280px wide, with gutters that grow with the screen
const wrap = 'mx-auto max-w-7xl px-[clamp(1.25rem,5vw,5rem)]';
const h2 = 'font-display text-[clamp(2.5rem,5vw,4.5rem)] leading-[0.9] tracking-[0.012em]';
const arrow = <ArrowRight className="size-5 transition-transform duration-200 group-hover:translate-x-1" />;
// Ecurious's square bullet: decorative, the text says it all
const bullet = <span aria-hidden className="mt-2 size-2 shrink-0 bg-signal" />;

const steps = [
  { scene: 'find', title: 'Find', text: 'Search public chargers on the map. Bays with an Ecurious guard can be reserved.' },
  {
    scene: 'guarded',
    title: 'Reserve',
    text: `Pick your car and pay from ${formatEuro(RESERVATION_FROM_CENTS)}. The guard rises and holds the bay for ${holdMinutes} minutes.`,
  },
  { scene: 'arriving', title: 'Arrive', text: `The camera reads your plate and lowers the guard. Running late? Add ${EXTENSION_MIN} minutes.` },
  { scene: 'charging', title: 'Charge', text: 'Plug in as usual. When you drive off, the bay is free for the next driver.' },
] as const;

const covered = [
  {
    icon: TriangleAlert,
    title: 'Someone parked in your bay',
    text: 'Your timer pauses, the operator is alerted, and you see the nearest free chargers. Cancelling is free.',
  },
  {
    icon: ScanLine,
    title: 'The camera misreads your plate',
    text: 'Dirt, glare and look-alike characters (B and 8, O and 0) still match your car. If nothing reads, tap “I’m at the bay”.',
  },
  {
    icon: CarFront,
    title: 'You’re in a different car today',
    text: 'Add today’s plate to the booking. It’s forgotten as soon as you leave.',
  },
];

const driverRules = Object.values(feeRules(holdMinutes));

const operatorRules = [
  'Blocked-bay alerts by email and on the dashboard',
  'Utilisation, no-show and check-in numbers per bay',
  `${Math.round(CPO_SHARE * 100)}% of every reservation fee goes to you`,
  'An open, OCPI-style API so other apps can book your bays',
];

// a ruled table, keyed in mono, rather than three icon cards
const privacy = [
  { key: 'Consent', title: 'You agree once', text: 'Plate recognition only starts after you add your car and say yes.' },
  { key: 'Matching', title: 'Matched to your booking only', text: 'The camera compares a read plate with the one active booking. Nothing else is looked up.' },
  { key: 'Deletion', title: 'Forgotten after the session', text: 'Your booking drops the plate when it ends. A blocking car’s plate is kept only until the incident is resolved.' },
];

export default function Landing() {
  return (
    <>
      <div className="bg-page text-ink">
        <header className={`${wrap} flex items-center justify-between gap-4 py-5`}>
          <Link href="/" aria-label="Ecurious Reserve home" className="rounded-lg">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-7 text-[0.95rem] font-medium md:flex">
            {[
              ['#how', 'How it works'],
              ['#at-the-bay', 'At the bay'],
              ['#pricing', 'Pricing'],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="relative py-1 after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-200 hover:after:scale-x-100"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Show when="signed-out">
              <Link href="/sign-in" className={buttonClass('secondary', 'sm')}>
                Sign in
              </Link>
              {/* phones get the hero's big "Reserve a bay" instead */}
              <Link href="/sign-up" className={buttonClass('signal', 'sm', 'max-sm:hidden')}>
                Get started
              </Link>
            </Show>
            <Show when="signed-in">
              <Link href="/explore" className={buttonClass('signal', 'sm')}>
                Open the app <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1" />
              </Link>
            </Show>
          </div>
        </header>

        <section className={`${wrap} relative grid items-center gap-12 overflow-hidden pb-16 pt-8 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:pb-24 lg:pt-14`}>
          <div className="relative z-10">
            <div className="animate-rise">
              <LiveBayStatus />
            </div>
            <h1 className="mt-6 animate-rise font-display text-[clamp(3.5rem,8vw,6rem)] leading-[0.88] tracking-[0.012em] [animation-delay:80ms]">
              Your charging spot, <span className="text-accent">kept free.</span>
            </h1>
            <p className="mt-6 max-w-[40ch] animate-rise text-[clamp(1.1875rem,2vw,1.375rem)] leading-normal text-muted [animation-delay:160ms]">
              Reserve a public charger before you set off. A guard holds the bay, and the camera lets your car in when
              you arrive.
            </p>
            <div className="mt-9 flex animate-rise flex-col gap-3 [animation-delay:240ms] sm:flex-row sm:items-center">
              <Link href="/sign-up" className={buttonClass('signal', 'lg')}>
                Reserve a bay {arrow}
              </Link>
              <a href="#how" className={buttonClass('secondary', 'lg')}>
                How it works
              </a>
            </div>
            <p className="mt-7 animate-rise font-mono text-xs uppercase leading-relaxed tracking-[0.08em] text-muted [animation-delay:320ms]">
              From {formatEuro(RESERVATION_FROM_CENTS)} per booking · Free cancellation for {FREE_CANCEL_MIN} minutes · Plate deleted
              after every session
            </p>
          </div>

          {/* the app and the bay, side by side, tilted and floating like Ecurious's product shots */}
          <div className="relative mx-auto flex w-full max-w-136 justify-center pb-48 sm:justify-end sm:pb-0 lg:justify-self-end">
            {/* widths are set per breakpoint so the card never covers the phone's screen, only its bezel at most */}
            <div className="relative animate-rise [animation-delay:200ms] sm:mr-10 lg:mr-0 xl:mr-10">
              <div className="-rotate-4 motion-safe:animate-float">
                <PhoneMockup holdMinutes={holdMinutes} />
              </div>
            </div>
            <figure className="absolute bottom-0 left-1 w-44 animate-rise [animation-delay:380ms] sm:bottom-10 sm:left-0 sm:w-48 lg:w-40 xl:w-48">
              <div className="rotate-5 rounded-2xl bg-brand-deep p-3 shadow-[0_24px_50px_rgb(15_20_25/0.32)] ring-1 ring-white/14">
                <BaySketch scene="guarded" tone="dark" className="w-full" />
                <figcaption className="mt-1 px-1 font-mono text-[0.6875rem] uppercase leading-snug tracking-[0.08em] text-on-brand-muted">
                  <span className="text-on-brand">Guard up.</span> The camera waits for your plate.
                </figcaption>
              </div>
            </figure>
          </div>
        </section>
      </div>

      <main>
        {/* streams in: a slow GoingElectric answer never holds up the page */}
        <Suspense fallback={null}>
          <NearbyChargers />
        </Suspense>

        <section id="how" className={`${wrap} scroll-mt-6 py-20 lg:py-28`}>
          <div className="grid gap-6 lg:grid-cols-2 lg:items-end">
            <h2 className={h2}>Four steps from the road to the plug</h2>
            <p className="max-w-[46ch] text-lg text-muted lg:justify-self-end">
              No more circling the car park. The bay is guarded from the moment you book until your car is the one
              standing in it.
            </p>
          </div>
          {/* a spec-sheet grid: hairlines, no gaps, square corners */}
          <ol className="mt-12 grid border-l border-t border-line sm:mt-14 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[6.5rem_1fr] items-start gap-5 border-b border-r border-line bg-surface p-5 sm:block sm:p-7">
                <div className="rounded-xl bg-page px-2 pb-1 pt-2 sm:px-6 sm:pb-2 sm:pt-6">
                  <BaySketch scene={s.scene} className="mx-auto w-full max-w-52" />
                </div>
                <div>
                  <div className="flex items-baseline gap-3 sm:mt-6">
                    <span className="font-mono text-xs tracking-[0.12em] text-accent">{String(i + 1).padStart(2, '0')}</span>
                    <h3 className="font-display text-3xl leading-none tracking-[0.012em]">{s.title}</h3>
                  </div>
                  <p className="mt-1.5 max-w-[34ch] text-muted sm:mt-3">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="at-the-bay" className="scroll-mt-6 bg-surface py-20 lg:py-28">
          <div className={`${wrap} grid items-center gap-12 lg:grid-cols-2 lg:gap-20`}>
            <figure className="relative order-last rounded-3xl bg-sunken p-8 sm:p-12 lg:order-first">
              <BaySketch scene="blocked" className="mx-auto w-full max-w-md" />
              <figcaption className="absolute left-6 top-6 flex items-center gap-2 rounded-full bg-surface py-1.5 pl-2 pr-3.5 font-mono text-xs font-semibold uppercase tracking-[0.08em] shadow-[0_2px_10px_rgb(15_20_25/0.18)] ring-1 ring-line sm:left-8 sm:top-8">
                <span className="grid size-6 place-items-center rounded-full bg-warn-tint text-warn">
                  <TriangleAlert className="size-3.5" />
                </span>
                Hold paused · operator alerted
              </figcaption>
            </figure>
            <div>
              <h2 className={h2}>When the bay doesn’t play along, you’re covered</h2>
              <ul className="mt-10 divide-y divide-line border-y border-line">
                {covered.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex gap-4 py-6">
                    <Icon className="mt-1 size-5 shrink-0 text-ink" />
                    <div>
                      <h3 className="text-lg font-semibold">{title}</h3>
                      <p className="mt-1 text-muted">{text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="pricing" className={`${wrap} scroll-mt-6 py-20 lg:py-28`}>
          <h2 className={`${h2} max-w-[18ch]`}>Simple prices, fair rules</h2>
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <article className="flex flex-col rounded-3xl bg-surface p-8 ring-1 ring-line sm:p-10">
              <h3 className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-muted">For drivers</h3>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-sm uppercase tracking-[0.08em] text-muted">From</span>
                <span className="font-display text-7xl leading-[0.9] text-accent">{formatEuro(RESERVATION_FROM_CENTS)}</span>
                <span className="font-mono text-sm uppercase tracking-[0.08em] text-muted">per reservation</span>
              </p>
              <ul className="mt-8 grid gap-3.5">
                {driverRules.map((r) => (
                  <li key={r} className="flex gap-3">
                    {bullet}
                    {r}
                  </li>
                ))}
              </ul>
              <Link href="/sign-up" className={buttonClass('primary', 'lg', 'mt-10 self-start')}>
                Reserve a bay {arrow}
              </Link>
            </article>

            <article className="flex flex-col rounded-3xl bg-brand-deep p-8 text-on-brand sm:p-10">
              <h3 className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-on-brand-muted">For charge point operators</h3>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-7xl leading-[0.9] text-signal">{formatEuro(PRICES.bayGuardPerBayMonth)}</span>
                <span className="font-mono text-sm uppercase tracking-[0.08em] text-on-brand-muted">per bay per month</span>
              </p>
              <p className="mt-3 font-mono text-xs uppercase tracking-[0.14em] text-on-brand-accent">Bay Guard</p>
              <ul className="mt-6 grid gap-3.5">
                {operatorRules.map((r) => (
                  <li key={r} className="flex gap-3">
                    {bullet}
                    {r}
                  </li>
                ))}
              </ul>
              <p className="mt-8 max-w-[44ch] text-on-brand-muted">
                An hour of a blocked DC bay loses about {formatEuro(BLOCKED_DC_HOUR_MARGIN)} in margin.{' '}
                Preventing {Math.ceil(PRICES.bayGuardPerBayMonth / BLOCKED_DC_HOUR_MARGIN)} blockings a month pays for the plan.
              </p>
              {/* no self-serve operator sign-up yet: a plain line of text, deliberately not styled like a button */}
              <p className="mt-8 flex items-center gap-2.5 text-lg font-semibold">
                <MessagesSquare className="size-5 shrink-0 text-signal" /> Talk to us at the Ecurious stand.
              </p>
            </article>
          </div>
          <p className="mt-6 text-sm text-muted">Prototype: payments are simulated and no card is charged.</p>
        </section>

        <section className="bg-brand-strong py-20 text-on-brand lg:py-24">
          <div className={wrap}>
            <h2 className={`${h2} max-w-[22ch]`}>Your plate is used at the bay, then forgotten</h2>
            <dl className="mt-12 grid divide-y divide-white/14 border-t-2 border-signal md:grid-cols-3 md:divide-x md:divide-y-0">
              {privacy.map(({ key, title, text }) => (
                <div key={key} className="py-8 md:px-8 md:first:pl-0">
                  <dt>
                    <span className="block font-mono text-xs uppercase tracking-[0.14em] text-on-brand-accent">{key}</span>
                    <span className="mt-4 block font-display text-3xl leading-none tracking-[0.012em]">{title}</span>
                  </dt>
                  <dd className="mt-3 max-w-[36ch] text-on-brand-muted">{text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="bg-brand-deep text-on-brand">
          <div className={`${wrap} flex flex-col items-start gap-8 py-20 lg:flex-row lg:items-center lg:justify-between lg:py-24`}>
            <h2 className={`${h2} max-w-[16ch]`}>
              Set off knowing <span className="text-on-brand-accent">a bay is waiting.</span>
            </h2>
            <div className="flex flex-wrap gap-3">
              <Link href="/sign-up" className={buttonClass('signal', 'lg')}>
                Reserve a bay {arrow}
              </Link>
              <Link href="/sign-in" className={buttonClass('on-brand', 'lg')}>
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/14 bg-brand-deep text-on-brand-muted">
        <div className={`${wrap} flex flex-col gap-6 py-12 text-sm md:flex-row md:items-end md:justify-between`}>
          <div className="flex flex-col gap-3">
            <Logo tone="light" />
            <p>A prototype for the Ecurious smart reservation challenge.</p>
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            <p className="max-w-[60ch] font-mono text-xs uppercase leading-relaxed tracking-[0.06em] md:text-right">
              Charging data ©{' '}
              <a className="underline underline-offset-2 hover:text-signal" href="https://www.goingelectric.de/stromtankstellen/">
                GoingElectric.de
              </a>
              . Map data ©{' '}
              <a className="underline underline-offset-2 hover:text-signal" href="https://www.openstreetmap.org/copyright">
                OpenStreetMap
              </a>{' '}
              contributors, tiles by{' '}
              <a className="underline underline-offset-2 hover:text-signal" href="https://openfreemap.org">
                OpenFreeMap
              </a>
              .
            </p>
            <PoweredByEcurious />
          </div>
        </div>
      </footer>
    </>
  );
}
