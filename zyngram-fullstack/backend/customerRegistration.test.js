const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCustomerAttribution, validateCustomerRegistration } = require('./customerRegistration');

const validRegistration = {
  name: 'Sample Customer',
  email: 'customer@example.test',
  mobile: '+919876543210',
  password: 'a-secure-password',
  locationConsent: true,
  latitude: 17.4,
  longitude: 78.3,
  accuracy: 25
};

test('validates customer registration identity and GPS inputs', () => {
  assert.equal(validateCustomerRegistration(validRegistration), null);
  assert.match(validateCustomerRegistration({ ...validRegistration, latitude: 91 }), /GPS latitude/);
  assert.match(validateCustomerRegistration({ ...validRegistration, mobile: '123' }), /mobile number/);
  assert.match(validateCustomerRegistration({ ...validRegistration, password: 'short' }), /Password/);
  assert.match(validateCustomerRegistration({ ...validRegistration, locationConsent: false }), /consent/);
});

test('stores complete physical and digital matches as a mapped attribution snapshot', () => {
  const mapping = {
    physical: {
      status: 'MAPPED', point: { id: 'point' }, center: { id: 'center' }, hub: { id: 'hub' },
      command: { id: 'command' }, hq: { id: 'hq' }, boundaryId: 'physical-boundary', mappingVersion: 4
    },
    digital: {
      status: 'MAPPED', node: { id: 'node' }, zone: { id: 'zone' }, territory: { id: 'territory' },
      region: { id: 'region' }, nation: { id: 'nation' }, boundaryId: 'digital-boundary', mappingVersion: 2
    }
  };

  const snapshot = buildCustomerAttribution(mapping);
  assert.equal(snapshot.status, 'MAPPED');
  assert.equal(snapshot.point_id, 'point');
  assert.equal(snapshot.nation_id, 'nation');
  assert.equal(snapshot.physical_boundary_id, 'physical-boundary');
  assert.equal(snapshot.digital_mapping_version, 2);
});

test('never saves a partial hierarchy as a franchise assignment', () => {
  const snapshot = buildCustomerAttribution({
    physical: { status: 'MAPPED', point: { id: 'point' } },
    digital: { status: 'UNMAPPED', node: null }
  });

  assert.equal(snapshot.status, 'UNMAPPED');
  assert.equal(snapshot.point_id, null);
  assert.equal(snapshot.node_id, null);
  assert.equal(snapshot.physical_boundary_id, null);
  assert.match(snapshot.physical_result, /point/);
  assert.match(snapshot.digital_result, /UNMAPPED/);
});
