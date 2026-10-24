import test from 'node:test';
import assert from 'node:assert/strict';
import { emailBlockedBay } from './notify.ts';

const bay = { name: 'Test bay', address: 'Somewhere 1' };

test('alert email: skipped without a key, never throws, never contains a plate', async () => {
  const realFetch = globalThis.fetch;
  try {
    delete process.env.RESEND_API_KEY;
    process.env.OPERATOR_EMAILS = 'ops@example.com';
    assert.equal(await emailBlockedBay(0, bay), 'skipped');

    process.env.RESEND_API_KEY = 're_test';
    globalThis.fetch = async () => { throw new Error('network down'); };
    assert.equal(await emailBlockedBay(0, bay), 'failed');

    let sent = '';
    globalThis.fetch = async (_url, init) => {
      sent = String(init?.body);
      return new Response('{}', { status: 200 });
    };
    assert.equal(await emailBlockedBay(0, bay), 'sent');
    assert.ok(JSON.parse(sent).to.includes('ops@example.com'));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
});
