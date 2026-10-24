# Design System: Ecurious Reserve

Phase 1 proposal, 2026-10-24. **Phase 2a (applied):** §2, §3, §7.1–7.6 (except the Demo trigger row, which is in the builder's `demo-panel.tsx`) and §7.12. **Still to apply in 2b:** that row and §7.7–7.11. It moves the app from its self-chosen green, yellow and Barlow look to the Ecurious brand system. §2 holds the paste-ready tokens, and §7 lists every screen change in the order to apply them. Token names are the ones in `app/globals.css` as of 12:08 today, including `context`, `location`, `plate-blue` and `plate-star`. If a class string quoted in §7 has changed since then, apply the intent in the "Change to" column.

## 1. Overview

**Creative North Star: "Voltage on paper."** Ecurious draws on a warm sheet of paper with blue-black ink and one spark of electric lime. Ultraviolet stands in for that spark wherever it has to be read on a light background. For this app, that means calm, almost monochrome screens where the only saturated thing is the bay that is held for you.

### Source and evidence

- Captured 2026-10-24 with playwright-cli, because the Firecrawl CLI isn't authenticated in this environment. Pages: `https://ecurious.com/` (also with the DE toggle), `/benefits.html`, `/technology.html` and `/about.html`, at 1440×900 and 390×844.
- The values are read from source, not eyeballed. They are the `:root` custom properties and component rules of `https://ecurious.com/styles/index.css` and `/styles/benefits.css`, saved to `…/scratchpad/brand/source-css/`.
- Evidence screenshots are working files in the session scratchpad and are not committed. All paths start with `/private/tmp/claude-501/-Users-mohamedaminehamdi-Desktop-ecurious/0d5f5667-df5c-43eb-94f5-c2f0dd1e0469/scratchpad/brand/`. Page captures: `ecurious-home-hero-1440.png`, `ecurious-home-full-1440.png`, `ecurious-home-hero-390.png`, `ecurious-home-full-390.png`, `ecurious-mobile-menu-390.png` and `ecurious-home-hero-DE-1440.png`, plus a `-hero-1440.png` and `-full-1440.png` pair for each of `benefits`, `technology` and `about`. Component close-ups: `detail-home-{nav,hero-cta,features,calc,uid,vmp,news,footer}.png`, `detail-benefits-row{1..5}.png`, `detail-benefits-stats.png` and `detail-benefits-pricing.png`.
- The contrast proof is `…/scratchpad/brand/palette.py`. Run `python3 -I palette.py --check`, which exits with status 1 if any app pairing fails.
- **Finding:** ecurious.com presents Ecurious as a smart-charging marketplace: one RFID card and app with best-price routing, launching in September 2026 from Munich. The reservation hardware doesn't appear anywhere on the site, so there is no hardware photography or drawing to adopt. We adopt the visual system and draw the hardware ourselves in its diagram style (§5).

### The brand in five traits

1. **Paper and ink.** The page is a warm off-white (`#F5F4F1`) with a second, darker paper (`#ECEAE3`). The text is blue-black ink (`#0F1419`), and full-width ink bands carry emphasis. Everything else is almost monochrome.
2. **Voltage lime (`#C8E847`) is the one loud accent.** It is always a fill with ink on it (CTA pills, the "best" row, the active tier, slider thumbs) or a mark on ink (numbers, dots). The site never sets lime as text on paper.
3. **Ultraviolet (`#5A1DF0`) is "legible voltage on paper"**, a comment in their own CSS. It colours highlight words in headlines, eyebrows, the active nav underline and numbers on light. On ink, the highlight words turn light violet (`#B69BFF`).
4. **A three-part type system.** Bebas Neue capitals for headlines and big numbers, Space Grotesk for reading, and JetBrains Mono in tracked capitals for labels, buttons, prices and data.
5. **An engineered shape language.** Pill buttons and chips, cards with a 14px radius, and spec-sheet grids of hairline rules with square corners. Surfaces are flat, with soft ink shadows only under floating product shots. The product appears as tilted, floating phone renders and dark UI panels, with no illustration and no stock imagery.

The voice is confident and plain: English first, with formal German ("Sie") behind a DE toggle.

### How it maps onto this app

- `brand` is **ink**. Primary actions are ink pills (Ecurious's dark button) whose label holds 16.8:1 in sunlight.
- `signal` and `mint` are **lime**. They mark what is yours or available on dark surfaces: the held-for-you card, the bay pin, CTAs on ink and live dots.
- **Violet** is added as `accent`, `accent-tint` and `on-brand-accent` for links, focus, the active nav, highlight words and anything demo-only.
- `brand-deep` (ink) becomes the **live-status surface**. While a booking is active, its hero card is ink with a lime Bebas countdown. Blocked is light orange, and finished is white.
- The app stays light, because drivers read it in daylight glare. The landing page copies the brand's composition: a paper hero, ink bands lower down, and an ink footer.

### Layout and spacing

- The container is unchanged: `max-w-7xl` (1280px) is exactly Ecurious's `--max`. On the landing page, use their gutter `px-[clamp(20px,5vw,80px)]` instead of `px-5 sm:px-8`. The app keeps its own gutters.
- The landing section rhythm stays at `py-20 lg:py-28`, matching Ecurious's `clamp(72px,11vh,140px)`. Inside sections, use `gap-6` (24px) and `gap-14` (56px) between a hero's two columns.
- **Spec grid** (Ecurious's features, tiers and tech steps): use it for the four landing steps and the privacy band. The container is `grid border-l border-t border-line`, each cell is `border-b border-r border-line` with `p-6 sm:p-8`, and there is no gap and no radius. It reads as a data sheet, not as cards.
- In-app density stays as it is. Ecurious is a marketing site, so its 18px body and 140px headlines don't apply inside the app.

### Voice and copy

Combine Ecurious's confidence with PRODUCT.md's car-park attendant: short, concrete and calm.

1. **Headlines** are 2–6 words, declarative, and end with a full stop. Keep them in sentence case in the source; CSS sets Bebas in capitals. Example: "Another car is in your bay."
2. **Body copy** is at most two sentences of about 20 words each. Lead with the fact, then the consequence.
3. **Be concrete.** Use 24-hour times ("Held until 14:35"), exact money ("€1.50"), and minutes as numerals.
4. **"You" is the driver, and "we" is Ecurious or the operator.** For example: "We've alerted the operator."
5. **No hype**: no exclamation marks, no "Oops", no emoji, no "simply" or "just".
6. **Buttons** start with a verb and run 1–4 words: "Reserve for €1.50", "Navigate", "I'm at the bay", "Keep it". Only forward actions get an arrow.
7. **Use a fixed status vocabulary** with no synonyms: Free · Reserved · Held for you · Checked in · Charging · Done · Car in bay · No-show · Cancelled.
8. **Never name a colour in copy.** "The green bay" breaks as soon as the theme changes. Describe the thing instead: "the bay with the bolt".
9. **Use mono capitals only for data labels** (LEFT TO ARRIVE, HELD UNTIL, PER RESERVATION), not as an eyebrow over every section.
10. **German, when it comes, uses formal "Sie"** as ecurious.com does. Don't reuse Ecurious's headlines, claims or sign-off anywhere.

#### Microcopy

| Moment | Surface | Copy |
|---|---|---|
| Bay reserved | Banner after paying | Bay reserved. Held until 14:35. |
| | Status chip | Held for you |
| | Countdown label | LEFT TO ARRIVE · HELD UNTIL 14:35 |
| | Card body | The guard is up. Drive in and the camera lowers it for your plate. |
| | Header pill | Held for you · 14:57 |
| | Reminder (banner and notification) | 5 minutes left on your hold. Running late? Add `EXTENSION_MIN` minutes for `formatEuro(PRICES.extension)`. |
| Blocked bay | Header pill | Bay blocked · hold paused |
| | Headline | Another car is in your bay. |
| | Body | Your hold is paused with 14:50 left, so you lose no time. We've alerted the operator. |
| | Meta | Since 12:00. Cancelling now is free. |
| | Actions | Keep waiting · Find another charger · Cancel for free |
| | Bay detail, for other drivers | Car in bay: a car is standing in the bay. We'll know the moment it leaves. |
| No-show | Headline (done screen) | You didn't arrive in time. |
| | Body | You didn't arrive by 14:35, so the bay went to the next driver. You pay {amount}; the rest of the fee was returned. (Prepaid: "the {amount} you prepaid is kept".) |
| | Rule, shown before paying | `bookingTerms().noShow`, and `feeRules().noShow` on the landing page |
| | Bookings chip | No-show |

Every amount, share and duration comes from `lib/pricing.ts` (`feeRules()`, `bookingTerms()`, `PRICES`, `EXTENSION_MIN`) or from the booking's own charges. Copy never hard-codes a number or a fraction such as "half the fee".

## 2. Colors

**Palette strategy:** "Restrained" (impeccable's product default). Tinted paper and ink neutrals carry about 90% of every screen, lime marks the one thing that's yours, and violet marks the one thing you can follow (a link, focus, or the current page).

### Primary

- **Ink** (`#0F1419`): the text, primary buttons, stepper fill, selected rings, DC map rings and clusters, and the dark bands. Tokens: `ink`, `brand`, `brand-deep`.
- **Ink soft** (`#1F2933`): hover for ink, the raised dark card on an ink band, and text on lime tints. Tokens: `brand-strong` (and `dc`, which is unused).

### Secondary: voltage lime

- **Voltage** (`#C8E847`): lime fills with ink on top, the guard in drawings, the bay pin, lime marks on ink, and text selection. Tokens: `signal` and `mint`.
- **Voltage hover** (`#D4F05A`): Ecurious brightens on hover rather than darkening. Token: `signal-strong`.
- **Voltage soft** (`#E7F2A8`) and **Voltage soft hover** (`#DCEB8C`): "held for you", "free" and "completed" chips, and selected rows. Tokens: `brand-tint` and `brand-soft`.

### Tertiary: ultraviolet

- **Ultraviolet** (`#5A1DF0`): links, the focus ring, the active nav underline, the selected-charger ring, highlight words and step numbers on light. Token: `accent` (new).
- **UV soft** (`#EAE2FF`): the demo pill, the demo status line and info banners. Token: `accent-tint` (new).
- **UV on dark** (`#B69BFF`): highlight words and keys inside ink bands. Token: `on-brand-accent` (new).

### Neutral and state

- **Paper** (`#F5F4F1`) is `page` and `on-brand`. **Paper 2** (`#ECEAE3`) is `sunken`. White is `surface`.
- **Rule** (`#D9D9D7`, ink at 12% on paper) is `line`. **Input edge** (`#858687`) is `line-strong`.
- **Muted** (`#55595E`) is `muted`, **Faint** (`#6C6F73`) is `faint`, and paper at 62% on ink (`#9E9F9F`) is `on-brand-muted`.
- **Warn** (`#A8430F`, Ecurious's signal orange darkened until it reads as text) is `warn`, with `#FDEBDF` as `warn-tint`.
- **Danger** (`#B3261E`) is `danger`, with `#FCE8E6` as `danger-tint`. Ecurious has no red, so this one is derived.
- **Map roles:** `context` (`#84888C`, solved for 3:1 on the map) for public chargers. `location`, `plate-blue` and `plate-star` are unchanged because they are real-world colours.

### Ready-to-paste `@theme` block

Replace the whole `@theme { … }` block in `app/globals.css` with this. It keeps every existing name, adds three, and adds a `float` animation for the landing mockups. Every OKLCH value round-trips to the hex in its comment.

```css
/* Ecurious Reserve tokens from the Ecurious brand (ecurious.com, captured 2026-10-24): paper and ink neutrals,
   voltage lime as a fill, ultraviolet as the accent for text and lines on light. Contrast of every pair: DESIGN.md §2. */
@theme {
  --font-sans: var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-bebas-neue), "Arial Narrow", ui-sans-serif, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, "SF Mono", Menlo, monospace;

  --color-page: oklch(0.9671 0.0041 91.4); /* #F5F4F1 paper */
  --color-surface: oklch(1 0 0); /* #FFFFFF */
  --color-sunken: oklch(0.9367 0.0096 93.6); /* #ECEAE3 paper-2 */
  --color-line: oklch(0.8847 0.0027 106.5); /* #D9D9D7 ink at 12% on paper; decorative only */
  --color-line-strong: oklch(0.6195 0.0019 247.9); /* #858687 input edges: 3:1 on surface, page and sunken */
  --color-ink: oklch(0.1884 0.0128 248.5); /* #0F1419 */
  --color-muted: oklch(0.4622 0.0096 253.9); /* #55595E 4.5:1 on every light surface, tints included */
  --color-faint: oklch(0.5404 0.0072 255.5); /* #6C6F73 placeholders, inactive tabs: 4.5:1 on surface and page */

  /* brand is ink: primary actions are ink pills and the dark bands are ink */
  --color-brand: oklch(0.1884 0.0128 248.5); /* #0F1419 */
  --color-brand-strong: oklch(0.276 0.0233 248.7); /* #1F2933 ink-soft: hover, raised dark card, text on lime tints */
  --color-brand-deep: oklch(0.1884 0.0128 248.5); /* #0F1419 dark bands and the live-booking card */
  --color-brand-tint: oklch(0.9356 0.0953 115.2); /* #E7F2A8 voltage-soft: held-for-you chips, selected rows */
  --color-brand-soft: oklch(0.908 0.1203 116.2); /* #DCEB8C hover of brand-tint */
  --color-on-brand: oklch(0.9671 0.0041 91.4); /* #F5F4F1 */
  --color-on-brand-muted: oklch(0.7017 0.0012 197.1); /* #9E9F9F paper at 62% on ink */
  --color-mint: oklch(0.8791 0.1833 120.1); /* #C8E847 lime marks on dark: checks, live dots */

  /* voltage lime: a fill with ink on it, or a mark on ink. Never text, rings or state on a light surface. */
  --color-signal: oklch(0.8791 0.1833 120.1); /* #C8E847 */
  --color-signal-strong: oklch(0.9068 0.1752 119); /* #D4F05A hover: Ecurious brightens on hover */

  /* ultraviolet: the accent wherever it has to be text or a line on light */
  --color-accent: oklch(0.4875 0.2721 282.7); /* #5A1DF0 */
  --color-accent-tint: oklch(0.9278 0.0398 298.2); /* #EAE2FF */
  --color-on-brand-accent: oklch(0.7527 0.1426 295.2); /* #B69BFF highlight words on dark */

  --color-warn: oklch(0.5131 0.1452 42.6); /* #A8430F Ecurious signal orange, darkened to read as text */
  --color-warn-tint: oklch(0.9512 0.0254 56.1); /* #FDEBDF */
  --color-danger: oklch(0.5013 0.1783 28.7); /* #B3261E */
  --color-danger-tint: oklch(0.9464 0.0221 24.4); /* #FCE8E6 */
  --color-dc: oklch(0.276 0.0233 248.7); /* #1F2933 unused: delete once nothing references it */

  /* map and chart roles */
  --color-context: oklch(0.6247 0.0076 247.9); /* #84888C public chargers: 3:1 on surface and on the map's land */
  --color-location: oklch(0.546 0.215 262.9); /* your location */
  /* the EU licence plate band: real-world colours, not brand */
  --color-plate-blue: oklch(0.442 0.142 259.8);
  --color-plate-star: oklch(0.865 0.177 90.4);

  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);

  --animate-rise: rise 700ms var(--ease-out-expo) both;
  --animate-pulse-ring: pulse-ring 2.4s var(--ease-out-quart) infinite;
  --animate-float: float 6.5s ease-in-out infinite; /* landing mockups only */

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(18px);
    }
  }
  @keyframes pulse-ring {
    0% {
      transform: scale(0.6);
      opacity: 0.55;
    }
    80%,
    100% {
      transform: scale(1.9);
      opacity: 0;
    }
  }
  /* animates `translate`, so it composes with Tailwind's `rotate-*` on the same element */
  @keyframes float {
    50% {
      translate: 0 -10px;
    }
  }
}
```

Then make these changes inside the existing `@layer base` block:

```css
  html {
    -webkit-text-size-adjust: 100%;
    scroll-behavior: smooth;
    font-synthesis-weight: none; /* Bebas Neue ships one weight: never fake a bold */
  }
  /* Bebas is drawn in capitals; keep the source in sentence case and let CSS set the case */
  .font-display {
    text-transform: uppercase;
  }
  ::selection {
    background: var(--color-signal);
    color: var(--color-ink);
  }
  :focus-visible {
    outline: 3px solid var(--color-accent); /* was --color-brand */
    outline-offset: 2px;
    border-radius: 6px;
  }
  /* violet is only 2.5:1 on ink, so focus inside dark bands turns lime (13.3:1) */
  :where(.bg-brand-deep, .bg-brand-strong, .bg-ink) :focus-visible {
    outline-color: var(--color-signal);
  }
```

### Contrast of every pairing

Computed with WCAG 2.x relative luminance by `palette.py`. Alpha colours were composited onto their actual background first. Text pairs need 4.5:1; large text and UI parts need 3:1.

| Foreground | Background | Ratio | Needs | Used for |
|---|---|---|---|---|
| ink | page / surface / sunken | 16.83 / 18.51 / 15.38 | 4.5 | body text |
| ink | brand-tint / brand-soft / accent-tint | 15.57 / 14.37 / 14.83 | 4.5 | text in chips, rows, banners |
| ink | warn-tint / danger-tint | 15.98 / 15.71 | 4.5 | banner text |
| muted | page / surface / sunken | 6.41 / 7.05 / 5.86 | 4.5 | secondary text |
| muted | brand-tint / accent-tint / warn-tint / danger-tint | 5.93 / 5.65 / 6.09 / 5.99 | 4.5 | secondary text on tints |
| faint | page / surface | 4.59 / 5.05 | 4.5 | placeholders, inactive tabs, future steps |
| brand-strong | brand-tint / brand-soft / page / surface | 12.41 / 11.46 / 13.42 / 14.76 | 4.5 | chip and notice text |
| accent | page / surface / sunken | 6.66 / 7.32 / 6.08 | 4.5 | links, eyebrows, highlight words |
| accent | accent-tint / brand-tint | 5.86 / 6.16 | 4.5 | demo pill, link on a lime row |
| warn | warn-tint / surface / page | 5.22 / 6.04 / 5.49 | 4.5 | warning text and icons |
| danger | danger-tint / surface / page | 5.55 / 6.54 / 5.94 | 4.5 | error text |
| white / on-brand | brand (ink) | 18.51 / 16.83 | 4.5 | primary button label |
| ink | signal / signal-strong | 13.30 / 14.47 | 4.5 | lime button and chip label |
| white | danger | 6.54 | 4.5 | danger button label |
| white | warn | 6.04 | 3 | "!" glyph on the warn badge |
| white | plate-blue | 7.84 | 3 | plate country code |
| on-brand | brand-deep / brand-strong | 16.83 / 13.42 | 4.5 | text on ink, and on the raised dark card |
| on-brand-muted | brand-deep / brand-strong | 6.98 / 5.56 | 4.5 | secondary text and mono labels on dark |
| mint, signal (lime) | brand-deep / brand-strong | 13.30 / 10.60 | 4.5 | countdown, "View", checks on dark |
| on-brand-accent | brand-deep / brand-strong | 8.04 / 6.41 | 4.5 | highlight words on dark |
| line-strong | surface / page / sunken | 3.65 / 3.32 / 3.03 | 3 | input and secondary-button edges |
| accent | page / surface | 6.66 / 7.32 | 3 | focus ring, nav underline |
| signal | brand-deep | 13.30 | 3 | focus ring inside ink bands |
| brand | page | 16.83 | 3 | stepper fill, selected ring |
| context | surface / map land `#F2F3F0` | 3.57 / 3.21 | 3 | public-charger dots and AC rings |
| ink | map land | 16.62 | 3 | DC rings, clusters, bay-pin ring |
| accent | map land | 6.57 | 3 | selected-charger ring |
| faint | map land | 4.53 | 3 | ring of the busy bay pin |
| location | map land | 4.64 | 3 | your-location dot |
| ink | signal | 13.30 | 3 | bay pin: ink bolt and ring on lime |

These pairings are not used, or are allowed only as decoration:

- `line` on surface or page (1.41 / 1.29) is a hairline and never the only edge of a control.
- Lime on white or paper (1.39 / 1.27) never carries meaning by itself. It sits under ink, as in the landing hero CTA (identified by its 13.3:1 ink label, which WCAG 1.4.11 accepts) or the ink-ringed bay pin. Otherwise it only decorates next to ink: a pulse halo, a landing bullet.
- Violet on ink (2.53) and `on-brand-accent` on paper (2.09) are never used.
- Warn on ink (3.06) is a UI dot only, never text.

### Named rules

**The Voltage Rule.** On a light surface, lime never carries meaning by itself: no lime text, lines, rings or state markers. It is 1.27:1 there and vanishes in sunlight. It may sit under ink (the hero CTA, the bay pin) or decorate next to ink (a pulse halo, a bullet). On ink, lime is the value colour.

**The Legible Voltage Rule.** When the accent has to be read on light, it is violet (`accent`). When it has to be read on ink, it is lime for values and light violet for words.

**The One Spark Rule.** Lime marks one thing per screen: the Ecurious bay, or your booking of it. If two unrelated things on a screen are lime, one of them is wrong. Lime-soft chip tints don't count.

## 3. Typography

**Display font:** Bebas Neue 400, falling back to Arial Narrow.
**Body font:** Space Grotesk, variable 300–700, falling back to system-ui.
**Label and data font:** JetBrains Mono, variable 100–800, falling back to ui-monospace.

**Character:** Bebas Neue is condensed, all-caps signage, Space Grotesk is a slightly quirky grotesque that stays easy to read, and JetBrains Mono gives every number a fixed width. These are exactly the three families ecurious.com loads from Google Fonts. All three are under the SIL Open Font License 1.1, and next/font self-hosts them at build time, so visitors' browsers never call Google. That avoids the GDPR problem a Munich court found in 2022 with fonts loaded from Google's servers. Their CSS lists "Bebas Neue Pro" first, which is a paid Dharma Type family; we use only the free Bebas Neue, which is what their site actually renders.

Measured in the browser: Bebas Neue's digits are tabular by default, so the countdown won't jitter. Space Grotesk supports `tnum`, so `tabular-nums` works. Bebas has Ä, Ö, Ü, € and ·, but not ẞ or ≥. CSS uppercases ß to "SS", and "≥ 50 kW" lives in mono chips, so neither gap shows. Bebas draws `0` and `O` at the same width, so any text where that difference matters (plate inputs, misread hints) is set in mono.

### next/font import (`app/layout.tsx`)

```tsx
import { Bebas_Neue, JetBrains_Mono, Space_Grotesk } from "next/font/google";

// Ecurious's own type system: the three families ecurious.com uses, all SIL OFL, self-hosted by next/font
const display = Bebas_Neue({ subsets: ["latin", "latin-ext"], weight: "400", variable: "--font-bebas-neue" });
const sans = Space_Grotesk({ subsets: ["latin", "latin-ext"], variable: "--font-space-grotesk" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-jetbrains-mono" });

// <html lang="en" data-scroll-behavior="smooth" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
```

`latin-ext` is included because GoingElectric charger names cover the rest of Europe (ł, ř, ő). Its files only load when those characters appear.

### Hierarchy

The app uses a fixed rem scale. Fluid `clamp()` sizes are for the landing page only.

| Role | Font | Size and leading | Use |
|---|---|---|---|
| Countdown | Bebas | `text-8xl sm:text-9xl` (96 / 128px), `leading-[0.85]` | hold timer and charging timer, in lime on ink |
| Display (landing) | Bebas | `text-[clamp(3.5rem,8vw,6rem)]`, `leading-[0.88]`, `tracking-[0.012em]` | hero h1 only, capped at 6rem |
| Headline (landing) | Bebas | `text-[clamp(2.5rem,5vw,4.5rem)]`, `leading-[0.9]` | section h2 |
| Page title | Bebas | `text-4xl` (36px), `leading-[0.95]` | h1 in the app: Bookings, Your cars, the bay name |
| Status headline | Bebas | `text-4xl` (36px), `leading-[0.9]` | "You're checked in.", "Another car is in your bay.", "Session complete." |
| Card and dialog title | Bebas | `text-2xl`–`text-3xl` (24–30px) | dialog titles, Receipt, Nearest public chargers, Add a car, empty states |
| Title | Space Grotesk 600 | `text-lg` (18px) | list item names, car names |
| Body | Space Grotesk 400 | `text-base`, `leading-normal` (16/24) | everything you read; landing body `text-lg` |
| Small | Space Grotesk 400 | `text-sm` (14px) | meta lines, hints |
| Button | JetBrains Mono 600, uppercase | `text-sm` (14px), `tracking-[0.06em]` | every button |
| Label and chip | JetBrains Mono 500–600, uppercase | `text-xs`–`text-[0.8125rem]`, `tracking-[0.08em]`–`[0.14em]` | chips, data keys, kickers, legal lines |
| Data | JetBrains Mono 500 | `text-sm`–`text-lg` | prices, times, distances, kW, plate input, event log |

### Named rules

**The Signage Rule.** Bebas only goes on headings and big numbers, at 20px or more. It never goes on body text, buttons, form fields, chips or anything you have to read twice. Bebas has one weight, so never add `font-bold` to it.

**The Monospace-for-Facts Rule.** Every number a driver acts on (time, price, distance, power, plate) is mono or Bebas, so it never reflows while it updates.

**The One Eyebrow Rule.** The mono violet eyebrow with a leading 24px rule appears exactly once in the product: above "Add your car" on the welcome step. Mono capitals elsewhere are data labels or the landing hero's live-status line, never section decoration.

## 4. Elevation

Surfaces are flat, layered by tone and separated by hairlines: paper, then white cells and cards, then ink bands. Shadows appear only where something truly floats above other content: map controls, the bottom sheet, dialogs, and the landing mockups. All shadows are tinted with ink (`rgb(15 20 25 / a)`) rather than pure black.

### Shadow vocabulary

- **Control on map:** `shadow-[0_2px_10px_-2px_rgb(15_20_25/0.2)]`. Search, chips and the locate button keep their current values with the tint swapped.
- **Sheet:** `shadow-[0_-12px_40px_-12px_rgb(15_20_25/0.3)]`, for the mobile chargers sheet.
- **Dialog:** `shadow-[0_30px_80px_rgb(15_20_25/0.28)]`, from Ecurious's calculator panel.
- **Float:** `shadow-[0_24px_50px_rgb(15_20_25/0.32)]`, for the landing phone and bay panel (Ecurious hero assembly).
- **Flag:** `shadow-[0_2px_10px_rgb(15_20_25/0.18)]`, for a chip floating on an illustration.

### Named rules

**The Flat-by-Default Rule.** Cards are a white fill plus `ring-1 ring-line`, with no shadow. If a resting card has a shadow, it is wrong.

**The Not-Glass Rule.** The sticky header may be 90% opaque with a light blur, but never a frosted glass card. PRODUCT.md rules out glassmorphism.

## 5. Components

Each component gets a short character line, then its spec. These components match Ecurious's own app mockups: pills, mono capitals and dark panels.

### Shape and radius

- **Pills** (`rounded-full`): every button, chip, input, the search field, the locate button and icon badges.
- **Cards** (`rounded-2xl`, 16px, close to Ecurious's 14px): list cards, receipts, vehicle rows, booking rows, sketch frames and notices.
- **Hero panels and dialogs** (`rounded-3xl`, 24px, Ecurious's calculator): the live-booking card, the blocked card, the landing pricing panels and the dialog.
- **Small controls** (`rounded-lg`, 8px): connector rows and demo event buttons.
- **Spec grids** have square corners and hairlines.
- `rounded-4xl` goes away (it becomes `rounded-3xl`), and `rounded-xl` on controls becomes `rounded-full`.

### Buttons

Tactile, uppercase, mono: Ecurious's `.btn` family.

- **Shape:** a pill. The label is JetBrains Mono 600 in capitals with `tracking-[0.06em]`; below 640px it uses `tracking-[0.04em]` and is allowed to wrap.
- **Primary:** an ink pill with a paper label (16.8:1) on every light screen. Hover is ink-soft, and the button lifts 2px (`hover:-translate-y-0.5`, 150ms). Pressing settles it back.
- **Signal:** a lime pill with an ink label. Use it on ink surfaces, and once on paper for the landing hero CTA.
- **Secondary:** white, ink label, with a `ring-line-strong` edge (3.65:1) that turns ink on hover.
- **Ghost:** an ink label with a sunken background on hover.
- **On-brand:** the outlined pill for ink surfaces.
- **Danger:** a red pill with a white label.
- **Sizes:** all sizes are at least 44px tall (PRODUCT.md's floor). `sm` today is 36px, which fails it.
- **Arrow:** forward CTAs use the `ArrowRight` icon, which nudges 4px on hover (`group-hover:translate-x-1`).

### Chips

Mono capitals in a pill, with text always present, so colour is never the only signal.

- **Base:** `chipClass` (§7.2): `rounded-full px-3 py-1 font-mono text-[0.8125rem] font-semibold uppercase tracking-[0.08em]`.
- **Positive** (held for you, free, booked by you, charging, completed): `bg-brand-tint text-brand-strong`, with an optional ink dot. On ink, use `bg-signal text-ink`.
- **Waiting or problem** (reserved by others, in use, car in bay, held, no-show): `bg-warn-tint text-warn`.
- **Neutral** (cancelled): `bg-sunken text-muted`.
- **Demo and prototype:** `bg-accent-tint text-accent`.
- **Map filter chips** keep their current behaviour: white with an ink label, and solid ink with a paper label when pressed. The label becomes mono `text-xs`.

### Cards and panels

- **Card:** `rounded-2xl bg-surface ring-1 ring-line` with padding `p-5`–`p-8`. No nested cards.
- **Live-status card:** `rounded-3xl bg-brand-deep text-on-brand`. It holds a lime status chip, a lime Bebas number, mono labels in `on-brand-muted`, and dividers in `border-white/14`. It is used for Reserved, Checked in and Charging, and on the landing phone mockup.
- **Blocked card:** `rounded-3xl bg-warn-tint text-ink` with a warn icon. The deliberate break from ink tells you something is wrong.
- **Done card:** a plain white card.
- **Spec grid:** see §1, Layout. It is for landing content only.

### Inputs and fields

- **Style:** `rounded-full`, white, a 1px `line-strong` edge at full strength (3.65:1), `min-h-12`, `px-5`.
- **Focus:** the border turns `accent`, with `ring-3 ring-accent/20`, plus the global violet outline.
- **Labels:** Space Grotesk 600 in sentence case. Form labels stay easy to read, so they are not mono.
- **Plate inputs:** `font-mono text-lg font-semibold uppercase tracking-[0.06em]`.
- **Errors:** `text-danger` under the field. **Disabled:** `opacity-55`.

### Navigation

- **App header:** `bg-page/90 backdrop-blur-sm border-b border-line`. Links are Space Grotesk 500 in muted, turning ink on hover and when current.
- **Current page:** a 2px violet underline that scales in from the left (200ms), Ecurious's nav pattern.
- **Bottom tabs:** the same violet bar sits on top of the active tab, with the active label and icon in ink and the others in `faint`.
- **Landing header:** sits on paper. "Sign in" is a secondary pill and "Get started" is a lime pill.

### Map marks

- **Ecurious bay pin:** a lime teardrop with a 3px ink ring and an ink bolt. Lime is the only saturated colour on the map, and the ink ring holds 16.6:1 against it. A lime pulse shows only while the bay is free.
- **Busy bay pin:** a sunken body with a `faint` ring and a `faint` bolt.
- **Public chargers:** keep white dots with a `context` ring for AC, an `ink` ring for DC at 50 kW or more, and a `danger` ring for a fault. **Selected** becomes a violet `accent` ring.
- **Clusters:** stay ink with a white count.
- **Your location:** stays blue.
- **The base map stays OpenFreeMap Positron (light).** Public chargers recede, which fits PRODUCT.md's "Honest data" principle.

### Iconography

- **Library:** keep lucide-react. It is a 24px line grid like Ecurious's hand-drawn icons.
- **Stroke:** keep the default 2px stroke up to 24px. Use `strokeWidth={1.5}` at 32px or more (the 32–36px icons on the blocked and checked-in cards), which matches Ecurious's 1.5px at 44px.
- **Colour:** icons are ink or muted on light, and lime or `on-brand-muted` on dark. Never colour an icon lime on light.
- **Status icons** always sit next to their word.
- **The bolt (`Zap`)** is reserved for the Ecurious bay.

### Imagery and illustration

- **Product shots:** Ecurious shows product renders (phones tilted 2–5°, floating, with a soft ink shadow), warm cinematic photography and team portraits. We have none of these and must not borrow theirs. We keep our own product shot, the `PhoneMockup`, tilted `-rotate-4` and floating (`motion-safe:animate-float`), next to an ink bay panel tilted `rotate-5`.
- **`BaySketch`** is drawn in Ecurious's diagram language (the dark grid panel with glowing nodes from their technology section): ink lines on paper, the guard as a lime token, and the camera's field of view in violet. On dark, the lines are paper at 40% and the guard is lime. On light, the guard gets an ink edge so it holds against paper.
- **Photos:** if the team photographs the real device at the venue, it may appear in a `rounded-2xl` frame with a warm grade. No stock photography, ever.

### Logo and "Powered by Ecurious"

- **Our product mark stays our own:** the bay outline with a bolt. On light it is an ink square with a lime bolt; on dark it is a lime square with an ink bolt. The product name "Ecurious Reserve" is set in Bebas, with "Reserve" in violet (light violet on dark).
- **Do not recreate Ecurious's diacritic Ë mark or its wordmark** in CSS or SVG.
- **"Powered by Ecurious" (shipped):** `PoweredByEcurious` in `components/ui/logo.tsx` is a text-only credit in our own type: a mono label `POWERED BY` and "Ecurious" in Bebas, linking to `https://ecurious.com`. It appears in the landing footer and the auth panel.
  - Decision: no Ecurious logo files until the user confirms permission from Ecurious staff.
  - The public files are `https://ecurious.com/assets/wordmark-black.png` and `wordmark-white.png` (PNG, 1428×344), plus `https://ecurious.com/assets/favicon.png`. Public isn't the same as licensed.
  - If permission comes, swap the Bebas word in that one component for the white wordmark, unmodified, at 16px high, using `next/image` from `public/brand/`.
  - Never recolour, crop, stretch or hotlink the files, put the wordmark on lime, or use it as our app icon.

### Motion

Motion is quick and only conveys state. Product transitions take 150–250ms.

| Motion | Spec | Where |
|---|---|---|
| Button lift | `hover:-translate-y-0.5`, 150ms ease-out; hover only applies on devices that can hover | all buttons |
| Arrow nudge | `group-hover:translate-x-1`, 200ms | forward CTAs |
| Nav underline | `scale-x` from the left, 200ms | header nav |
| Stepper fill | `transition-colors duration-500` (existing) | booking progress |
| Pulse ring | `animate-pulse-ring`, 2.4s (existing) | free bay pin, guard in drawings |
| Rise | `animate-rise`, 700ms expo (existing) | landing hero only |
| Float | `animate-float`, 6.5s ±10px (new) | landing phone and bay panel only |

No marquee, scan line, glow or choreography anywhere in the app. `prefers-reduced-motion` is already handled globally: animations run once at 1ms, and content is always visible without them.

## 6. Do's and Don'ts

### Do

- **Do** keep primary actions as ink pills on light. Lime fills go on ink, or on the one hero CTA.
- **Do** put a word next to every status colour: "Held for you", "Car in bay", "No-show".
- **Do** set times in 24 hours ("Held until 14:35") and every driver-facing number in mono or Bebas.
- **Do** use violet for links and focus, and give focus inside ink bands the lime outline (already handled in the base layer).
- **Do** run `python3 -I palette.py --check` after touching any colour value.

### Don't

- **Don't** set lime as text, a ring or a state marker on paper or white (1.27:1).
- **Don't** add `font-bold` or negative tracking to Bebas, use it below 20px, or set body text, buttons or inputs in it.
- **Don't** put a mono eyebrow over every section, or number sections that aren't a real sequence.
- **Don't** let any heading exceed `6rem`. The countdown is a number, not a heading, and may reach `text-9xl`.
- **Don't** build generic SaaS dashboard templates: hero-metric cards, identical icon-card grids, purple gradients. Violet is a flat accent, never a gradient or a fill for big surfaces.
- **Don't** use "EV tech" clichés: neon-on-black, lightning-bolt gradients, glassmorphism. That rules out Ecurious's dark app look and their glows.
- **Don't** let promos, filters and toasts fight the map. The bay pin is the only loud mark on it.
- **Don't** build the bare full-screen map with a floating white box, with no hierarchy and no entry point.
- **Don't** reuse Ecurious's copy, claims, sign-off, photos, partner names or app screenshots.

### What we deliberately did not adopt

| On ecurious.com | Measured | What we do instead |
|---|---|---|
| Body and lede grey (ink at 58%) | 4.39:1 on paper, **fails** | `muted` `#55595E`: 6.41:1 on paper, 5.86:1 on sunken |
| Note, marquee and disclaimer grey (ink at 36%) | 2.30:1, **fails** | nothing below `faint` (4.59:1) |
| Calculator disclaimer, dark grey on the dark panel | 1.02:1, **invisible** | `on-brand-muted` (6.98:1) |
| White label on the lime CTA in the mobile menu | 1.39:1, **fails** | lime always carries ink (13.3:1) |
| Lime bullets and lime pill edges on paper | 1.27:1 | decorative on the landing page only; never in the app on light |
| Orange live dot `#F26B3A` | 2.75:1 on paper | `warn` darkened to `#A8430F` (5.49:1); the live dot is ink with a lime halo |
| `outline: none` on their email input | no focus indicator | 3px violet outline everywhere, lime inside ink |
| Dark-mode app (near-black UI, lime glows, dark map) | neon-on-black (PRODUCT.md anti-reference); glare in sunlight | light app; ink only for the live-status card and bands; light Positron map |
| Headlines up to 132–150px | shouting (impeccable's 6rem cap) | `clamp(3.5rem,8vw,6rem)` |
| Mono eyebrow over every section, and the six identical icon cells | AI-template tells; PRODUCT.md anti-reference | one eyebrow in the whole product (welcome step); spec grids only for a real sequence (4 steps) and the privacy table |
| Marquee, scan line, flying tokens, floating cards | decorative motion | float on the landing mockups only |
| Translucent nav at 82% with a 14px blur | close to glass | header at 90% with a light blur |
| "Bebas Neue Pro" first in the stack | commercial font | free Bebas Neue (what they actually load) |
| Their Ë mark, wordmark styling, photos, copy, partner logos | not ours to use | our own mark; their wordmark only as attribution, with permission |

## 7. Applying it, screen by screen

### Top 10 by visual impact

1. **Tokens** (`globals.css` §2): paper, ink, lime and violet replace green and yellow on every screen at once.
2. **Fonts** (`layout.tsx` §3), plus the global display fixes (§7.3).
3. **Buttons** become ink and lime pills with mono capitals (`button.tsx`).
4. **The landing hero** moves to paper: a giant Bebas headline with a violet highlight, a lime pill, and a tilted floating phone with an ink bay panel.
5. **The live-booking card** turns ink, with a 128px lime Bebas countdown and mono labels (Reserved, Checked in, Charging).
6. **The map:** a lime bay pin with an ink ring and bolt, a violet selected ring, a lime pulse, and state-aware labels.
7. **Chips:** mono capitals, positive in lime-soft, problems in warn, demo in violet.
8. **Sign in and sign up:** an ink brand panel with a Bebas headline and "Powered by"; Clerk gets pills, mono buttons and violet links.
9. **The app shell:** a paper header, the Bebas logo, the violet active underline and tab bar, and a violet demo pill.
10. **The landing sections:** the hairline spec grid for the 4 steps, an ink privacy table with a lime rule, an ink footer with "Powered by Ecurious".

### 7.1 Foundation (apply first; every screen is then about 70% there)

| File | Change |
|---|---|
| `app/globals.css` | replace `@theme` and update `@layer base` exactly as in §2 |
| `app/layout.tsx` | replace the Barlow imports with the §3 next/font block; replace `html` `className`; set `viewport.themeColor` to `"#f5f4f1"`; replace the Clerk `appearance.variables` with the block below; delete the "Barlow is drawn from highway signage" comment |
| `app/manifest.ts` | set `background_color` and `theme_color` to `"#f5f4f1"` |
| `app/icon.svg` | set the rect fill to `#0f1419` and the bolt fill to `#c8e847` |
| `app/apple-icon.png`, `public/icon-512.png` | re-export from the new `icon.svg` at 180px and 512px (headless-browser screenshot of the SVG); the PNGs are binary and can't be edited as text |

```tsx
appearance={{
  cssLayerName: "clerk",
  // theme tokens, so a retheme in globals.css reaches Clerk's forms too
  variables: {
    colorPrimary: "var(--color-brand)",
    colorPrimaryForeground: "var(--color-on-brand)",
    colorForeground: "var(--color-ink)",
    colorMutedForeground: "var(--color-muted)",
    colorBackground: "var(--color-surface)",
    colorInput: "var(--color-surface)",
    colorInputForeground: "var(--color-ink)",
    colorDanger: "var(--color-danger)",
    colorWarning: "var(--color-warn)",
    colorBorder: "var(--color-line-strong)", // inputs need 3:1 against the page
    colorRing: "var(--color-accent)", // drawn at 15%: the visible focus ring is the global outline
    colorShadow: "var(--color-ink)",
    colorModalBackdrop: "var(--color-ink)",
    fontFamily: "var(--font-sans)",
    fontFamilyButtons: "var(--font-mono)",
    fontFamilyMono: "var(--font-mono)",
    fontSize: "1rem",
    borderRadius: "0.75rem", // pills are set per element in clerk-card.ts; a 999px base would round the OTP boxes
  },
}}
```

### 7.2 Shared primitives

**`components/ui/button.tsx`**: replace `VARIANTS`, `SIZES` and the base string, and add `chipClass` below `buttonClass`:

```ts
const VARIANTS = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong active:bg-brand-deep',
  secondary: 'bg-surface text-ink ring-1 ring-inset ring-line-strong hover:ring-ink',
  ghost: 'text-ink hover:bg-sunken',
  danger: 'bg-danger text-white hover:bg-danger/90',
  // lime: on ink surfaces, plus the one hero CTA on paper (its ink label carries the 13:1)
  signal: 'bg-signal text-ink hover:bg-signal-strong',
  'on-brand': 'text-on-brand ring-1 ring-inset ring-on-brand-muted/50 hover:bg-white/5 hover:ring-on-brand',
};

const SIZES = {
  sm: 'min-h-11 px-4 text-xs', // 44px: PRODUCT.md's touch-target floor (was 36px)
  md: 'min-h-11 px-6 text-sm',
  lg: 'min-h-13 px-8 text-[0.9375rem]',
};

export const buttonClass = (variant: ButtonVariant = 'primary', size: keyof typeof SIZES = 'md', extra = '') =>
  `group inline-flex items-center justify-center gap-2.5 rounded-full font-mono font-semibold uppercase tracking-[0.06em] whitespace-nowrap select-none transition-[background-color,color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 active:translate-y-0 disabled:pointer-events-none disabled:opacity-55 max-sm:whitespace-normal max-sm:text-center max-sm:tracking-[0.04em] ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;

// Status labels: mono capitals in a pill. Always pair with a tone (DESIGN.md §5 Chips).
export const chipClass = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[0.8125rem] font-semibold uppercase leading-none tracking-[0.08em]';
```

Delete the comment "for deep-green brand surfaces".

| File | Now | Change to |
|---|---|---|
| `ui/field.tsx` `inputClass` | `rounded-xl border border-line-strong/70 … px-4 … focus:border-brand … focus:ring-brand/20` | `rounded-full border border-line-strong … px-5 … focus:border-accent … focus:ring-accent/20`. Drop the `/70`: at 70% the edge is about 2.5:1 and fails today. |
| `ui/dialog.tsx` | `shadow-[0_32px_80px_-24px_rgb(0_0_0/0.45)]`; title `font-display text-xl font-bold`; close button `rounded-xl` | `shadow-[0_30px_80px_rgb(15_20_25/0.28)]`; `font-display text-2xl leading-none`; `rounded-full` |
| `ui/empty-state.tsx` | `rounded-3xl … border-line-strong/50`; icon `rounded-2xl bg-brand-tint text-brand`; title `font-display text-2xl font-bold` | `rounded-2xl … border-line-strong`; icon `rounded-full bg-brand-tint text-ink`; `font-display text-3xl` |
| `ui/plate-badge.tsx` | `font-display font-bold … tracking-[0.06em]`; sizes `text-sm / text-lg / text-2xl` | `font-display … tracking-[0.08em]` (condensed capitals, close to the FE-Schrift on German plates); sizes `text-base / text-xl / text-3xl` (Bebas is narrower, so this keeps the plate's width) |
| `ui/clerk-card.ts` | see below | see below |

**`components/ui/logo.tsx`** (body):

```tsx
const light = tone === 'light';
return (
  <span className={`inline-flex items-center gap-2.5 ${className}`}>
    <svg viewBox="0 0 32 32" aria-hidden className="size-8 shrink-0">
      <rect width="32" height="32" rx="8" className={light ? 'fill-signal' : 'fill-brand'} />
      <path d="M9 8v16h14V8" fill="none" strokeWidth="2.2" strokeLinecap="round" className={light ? 'stroke-ink/80' : 'stroke-on-brand/70'} />
      <path d="M17.4 10.5 12.6 17h3.6l-1.6 5.5 4.8-6.6h-3.6z" className={light ? 'fill-ink' : 'fill-signal'} />
    </svg>
    <span className={`whitespace-nowrap font-display text-[1.6rem] leading-none tracking-[0.02em] ${light ? 'text-on-brand' : 'text-ink'}`}>
      Ecurious <span className={light ? 'text-on-brand-accent' : 'text-accent'}>Reserve</span>
    </span>
  </span>
);
```

**`components/ui/clerk-card.ts`**:

```ts
const field = 'min-h-12 rounded-full px-5 text-base shadow-[inset_0_0_0_1px_var(--color-line-strong)]';

export const clerkCard = {
  elements: {
    rootBox: 'w-full max-w-[26rem]',
    cardBox: 'w-full overflow-visible shadow-none rounded-none border-0', // it clipped the fields' outer pixel
    card: 'bg-transparent shadow-none px-0 py-2',
    headerTitle: 'font-display text-4xl uppercase leading-[0.9] tracking-[0.012em] text-ink', // explicit: the clerk layer outranks base
    headerSubtitle: 'text-base text-muted',
    socialButtonsBlockButton: `${field} hover:bg-sunken`,
    dividerText: 'font-mono text-xs uppercase tracking-[0.14em] text-muted',
    formButtonPrimary: 'min-h-12 rounded-full bg-brand font-mono text-sm font-semibold uppercase tracking-[0.06em] text-on-brand shadow-none after:hidden hover:bg-brand-strong',
    formFieldInput: `${field} focus:shadow-[inset_0_0_0_2px_var(--color-accent)]`,
    footerActionLink: 'font-semibold text-accent underline underline-offset-2 hover:text-ink',
    footer: 'bg-none bg-transparent',
  },
};
```

### 7.3 Global replacement rules (all files under `app/` and `components/`)

| Find | Replace with | Why |
|---|---|---|
| `font-bold` or `font-semibold` in a class string that has `font-display` | remove | Bebas has one weight. The base layer blocks fake bold anyway. |
| `tracking-tight`, `tracking-[-0.02em]` or `tracking-[-0.01em]` next to `font-display` | `tracking-[0.012em]` | negative tracking makes condensed caps touch |
| `leading-tight`, `leading-none`, `leading-[0.94]`, `leading-[0.98]` or `leading-[1.02]` on multi-line `font-display` headings | `leading-[0.9]`, or `leading-[0.95]` for in-app titles | caps-only lines need tight leading |
| `font-display` on anything below `text-xl` (step numbers, plate inputs, demo hints) | `font-mono` | The Signage Rule |
| `text-white` on a `bg-brand-deep` or `bg-brand-strong` element or its children | `text-on-brand` | paper, not pure white (Ecurious) |
| `rounded-4xl` | `rounded-3xl` | radius scale (§5) |
| `rounded-3xl` on ordinary cards (not the live-status, blocked or pricing panels, and not the dialog) | `rounded-2xl` | radius scale |
| `rgb(0_0_0/` inside `shadow-[…]` | `rgb(15_20_25/` | ink-tinted shadows (optional, same look) |
| `text-brand-strong underline` on links | `text-accent underline` | violet links |

Sizes: at the same `text-*`, Bebas capitals stand as tall as Barlow's but are narrower and lighter.

- Bump card, dialog and status titles one step: `text-xl` to `2xl`, `2xl` to `3xl`, `3xl` to `4xl`.
- Leave `text-4xl` page titles as they are.
- The countdown, plate badge, welcome and auth headlines, landing clamps and prices have their own sizes.

The tables below list every case.

### 7.4 Landing (`app/(marketing)/page.tsx` and `components/landing/*`)

| Element | Now | Change to |
|---|---|---|
| Top wrapper | `bg-brand-deep text-white` | `bg-page text-ink`. The hero sits on paper, as ecurious.com's does. |
| Header logo | `<Logo tone="light" />` | `<Logo />` |
| Header nav | `text-on-brand`; links `hover:text-white` | `text-ink`; links `relative py-1 after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-200 hover:after:scale-x-100` |
| "Sign in" | `buttonClass('on-brand', 'sm')` | `buttonClass('secondary', 'sm')` |
| "Get started" and "Open the app" | `buttonClass('signal', 'sm')` | unchanged (a lime pill on paper, like Ecurious's nav CTA) |
| `LiveBayStatus` (`live-bay-status.tsx`) | a translucent pill: `rounded-full bg-white/8 … text-on-brand ring-white/15`; name `text-white`; dot and ping share one class | Ecurious hero note: `inline-flex items-center gap-2.5 font-mono text-[0.8125rem] uppercase tracking-[0.1em] text-muted`; name `font-semibold text-ink`. Return `[label, dot, ping]`: free is `['free right now', 'bg-ink', 'bg-signal']`, the others are `[…, 'bg-warn', 'bg-warn']`. The placeholder becomes `h-5`. |
| h1 | `font-display text-[clamp(2.9rem,7.2vw,5.6rem)] font-bold leading-[0.94] tracking-tight` with highlight `text-signal` | `font-display text-[clamp(3.5rem,8vw,6rem)] leading-[0.88] tracking-[0.012em]`; highlight `text-accent` |
| Lede | `text-[1.2rem] leading-relaxed text-on-brand sm:text-xl max-w-[34ch]` | `text-[clamp(1.1875rem,2vw,1.375rem)] leading-normal text-muted max-w-[40ch]` |
| CTAs | `signal` lg + `on-brand` lg | `signal` lg with `<ArrowRight className="size-5 transition-transform duration-200 group-hover:translate-x-1" />` + `secondary` lg |
| Fine print | `text-[0.95rem] text-on-brand-muted` | `font-mono text-xs uppercase leading-relaxed tracking-[0.08em] text-muted` |
| Phone wrapper | `<div className="relative animate-rise …"><PhoneMockup /></div>` | wrap the mockup in an inner `<div className="-rotate-4 motion-safe:animate-float">` (keep `animate-rise` on the outer div) |
| Bay figure | `rounded-3xl bg-brand-strong p-3 shadow-[0_24px_48px_-20px_rgb(0_0_0/0.6)] ring-1 ring-white/12`; caption `text-sm text-on-brand` + `font-semibold text-white` | `rotate-5 rounded-2xl bg-brand-deep p-3 shadow-[0_24px_50px_rgb(15_20_25/0.32)] ring-1 ring-white/14`; caption `font-mono text-[0.6875rem] uppercase leading-snug tracking-[0.08em] text-on-brand-muted` + `text-on-brand` |
| `PhoneMockup` title | "Your booking" in `font-display text-lg font-bold` | `font-display text-xl` (the Signage Rule floor) |
| `PhoneMockup` card | `rounded-2xl bg-surface p-4 ring-1 ring-line` | `rounded-2xl bg-brand-deep p-4 text-on-brand` (it mirrors the new booking card) |
| Mockup chip | `bg-brand-tint … text-brand-strong`; dot `bg-brand`, ping `bg-brand/60` | `inline-flex items-center gap-1.5 rounded-full bg-signal px-2.5 py-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-ink`; dot `bg-ink`, ping `bg-ink/50` |
| Mockup countdown | `font-display text-[3.25rem] font-bold leading-none tabular-nums tracking-[-0.02em]` | `font-display text-[4rem] leading-[0.85] text-signal` |
| Mockup meta lines | `text-sm text-muted` / `text-xs text-muted`; divider `border-line` | `font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-on-brand-muted`; divider `border-white/14` |
| Mockup stepper labels | current `text-brand-strong` | current `text-ink` (the stepper sits on `bg-page`) |
| Mockup buttons | `rounded-xl bg-brand font-semibold text-white` / `rounded-xl … ring-1 ring-line` | `rounded-full bg-brand font-mono text-xs font-semibold uppercase tracking-[0.06em] text-on-brand` / `rounded-full … ring-1 ring-line-strong font-mono text-[0.6875rem] uppercase tracking-[0.04em]` |
| `NearbyChargers` h2 | `… font-bold leading-none tracking-[-0.02em]`, highlight `text-brand` | `font-display text-[clamp(2.5rem,5vw,4.5rem)] leading-[0.9] tracking-[0.012em]`, highlight `text-accent` |
| `NearbyChargers` copy | "The green bay is the one an Ecurious guard keeps free for whoever booked it." | "The bay with the bolt is the one an Ecurious guard keeps free for whoever booked it." |
| `NearbyChargers` figure | `rounded-4xl bg-surface p-5 ring-1 ring-line` | `rounded-3xl bg-surface p-5 ring-1 ring-line` |
| `DotMap` bay | pulse `fill-brand`; dot `fill-brand stroke-surface`; bolt `fill-surface`; label `fill-brand-strong`; legend swatch `bg-brand` | pulse `fill-signal`; dot `fill-signal stroke-ink`; bolt `fill-ink`; label `fill-accent`; swatch `bg-signal ring-1 ring-ink`. Update the "(emphasis, green)" comment. |
| "Four steps" `<ol>` | `mt-12 grid gap-7 … sm:grid-cols-2 sm:gap-10 lg:grid-cols-4 lg:gap-6` | spec grid: `mt-12 grid border-l border-t border-line sm:mt-14 sm:grid-cols-2 lg:grid-cols-4` |
| Step `<li>` | `grid grid-cols-[6.5rem_1fr] items-start gap-5 sm:block` | add `border-b border-r border-line bg-surface p-5 sm:p-7` |
| Step sketch frame | `rounded-2xl bg-sunken … sm:rounded-3xl …` | `rounded-xl bg-page …` |
| Step number | `font-display text-sm font-bold tabular-nums text-brand` | `font-mono text-xs tracking-[0.12em] text-accent` |
| Step title | `font-display text-2xl font-bold` | `font-display text-3xl leading-none` |
| "At the bay" figure | `rounded-4xl bg-sunken`; caption chip `text-sm font-semibold … shadow-[0_8px_24px_-10px_rgb(0_0_0/0.25)]` | `rounded-3xl bg-sunken`; chip `font-mono text-xs uppercase tracking-[0.08em] … shadow-[0_2px_10px_rgb(15_20_25/0.18)]` |
| Pricing, driver card | `rounded-4xl`; "For drivers" `font-semibold text-muted`; price `font-display text-6xl font-bold tracking-[-0.02em]`; "per reservation" `text-lg text-muted`; `Check` icons | `rounded-3xl`; `font-mono text-xs uppercase tracking-[0.14em] text-muted`; `font-display text-7xl leading-[0.9] text-accent`; `font-mono text-sm uppercase tracking-[0.08em] text-muted`; replace `Check` with `<span aria-hidden className="mt-2 size-2 shrink-0 bg-signal" />` (Ecurious's square bullet, decorative) |
| Pricing, operator card | `rounded-4xl bg-brand-deep … text-white`; price `font-bold`; "Bay Guard" `font-display text-xl font-semibold text-mint`; `CircleCheck` in mint | `rounded-3xl … text-on-brand`; price `font-display text-7xl leading-[0.9] text-signal`; `font-mono text-xs uppercase tracking-[0.14em] text-on-brand-accent`; lime square bullets |
| "Talk to us" | `<p>` styled as a button: `rounded-xl bg-signal px-5 py-3 … text-ink` | `inline-flex items-center gap-2.5 font-mono text-sm uppercase tracking-[0.1em] text-signal`. It isn't clickable, so it mustn't look like a button. |
| Privacy section | `bg-sunken`, three icon columns | `bg-brand-strong text-on-brand`; grid `mt-12 grid divide-y divide-white/14 border-t-2 border-signal md:grid-cols-3 md:divide-x md:divide-y-0`; cells `py-8 md:px-8 md:first:pl-0`; replace the icons with mono keys `CONSENT`, `MATCHING`, `DELETION` (`font-mono text-xs tracking-[0.14em] text-on-brand-accent`), so it's a ruled table rather than an icon-card grid; titles `font-display text-3xl leading-none`; body `text-on-brand-muted` |
| CTA band | `bg-brand-deep text-white`; h2 `font-bold … tracking-tight` | `bg-brand-deep text-on-brand`; `font-display text-[clamp(2.5rem,5vw,4.5rem)] leading-[0.9] tracking-[0.012em]`; wrap "a bay is waiting." in `text-on-brand-accent` |
| Footer | `mx-auto flex max-w-7xl … text-sm text-muted …` on paper; links `hover:text-ink` | `<footer className="bg-brand-deep text-on-brand-muted">` around the existing inner layout; `<Logo tone="light" />`; credits `font-mono text-xs uppercase tracking-[0.06em]`; links `hover:text-signal`; `<PoweredByEcurious />` under the credits |
| `BaySketch` camera cone | dark `fill-mint/15 stroke-mint/50`, light `fill-brand/10 stroke-brand/40` | dark `fill-on-brand-accent/15 stroke-on-brand-accent/60`, light `fill-accent/10 stroke-accent/50` |
| `BaySketch` guard | `<rect … className="fill-signal" />` | on light add `strokeWidth="1" className="fill-signal stroke-ink/60"`; dark stays `fill-signal` |

### 7.5 Sign in and sign up (`app/(auth)/layout.tsx`, plus §7.1 Clerk variables and §7.2 `clerk-card.ts`)

| Element | Now | Change to |
|---|---|---|
| Brand panel | `bg-brand-deep p-12 text-white` | `bg-brand-deep p-12 text-on-brand` |
| Headline | `font-display text-5xl font-bold leading-[0.98] tracking-[-0.02em]`, highlight `text-signal` | `font-display text-6xl leading-[0.9] tracking-[0.012em]`, highlight `text-on-brand-accent` |
| Promises | `Check` in `text-mint`, `text-lg text-on-brand` | unchanged (lime checks on ink) |
| Bottom of panel | nothing | `<PoweredByEcurious className="mt-10" />` (§5, text only) |
| Form side | the Clerk card on paper | headings in Bebas capitals, pill fields and buttons, mono "CONTINUE" button, violet "Sign up" link. All of it comes from §7.1 and §7.2, with no extra edits. |

### 7.6 App shell (`components/app/app-nav.tsx`)

| Element | Now | Change to |
|---|---|---|
| Header | `border-b border-line bg-surface/95 backdrop-blur-sm` | `border-b border-line bg-page/90 backdrop-blur-sm` |
| Desktop links | `font-semibold text-muted … after:rounded-full after:bg-brand after:opacity-0 aria-[current=page]:after:opacity-100` | `font-medium text-muted … after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-200 hover:after:scale-x-100 aria-[current=page]:after:scale-x-100`. Remove the 18px icons (Ecurious's nav is text only); keep them in the bottom tabs. |
| `LivePill` | `inline-flex min-h-9 … rounded-full px-3.5 text-sm font-semibold tabular-nums ring-1 ring-inset` | ``${chipClass} min-h-11 px-3.5 ring-1 ring-inset`` with the same tones (they retheme themselves). The label reads "Bay blocked · hold paused" instead of "Bay blocked: hold paused". |
| Avatar | `hue-rotate-[-95deg] saturate-[0.8]` on Clerk's default avatar | delete the hack and its comment: Clerk's default purple now sits next to our violet |
| Bottom bar | `bg-surface/95`; active `aria-[current=page]:text-brand` | `bg-page/95`; add `relative aria-[current=page]:text-ink aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-6 aria-[current=page]:after:top-0 aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-accent` |
| Demo trigger (`demo-panel.tsx`) | `min-h-9 … rounded-full bg-signal px-3 text-sm font-semibold text-ink hover:bg-signal-strong` | `min-h-11 … rounded-full bg-accent-tint px-3.5 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-accent ring-1 ring-inset ring-accent/25 hover:ring-accent` |

### 7.7 Explore (`components/explore/*`)

| Element | Now | Change to |
|---|---|---|
| Filter `chip()` | `min-h-9 … rounded-full … text-sm font-semibold … shadow-[0_2px_8px_-2px_rgb(0_0_0/0.18)]` | `min-h-11 … rounded-full … font-mono text-xs font-semibold uppercase tracking-[0.08em] … shadow-[0_2px_8px_-2px_rgb(15_20_25/0.18)]`; the pressed ink state is unchanged |
| Search input / locate | `rounded-xl … focus:ring-brand` / `rounded-xl` | `rounded-full … focus:ring-accent` / `rounded-full` |
| Sheet handle label | `text-sm font-semibold text-muted` | `font-mono text-xs font-semibold uppercase tracking-[0.1em] text-muted` |
| Bay card (`ChargerList`) | `rounded-2xl bg-brand-deep p-4 … text-white`; icon `rounded-xl bg-signal`; name `font-semibold`; meta `text-sm text-on-brand`; "View" `text-sm font-semibold text-signal group-hover:underline` | `text-on-brand`; icon `rounded-full bg-signal`; name `font-display text-2xl leading-none`; meta `font-mono text-xs uppercase tracking-[0.08em] text-on-brand-muted`; "View →" `font-mono text-xs font-semibold uppercase tracking-[0.1em] text-signal` |
| "Public chargers nearby" | `text-sm font-semibold text-muted` | left span `font-mono text-xs font-medium uppercase tracking-[0.12em]`; right span stays sentence case |
| Charger row meta / distance | `text-sm text-muted` / `text-sm tabular-nums text-muted` | `font-mono text-[0.8125rem] text-muted` for both |
| `ChargerDetail` | network `text-sm font-semibold text-muted`; h2 `font-display text-2xl font-bold leading-tight`; connector rows `rounded-xl bg-sunken`, kW `tabular-nums text-muted` | `font-mono text-xs uppercase tracking-[0.12em] text-muted`; `font-display text-3xl leading-[0.95]`; `rounded-lg bg-sunken`, kW `font-mono text-muted` |
| `BayDetail` | chip `inline-flex rounded-full px-3 py-1 text-sm font-semibold ${tone}`; h2 `font-display text-3xl font-bold leading-tight`; "We'll hold it for you" `text-brand-strong` | `${chipClass} ${tone}`; `font-display text-4xl leading-[0.95]`; `text-ink` with the `BellRing` icon in `text-accent` |
| `map-view.tsx` `themeColors()` | reads `brand` | add `accent: read('--color-accent')`; the selected charger stroke `c.brand` becomes `c.accent`; drop `brand` if it's no longer used |
| Bay marker | pulse `bg-brand/40`; pin `bg-brand` or `bg-faint` with `ring-3 ring-white`; bolt `fill-signal text-signal`; fixed `aria-label="Ecurious bay, reservable"` | pulse `bg-signal/70` (free only); pin ``ring-3 ${bayLook === 'busy' ? 'bg-sunken ring-faint' : 'bg-signal ring-ink'}``; bolt `busy ? 'fill-faint text-faint' : 'fill-ink text-ink'`; shadow `rgb(15_20_25/0.45)`; `aria-label={{ free: 'Ecurious bay, free to reserve', mine: 'Ecurious bay, booked by you', busy: 'Ecurious bay, taken right now' }[bayLook]}` |
| `ReserveDialog` | prices `tabular-nums`; selected row `has-checked:bg-brand-tint has-checked:ring-brand` | prices `font-mono`; selected row unchanged (it becomes lime-soft with an ink ring automatically); "Demo payment: no card is charged." becomes `font-mono text-xs uppercase tracking-[0.08em] text-muted` |

### 7.8 Booking screens (`components/booking/*`)

**Reserved card** (`booking-view.tsx`, `Reserved`): replace the `<section>`:

```tsx
<section className="rounded-3xl bg-brand-deep p-6 text-on-brand sm:p-8">
  <span className={`${chipClass} bg-signal text-ink`}>
    <span className="size-2 rounded-full bg-ink" /> Held for you
  </span>
  <p className="mt-4 font-display text-8xl leading-[0.85] text-signal sm:text-9xl">{formatCountdown(left)}</p>
  <p className="mt-3 font-mono text-sm uppercase tracking-[0.08em] text-on-brand-muted">
    left to arrive · held until {formatTime(r.expiresAt)}
    {r.extendedAt ? ' · extended' : ''}
  </p>
  <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/14 pt-5">
    <CarFront className="size-5 text-on-brand-muted" />
    <span className="font-semibold">{r.vehicleLabel}</span>
    {r.plateHint && <PlateBadge plate={r.plateHint} size="sm" />}
    {r.extraPlateHint && (
      <span className="flex items-center gap-2 text-sm text-on-brand-muted">
        and today <PlateBadge plate={r.extraPlateHint} size="sm" />
      </span>
    )}
  </div>
  <p className="mt-3 text-sm text-on-brand-muted">The guard is up. Drive in and the camera lowers it for your plate.</p>
</section>
```

| Element | Now | Change to |
|---|---|---|
| Page header | kicker "Your booking" `text-sm font-semibold text-muted`; h1 `font-display text-3xl font-bold leading-tight` | `font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted`; `font-display text-4xl leading-[0.95]` |
| `Banner` | `bg-warn-tint text-warn` / `bg-brand-tint text-brand-strong`; icon inherits | ``flex gap-3 rounded-2xl p-4 text-ink ${tone === 'warn' ? 'bg-warn-tint' : 'bg-accent-tint'}``; icon ``${tone === 'warn' ? 'text-warn' : 'text-accent'}``. Ink text reads best in glare, and info is no longer shown as lime "success". |
| Notification link | `text-brand-strong underline` | `text-accent underline` |
| `Blocked` card | `rounded-3xl bg-warn-tint p-6 text-ink`; h2 `font-display text-3xl font-bold`; paused time `font-semibold tabular-nums` | unchanged card; `font-display text-4xl leading-[0.95]`; `font-mono font-semibold`; meta "Since 12:00. Cancelling now is free." |
| Alternatives card | `rounded-3xl bg-surface p-6 ring-1 ring-line`; h3 `font-display text-xl font-bold` | `rounded-2xl …`; `font-display text-2xl` |
| `Arrived` | `rounded-3xl bg-brand-deep p-6 text-white`; h2 `font-display text-4xl font-bold`; body `text-on-brand`; time `text-on-brand-muted` | `… text-on-brand`; `font-display text-4xl leading-[0.9]`; unchanged; `font-mono text-sm uppercase tracking-[0.08em] text-on-brand-muted` |
| `Charging` | white card with a `bg-brand-tint` chip and an ink `font-display text-7xl font-bold` timer | same treatment as Reserved: `rounded-3xl bg-brand-deep text-on-brand`; chip ``${chipClass} bg-signal text-ink`` with `PlugZap`; timer `font-display text-8xl leading-[0.85] text-signal sm:text-9xl`; meta `text-on-brand-muted` |
| `Done` | h2 `font-display text-4xl font-bold`; `dt` `text-sm text-muted`; `dd` `font-semibold tabular-nums`; receipt card `rounded-3xl`, h3 `font-display text-xl font-bold` | `font-display text-4xl leading-[0.9]`; `font-mono text-xs uppercase tracking-[0.1em] text-muted`; `font-mono text-lg font-semibold`; `rounded-2xl`, `font-display text-2xl` |
| No-show text in `Done` | "The bay was released for other drivers. You pay half the fee, {total}; the rest was returned." | "You didn't arrive by {formatTime(r.expiresAt)}, so the bay went to the next driver. You pay {formatEuro(total)}; the rest of the fee was returned." Don't hard-code "half": the amount comes from the charges. |
| `StatusStepper` | done labels `text-brand-strong` | done `text-muted`, current `text-ink` (unchanged), future `text-faint` (unchanged) |
| `Receipt` | amounts `tabular-nums` | `font-mono` |
| Plate input (`OtherCarDialog`) | `font-display text-lg font-semibold tracking-[0.06em]` | `font-mono text-lg font-semibold uppercase tracking-[0.06em]` |
| `components/time.ts` `formatTime` | `{ hour: '2-digit', minute: '2-digit' }` | add `hourCycle: 'h23'` so it reads "14:35" in every browser locale (PRODUCT.md's "Held until 14:35") |

### 7.9 Vehicles and welcome (`components/vehicles/*`)

| Element | Now | Change to |
|---|---|---|
| Vehicles h1 | `font-display text-4xl font-bold` | `font-display text-4xl leading-[0.95]` |
| Car row | `rounded-3xl bg-surface p-5 ring-1 ring-line`; meta `text-sm text-muted` | `rounded-2xl …`; `font-mono text-xs uppercase tracking-[0.08em] text-muted` |
| "Add a car" section | `rounded-3xl …`; h2 `font-display text-2xl font-bold` | `rounded-2xl …`; `font-display text-3xl` |
| Plate input (`vehicle-form.tsx`) | `font-display text-lg font-semibold tracking-[0.06em]` | `font-mono text-lg font-semibold uppercase tracking-[0.06em]` |
| Welcome eyebrow | `font-semibold text-brand-strong` | the one eyebrow on this page: `inline-flex items-center gap-3 font-mono text-[0.8125rem] font-medium uppercase tracking-[0.16em] text-accent before:h-px before:w-6 before:bg-current before:opacity-70` |
| Welcome h1 | `font-display text-5xl font-bold leading-[0.98] tracking-tight` | `font-display text-6xl leading-[0.9] tracking-[0.012em]` |
| Welcome card | `rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8`; "You're all set" `font-display text-2xl font-bold` | `rounded-2xl …`; `font-display text-3xl` |

### 7.10 Bookings (`components/bookings/bookings.tsx`)

| Element | Now | Change to |
|---|---|---|
| h1 | `font-display text-4xl font-bold` | `font-display text-4xl leading-[0.95]` |
| Live card | `rounded-3xl bg-brand-deep p-5 text-white hover:bg-brand-strong`; meta `text-sm text-on-brand`; "Open" `font-semibold text-signal` | `… text-on-brand`; `text-sm text-on-brand-muted`; "Open →" `font-mono text-xs font-semibold uppercase tracking-[0.1em] text-signal` |
| "Past bookings" | `text-sm font-semibold text-muted` | `font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted` |
| Row | `rounded-3xl … open:ring-line-strong/50`; chip `shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${tone}`; price `font-semibold tabular-nums` | `rounded-2xl …`; ``shrink-0 ${chipClass} ${tone}``; `font-mono font-semibold` |

### 7.11 Demo panel (`components/demo-panel.tsx`)

Demo-only UI is violet, so the jury can always tell the backstage controls apart from the driver's product.

| Element | Now | Change to |
|---|---|---|
| Trigger | lime pill | violet pill (§7.6) |
| Intro | "Only on with SIMULATOR=1" | wrap `SIMULATOR=1` in `<code className="font-mono text-ink">` |
| Event buttons | `rounded-xl px-4 py-2 … ring-1 ring-line hover:bg-sunken`; hint `font-display text-sm tracking-wide text-muted` | `rounded-lg … ring-1 ring-line-strong hover:bg-brand-tint hover:ring-ink`; hint `font-mono text-sm text-muted` (mono separates A8 from AB, which is the point of the misread demo) |
| Last result | `rounded-xl bg-brand-tint px-4 py-2.5 font-medium text-brand-strong` | `rounded-xl bg-accent-tint px-4 py-2.5 font-mono text-sm text-ink` |
| Event log | time `tabular-nums text-muted`; type `font-semibold` | time `font-mono text-muted`; type `font-mono text-xs font-semibold uppercase tracking-[0.08em]` |

### 7.12 Operator dashboard (`components/operator/*`, added after this plan was drafted)

§7.1–7.3 cover it, with no extra rules:

- The global display replacements fix its `font-display … font-bold` headings.
- Its week chart's `fill-brand` and `stroke-brand` series turn ink against the `fill-muted` grey, which stays distinct by luminance (16.8:1 against 6.4:1 on paper).
- Its `bg-mint` live dot turns lime on ink.

Include it in the verify screenshots.

### 7.13 Verify

1. Run `python3 -I /private/tmp/claude-501/-Users-mohamedaminehamdi-Desktop-ecurious/0d5f5667-df5c-43eb-94f5-c2f0dd1e0469/scratchpad/brand/palette.py --check` after any change to a value.
2. Run `npm run lint` and remove the imports it flags. Swapping icons for bullets and keys leaves `Check`, `CircleCheck`, `UserCheck` and `EyeOff` unused on the landing page.
3. Grep for these, which should all return nothing:
   - `grep -rnE "font-display[^\"'\`]*font-(bold|semibold)" app components`
   - `grep -rnE "tracking-tight|tracking-\[-0" app components`
   - `grep -rniw "green" components app --include='*.tsx'` (copy only)
4. Take screenshots at 1440×900 and 390×844 of landing, sign-in, explore, the bay detail, the reserve dialog, booking (reserved, blocked, charging, done), vehicles, bookings and the demo panel. Compare against the pre-change set in `…/scratchpad/redesign/`.
5. Tab through the landing CTA band, footer and auth panel. The focus outline must be lime there, and violet everywhere else.
6. Turn on reduced motion in the OS. Nothing floats or pulses, and all content is still visible.
7. Check that no headline overflows at 360px, especially "Another car is in your bay." and long charger names in Bebas.
