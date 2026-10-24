'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

// Native modal: the browser handles focus trapping, Esc and the backdrop. On phones it sits at the bottom.
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) d?.showModal();
    if (!open && d?.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto max-h-[min(92dvh,52rem)] w-[min(100%-2rem,34rem)] overflow-hidden rounded-3xl bg-surface p-0 text-ink shadow-[0_30px_80px_rgb(15_20_25/0.28)] backdrop:bg-ink/45 open:flex open:flex-col max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none"
    >
      <div className="flex items-center justify-between gap-4 border-b border-line py-3 pl-6 pr-3">
        <h2 id={titleId} className="font-display text-2xl leading-none tracking-[0.012em]">
          {title}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-11 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink">
          <X className="size-5" />
        </button>
      </div>
      <div className="overflow-y-auto px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5">{children}</div>
    </dialog>
  );
}
