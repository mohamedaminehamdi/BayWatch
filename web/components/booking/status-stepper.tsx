import type { ReservationStatus } from '@/lib/booking-types';

const STEPS = ['Booked', 'Live', 'Checked in', 'Charging', 'Done'];
const INDEX: Partial<Record<ReservationStatus, number>> = { upcoming: 0, live: 1, arrived: 2, charging: 3, completed: 4 };

export function StatusStepper({ status }: { status: ReservationStatus }) {
  const at = INDEX[status] ?? 0;
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label="Booking progress">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined} className="grid gap-2">
          <span className={`h-1.5 rounded-full transition-colors duration-500 ${i <= at ? 'bg-brand' : 'bg-line'}`} />
          <span className={`text-xs font-semibold sm:text-sm ${i === at ? 'text-ink' : i < at ? 'text-muted' : 'text-faint'}`}>{s}</span>
        </li>
      ))}
    </ol>
  );
}
