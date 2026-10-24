// Clerk's form sits flat on the page instead of in its default floating card.
// Clerk draws field borders as faint box-shadows; these give inputs the 3:1 edge form controls need.
// Inset, because Clerk's card clips anything drawn outside a full-width field.
const field = 'min-h-12 rounded-full px-5 text-base shadow-[inset_0_0_0_1px_var(--color-line-strong)]';

export const clerkCard = {
  elements: {
    rootBox: 'w-full max-w-[26rem]',
    cardBox: 'w-full overflow-visible shadow-none rounded-none border-0', // it clipped the fields' outer pixel
    card: 'bg-transparent shadow-none px-0 py-2',
    // uppercase spelled out: the clerk layer outranks the base rule that capitalises Bebas
    headerTitle: 'font-display text-4xl uppercase leading-[0.9] tracking-[0.012em] text-ink',
    headerSubtitle: 'text-base text-muted',
    // a button like every other: mono capitals (the field it shares its edge with stays sentence case)
    socialButtonsBlockButton: `${field} text-sm uppercase tracking-[0.06em] hover:bg-sunken`,
    dividerText: 'font-mono text-xs uppercase tracking-[0.14em] text-muted',
    formButtonPrimary:
      'min-h-12 rounded-full bg-brand font-mono text-sm font-semibold uppercase tracking-[0.06em] text-on-brand shadow-none after:hidden hover:bg-brand-strong',
    formFieldInput: `${field} focus:shadow-[inset_0_0_0_2px_var(--color-accent)]`,
    footerActionLink: 'font-semibold text-accent underline underline-offset-2 hover:text-ink',
    footer: 'bg-none bg-transparent',
  },
};
