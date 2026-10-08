const assert = require('node:assert/strict');
const test = require('node:test');
const { createOrderId } = require('./orderId');

test('creates a readable India-local date order ID', () => {
  const id = createOrderId(new Date('2026-10-04T20:00:00.000Z'), '12345678-1234-5678-1234-567812345678');

  assert.equal(id, 'ORD-20261005-123456781234');
});

test('different unique IDs create different order IDs on the same date', () => {
  const date = new Date('2026-10-05T10:00:00.000Z');

  assert.notEqual(
    createOrderId(date, '12345678-1234-5678-1234-567812345678'),
    createOrderId(date, 'abcdefab-cdef-abcd-efab-cdefabcdefab'),
  );
});

test('rejects invalid unique IDs rather than making a success-shaped order ID', () => {
  assert.throws(() => createOrderId(new Date('2026-10-05T10:00:00.000Z'), 'not-a-uuid'), /valid unique ID/);
});
