import type { Charge } from '@/lib/pricing';
import { formatEuro } from '@/lib/pricing';

// The booking's charges are its receipt
export function Receipt({ charges, totalCents }: { charges: Charge[]; totalCents: number }) {
  return (
    <div>
      <dl className="grid gap-2">
        {charges.map((c, i) => (
          <div key={i} className="flex justify-between gap-4">
            <dt className={c.cents < 0 ? 'text-brand-strong' : ''}>{c.label}</dt>
            <dd className={`whitespace-nowrap tabular-nums ${c.cents < 0 ? 'text-brand-strong' : ''}`}>{formatEuro(c.cents)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-line pt-2 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatEuro(totalCents)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-sm text-muted">Demo payment: no card was charged.</p>
    </div>
  );
}
