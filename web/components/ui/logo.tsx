// The mark: a parking-bay outline holding a charge bolt. `tone` switches it for dark surfaces.
export function Logo({ tone = 'dark', className = '' }: { tone?: 'dark' | 'light'; className?: string }) {
  const light = tone === 'light';
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 32 32" aria-hidden className="size-8 shrink-0">
        <rect width="32" height="32" rx="8" className={light ? 'fill-signal' : 'fill-brand'} />
        <path d="M9 8v16h14V8" fill="none" strokeWidth="2.2" strokeLinecap="round" className={light ? 'stroke-ink/80' : 'stroke-on-brand/70'} />
        <path d="M17.4 10.5 12.6 17h3.6l-1.6 5.5 4.8-6.6h-3.6z" className={light ? 'fill-ink' : 'fill-signal'} />
      </svg>
      <span className={`whitespace-nowrap font-display text-[1.6rem] leading-none tracking-[0.02em] ${light ? 'text-on-brand' : 'text-ink'}`}>
        Ecurious <span className={light ? 'text-on-brand-accent' : 'text-accent'}>Reserve</span>
      </span>
    </span>
  );
}

// Credit for Ecurious, in our own type: no wordmark file and no recreated Ë until Ecurious says the logo may be used.
// For dark surfaces (the landing footer and the auth panel).
export function PoweredByEcurious({ className = '' }: { className?: string }) {
  return (
    <a
      href="https://ecurious.com"
      className={`inline-flex min-h-11 items-center gap-2.5 font-mono text-xs uppercase tracking-[0.12em] text-on-brand-muted hover:text-on-brand ${className}`}
    >
      Powered by <span className="font-display text-2xl leading-none tracking-[0.04em] text-on-brand">Ecurious</span>
    </a>
  );
}
