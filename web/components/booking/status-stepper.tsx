import type { Status } from '@/lib/reservation';

const STEPS = ['Reserved', 'Checked in', 'Charging', 'Done'];
const INDEX: Partial<Record<Status, number>> = { reserved: 0, arrived: 1, charging: 2, completed: 3 };

export function StatusStepper({ status }: { status: Status }) {
  const at = INDEX[status] ?? 0;
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Booking progress">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined} className="grid gap-2">
          <span className={`h-1.5 rounded-full transition-colors duration-500 ${i <= at ? 'bg-brand' : 'bg-line'}`} />
          <span className={`text-sm font-semibold ${i === at ? 'text-ink' : i < at ? 'text-brand-strong' : 'text-faint'}`}>{s}</span>
        </li>
      ))}
    </ol>
  );
}
