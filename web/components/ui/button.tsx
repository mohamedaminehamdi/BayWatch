import type { ButtonHTMLAttributes } from 'react';

const VARIANTS = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong active:bg-brand-deep',
  // the edge is line-strong (3:1), so the button still reads as one in glare
  secondary: 'bg-surface text-ink ring-1 ring-inset ring-line-strong hover:ring-ink',
  ghost: 'text-ink hover:bg-sunken',
  danger: 'bg-danger text-white hover:bg-danger/90',
  // lime: on ink surfaces, plus the one hero CTA on paper (its ink label carries the 13:1)
  signal: 'bg-signal text-ink hover:bg-signal-strong',
  'on-brand': 'text-on-brand ring-1 ring-inset ring-on-brand-muted/50 hover:bg-white/5 hover:ring-on-brand',
};

// every size is at least 44px tall: the touch-target floor in PRODUCT.md
const SIZES = {
  sm: 'min-h-11 px-4 text-xs',
  md: 'min-h-11 px-6 text-sm',
  lg: 'min-h-13 px-8 text-[0.9375rem]',
};

export type ButtonVariant = keyof typeof VARIANTS;

// Shared by <button> and <Link> so every action looks the same: Ecurious's mono-capital pills, lifting 2px on hover
export const buttonClass = (variant: ButtonVariant = 'primary', size: keyof typeof SIZES = 'md', extra = '') =>
  `group inline-flex items-center justify-center gap-2.5 rounded-full font-mono font-semibold uppercase tracking-[0.06em] whitespace-nowrap select-none transition-[background-color,color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 active:translate-y-0 disabled:pointer-events-none disabled:opacity-55 max-sm:whitespace-normal max-sm:text-center max-sm:tracking-[0.04em] ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;

// Status labels: mono capitals in a pill. Always pair with a tone and a word, never colour alone.
export const chipClass = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[0.8125rem] font-semibold uppercase leading-none tracking-[0.08em]';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof SIZES;
  loading?: boolean;
};

export function Button({ variant, size, loading, className = '', children, disabled, ...rest }: Props) {
  return (
    <button {...rest} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {children}
    </button>
  );
}
