const PHYSICAL_FIELDS = ['point', 'center', 'hub', 'command', 'hq'];
const DIGITAL_FIELDS = ['node', 'zone', 'territory', 'region', 'nation'];

function validateCustomerRegistration(input) {
  if (!input || typeof input !== 'object') return 'Registration details are required.';

  const { name, email, mobile, password, latitude, longitude, accuracy } = input;
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) {
    return 'Name must be between 2 and 120 characters.';
  }
  if (typeof email !== 'string' || email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return 'Enter a valid email address.';
  }
  if (typeof mobile !== 'string' || !/^\+?[1-9]\d{7,14}$/.test(mobile.replace(/[\s()-]/g, ''))) {
    return 'Enter a valid mobile number with country code.';
  }
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    return 'Password must be between 10 and 128 characters.';
  }
  if (input.locationConsent !== true) {
    return 'Location consent is required before customer registration.';
  }
  const validCoordinate = (value, minimum, maximum) => (
    value !== undefined && value !== null && String(value).trim() !== '' &&
    Number.isFinite(Number(value)) && Number(value) >= minimum && Number(value) <= maximum
  );
  if (!validCoordinate(latitude, -90, 90) || !validCoordinate(longitude, -180, 180)) {
    return 'Valid GPS latitude and longitude are required.';
  }
  if (accuracy !== undefined && accuracy !== null &&
      (String(accuracy).trim() === '' || !Number.isFinite(Number(accuracy)) ||
       Number(accuracy) < 0 || Number(accuracy) > 100000)) {
    return 'GPS accuracy must be between 0 and 100000 metres.';
  }
  return null;
}

function buildCustomerAttribution(mapping) {
  const physical = mapping?.physical;
  const digital = mapping?.digital;
  if (!physical || !digital) throw new Error('Both hierarchy mapping results are required.');

  const mapped = physical.status === 'MAPPED' && digital.status === 'MAPPED';
  const franchiseFields = [...PHYSICAL_FIELDS, ...DIGITAL_FIELDS];
  const resolvedIds = Object.fromEntries(franchiseFields.map((field) => [
    `${field}_id`,
    mapped ? physical[field]?.id || digital[field]?.id || null : null
  ]));

  if (mapped && Object.values(resolvedIds).some((id) => !id)) {
    throw new Error('A mapped customer attribution must contain both complete franchise hierarchies.');
  }

  return {
    status: mapped ? 'MAPPED' : 'UNMAPPED',
    ...resolvedIds,
    physical_boundary_id: mapped ? physical.boundaryId : null,
    physical_mapping_version: mapped ? physical.mappingVersion : null,
    digital_boundary_id: mapped ? digital.boundaryId : null,
    digital_mapping_version: mapped ? digital.mappingVersion : null,
    physical_result: JSON.stringify(physical),
    digital_result: JSON.stringify(digital)
  };
}

module.exports = { buildCustomerAttribution, validateCustomerRegistration };
