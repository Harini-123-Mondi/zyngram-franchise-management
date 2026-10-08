const assert = require('node:assert/strict');
const test = require('node:test');
const { parsePolygon, pointInPolygon, resolveFranchiseMapping } = require('./geoMapping');

const polygon = {
  type: 'Polygon',
  coordinates: [[[78.43, 17.38], [78.49, 17.38], [78.49, 17.42], [78.43, 17.42], [78.43, 17.38]]],
};
const franchises = [
  { id: 'HQ01', level: 'HQ', name: 'HQ', parent_id: null, status: 'ACTIVE' },
  { id: 'CMD01', level: 'COMMAND', name: 'Telangana Command', parent_id: 'HQ01', status: 'ACTIVE' },
  { id: 'HUB01', level: 'HUB', name: 'Hyderabad Hub', parent_id: 'CMD01', status: 'ACTIVE' },
  { id: 'CTR01', level: 'CENTER', name: 'Hitech Center', parent_id: 'HUB01', status: 'ACTIVE' },
  { id: 'PNT01', level: 'POINT', name: 'Madhapur Point', parent_id: 'CTR01', status: 'ACTIVE' },
];
const boundary = { id: 'b1', franchise_id: 'PNT01', geometry: JSON.stringify(polygon), version: 3, status: 'ACTIVE' };

test('matches a point inside a GeoJSON polygon and resolves its physical hierarchy', () => {
  const result = resolveFranchiseMapping(franchises, [boundary], 17.4, 78.46);
  assert.equal(result.status, 'MAPPED');
  assert.equal(result.point.id, 'PNT01');
  assert.equal(result.center.id, 'CTR01');
  assert.equal(result.hub.id, 'HUB01');
  assert.equal(result.command.id, 'CMD01');
  assert.equal(result.mappingVersion, 3);
});

test('does not invent a mapping outside configured boundaries', () => {
  const result = resolveFranchiseMapping(franchises, [boundary], 17.5, 78.6);
  assert.equal(result.status, 'UNMAPPED');
  assert.equal(result.point, null);
});

test('marks overlapping boundaries and incomplete hierarchy explicitly', () => {
  assert.equal(resolveFranchiseMapping(franchises, [boundary, { ...boundary, id: 'b2' }], 17.4, 78.46).status, 'AMBIGUOUS');
  const incomplete = resolveFranchiseMapping(franchises.filter((item) => item.id !== 'CTR01'), [boundary], 17.4, 78.46);
  assert.equal(incomplete.status, 'INCOMPLETE');
});

test('validates GeoJSON coordinate order, ranges, and closed rings', () => {
  assert.deepEqual(parsePolygon(polygon), polygon);
  assert.throws(() => parsePolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }), /repeat the first coordinate/);
  assert.throws(() => parsePolygon({ type: 'Polygon', coordinates: [[[181, 0], [1, 0], [1, 1], [181, 0]]] }), /valid ranges/);
  assert.throws(() => resolveFranchiseMapping(franchises, [], 91, 0), /valid latitude and longitude/);
});

test('point-in-polygon respects latitude/longitude coordinates', () => {
  assert.equal(pointInPolygon(17.4, 78.46, polygon.coordinates[0]), true);
  assert.equal(pointInPolygon(17.5, 78.6, polygon.coordinates[0]), false);
  const polygonWithHole = {
    ...polygon,
    coordinates: [...polygon.coordinates, [[78.45, 17.39], [78.47, 17.39], [78.47, 17.41], [78.45, 17.41], [78.45, 17.39]]],
  };
  assert.equal(resolveFranchiseMapping(franchises, [{ ...boundary, geometry: JSON.stringify(polygonWithHole) }], 17.4, 78.46).status, 'UNMAPPED');
});
