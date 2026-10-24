# Voice booking (Vapi)

A driver says "Hey Siri, call Baywatch", or taps the mic in the app. Then they say where, when and for how long. The assistant checks the slot, reads back the exact booking and fee, and books only after the driver says yes. The booking shows up in the app under **Bookings**.

Scope: booking only, for any signed-in driver, with their first registered car, on the Baywatch bays. Payment is simulated, so all of it runs only with `VOICE_DEMO=1`. Cancelling, route planning and real charges are out of scope.

Bookings go through the booking engine (`reserve()` in [web/lib/booking.ts](../web/lib/booking.ts), with the demo payment), exactly like a booking made in the app. A booking for **now** on a bay with a real lock raises its arm, as any booking does. The team accepted this.

Code:

- [web/lib/voice.ts](../web/lib/voice.ts): the logic, with tests in `voice.test.ts`.
- [web/app/api/voice/vapi/route.ts](../web/app/api/voice/vapi/route.ts): the webhook that Vapi calls.
- [web/app/api/voice/session/route.ts](../web/app/api/voice/session/route.ts): mints the session token for the app's mic.
- [web/components/voice/mic-button.tsx](../web/components/voice/mic-button.tsx): the mic in the app header. It fetches the token and starts the Vapi call with it.

## Who a call books for

1. **The app's mic.** Before the call starts, the signed-in app calls `POST /api/voice/session` (Clerk session).
   - It gets back `{ token, expiresAt }`: an HMAC-SHA256 token naming the driver, valid for 15 minutes.
   - The token's key is derived from `VOICE_SESSION_SECRET`, which stays on our server. It's deliberately not `VAPI_BEARER_SECRET`: Vapi and the teammate who configures it hold that one, and they must not be able to mint tokens for other drivers.
   - The app starts the call with `vapi.start(assistantId, { metadata: { voiceToken: token } })`.
   - The token reaches the webhook as `message.call.assistantOverrides.metadata.voiceToken`. Vapi never puts `metadata` into the prompt, so the model can't see or change it. `variableValues`, by contrast, are filled into prompts.
   - The webhook checks the token in constant time on every tool call and books for that driver.
2. **A phone call** carries no token. It books for `VOICE_DEMO_USER_ID` if that is set. Otherwise the assistant says that voice booking works from the mic in the Baywatch app.
3. **A forged, altered or expired token** gets "start the call again from the mic in the app". It never falls back to the demo account.

Tool arguments and the caller's number never decide the account. Quotes are bound to the call id and that account. A driver with no car is told to add a car in the app first.

## Endpoint

`POST /api/voice/vapi`, with **`Authorization: Bearer <VAPI_BEARER_SECRET>`**.

- The secret check fails closed. If no secret is set, every request gets a 401.
- With `VOICE_DEMO` unset, every tool call answers "Voice booking is switched off", and `/api/voice/session` returns a 503.
- The endpoint takes Vapi's `tool-calls` server message. It answers synchronously with one entry per `toolCallId`, in the form `{ "results": [{ "toolCallId", "result" }] }`. Each `result` is a JSON string, because Vapi wants a flat string.
- Account problems come back as a `result` with `{ "status": "error", "message" }`, so the assistant reads the message out. Tool failures come back as `error` with HTTP 200, as Vapi expects.
- The endpoint ignores other message types with `{}`.

## Rules the backend enforces

| Rule | Behaviour |
|---|---|
| Bookable places | Only the Baywatch bays. GoingElectric listings are never offered. "Baywatch" matches any Baywatch bay, and "Baywatch Bay 2" matches only that one. |
| Dates | `today`, `tomorrow` or `YYYY-MM-DD`, counted from the call's timestamp in Europe/Berlin. The furthest date is 60 days ahead. |
| Times | `HH:mm`, 24-hour. Starts fall on the quarter hour, so 15:10 gets the question "15:00 or 15:15?". A time from the last few minutes means **now**: the block under way, or the next one. |
| Night | A start between 00:00 and 06:59 is asked about once per call ("03:00 at night, not 15:00?"). If the assistant sends the same time again, it's accepted. |
| Duration | Rounded up to whole quarter hours, up to the bay's maximum (2 h on fast bays). The read-back says when it rounded up. |
| Quotes | A quote books nothing and is valid for 5 minutes. It's bound to the call and the account. |
| Confirm | Checks the quote again: the call, the account, the expiry, whether the slot is still free and whether the price has changed. A repeated or parallel confirm returns the same booking. If the engine refuses with a 409, voice quotes again. If the slot is still free at a new price, it answers `expired` with the new `priceCents`. Otherwise it answers `unavailable` with alternatives. |

