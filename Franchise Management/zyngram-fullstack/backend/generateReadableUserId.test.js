const assert = require('node:assert/strict');
const test = require('node:test');
const { createUserCodeAssignments, createUserId } = require('./generateReadableUserId');

test('starts readable user IDs at USR001 when none exist', () => {
  assert.equal(createUserId(['ADM001', 'legacy-uuid']), 'USR001');
});

test('increments the highest numeric user ID regardless of row order', () => {
  assert.equal(createUserId(['USR009', 'USR002', 'ADM001']), 'USR010');
});

test('supports user counts beyond three digits without truncating IDs', () => {
  assert.equal(createUserId(['USR999', 'USR1000']), 'USR1001');
});

test('assigns readable display codes to legacy UUID accounts without changing primary IDs', () => {
  assert.deepEqual(
    createUserCodeAssignments([
      { id: 'ADM001', user_code: null },
      { id: 'legacy-uuid', user_code: null },
    ]),
    [
      { id: 'ADM001', userCode: 'ADM001' },
      { id: 'legacy-uuid', userCode: 'USR001' },
    ],
  );
});

test('continues after the highest existing user code and preserves assigned codes', () => {
  assert.deepEqual(
    createUserCodeAssignments([
      { id: 'USR002', user_code: 'USR002' },
      { id: 'another-uuid', user_code: null },
    ]),
    [{ id: 'another-uuid', userCode: 'USR003' }],
  );
});
