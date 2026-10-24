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
        Bay<span className={light ? 'text-on-brand-accent' : 'text-accent'}>watch</span>
      </span>
    </span>
  );
}
