import type { ReactNode } from 'react';

export const inputClass =
  // full-strength line-strong: the edge needs 3:1 against the page (at 70% it was about 2.5:1)
  'block w-full min-h-12 rounded-full border border-line-strong bg-surface px-5 text-base text-ink placeholder:text-faint transition-shadow focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="font-semibold">{label}</span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );
}
