// Hardware console for supervised tests at the bay: one command per run, never in a loop.
//   cd web && node --env-file=.env lib/ecurious-cli.ts <command>
// Reads, safe any time:  bays | status | plate | watch [seconds, default 120]
// Writes move the real arm or its camera. They need ECURIOUS_LIVE=1 and an explicit ECURIOUS_LOCK_ID, someone
// at the bay and the bay clear:
//   raise | lower [--auto-lift] | whitelist [PLATE ...] (no plates = off; there is no "any car") |
//   keep normal|keep_open|keep_closed
// The key only travels in a header. Plates are printed masked.
import { call, live, lockId, openEvents } from './ecurious.ts';
import { connectEvents } from './ecurious-events.ts';
import { maskPlate, normalizePlate } from './plates.ts';

const [cmd = '', ...args] = process.argv.slice(2);

const mask = (k: string, v: unknown): unknown =>
  k === 'plateType'
    ? v
    : /plate|whitelist/i.test(k) && Array.isArray(v)
      ? v.map((p) => (p === '*' ? p : maskPlate(String(p))))
      : /plate/i.test(k) && typeof v === 'string'
        ? maskPlate(v)
        : v;
const show = (x: unknown) => console.log(JSON.stringify(x, mask, 2));
const at = () => new Date().toISOString().slice(11, 23);

const writes: Record<string, () => [string, object]> = {
  raise: () => ['lock', { cancelAutoLift: true }],
  lower: () => ['unlock', { cancelAutoLift: !args.includes('--auto-lift') }],
  whitelist: () => ['whitelist', { plates: args.map(normalizePlate).filter(Boolean) }],
  keep: () => {
    if (!['normal', 'keep_open', 'keep_closed'].includes(args[0])) throw new Error('keep needs normal, keep_open or keep_closed');
    return ['keep-state', { state: args[0] }];
  },
};

try {
  if (Object.hasOwn(writes, cmd)) {
    if (!live() || !process.env.ECURIOUS_LOCK_ID) {
      throw new Error('Writes move the real arm: set ECURIOUS_LIVE=1 and ECURIOUS_LOCK_ID, with someone at the bay and the bay clear');
    }
    const [action, body] = writes[cmd]();
    const id = await lockId();
    console.log(`${at()} → POST /locks/${id}/${action} ${JSON.stringify(body, mask)}`);
    show(await call('POST', `/locks/${encodeURIComponent(id)}/${action}`, body));
  } else if (cmd === 'bays') {
    show((await call<{ locks?: unknown[] }>('GET', '/locks')).locks);
  } else if (cmd === 'status' || cmd === 'plate') {
    show(await call('GET', `/locks/${encodeURIComponent(await lockId())}${cmd === 'plate' ? '/plate/latest' : ''}`));
  } else if (cmd === 'watch') {
    // every event for all the team's bays, as sent: to see the real names and payloads
    const conn = connectEvents({
      open: openEvents,
      onMessage: ({ event, data }) => {
        let d: unknown = data;
        try {
          d = JSON.parse(data);
        } catch {
          // not JSON: printed as text
        }
        console.log(at(), event, JSON.stringify(d, mask));
      },
      onState: (up, why) => console.log(at(), up ? 'stream connected' : `stream down: ${why}`),
    });
    setTimeout(conn.stop, Number(args[0] ?? 120) * 1000);
  } else {
    console.log('Usage: node --env-file=.env lib/ecurious-cli.ts bays|status|plate|watch [s]|raise|lower [--auto-lift]|whitelist [PLATE…]|keep <state>');
  }
} catch (e) {
  console.error((e as Error).message); // never holds the key (see hwError in ecurious.ts)
  process.exitCode = 1;
}
