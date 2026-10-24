'use client';

import { Minus, Plus } from 'lucide-react';
import { formatTime } from '@/components/time';
import { inputClass } from '@/components/ui/field';
import { BLOCK_MS, CLASSES, HORIZON_MS, TZ } from '@/lib/booking-rules';
import type { BayClass, BlockState } from '@/lib/booking-types';

// Picking a slot: a date (today up to 60 days ahead), a start block on that day's grid of 96 quarter
// hours (Europe/Berlin), and a length in blocks. The server re-checks all of it when quoting and booking.

const HORIZON_DAYS = Math.floor(HORIZON_MS / 86_400_000);

// "1 h 15 min": lengths read as durations, never as a time of day
export const formatLength = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;

// "Book now" books an hour, or the class maximum if that's shorter
export const quickLength = (cls: BayClass) => Math.min(4, CLASSES[cls].maxBlocks);

// Dates are YYYY-MM-DD in Europe/Berlin, the grid's time zone; noon UTC keeps day arithmetic clear of DST
export const berlinDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(ms);
export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// A block as the timeline draws it: the server's state, or 'occupied' when a car without a booking stands in the
// bay, so the guard can't rise for a start that close (the booking flow works that out)
export type Cell = { start: number; state: BlockState | 'occupied' };

// Free blocks in a row from index i: the longest booking that can start there
export function freeRun(blocks: Cell[], i: number) {
  let n = 0;
  while (blocks[i + n]?.state === 'free') n++;
  return n;
}

const focusRing = 'has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent';
const chip = `inline-flex min-h-11 cursor-pointer items-center rounded-full px-4 font-mono text-xs font-semibold uppercase tracking-[0.06em] ring-1 ring-inset ring-line-strong transition-colors has-checked:bg-ink has-checked:text-on-brand has-checked:ring-ink ${focusRing}`;

