# Tools used

_Last updated: 2026-10-24. Versions are from [web/package.json](../web/package.json) and [mobile/pubspec.yaml](../mobile/pubspec.yaml)._

## Web app and API ([web/](../web/))

| Tool | Version | Used for |
|---|---|---|
| Next.js (App Router, Turbopack) | 16.4.3 | Pages, route handlers (the API), `proxy.ts` middleware, metadata (manifest and icons) |
| React | 19.3.0 | UI |
| TypeScript | ^5 | Everything. `lib/*.ts` uses only erasable syntax, so `node --test` runs it directly. |
| `@clerk/nextjs` | ^7.9.20 | Sign-in and sign-up (Google and email), sessions, `UserButton`, and the Backend API for drivers' cars |
| Tailwind CSS (+ `@tailwindcss/postcss`) | ^4.3.3 | Styling through `@theme` tokens in [globals.css](../web/app/globals.css) |
| `maplibre-gl` + `react-map-gl` | ^5.24.0 / ^8.1.3 | Vector map, clustered GoingElectric points, the bay marker |
| `lucide-react` | ^1.61.0 | Icons |
| ESLint + `eslint-config-next` | ^9 / 16.4.3 | Lint |
| Fonts via `next/font` | – | Barlow today. Retheme in progress to Bebas Neue, Space Grotesk and JetBrains Mono (Google Fonts), per [web/DESIGN.md](../web/DESIGN.md). |
| Node.js | 26.8.1 on the dev machine | Runtime. Next 16 needs Node 20.9 or later. |

No other runtime dependencies: email goes through a plain `fetch` to Resend, the timeouts use `AbortSignal.timeout`, and the constant-time compares use `node:crypto`.

## Mobile app ([mobile/](../mobile/))

| Tool | Version | Used for |
|---|---|---|
| Flutter / Dart | 3.47.8 / 3.13.7 | Mobile client, run in Chrome (Flutter web) |
| `flutter_map` + `latlong2` | ^8.3.2 / ^0.10.1 | Map with OpenStreetMap tiles |
| `http` | ^1.6.0 | Calls to the web/ API |
| `url_launcher` | ^6.3.3 | Navigate links |

## Services and data

| Service | Why |
|---|---|
| **GoingElectric** charge point API | Public chargers for the map, list and landing page |
| **Ecurious server** | Bay hardware and camera. Mocked in [lib/ecurious.ts](../web/lib/ecurious.ts) until we get the on-site API docs. The team's key is stored as `ECURIOUS_API_KEY`. |
| **Clerk** | Auth and driver accounts (accountless dev instance until claimed) |
| **Resend** | Blocked-bay alert emails to operators |
| **OpenFreeMap** (OpenMapTiles, OSM data) | Map style and vector tiles, no key |
| **Nominatim** (OpenStreetMap) | Place search, on submit only |
| **Google Maps** links | Turn-by-turn navigation handoff (a link, not an API) |

## Testing and checks

| Tool | What it checks |
|---|---|
| `node --test` (`npm test` in web/) | The reservation engine, booking rules, plate matching, operator stats and the simulated week, alert email. Test files: [web/lib/*.test.ts](../web/lib/) |
| `tsc --noEmit`, `npm run lint`, `npm run build` | Types, lint, production build |
| `flutter analyze`, `flutter test` | The Flutter app and its API response parsing ([mobile/test/api_test.dart](../mobile/test/api_test.dart)) |
| **playwright-cli** | Scripted browser walkthroughs at 390×844 and 1440×900: sign-in via Clerk sign-in tickets, the full booking cycle, blocked bay, operator, screenshots, and console and hydration errors |
| curl | API contract checks: auth, webhook secret, limits, CORS |
| Automated security review (Claude Code hook) | Flagged the fail-open webhook and the missing reservation ownership (fixed, see [decisions D5–D7](decisions.md)) |

## Design inputs

- [web/PRODUCT.md](../web/PRODUCT.md): the product and design brief, written from the team's conversation. The team hasn't confirmed it yet.
- [web/DESIGN.md](../web/DESIGN.md): the Ecurious brand system, extracted from ecurious.com's own CSS with playwright-cli. The Firecrawl CLI wasn't logged in. Every colour pairing was checked for WCAG AA with a script. **Being applied now.**

## AI usage (honest note)

Most of the code and docs were written by **Claude Code** agents under the team's direction: the team set the scope, made the product and pricing decisions, and reviewed the screens. The agents were:
- **Builder:** the app and API.
- **Pricing researcher:** market research with sourced numbers, the rules and their tests ([reservation-model.md](reservation-model.md)).
- **Brand agent:** the Ecurious design system and the retheme.
- **Interop agent:** the partner API and [api.md](api.md).
- **Docs agent:** this folder and the README.

The agents used design and data-visualisation skills (`impeccable`, `dataviz`) and playwright-cli for verification. Every number in the pricing model is cited, or labelled as an estimate.
