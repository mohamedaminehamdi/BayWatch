// Top-down drawing of the charging bay in one of its states. Pure SVG, no images to load.
type Scene = 'find' | 'guarded' | 'arriving' | 'charging' | 'blocked';

export function BaySketch({ scene, tone = 'light', className = '' }: { scene: Scene; tone?: 'light' | 'dark'; className?: string }) {
  const dark = tone === 'dark';
  const line = dark ? 'stroke-white/40' : 'stroke-ink/25';
  const pillar = dark ? 'fill-white/15 stroke-white/40' : 'fill-surface stroke-ink/30';
  // the camera's field of view is violet, the brand's "technology" colour
  const cone = dark ? 'fill-on-brand-accent/15 stroke-on-brand-accent/60' : 'fill-accent/10 stroke-accent/50';
  const showGuard = scene === 'guarded' || scene === 'arriving';
  const car = scene === 'arriving' ? { y: 92, cls: 'fill-brand' } : scene === 'charging' ? { y: 44, cls: 'fill-brand' } : scene === 'blocked' ? { y: 44, cls: dark ? 'fill-white/35' : 'fill-faint' } : null;

  return (
    <svg viewBox="0 0 200 160" role="img" aria-hidden className={className}>
      {/* bay markings and the charger at its head */}
      <path d="M48 150V26h104v124" fill="none" strokeWidth="3" strokeLinecap="round" className={line} />
      <rect x="88" y="6" width="24" height="16" rx="4" strokeWidth="1.5" className={pillar} />
      <path d="M94 14h6l-2 4h6" fill="none" strokeWidth="1.5" strokeLinecap="round" className={dark ? 'stroke-signal' : 'stroke-brand'} />

      {(scene === 'arriving' || scene === 'blocked') && (
        <path d="M100 20 66 96h68z" strokeWidth="1" strokeDasharray="3 3" className={scene === 'blocked' ? (dark ? 'fill-signal/10 stroke-signal/60' : 'fill-warn/10 stroke-warn/50') : cone} />
      )}

      {showGuard && (
        <g>
          <circle cx="100" cy="78" r="22" className="origin-[100px_78px] animate-pulse-ring fill-signal/30" />
          {/* lime vanishes on paper (1.3:1), so on light the guard gets an ink edge */}
          <rect x="80" y="70" width="40" height="16" rx="5" strokeWidth={dark ? 0 : 1} className={dark ? 'fill-signal' : 'fill-signal stroke-ink/60'} />
          <rect x="86" y="76" width="28" height="4" rx="2" className="fill-ink/70" />
        </g>
      )}

      {car && (
        <g transform={`translate(70 ${car.y})`}>
          <rect width="60" height="96" rx="16" className={car.cls} />
          <rect x="8" y="14" width="44" height="18" rx="6" className="fill-white/70" />
          <rect x="10" y="64" width="40" height="12" rx="5" className="fill-white/35" />
        </g>
      )}

      {scene === 'charging' && (
        <path d="M100 22c0 10 0 14 0 22" fill="none" strokeWidth="3" strokeLinecap="round" className={dark ? 'stroke-mint' : 'stroke-brand-strong'} />
      )}

      {scene === 'find' && (
        <g>
          <path d="M100 52c-12 0-21 9-21 21 0 16 21 37 21 37s21-21 21-37c0-12-9-21-21-21z" className="fill-brand" />
          <circle cx="100" cy="73" r="8" className="fill-white" />
        </g>
      )}

      {scene === 'blocked' && (
        <g transform="translate(138 30)">
          <circle r="13" className="fill-warn" />
          <path d="M0-6v7" strokeWidth="2.6" strokeLinecap="round" className="stroke-white" />
          <circle cy="5.5" r="1.6" className="fill-white" />
        </g>
      )}
    </svg>
  );
}
