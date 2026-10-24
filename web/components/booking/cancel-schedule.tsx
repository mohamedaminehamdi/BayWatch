'use client';

import type { CancelStep } from '@/lib/booking-types';
import { formatTime } from '@/components/time';
import { formatEuro } from '@/lib/pricing';

// What cancelling costs over time, as steps: free, 10 %, 50 %, 80 %, then the no-show (100 %).
// Each step starts at `from`; the last one lasts until the arrival deadline.
const tone = (percent: number) => (percent === 0 ? 'bg-brand-tint' : percent < 50 ? 'bg-sunken' : percent < 100 ? 'bg-warn-tint' : 'bg-danger-tint');

export function CancelSchedule({ steps, noShowCents, now }: { steps: CancelStep[]; noShowCents: number; now: number }) {
  const when = (at: number) => (at <= now ? 'Now' : `${new Date(at).toDateString() === new Date(now).toDateString() ? '' : `${new Date(at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, `}${formatTime(at)}`);
  const rows = [...steps.map((s) => ({ key: `s${s.from}`, label: s.percent === 0 ? 'Free' : `${s.percent}%`, cents: s.cents, from: when(s.from), percent: s.percent })), { key: 'noshow', label: 'No-show', cents: noShowCents, from: 'After the arrival deadline', percent: 100 }];
  return (
    <div>
      <h3 className="font-semibold">If you cancel</h3>
      {/* the strip is a picture of the list below, which carries the same information in words */}
      <div aria-hidden className="mt-3 flex h-2 overflow-hidden rounded-full">
        {rows.map((r) => (
          <span key={r.key} className={`flex-1 ${tone(r.percent)} border-r-2 border-surface last:border-r-0`} />
        ))}
      </div>
      <ol className="mt-3 grid gap-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.key} className="flex items-baseline justify-between gap-3">
            <span className="flex items-baseline gap-2">
              <span className={`inline-flex min-w-16 justify-center rounded-full px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-[0.06em] text-ink ${tone(r.percent)}`}>{r.label}</span>
              <span className="text-muted">{r.key === 'noshow' ? r.from : `from ${r.from}`}</span>
            </span>
            <span className="font-mono font-semibold">{formatEuro(r.cents)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
