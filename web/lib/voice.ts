// Voice booking for the Vapi assistant ("Hey Siri, call Baywatch", or the mic in the app).
// The assistant calls quote_reservation, reads the quote back, and calls confirm_reservation only after the
// caller says yes. A quote books nothing; confirming the same quote twice returns the same booking.
// Pure apart from the injected booking service, so `node --test` runs it as it is. Contract: docs/voice-booking.md.

import { timingSafeEqual } from 'node:crypto';
import { BLOCK_MS, berlinTime, CLASSES, dayBlocks, earliestStart, HORIZON_MS, TZ } from './booking-rules.ts';
import type { BayClass } from './booking-types.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const QUOTE_TTL_MS = 5 * MINUTE; // a call lasts a few minutes; after that the assistant quotes again
const NOW_MS = 10 * MINUTE; // "15:00" said at 15:07 means now, not "that has passed"
const NIGHT_UNTIL_HOUR = 7; // 00:00–06:59 is more often a misheard afternoon than a plan: asked once per call
const ALTERNATIVES = 2;
const SEARCH_BLOCKS = 16; // alternatives up to 4 h either side

export type VoiceBay = { id: string; name: string; address: string; class: BayClass };

// What voice needs from the booking engine (booking v2). Only bays() can be booked by voice: directory
// listings alone never are. book() takes simulated payment and throws `{ status: 409 }` when the slot is gone.
export interface BookingService {
  bays(): VoiceBay[];
  quote(bayId: string, start: number, blocks: number, account: string): { cents: number; valid: boolean; reason?: string; creditAppliedCents?: number };
  book(account: string, slot: { bayId: string; start: number; blocks: number; priceCents: number }): Promise<{ id: string }>;
}

type Call = { id: string; at: number }; // the Vapi call id and the moment relative dates are counted from
type Slot = { bay: VoiceBay; start: number; blocks: number };
type Quote = Slot & { id: string; callId: string; account: string; priceCents: number; creditCents: number; expiresAt: number; booking?: Promise<{ id: string }> };

const pad = (n: number) => String(n).padStart(2, '0');
const end = (s: Slot) => s.start + s.blocks * BLOCK_MS;
const hhmm = (t: number) => {
  const { hour, minute } = berlinTime(t);
  return `${pad(hour)}:${pad(minute)}`;
};

