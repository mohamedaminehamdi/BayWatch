import test from 'node:test';
import assert from 'node:assert/strict';
import { split, stripeFeeCents } from './revenue.ts';

const fee = (cents: number) => [{ kind: 'reservation', cents }];

test('stripe fee: 1.5% + €0.25 on what was charged, nothing on nothing', () => {
  assert.equal(stripeFeeCents(500), 33); // 7.5 rounds up
  assert.equal(stripeFeeCents(50), 26);
  assert.equal(stripeFeeCents(0), 0);
});

test('a paid booking: Stripe first, then 70/30 between CPO and BayWatch', () => {
  assert.deepEqual(split(fee(500)), { paidCents: 500, stripeCents: 33, cpoCents: 327, platformCents: 140, creditCents: 0 });
  assert.deepEqual(split(fee(300)), { paidCents: 300, stripeCents: 30, cpoCents: 189, platformCents: 81, creditCents: 0 });
  assert.deepEqual(split(fee(600)), { paidCents: 600, stripeCents: 34, cpoCents: 396, platformCents: 170, creditCents: 0 });
});

test('overstay is split 50:50', () => {
  const r = split([...fee(500), { kind: 'overstay', cents: 300 }]);
  assert.deepEqual(r, { paidCents: 800, stripeCents: 37, cpoCents: 477, platformCents: 286, creditCents: 0 });
});

test('the real fee from Stripe replaces the estimate', () => {
  assert.equal(split(fee(500), { feeCents: 40 }).cpoCents, 322);
});

test('a booking paid with credit: the CPO still gets its share, BayWatch pays it', () => {
  const r = split([...fee(500), { kind: 'credit', cents: -500 }]);
  assert.deepEqual(r, { paidCents: 0, stripeCents: 0, cpoCents: 350, platformCents: -350, creditCents: 500 });
});

test('a cancellation fee under the card minimum, waived: nobody gets anything', () => {
  const r = split([...fee(300), { kind: 'released', cents: -270 }], { paidCents: 0 });
  assert.deepEqual(r, { paidCents: 0, stripeCents: 0, cpoCents: 0, platformCents: 0, creditCents: 0 });
});

test('charge then refund in full: Stripe keeps its fee, BayWatch carries it', () => {
  const r = split([...fee(500), { kind: 'refund', cents: -500 }], { paidCents: 0, feeCents: 33 });
  assert.deepEqual(r, { paidCents: 0, stripeCents: 33, cpoCents: 0, platformCents: -33, creditCents: 0 });
});
