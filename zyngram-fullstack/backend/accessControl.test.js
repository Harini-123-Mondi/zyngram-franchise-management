const assert = require('node:assert/strict');
const test = require('node:test');
const {
  canAccessFranchise,
  canCaptureLocation,
  canReadCommissionOwner,
  hasRole,
  matchesActiveAccount
} = require('./accessControl');

test('checks current active account identity and invalidates changed or inactive accounts', () => {
  const tokenUser = { id: 'admin-1', role: 'HQ_ADMIN' };
  assert.equal(matchesActiveAccount(tokenUser, { ...tokenUser, status: 'ACTIVE' }), true);
  assert.equal(matchesActiveAccount(tokenUser, { ...tokenUser, status: 'INACTIVE' }), false);
  assert.equal(matchesActiveAccount(tokenUser, { id: 'admin-1', role: 'EMPLOYEE', status: 'ACTIVE' }), false);
});

test('denies customer roles on admin-only APIs', () => {
  assert.equal(hasRole({ role: 'CUSTOMER' }, ['HQ_ADMIN']), false);
  assert.equal(hasRole({ role: 'HQ_ADMIN' }, ['HQ_ADMIN']), true);
});

test('allows location writes only for the owner or HQ Admin', () => {
  assert.equal(canCaptureLocation({ id: 'customer-1', role: 'CUSTOMER' }, 'customer-1'), true);
  assert.equal(canCaptureLocation({ id: 'customer-1', role: 'CUSTOMER' }, 'customer-2'), false);
  assert.equal(canCaptureLocation({ id: 'admin-1', role: 'HQ_ADMIN' }, 'customer-2'), true);
});

test('enforces franchise scope for employee and document access', () => {
  const owner = { id: 'owner-1', role: 'FRANCHISE_OWNER', franchiseIds: ['franchise-a', 'franchise-b'] };
  assert.equal(canAccessFranchise(owner, 'franchise-a'), true);
  assert.equal(canAccessFranchise(owner, 'franchise-c'), false);
  assert.equal(canAccessFranchise({ role: 'CUSTOMER' }, 'franchise-a'), false);
});

test('restricts commission owner reads to self unless HQ Admin', () => {
  const owner = { id: 'owner-1', role: 'FRANCHISE_OWNER' };
  assert.equal(canReadCommissionOwner(owner, 'owner-1'), true);
  assert.equal(canReadCommissionOwner(owner, 'owner-2'), false);
  assert.equal(canReadCommissionOwner({ role: 'EMPLOYEE' }, 'owner-1'), false);
  assert.equal(canReadCommissionOwner({ role: 'HQ_ADMIN' }, 'owner-2'), true);
});