## Tools for the Vapi assistant

Create both as **Function** tools.

- Point them at the endpoint through a **Bearer Token** credential: Dashboard → Integrations → Server Configuration → Add Custom Credential. Use header `Authorization`, with the Bearer prefix on, and the token set to the same value as `VAPI_BEARER_SECRET`.
- Keep them synchronous (`async: false`), so the assistant waits for the result before it says anything.
- Optionally, add a "Request Start" message in the dashboard, such as "One moment, I'm checking the bay."

```json
{
  "type": "function",
  "async": false,
  "function": {
    "name": "quote_reservation",
    "description": "Check a Baywatch charging bay for a slot and get the exact booking details and fee. This books nothing. If status is available, read confirmationText to the caller and only call confirm_reservation after they clearly say yes. If needs_clarification, ask the question. If unavailable, offer the alternatives (each one can be passed straight back to this tool).",
    "parameters": {
      "type": "object",
      "properties": {
        "place": { "type": "string", "description": "Station name or destination as the caller said it, e.g. \"Baywatch\" or \"Baywatch Bay 2\"." },
        "date": { "type": "string", "description": "\"today\", \"tomorrow\" or a date as YYYY-MM-DD." },
        "time": { "type": "string", "description": "Start time in 24-hour HH:mm, Berlin time, e.g. \"15:00\". If the caller says now, the current time." },
        "durationMinutes": { "type": "integer", "description": "How long the caller wants to charge, in minutes." }
      },
      "required": ["place", "date", "time", "durationMinutes"]
    }
  },
  "server": { "url": "https://<your-tunnel-host>/api/voice/vapi", "credentialId": "<bearer-credential-id>" }
}
```

```json
{
  "type": "function",
  "async": false,
  "function": {
    "name": "confirm_reservation",
    "description": "Book a slot from quote_reservation. Only call this after the caller has heard the confirmationText and said yes. Only say the booking is done when status is confirmed.",
    "parameters": {
      "type": "object",
      "properties": {
        "quoteId": { "type": "string", "description": "The quoteId returned by quote_reservation." }
      },
      "required": ["quoteId"]
    }
  },
  "server": { "url": "https://<your-tunnel-host>/api/voice/vapi", "credentialId": "<bearer-credential-id>" }
}
```

## Responses

Each `result` string parses to one of the objects below. These examples were produced by the code, with a call at 14:00 on Saturday 24 October 2026.

`quote_reservation` with `{ "place": "Baywatch", "date": "tomorrow", "time": "15:00", "durationMinutes": 45 }`:

```json
{
  "status": "available",
  "quoteId": "edf354df-2586-465e-bb58-71e089744f81",
  "station": { "name": "Baywatch Bay 1", "address": "Hackathon venue, Berlin" },
  "start": "2026-10-25T15:00:00+01:00",
  "end": "2026-10-25T15:45:00+01:00",
  "timezone": "Europe/Berlin",
  "durationMinutes": 45,
  "priceCents": 250,
  "currency": "EUR",
  "expiresAt": "2026-10-24T14:05:00+02:00",
  "confirmationText": "Baywatch Bay 1, Hackathon venue, Berlin: tomorrow from 15:00 to 15:45, 45 minutes. The reservation fee is 2 euros 50. Shall I book it?"
}
```

`confirm_reservation` with `{ "quoteId": "edf354df-…" }`:

```json
{
  "status": "confirmed",
  "bookingId": "3f0c9b2e-booking",
  "station": { "name": "Baywatch Bay 1", "address": "Hackathon venue, Berlin" },
  "start": "2026-10-25T15:00:00+01:00",
  "end": "2026-10-25T15:45:00+01:00",
  "timezone": "Europe/Berlin",
  "durationMinutes": 45,
  "priceCents": 250,
  "currency": "EUR",
  "confirmationText": "Booked: Baywatch Bay 1, tomorrow from 15:00 to 15:45. It’s in your Baywatch app under Bookings."
}
```

The other answers:

```json
{ "status": "needs_clarification", "question": "Bookings start on the quarter hour. 15:00 or 15:15?" }
```

```json
{
  "status": "unavailable",
  "message": "Those bays are already booked then.",
  "alternatives": [
    { "place": "Baywatch Bay 1", "date": "2026-10-25", "time": "17:15", "durationMinutes": 60, "priceCents": 250 },
    { "place": "Baywatch Bay 2", "date": "2026-10-25", "time": "17:15", "durationMinutes": 60, "priceCents": 250 }
  ]
}
```

