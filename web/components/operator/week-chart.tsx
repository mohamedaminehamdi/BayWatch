'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Day } from '@/lib/operator';

const H = 240;
const PAD = { left: 36, right: 8, top: 18, bottom: 30 };
const BAR = 24; // column width cap, per the dataviz spec

// day keys are YYYY-MM-DD; format them in UTC so every browser shows the same label
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const longDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// 1, 2 or 5 × 10^n: clean axis ticks
function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
}

// Column with a 4px rounded top and a square base, growing from the baseline
function column(x: number, y: number, w: number, base: number) {
  const r = Math.min(4, base - y);
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

// Reservations per day, last 7 days. Single series, so no legend: the heading names it.
export function WeekChart({ days }: { days: Day[] }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  // draw at the real pixel width, so text and bars keep their sizes on small screens
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = Math.max(4, ...days.map((d) => d.total));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const base = H - PAD.bottom;
  const y = (v: number) => PAD.top + (base - PAD.top) * (1 - v / top);
  const band = (width - PAD.left - PAD.right) / days.length;
  const bw = Math.min(BAR, band * 0.55);
  const h = hover === null ? null : days[hover];

  return (
    <div>
      <div ref={box} className="relative">
        <svg width={width} height={H} role="img" aria-labelledby={titleId} className="block max-w-full" onPointerLeave={() => setHover(null)}>
          <title id={titleId}>{`Reservations per day: ${days.map((d) => `${longDay(d.day)} ${d.total}`).join(', ')}`}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} strokeWidth="1" className="stroke-line" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {t}
              </text>
            </g>
          ))}
          {days.every((d) => d.total === 0) && (
            <text
              x={(PAD.left + width - PAD.right) / 2}
              y={(PAD.top + base) / 2}
              textAnchor="middle"
              className="fill-muted text-[14px]"
              style={{ paintOrder: 'stroke', stroke: 'var(--color-surface)', strokeWidth: 8 }}
            >
              No reservations in the last 7 days yet
            </text>
          )}
          {days.map((d, i) => {
            const x = PAD.left + i * band + (band - bw) / 2;
            return (
              <g key={d.day}>
                {d.total > 0 && <path d={column(x, y(d.total), bw, base)} className={i === hover ? 'fill-accent' : 'fill-brand'} />}
                <text x={x + bw / 2} y={H - 10} textAnchor="middle" className={`text-[12px] ${i === days.length - 1 ? 'fill-ink font-semibold' : 'fill-muted'}`}>
                  {i === days.length - 1 ? 'Today' : weekday(d.day)}
                </text>
                {/* the whole band is the hover and focus target, not just the painted column */}
                <rect
                  x={PAD.left + i * band}
                  y={PAD.top}
                  width={band}
                  height={base - PAD.top}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${longDay(d.day)}: ${d.total} reservations`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none focus-visible:stroke-accent focus-visible:stroke-2"
                />
              </g>
            );
          })}
        </svg>

        {h && hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute z-(--z-toast) w-max -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-xl bg-ink px-3 py-2 text-sm text-white shadow-lg"
            style={{ left: PAD.left + hover * band + band / 2, top: y(h.total) }}
          >
            <p className="text-base font-semibold">
              {h.total} {h.total === 1 ? 'reservation' : 'reservations'}
            </p>
            <p className="text-on-brand-muted">{longDay(h.day)}</p>
            {h.total > 0 && (
              <p className="mt-1 text-on-brand">
                {h.completed} completed · {h.noShow} no-show · {h.cancelled} cancelled
              </p>
            )}
          </div>
        )}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-muted hover:text-ink">View as a table</summary>
        <table className="mt-3 w-full text-left tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="py-1.5 font-semibold">Day</th>
              <th className="py-1.5 text-right font-semibold">Reservations</th>
              <th className="py-1.5 text-right font-semibold">Completed</th>
              <th className="py-1.5 text-right font-semibold">No-shows</th>
              <th className="py-1.5 text-right font-semibold">Cancelled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {days.map((d) => (
              <tr key={d.day}>
                <td className="py-1.5">{longDay(d.day)}</td>
                <td className="py-1.5 text-right">{d.total}</td>
                <td className="py-1.5 text-right">{d.completed}</td>
                <td className="py-1.5 text-right">{d.noShow}</td>
                <td className="py-1.5 text-right">{d.cancelled}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
