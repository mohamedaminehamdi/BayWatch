// The 12 EU stars on a circle. Rounded because Math.sin/cos can differ in the last digits between
// Node and the browser, and unrounded values break hydration (server and client attributes differ).
const STARS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return { cx: +(5 + 3.6 * Math.cos(a)).toFixed(3), cy: +(5 + 3.6 * Math.sin(a)).toFixed(3) };
});

// A German/EU-style license plate: blue band with the EU stars and country code, black on white.
// Bebas's condensed capitals sit close to the FE-Schrift on real German plates.
export function PlateBadge({ plate, size = 'md' }: { plate: string; size?: 'sm' | 'md' | 'lg' }) {
  // Bebas is narrower than the old face, so each size steps up one to keep the plate's proportions
  const text = { sm: 'text-base', md: 'text-xl', lg: 'text-3xl' }[size];
  return (
    <span
      className={`inline-flex shrink-0 items-stretch overflow-hidden whitespace-nowrap rounded-md border-2 border-ink bg-white font-display uppercase leading-none tracking-[0.08em] text-ink ${text}`}
      aria-label={`License plate ${plate}`}
    >
      <span aria-hidden className="flex flex-col items-center justify-end gap-0.5 bg-plate-blue px-1 pb-0.5 pt-1 text-[0.5em] text-white">
        <svg viewBox="0 0 10 10" className="size-[1.1em]">
          {STARS.map((s, i) => (
            <circle key={i} cx={s.cx} cy={s.cy} r="0.55" className="fill-plate-star" />
          ))}
        </svg>
        D
      </span>
      <span className="px-2 py-1">{plate}</span>
    </span>
  );
}
