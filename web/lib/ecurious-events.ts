// Live events from the Ecurious server (Server-Sent Events): a small stream parser, the events as the
// server really names them, and a connection that reconnects with backoff. No dependencies.

export type SseMessage = { event: string; data: string };

export type HwEvent =
  | { type: 'photo'; lockId: string; plate: string } // the camera read a plate ('' = saw a car, couldn't read it)
  | { type: 'presence'; lockId: string; presence: 'occupied' | 'vacant' } // the car sensor
  | { type: 'arm'; lockId: string; arm: 'raised' | 'lowered' }
  | { type: 'alarm'; lockId: string; error: string } // tamper, water ingress, motor stall…
  | { type: 'heartbeat'; lockId: string }; // about every 3 min per online bay

// Feed it the decoded stream in order; it calls onMessage once per complete event. Lines may span chunks.
export function sseParser(onMessage: (m: SseMessage) => void) {
  let buf = '';
  let event = '';
  let data: string[] = [];
  return (chunk: string) => {
    buf += chunk;
    const lines = buf.split(/\r\n|\r(?!$)|\n/); // a trailing \r may be the first half of \r\n
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') {
        if (data.length) onMessage({ event: event || 'message', data: data.join('\n') });
        event = '';
        data = [];
      } else if (!line.startsWith(':')) {
        // ":" starts a comment, like the server's ": keepalive" every 20 s
        const i = line.indexOf(':');
        const field = i < 0 ? line : line.slice(0, i);
        const value = i < 0 ? '' : line.slice(line[i + 1] === ' ' ? i + 2 : i + 1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
    }
  };
}

// The server sends "lock:car_presence", "lock:photo_captured"…; its docs say "vehicle_presence", "photo_captured"…
const TYPES: Record<string, HwEvent['type']> = {
  photo_captured: 'photo',
  car_presence: 'presence',
  vehicle_presence: 'presence',
  status_change: 'arm',
  alarm: 'alarm',
  heartbeat: 'heartbeat',
};
// names, or the device's raw codes (deviceStatus 1 raised / 2 lowered, carPresence 1 occupied / 2 vacant)
const PRESENCE: Record<string, 'occupied' | 'vacant'> = { occupied: 'occupied', vacant: 'vacant', 1: 'occupied', 2: 'vacant' };
const ARM: Record<string, 'raised' | 'lowered'> = { raised: 'raised', lowered: 'lowered', 1: 'raised', 2: 'lowered' };

// One message as a device event, or null (the "connected" greeting, unknown names, bad payloads)
export function toEvent({ event, data }: SseMessage): HwEvent | null {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(data);
  } catch {
    return null;
  }
  if (!d || typeof d !== 'object') return null;
  const type = TYPES[String(event === 'message' ? d.type : event).replace(/^lock:/, '')];
  const lockId = typeof d.lockId === 'string' ? d.lockId : '';
  if (!type || !lockId) return null;
  if (type === 'photo') return { type, lockId, plate: String(d.licensePlate ?? d.plate ?? '') };
  if (type === 'presence') {
    const presence = PRESENCE[String(d.presence ?? d.carPresence)];
    return presence ? { type, lockId, presence } : null;
  }
  if (type === 'arm') {
    const arm = ARM[String(d.status ?? d.deviceStatus)];
    return arm ? { type, lockId, arm } : null;
  }
  if (type === 'alarm') return { type, lockId, error: String(d.error ?? 'unknown') };
  return { type, lockId };
}

// Keeps one stream open. Reconnects after an error, a close by the server or `idleMs` of silence (a dead
// connection can hang without an error), backing off from minDelayMs to maxDelayMs. stop() ends it for good.
export function connectEvents({
  open,
  onMessage,
  onState = () => {},
  minDelayMs = 1_000,
  maxDelayMs = 30_000,
  idleMs = 60_000,
}: {
  open: (signal: AbortSignal) => Promise<Response>;
  onMessage: (m: SseMessage) => void;
  onState?: (up: boolean, why?: string) => void;
  minDelayMs?: number;
  maxDelayMs?: number;
  idleMs?: number;
}) {
  let stopped = false;
  let ac = new AbortController();
  let wake = () => {};
  const deliver = (m: SseMessage) => {
    try {
      onMessage(m);
    } catch (e) {
      console.error('[ecurious] event handler failed:', (e as Error).message); // a bad event must not drop the stream
    }
  };

  void (async () => {
    let delay = minDelayMs;
    while (!stopped) {
      ac = new AbortController();
      const since = Date.now();
      let idle: ReturnType<typeof setTimeout> | undefined;
      const alive = () => {
        clearTimeout(idle);
        idle = setTimeout(() => ac.abort(new Error(`no data for ${idleMs / 1000} s`)), idleMs);
      };
      try {
        alive();
        const res = await open(ac.signal);
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        onState(true);
        const feed = sseParser(deliver);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          alive();
          feed(decoder.decode(value, { stream: true }));
        }
        throw new Error('closed by the server');
      } catch (e) {
        if (stopped) return;
        const why = ac.signal.aborted ? ac.signal.reason : e;
        onState(false, why instanceof Error ? why.message : String(why));
      } finally {
        clearTimeout(idle);
      }
      if (Date.now() - since > 60_000) delay = minDelayMs; // it held for a while: start the backoff over
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay);
        wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
      delay = Math.min(delay * 2, maxDelayMs);
    }
  })();

  return {
    stop() {
      stopped = true;
      ac.abort();
      wake();
    },
  };
}