export function DatePicker({ value, today, onChange }: { value: string; today: string; onChange: (date: string) => void }) {
  const tomorrow = addDays(today, 1);
  return (
    <fieldset>
      <legend className="font-semibold">Which day?</legend>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {[
          [today, 'Today'],
          [tomorrow, 'Tomorrow'],
        ].map(([d, label]) => (
          <label key={d} className={chip}>
            <input type="radio" name="day" value={d} checked={value === d} onChange={() => onChange(d)} className="sr-only" />
            {label}
          </label>
        ))}
        <label className="min-w-0 flex-1 basis-44">
          <span className="sr-only">Another date, up to {HORIZON_DAYS} days ahead</span>
          <input
            type="date"
            value={value}
            min={today}
            max={addDays(today, HORIZON_DAYS)}
            onChange={(e) => e.target.value && onChange(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </label>
      </div>
    </fieldset>
  );
}

type Taken = Exclude<Cell['state'], 'free'>;
const WORD: Record<Taken, string> = { booked: 'Booked', gap: 'Gap', past: 'Past', mine: 'Yours', occupied: 'Occupied' };
const CELL = 'flex min-h-11 flex-col items-center justify-center rounded-lg font-mono text-[0.6875rem] leading-tight';
const LOOK: Record<Taken, string> = {
  // hatched: taken by someone else, and visibly not a button
  booked: 'bg-[repeating-linear-gradient(135deg,var(--color-sunken)_0_6px,var(--color-line)_6px_8px)] text-muted',
  gap: 'bg-sunken text-faint',
  past: 'text-faint opacity-60',
  mine: 'bg-accent-tint text-accent ring-1 ring-inset ring-accent/30',
  occupied: 'bg-warn-tint text-warn',
};

// Free blocks are radios sharing one name: a single Tab enters the day, arrow keys move between free blocks
export function DayTimeline({ blocks, start, length, onPick }: { blocks: Cell[]; start: number | null; length: number; onPick: (start: number) => void }) {
  const rows: Cell[][] = [];
  for (let h = 0; h < blocks.length / 4; h++) {
    const row = blocks.slice(h * 4, h * 4 + 4);
    if (row.some((b) => b.state !== 'past')) rows.push(row); // hours that are entirely over are left out
  }
  const inRange = (b: Cell) => start !== null && b.start >= start && b.start < start + length * BLOCK_MS;

  if (!rows.length) return <p className="rounded-2xl bg-sunken p-4 text-muted">This day is over. Pick another date.</p>;

  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-2 font-semibold">Start time</legend>
      {rows.map((row) => (
        <div key={row[0].start} className="grid grid-cols-[3.25rem_repeat(4,minmax(0,1fr))] items-center gap-1.5">
          <span aria-hidden className="font-mono text-xs text-muted">
            {formatTime(row[0].start)}
          </span>
          {row.map((b) => {
            const minute = `:${formatTime(b.start).slice(-2)}`;
            if (b.state !== 'free') {
              return (
                <span key={b.start} className={`${CELL} ${LOOK[b.state]}`}>
                  <span aria-hidden>{minute}</span>
                  <span className="uppercase tracking-[0.04em]">
                    <span className="sr-only">{formatTime(b.start)}, </span>
                    {WORD[b.state]}
                  </span>
                </span>
              );
            }
            const picked = inRange(b);
            return (
              <label
                key={b.start}
                className={`${CELL} cursor-pointer ring-1 ring-inset transition-colors ${focusRing} ${
                  picked ? 'bg-signal font-semibold text-ink ring-ink' : 'bg-surface text-ink ring-line-strong hover:bg-brand-tint'
                }`}
              >
                <input
                  type="radio"
                  name="start"
                  value={b.start}
                  checked={start === b.start}
                  onChange={() => onPick(b.start)}
                  className="sr-only"
                  aria-label={`${formatTime(b.start)}, free`}
                />
                <span aria-hidden>{minute}</span>
                <span aria-hidden className="uppercase tracking-[0.04em]">
                  {picked ? (start === b.start ? 'Start' : '·') : 'Free'}
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
}

// Length in blocks: 1–4 h presets within the class maximum, plus ±15 min. `fit` is the free run from the start.
export function LengthPicker({ blocks, maxBlocks, fit, onChange }: { blocks: number; maxBlocks: number; fit: number; onChange: (blocks: number) => void }) {
  const limit = Math.max(1, Math.min(maxBlocks, fit));
  const presets = [4, 8, 12, 16].filter((n) => n <= maxBlocks);
  return (
    <fieldset>
      <legend className="font-semibold">How long?</legend>
      <p className="text-sm text-muted">Up to {formatLength((maxBlocks * BLOCK_MS) / 60_000)} at this charger.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {presets.map((n) => (
          <label key={n} className={`${chip} ${n > limit ? 'pointer-events-none opacity-45' : ''}`}>
            <input type="radio" name="length" value={n} checked={blocks === n} disabled={n > limit} onChange={() => onChange(n)} className="sr-only" />
            {n / 4} h
          </label>
        ))}
        <span className="ml-auto inline-flex items-center gap-1 rounded-full ring-1 ring-inset ring-line-strong">
          <button
            type="button"
            aria-label="15 minutes shorter"
            disabled={blocks <= 1}
            onClick={() => onChange(blocks - 1)}
            className="grid size-11 place-items-center rounded-full hover:bg-sunken disabled:opacity-45"
          >
            <Minus className="size-4" />
          </button>
          <span className="min-w-[5.5rem] text-center font-mono text-sm font-semibold" aria-live="polite">
            {formatLength((blocks * BLOCK_MS) / 60_000)}
          </span>
          <button
            type="button"
            aria-label="15 minutes longer"
            disabled={blocks >= limit}
            onClick={() => onChange(blocks + 1)}
            className="grid size-11 place-items-center rounded-full hover:bg-sunken disabled:opacity-45"
          >
            <Plus className="size-4" />
          </button>
        </span>
      </div>
      {fit < maxBlocks && fit > 0 && <p className="mt-2 text-sm text-muted">The bay is taken after {formatLength((fit * BLOCK_MS) / 60_000)} from this start.</p>}
    </fieldset>
  );
}
