const assert = require('node:assert/strict');
const test = require('node:test');
const { validateRechargeOrder } = require('./mobileRecharge');

const validRecharge = {
  mobileNumber: '9876543210',
  operator: 'JIO',
  circle: 'Andhra Pradesh',
  amount: '299'
};

test('accepts a valid Mobile Recharge request', () => {
  assert.equal(validateRechargeOrder(validRecharge), null);
});

test('rejects invalid recharge numbers, operators, circles, and amounts', () => {
  assert.match(validateRechargeOrder({ ...validRecharge, mobileNumber: '12345' }), /mobile number/);
  assert.match(validateRechargeOrder({ ...validRecharge, operator: 'UNKNOWN' }), /operator/);
  assert.match(validateRechargeOrder({ ...validRecharge, circle: 'Unknown' }), /circle/);
  assert.match(validateRechargeOrder({ ...validRecharge, amount: 0 }), /amount/);
  assert.match(validateRechargeOrder({ ...validRecharge, amount: 10.001 }), /amount/);
});
