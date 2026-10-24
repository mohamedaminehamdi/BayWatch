import { Check } from 'lucide-react';
import Link from 'next/link';
import { BaySketch } from '@/components/landing/bay-sketch';
import { Logo, PoweredByEcurious } from '@/components/ui/logo';

const promises = ['A bay held free until you arrive', 'Checked in by the camera, no card or app tap', 'Your plate is deleted after every session'];

// Sign-in and sign-up share a split screen: brand panel on the left, Clerk's form on the right
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden bg-brand-deep p-12 text-on-brand lg:flex lg:flex-col">
        <Link href="/" aria-label="Ecurious Reserve home" className="self-start rounded-lg">
          <Logo tone="light" />
        </Link>
        <div className="grid flex-1 place-items-center py-10">
          <BaySketch scene="guarded" tone="dark" className="w-full max-w-xs" />
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-6xl leading-[0.9] tracking-[0.012em]">
            Charge without the <span className="text-on-brand-accent">gamble.</span>
          </h1>
          <ul className="mt-8 grid gap-3 text-lg text-on-brand">
            {promises.map((p) => (
              <li key={p} className="flex gap-3">
                <Check className="mt-1 size-5 shrink-0 text-mint" />
                {p}
              </li>
            ))}
          </ul>
          <PoweredByEcurious className="mt-10" />
        </div>
      </aside>

      <main className="flex flex-col px-5 py-6 sm:px-8">
        <Link href="/" aria-label="Ecurious Reserve home" className="self-start rounded-lg lg:hidden">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
