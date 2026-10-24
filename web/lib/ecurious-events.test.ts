import test from 'node:test';
import assert from 'node:assert/strict';
import { connectEvents, sseParser, toEvent, type SseMessage } from './ecurious-events.ts';

test('sseParser: events, comments and multi-line data, wherever the chunks split the lines', () => {
  // the server's real framing (live probe, 2026-10-24) plus the edge cases of the format
  const stream =
    'event: connected\r\ndata: {"status":"connected"}\r\n\r\n' +
    ': keepalive\r\n\r\n' +
    'event: lock:heartbeat\ndata: {"type":"lock:heartbeat","lockId":"lock-0002","battery12V":15}\n\n' +
    'data:line one\ndata: line two\n\n' + // no event name, no space after the colon
    'event: name-only\n\n' + // no data: not dispatched
    'data: cr\r\r' + // bare CR line endings
    'event: last\ndata: x\n\n';
  for (const size of [1, 2, 3, 7, stream.length]) {
    const got: SseMessage[] = [];
    const feed = sseParser((m) => got.push(m));
    for (let i = 0; i < stream.length; i += size) feed(stream.slice(i, i + size));
    assert.deepEqual(
      got,
      [
        { event: 'connected', data: '{"status":"connected"}' },
        { event: 'lock:heartbeat', data: '{"type":"lock:heartbeat","lockId":"lock-0002","battery12V":15}' },
        { event: 'message', data: 'line one\nline two' },
        { event: 'message', data: 'cr' },
        { event: 'last', data: 'x' },
      ],
      `chunks of ${size}`,
    );
  }
});

test('toEvent: the names the server really sends, the documented ones, and raw device codes', () => {
  const ev = (event: string, data: object | string) => toEvent({ event, data: typeof data === 'string' ? data : JSON.stringify(data) });
  const id = 'lock-0002';
  assert.deepEqual(ev('lock:photo_captured', { type: 'lock:photo_captured', lockId: id, licensePlate: 'M-AB 1234' }), { type: 'photo', lockId: id, plate: 'M-AB 1234' });
  assert.deepEqual(ev('photo_captured', { lockId: id, licensePlate: '' }), { type: 'photo', lockId: id, plate: '' }, 'unreadable plate');
  assert.deepEqual(ev('lock:car_presence', { lockId: id, presence: 'occupied' }), { type: 'presence', lockId: id, presence: 'occupied' });
  assert.deepEqual(ev('vehicle_presence', { lockId: id, presence: 'vacant' }), { type: 'presence', lockId: id, presence: 'vacant' });
  assert.deepEqual(ev('message', { type: 'lock:car_presence', lockId: id, carPresence: 1 }), { type: 'presence', lockId: id, presence: 'occupied' });
  assert.deepEqual(ev('lock:status_change', { lockId: id, status: 'lowered' }), { type: 'arm', lockId: id, arm: 'lowered' });
  assert.deepEqual(ev('status_change', { lockId: id, deviceStatus: 1 }), { type: 'arm', lockId: id, arm: 'raised' });
  assert.deepEqual(ev('lock:alarm', { lockId: id, error: 'water_ingress' }), { type: 'alarm', lockId: id, error: 'water_ingress' });
  assert.deepEqual(ev('lock:heartbeat', { type: 'lock:heartbeat', lockId: id, battery12V: 15 }), { type: 'heartbeat', lockId: id });
  assert.equal(ev('connected', { status: 'connected', timestamp: '2026-10-24T10:56:22.468Z' }), null);
  assert.equal(ev('lock:photo_captured', 'not json'), null);
  assert.equal(ev('message', 'null'), null);
  assert.equal(ev('lock:photo_captured', { licensePlate: 'MAB1234' }), null, 'no lockId: whose bay?');
  assert.equal(ev('lock:car_presence', { lockId: id, presence: 'maybe' }), null);
  assert.equal(ev('lock:firmware_update', { lockId: id }), null);
});

// A streamed Response: `chunks`, then it closes, or hangs open until `signal` aborts
function sse(chunks: string[], signal?: AbortSignal) {
  const body = new ReadableStream({
    start(c) {
      for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
      if (signal) signal.addEventListener('abort', () => c.error(signal.reason));
      else c.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

async function until(ok: () => boolean) {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok(), 'timed out');
}

test('connectEvents reconnects after a close, an HTTP error and silence, and stops for good', async () => {
  const got: string[] = [];
  const states: string[] = [];
  let opens = 0;
  const conn = connectEvents({
    open: async (signal) => {
      opens++;
      if (opens === 1) return sse(['event: a\ndata: 1\n\n']); // closes at once
      if (opens === 2) return new Response('down', { status: 503 });
      if (opens === 3) return sse([': keepalive\n\n'], signal); // then goes quiet
      return sse(['event: b\ndata: 2\n\n'], signal);
    },
    onMessage: (m) => got.push(`${m.event}:${m.data}`),
    onState: (up, why) => states.push(up ? 'up' : `down: ${why}`),
    minDelayMs: 1,
    maxDelayMs: 4,
    idleMs: 100,
  });
  await until(() => got.includes('b:2'));
  conn.stop();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, ['a:1', 'b:2']);
  assert.deepEqual(states, ['up', 'down: closed by the server', 'down: HTTP 503', 'up', 'down: no data for 0.1 s', 'up']);
  assert.equal(opens, 4, 'no reconnect after stop()');
});

test('connectEvents: a handler that throws does not drop the stream', async (t) => {
  t.mock.method(console, 'error', () => {});
  const got: string[] = [];
  let opens = 0;
  const conn = connectEvents({
    open: async (signal) => (opens++, sse(['data: bad\n\ndata: good\n\n'], signal)),
    onMessage: (m) => {
      if (m.data === 'bad') throw new Error('boom');
      got.push(m.data);
    },
  });
  await until(() => got.length === 1);
  conn.stop();
  assert.equal(opens, 1);
});