// 2026-10-25T15:00:00+01:00
function isoLocal(t: number) {
  const m = t - (t % MINUTE);
  const { date, hour, minute } = berlinTime(m);
  const [y, mo, d] = date.split('-').map(Number);
  const off = (Date.UTC(y, mo - 1, d, hour, minute) - m) / MINUTE;
  return `${date}T${pad(hour)}:${pad(minute)}:00${off < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

const addDays = (date: string, n: number) => {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
};

// "today", "tomorrow" or YYYY-MM-DD, as a Berlin date counted from the call
function resolveDate(raw: unknown, callAt: number) {
  const s = String(raw ?? '').trim().toLowerCase();
  const today = berlinTime(callAt).date;
  if (s === 'today' || s === 'heute') return today;
  if (s === 'tomorrow' || s === 'morgen') return addDays(today, 1);
  return dayBlocks(s).length ? s : null; // dayBlocks rejects 2026-02-30 and anything that isn't a date
}

// The moment a Berlin wall-clock time happens on that date, or null (not HH:mm, or skipped by the clock change)
function localTime(date: string, raw: unknown) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  const block = dayBlocks(date).find((t) => {
    const b = berlinTime(t);
    return b.hour === h && b.minute === min - (min % 15);
  });
  return block === undefined ? null : { at: block + (min % 15) * MINUTE, h, min };
}

const spokenDuration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h && `${h} hour${h > 1 ? 's' : ''}`, m && `${m} minutes`].filter(Boolean).join(' ');
};
const spokenEuro = (c: number) => (c < 100 ? `${c} cents` : `${Math.floor(c / 100)} euros${c % 100 ? ` ${pad(c % 100)}` : ''}`);
const dayName = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });

function spokenWhen(s: Slot, callAt: number) {
  const date = berlinTime(s.start).date;
  const today = berlinTime(callAt).date;
  const day = date === today ? 'today' : date === addDays(today, 1) ? 'tomorrow' : `on ${dayName.format(s.start)}`;
  return `${day} from ${hhmm(s.start)} to ${hhmm(end(s))}`;
}

// Words that say nothing about which station is meant
const GENERIC = new Set(['the', 'bay', 'bays', 'test', 'charger', 'chargers', 'charging', 'station', 'point', 'at', 'in', 'near', 'by', 'of', 'and', 'str', 'strasse', 'street']);
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !GENERIC.has(w));

// The bays a spoken place most likely means: most words shared with the bay's name and street.
// "Baywatch" matches every Baywatch bay, "Baywatch bay 2" only the second.
// ponytail: word overlap, fine for a few bays the read-back confirms; with many, geocode the place and pick by distance.
function matchBays(place: string, bays: VoiceBay[]) {
  const said = new Set(words(place));
  const scored = bays.map((b) => ({ b, score: new Set(words(`${b.name} ${b.address.split(',')[0]}`).filter((w) => said.has(w))).size }));
  const best = Math.max(0, ...scored.map((x) => x.score));
  return best ? scored.filter((x) => x.score === best).map((x) => x.b) : [];
}

// Fails closed: without a configured secret nobody can book by voice
export function bearerOk(header: string | null, secret: string | undefined) {
  if (!secret) return false;
  const a = Buffer.from(header ?? '');
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createVoice({ service, now = Date.now }: { service: BookingService; now?: () => number }) {
  // ponytail: in memory, like the engine: a restart forgets open quotes, and the assistant quotes again
  const quotes = new Map<string, Quote>();
  const nightAsked = new Map<string, number>(); // `${callId} ${date} ${time}` → when we asked

  const details = (s: Slot, priceCents: number) => ({
    station: { name: s.bay.name, address: s.bay.address },
    start: isoLocal(s.start),
    end: isoLocal(end(s)),
    timezone: TZ,
    durationMinutes: (s.blocks * BLOCK_MS) / MINUTE,
    priceCents,
    currency: 'EUR',
  });

  const free = (s: Slot, account: string) => service.quote(s.bay.id, s.start, s.blocks, account).valid;

  // Up to two free slots of the same length: the same time at another matching bay first, then nearby times
  function alternatives(wanted: Slot, bays: VoiceBay[], account: string) {
    const found: ReturnType<typeof alternative>[] = [];
    for (let k = 0; k <= SEARCH_BLOCKS && found.length < ALTERNATIVES; k++) {
      for (const start of k ? [wanted.start + k * BLOCK_MS, wanted.start - k * BLOCK_MS] : [wanted.start]) {
        for (const bay of bays) {
          const s = { bay, start, blocks: wanted.blocks };
          if (found.length < ALTERNATIVES && (bay !== wanted.bay || k) && start >= earliestStart(now()) && free(s, account)) found.push(alternative(s, account));
        }
      }
    }
    return found;
  }
  // in quote_reservation's own arguments, so the assistant can quote it straight away
  const alternative = (s: Slot, account: string) => ({
    place: s.bay.name,
    date: berlinTime(s.start).date,
    time: hhmm(s.start),
    durationMinutes: (s.blocks * BLOCK_MS) / MINUTE,
    priceCents: service.quote(s.bay.id, s.start, s.blocks, account).cents,
  });

  function quote(args: Record<string, unknown>, call: Call, account: string) {
    const ask = (question: string) => ({ status: 'needs_clarification' as const, question });
    const t = now();
    const all = service.bays();
    const names = all.map((b) => b.name).join(', ');

    const place = String(args.place ?? '').trim();
    if (!place) return ask('Where would you like to charge?');
    const bays = matchBays(place, all);
    if (!bays.length) return ask(`I can only book ${names} for now. Shall I check one of those?`);

    const date = resolveDate(args.date, call.at);
    if (!date) return ask('Which day: today, tomorrow, or a date?');
    const time = localTime(date, args.time);
    if (!time) return ask('What time should the booking start?');

    const minutes = Math.round(Number(args.durationMinutes));
    const maxBlocks = Math.min(...bays.map((b) => CLASSES[b.class].maxBlocks));
    if (!(minutes > 0)) return ask('How long do you want to charge?');
    const blocks = Math.ceil(minutes / 15); // bookings are whole quarter hours: 50 minutes book 1 hour
    if (blocks > maxBlocks) return ask(`Bookings there last at most ${spokenDuration(maxBlocks * 15)}. How long should I book?`);

    // a time from the last few minutes means "now": the block under way, or the next one
    let start = time.at;
    const isNow = start <= t + MINUTE && start >= t - NOW_MS;
    if (isNow) start = earliestStart(t);
    else if (time.min % 15) {
      const before = start - (time.min % 15) * MINUTE;
      return ask(`Bookings start on the quarter hour. ${hhmm(before)} or ${hhmm(before + BLOCK_MS)}?`);
    }
    if (start < earliestStart(t)) {
      return ask(date === berlinTime(call.at).date ? `${hhmm(start)} has already passed today. Do you mean tomorrow at ${hhmm(start)}?` : 'That day is in the past. Which day do you mean?');
    }
    if (start - t > HORIZON_MS) return ask(`I can book up to ${HORIZON_MS / DAY} days ahead. Which day do you mean?`);
    const nightKey = `${call.id} ${date} ${hhmm(start)}`;
    if (!isNow && time.h < NIGHT_UNTIL_HOUR && !nightAsked.has(nightKey)) {
      nightAsked.set(nightKey, t);
      return ask(`Just to check: ${hhmm(start)} at night, not ${pad(time.h + 12)}:${pad(time.min)}?`);
    }

    // the first matching bay that's free then, or alternatives
    const wanted: Slot = { bay: bays[0], start, blocks };
    const bay = bays.find((b) => free({ ...wanted, bay: b }, account));
    if (!bay) {
      const why = service.quote(wanted.bay.id, start, blocks, account).reason;
      return { status: 'unavailable' as const, message: why ?? `${bays.length > 1 ? 'Those bays are' : `${wanted.bay.name} is`} already booked then.`, alternatives: alternatives(wanted, bays, account) };
    }

    for (const [k, v] of quotes) if (t - v.expiresAt > DAY) quotes.delete(k); // confirmed ones stay a day, for repeats
    for (const [k, at] of nightAsked) if (t - at > DAY) nightAsked.delete(k);

    const s: Slot = { ...wanted, bay };
    const { cents, creditAppliedCents = 0 } = service.quote(bay.id, start, blocks, account);
    const q: Quote = { ...s, id: crypto.randomUUID(), callId: call.id, account, priceCents: cents, creditCents: creditAppliedCents, expiresAt: t + QUOTE_TTL_MS };
    quotes.set(q.id, q);
    const rounded = blocks * 15 !== minutes ? ', rounded up to whole quarter hours' : '';
    const credit = creditAppliedCents ? `, and your credit covers ${spokenEuro(Math.min(creditAppliedCents, cents))} of it` : '';
    return {
      status: 'available' as const,
      quoteId: q.id,
      ...details(s, cents),
      expiresAt: isoLocal(q.expiresAt),
      confirmationText: `${bay.name}, ${bay.address}: ${spokenWhen(s, call.at)}, ${spokenDuration(blocks * 15)}${rounded}. The reservation fee is ${spokenEuro(cents)}${credit}. Shall I book it?`,
    };
  }

  async function confirm(args: Record<string, unknown>, call: Call, account: string) {
    const q = quotes.get(String(args.quoteId ?? ''));
    if (!q) return { status: 'error' as const, message: 'I can’t find that quote. Let me check the time again.' };
    if (q.callId !== call.id || q.account !== account) return { status: 'error' as const, message: 'That quote belongs to another call. Let me check the time again.' };
    if (!q.booking) {
      if (now() > q.expiresAt) return { status: 'expired' as const, message: 'That quote has expired. Shall I check the time again?' };
      const current = service.quote(q.bay.id, q.start, q.blocks, account);
      if (!current.valid) return { status: 'unavailable' as const, message: current.reason ?? 'That slot has just been taken.', alternatives: alternatives(q, service.bays(), account) };
      if (current.cents !== q.priceCents) return { status: 'expired' as const, message: `The price is now ${spokenEuro(current.cents)}. Shall I quote it again?` };
      // kept on the quote, so a repeated or parallel confirm waits for this one instead of booking twice
      q.booking = service.book(account, { bayId: q.bay.id, start: q.start, blocks: q.blocks, priceCents: q.priceCents });
      q.booking.catch(() => (q.booking = undefined)); // a failed booking can be confirmed again
    }
    try {
      const { id } = await q.booking;
      return { status: 'confirmed' as const, bookingId: id, ...details(q, q.priceCents), confirmationText: `Booked: ${q.bay.name}, ${spokenWhen(q, call.at)}. It’s in your Baywatch app under Bookings.` };
    } catch (e) {
      const { status, message } = e as { status?: number; message?: string };
      if (status === 409) return { status: 'unavailable' as const, message: message ?? 'That slot has just been taken.', alternatives: alternatives(q, service.bays(), account) };
      return { status: 'error' as const, message: 'The booking didn’t go through. Please try again in the app.' };
    }
  }

  const TOOLS = { quote_reservation: quote, confirm_reservation: confirm };
  type ToolCall = { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
  const toMs = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN);
  const parseArgs = (a: unknown): Record<string, unknown> => {
    if (typeof a === 'string') {
      try {
        return JSON.parse(a);
      } catch {
        return {};
      }
    }
    return a && typeof a === 'object' ? (a as Record<string, unknown>) : {};
  };

  // Vapi's server message. Only 'tool-calls' needs an answer: one result per toolCallId, as a flat string
  // (an `error` makes the assistant say the call failed). The account comes from the server, never the call.
  async function handle(payload: unknown, account: string) {
    const m = (payload as { message?: Record<string, unknown> } | null)?.message;
    if (m?.type !== 'tool-calls') return {};
    const callInfo = (m.call ?? {}) as { id?: unknown; createdAt?: unknown };
    const at = [toMs(m.timestamp), toMs(callInfo.createdAt)].find(Number.isFinite) ?? now();
    const call: Call = { id: String(callInfo.id ?? ''), at };
    const list = (m.toolCallList ?? (m.toolWithToolCallList as { toolCall?: ToolCall }[] | undefined)?.map((t) => t.toolCall) ?? []) as ToolCall[];
    const results = [];
    for (const tc of list) {
      const toolCallId = String(tc?.id ?? '');
      const name = String(tc?.function?.name ?? '');
      if (!call.id) results.push({ toolCallId, error: 'Missing call id' });
      else if (!Object.hasOwn(TOOLS, name)) results.push({ toolCallId, error: `Unknown tool: ${name}` });
      else {
        try {
          const out = await TOOLS[name as keyof typeof TOOLS](parseArgs(tc.function?.arguments), call, account);
          results.push({ toolCallId, result: JSON.stringify(out) });
        } catch (e) {
          console.error('voice tool failed:', e);
          results.push({ toolCallId, error: 'The booking system had a problem. Please try again.' });
        }
      }
    }
    return { results };
  }

  return { handle, quote, confirm };
}