- `confirm_reservation` can also return `{ "status": "expired", "message" }` when the quote is more than 5 minutes old, or `{ "status": "expired", "priceCents", "message" }` when the price has moved. It can also return `unavailable` (with alternatives), or `{ "status": "error", "message" }`.
- An `error` is returned for an unknown quote, a quote from another call, or a failed booking.

## Setup

| Variable | Where | What |
|---|---|---|
| `VAPI_BEARER_SECRET` | `web/.env` | A long random token that Vapi's Bearer credential also holds. Without it, every webhook request is rejected. Share it privately, never in chat or git. |
| `VOICE_SESSION_SECRET` | `web/.env` | A second long random token that keys the app's voice session tokens. It never leaves our server, so don't give it to Vapi or teammates. Without it, no session can be minted and every app call is refused. |
| `VOICE_DEMO` | `web/.env` | `1` turns voice booking on, with simulated payment. It's off by default. The booking engine's `'demo'` payment checks the same flag. |
| `VOICE_DEMO_USER_ID` | `web/.env` | Optional. A Clerk user id (`user_…`) that phone calls book for, since they carry no session token. Without it, phone callers are sent to the app's mic. |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `NEXT_PUBLIC_VAPI_ASSISTANT_ID` | `web/.env` | The Vapi public key and the assistant's id, from the Vapi dashboard. The mic button shows only when both are set. The public key is meant for browsers, so it's safe to expose. |

**HTTPS:** the demo runs as a single `next start` on one laptop, so Vapi reaches it through a tunnel:

```bash
cd web && npm run build && npm start          # one long-running process (state is in memory)
cloudflared tunnel --url http://localhost:3000 # prints https://<random>.trycloudflare.com
```

Put `https://<random>.trycloudflare.com/api/voice/vapi` into both tools' `server.url`. A quick tunnel gets a new host on every restart, so a named tunnel keeps the URL stable for the pitch.

To check from the command line, run this with `$VAPI_BEARER_SECRET` exported in your shell. A wrong or missing token gets a 401.

```bash
curl -s -X POST "$URL/api/voice/vapi" -H "authorization: Bearer $VAPI_BEARER_SECRET" -H 'content-type: application/json' \
  -d '{"message":{"type":"tool-calls","call":{"id":"test-1"},"toolCallList":[{"id":"t1","type":"function","function":{"name":"quote_reservation","arguments":{"place":"Baywatch","date":"tomorrow","time":"15:00","durationMinutes":45}}}]}}'
```

## Limitations

- **Quotes live in memory, like the engine.** A restart forgets open quotes, and the assistant simply quotes again.
- **Places are matched by word overlap** with the bays' names and streets. That's fine for three bays, because the read-back names the exact bay. With many bays, a place would need a geocoder.
- **Tested in code, not in a live call:** `voice.test.ts` runs the whole flow against the real engine (schedule and booking API) with fake hardware, wallets and cars. Over HTTP, unauthenticated requests are rejected. A live call with a signed-in driver needs the env below set on the server.
- **The mic shows only when configured:** it appears once `NEXT_PUBLIC_VAPI_PUBLIC_KEY` and `NEXT_PUBLIC_VAPI_ASSISTANT_ID` are set. It shows errors, such as "Voice booking is switched off", under the button.
- **Where the token arrives:** that `metadata` comes back under `message.call.assistantOverrides` is inferred from the API reference, not yet seen in a real call. Check it in Vapi's webhook logs on the first call from the app. The webhook also reads `message.assistant.metadata`.
- **Token lifetime:** a session token lasts 15 minutes from when it was minted, so a longer call has to be restarted from the app.

## Vapi references

- Tool calls, the request and response format, and the "flat string" rule: <https://docs.vapi.ai/tools/custom-tools>
- Bearer Token credentials: <https://docs.vapi.ai/server-url/server-authentication>
- The function tool object (`async`, `server`): <https://docs.vapi.ai/api-reference/tools/create>
- Web SDK for the in-app mic: <https://docs.vapi.ai/sdk/web>. `vapi.start(assistantId, assistantOverrides)` is from <https://github.com/VapiAI/client-sdk-web>.
- `assistantOverrides.metadata` ("metadata you want to store on the assistant") and `variableValues` (filled into prompts), and `assistantOverrides` on the Call object: <https://docs.vapi.ai/api-reference/calls/create>
- Template variables are filled into prompts: <https://docs.vapi.ai/assistants/dynamic-variables>
