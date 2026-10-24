import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// For screens with nothing to show yet: says what will appear here and how to get it
export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-brand-tint text-ink">
        <Icon className="size-6" />
      </span>
      <h2 className="mt-5 font-display text-3xl leading-none tracking-[0.012em]">{title}</h2>
      <div className="mt-2 max-w-[42ch] text-muted">{children}</div>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
