'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { formatDistance } from '@/lib/geo';

export type Dot = { id: number; name: string; x: number; y: number; powerKw: number; distance: number };

// Chart roles come from the theme tokens: context grey (3.6:1 on the surface) for public chargers, and the bay in
// lime with an ink ring (lime alone is 1.4:1 on white; the ring is 18:1). The surface-coloured ring keeps dots apart.
const halo = { paintOrder: 'stroke', stroke: 'var(--color-surface)', strokeWidth: 4 } as const;

// Public chargers around the bay (context, grey) and the one reservable bay (emphasis, lime).
// Coordinates are already projected into the 400×400 viewBox: bay at the centre, 2 km = 180 units.
export function DotMap({ dots, bayName }: { dots: Dot[]; bayName: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Dot | null>(null);

  // nearest-dot hover: dots are too dense to aim at one by one
  function onMove(e: PointerEvent<SVGSVGElement>) {
    const m = svg.current?.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    let best: Dot | null = null;
    let bestD = 18 ** 2;
    for (const d of dots) {
      const dd = (d.x - p.x) ** 2 + (d.y - p.y) ** 2;
      if (dd < bestD) [best, bestD] = [d, dd];
    }
    setHover(best);
  }

  return (
    <div className="relative">
      <svg ref={svg} viewBox="0 0 400 400" className="w-full touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)} aria-hidden>
        {[90, 180].map((r, i) => (
          <g key={r}>
            <circle cx="200" cy="200" r={r} fill="none" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="3 4" className="stroke-context" />
            <text x="200" y={200 - r - 6} textAnchor="middle" className="fill-muted font-mono text-[12px] font-medium">
              {i + 1} km
            </text>
          </g>
        ))}
        {dots.map((d) => (
          <circle key={d.id} cx={d.x} cy={d.y} r="5" strokeWidth="2" className="fill-context stroke-surface" />
        ))}
        {hover && <circle cx={hover.x} cy={hover.y} r="8" fill="none" strokeWidth="2" className="stroke-ink" />}
        <circle cx="200" cy="200" r="16" className="origin-[200px_200px] animate-pulse-ring fill-signal" />
        <circle cx="200" cy="200" r="11" strokeWidth="3" className="fill-signal stroke-ink" />
        <path d="M201.5 193.5 196.5 201h3.4l-1.4 5.5 5-7.6h-3.4z" className="fill-ink" />
        <text x="217" y="196" className="fill-ink text-[15px] font-bold" style={halo}>
          {bayName}
        </text>
        <text x="217" y="213" className="fill-accent font-mono text-[12px] font-semibold uppercase tracking-[0.06em]" style={halo}>
          reservable
        </text>
      </svg>

      {hover && (
        <div
          role="status"
          className="pointer-events-none absolute z-(--z-toast) w-max max-w-56 -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-xl bg-ink px-3 py-2 text-sm text-white shadow-lg"
          style={{ left: `${(hover.x / 400) * 100}%`, top: `${(hover.y / 400) * 100}%` }}
        >
          <p className="font-semibold leading-snug">{hover.name}</p>
          <p className="text-on-brand-muted">
            {hover.powerKw ? `${hover.powerKw} kW · ` : ''}
            {formatDistance(hover.distance)} from the bay
          </p>
        </div>
      )}

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
        <li className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-context" /> Public charger, first come first served
        </li>
        <li className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-signal ring-1 ring-ink" /> Baywatch bay, guarded
        </li>
      </ul>
    </div>
  );
}
