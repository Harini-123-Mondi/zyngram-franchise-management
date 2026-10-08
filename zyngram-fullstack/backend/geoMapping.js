function pointInPolygon(latitude, longitude, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 4) return false;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[j];
    const intersects = (y1 > latitude) !== (y2 > latitude) &&
      longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1;
    if (intersects) inside = !inside;
  }
  return inside;
}

const PHYSICAL_HIERARCHY = ['POINT', 'CENTER', 'HUB', 'COMMAND', 'HQ'];
const DIGITAL_HIERARCHY = ['NODE', 'ZONE', 'TERRITORY', 'REGION', 'NATION'];

function parentLevelFor(level) {
  const hierarchy = PHYSICAL_HIERARCHY.includes(level)
    ? PHYSICAL_HIERARCHY
    : DIGITAL_HIERARCHY.includes(level)
      ? DIGITAL_HIERARCHY
      : null;
  if (!hierarchy) return undefined;
  const index = hierarchy.indexOf(level);
  return index === hierarchy.length - 1 ? null : hierarchy[index + 1];
}

function resolveHierarchyMapping(franchises, boundaries, latitude, longitude, hierarchy) {
  const leafLevel = hierarchy[0];
  const levels = hierarchy.map((level) => level.toLowerCase());
  const emptyChain = Object.fromEntries(levels.map((level) => [level, null]));
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Enter valid latitude and longitude coordinates.');
  }

  const matches = boundaries
    .filter((boundary) => boundary.status === 'ACTIVE')
    .map((boundary) => {
      const franchise = franchises.find((item) => item.id === boundary.franchise_id);
      if (!franchise || franchise.status !== 'ACTIVE' || franchise.level !== leafLevel) return null;
      const geometry = JSON.parse(boundary.geometry);
      if (geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates?.[0])) return null;
      const [outerRing, ...holes] = geometry.coordinates;
      const inside = pointInPolygon(latitude, longitude, outerRing) &&
        !holes.some((ring) => pointInPolygon(latitude, longitude, ring));
      return inside ? { boundary, franchise } : null;
    })
    .filter(Boolean);

  if (!matches.length) {
    return {
      status: 'UNMAPPED',
      message: `No active ${leafLevel} boundary covers these coordinates.`,
      ...emptyChain,
      boundaryId: null,
      mappingVersion: null,
    };
  }
  if (matches.length > 1) {
    return {
      status: 'AMBIGUOUS',
      message: `More than one active ${leafLevel} boundary covers these coordinates. Review overlapping boundaries.`,
      ...emptyChain,
      boundaryId: null,
      mappingVersion: null,
    };
  }

  const { boundary, franchise: leaf } = matches[0];
  const chain = new Map([[leaf.level, leaf]]);
  const seen = new Set([leaf.id]);
  let current = leaf;
  for (let index = 1; index < hierarchy.length; index += 1) {
    const expectedLevel = hierarchy[index];
    if (!current.parent_id) break;
    if (seen.has(current.parent_id)) {
      return {
        status: 'INCOMPLETE',
        message: 'The franchise hierarchy contains a parent cycle.',
        ...emptyChain,
        boundaryId: boundary.id,
        mappingVersion: Number(boundary.version) || 1,
      };
    }
    seen.add(current.parent_id);
    current = franchises.find((item) => item.id === current.parent_id && item.status === 'ACTIVE');
    if (!current || current.level !== expectedLevel) break;
    chain.set(current.level, current);
  }

  const response = Object.fromEntries(hierarchy.map((level) => [level.toLowerCase(), chain.get(level) || null]));
  const complete = levels.every((level) => response[level]);
  return {
    ...response,
    status: complete ? 'MAPPED' : 'INCOMPLETE',
    boundaryId: boundary.id,
    message: complete
      ? `Coordinates matched an active ${hierarchy.join(' → ')} hierarchy.`
      : `A boundary matched, but its active ${hierarchy.join(' → ')} hierarchy is incomplete.`,
    mappingVersion: Number(boundary.version) || 1,
  };
}

function resolveFranchiseMapping(franchises, boundaries, latitude, longitude) {
  const physical = resolveHierarchyMapping(franchises, boundaries, latitude, longitude, PHYSICAL_HIERARCHY);
  const digital = resolveHierarchyMapping(franchises, boundaries, latitude, longitude, DIGITAL_HIERARCHY);
  return {
    ...physical,
    status: physical.status,
    message: `Physical: ${physical.message} Digital: ${digital.message}`,
    physical,
    digital,
  };
}

function parsePolygon(value) {
  let geometry = value;
  if (typeof geometry === 'string') {
    try {
      geometry = JSON.parse(geometry);
    } catch {
      throw new Error('Boundary must be valid GeoJSON.');
    }
  }
  const rings = geometry?.type === 'Polygon' && geometry.coordinates;
  if (!Array.isArray(rings) || rings.length < 1) {
    throw new Error('Boundary must be a GeoJSON Polygon with at least four coordinate pairs.');
  }
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4 || ring.length > 10000) {
      throw new Error('Boundary must be a GeoJSON Polygon with at least four coordinate pairs per ring.');
    }
    for (const position of ring) {
      if (!Array.isArray(position) || position.length < 2 ||
          !Number.isFinite(position[0]) || position[0] < -180 || position[0] > 180 ||
          !Number.isFinite(position[1]) || position[1] < -90 || position[1] > 90) {
        throw new Error('Polygon coordinates must use [longitude, latitude] values within valid ranges.');
      }
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      throw new Error('GeoJSON Polygon rings must repeat the first coordinate at the end.');
    }
  }
  return geometry;
}

module.exports = {
  DIGITAL_HIERARCHY,
  PHYSICAL_HIERARCHY,
  parentLevelFor,
  parsePolygon,
  pointInPolygon,
  resolveFranchiseMapping,
};
