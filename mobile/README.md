# Baywatch for phones (Flutter)

The native app: the same screens, copy and brand as the web app in [web/](../web/), on the same API and the same Clerk accounts. It's a port of the web UI, so a change to a web screen needs the same change here (each Dart file names the web file it ports).

| Screen | Dart | Web |
|---|---|---|
| Landing (signed out) | [screens/landing.dart](lib/screens/landing.dart) | `app/(marketing)/page.tsx` |
| Sign in / sign up | [sign_in.dart](lib/sign_in.dart) | `app/(auth)` with Clerk's `SignIn`/`SignUp` |
| App shell: header, live pill, tabs | [shell.dart](lib/shell.dart) | `components/app/app-nav.tsx` |
| Explore: map, list, bay details, walk-up | [screens/explore.dart](lib/screens/explore.dart) | `components/explore/*` |
| Book a bay | [screens/booking_flow.dart](lib/screens/booking_flow.dart) | `components/booking/booking-flow.tsx`, `slot-picker.tsx` |
| Your booking | [screens/booking.dart](lib/screens/booking.dart) | `components/booking/booking-view.tsx` |
| Bookings | [screens/bookings.dart](lib/screens/bookings.dart) | `components/bookings/bookings.tsx` |
| Your cars, welcome | [screens/vehicles.dart](lib/screens/vehicles.dart) | `components/vehicles/*` |
| Operator dashboard | [screens/operator.dart](lib/screens/operator.dart) | `components/operator/*` |
| Demo controls | [screens/demo_panel.dart](lib/screens/demo_panel.dart) | `components/demo-panel.tsx` |
| Voice booking (mic) | [voice.dart](lib/voice.dart) | `components/voice/mic-button.tsx` |

Shared code: [theme.dart](lib/theme.dart) (the brand tokens from `web/app/globals.css`), [ui.dart](lib/ui.dart) (buttons, chips, plate badge, sheets, notes, the bay sketch, cancel steps, receipt), [api.dart](lib/api.dart) (the types from `web/lib/booking-types.ts` and the HTTP client), [auth.dart](lib/auth.dart) (Clerk), [format.dart](lib/format.dart) (money, times, Berlin dates, geo), [app_state.dart](lib/app_state.dart) (the 2-second `/api/state` poll).

## Run it

Start the web app first (`cd web && npm run dev`). It serves the API and tells this app which Clerk instance and voice assistant to use (`GET /api/config`).

```bash
cd mobile
flutter pub get
flutter run -d chrome                                         # web, against http://localhost:3000
flutter run -d <device> --dart-define=API_URL=http://10.0.2.2:3000      # Android emulator
flutter run -d <device> --dart-define=API_URL=http://192.168.1.20:3000  # a phone: your computer's LAN address
flutter analyze && flutter test   # formats, parsing, and every screen rendered at phone size against a mock API
```

| `--dart-define` | Default | What it does |
|---|---|---|
| `API_URL` | `http://localhost:3000` | The web app that serves the API |
| `CLERK_PUBLISHABLE_KEY` | from `GET /api/config` | Only to override the server's Clerk instance |

## How it signs in

With the same Clerk accounts as the web app, one way per platform behind one interface ([auth.dart](lib/auth.dart)):
- **Phones:** [clerk_auth](https://pub.dev/packages/clerk_auth) (Clerk's community Dart SDK, pinned at `0.0.18-beta`) in native mode ([clerk_native.dart](lib/clerk_native.dart)).
- **Web:** the official clerk-js, the same build the web app loads, through [web/clerk_bridge.js](web/clerk_bridge.js) ([clerk_web.dart](lib/clerk_web.dart)). Clerk refuses the native mode in a browser: a request may not carry both `Origin` and `Authorization`.

Either way, the app sends the short-lived session token as `Authorization: Bearer` on every API call, and the server's `auth()` accepts it like the web's cookie, with no backend change. It supports email + password and a code by email, including Clerk's "new device" code after a password. Google sign-in is only in the Next.js web app for now: a Google account signs in here with a code sent to its address.

Clerk development instances accept test emails: any address with `+clerk_test` (for example `you+clerk_test@example.com`) signs in with the code `424242`, and no email is sent.

## Platforms

- **Web (Chrome):** works as is.
- **Android:** minimum SDK 24 (the voice SDK needs it). Cleartext HTTP is allowed so a dev server on `http://` works.
- **iOS:** location and microphone usage strings are in `Info.plist`, and local-network HTTP is allowed. [ios/Podfile](ios/Podfile) compiles in permission_handler's microphone permission for voice.

Native builds weren't tested on the machine the port was written on (no Android SDK, Xcode not active). If a build fails, see [docs/what-did-not-work.md](../docs/what-did-not-work.md).
