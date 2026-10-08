import React, { useEffect, useState } from 'react';
import axios from 'axios';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const SAMPLE_POLYGON = JSON.stringify({
  type: 'Polygon',
  coordinates: [[[78.50, 17.43], [78.54, 17.43], [78.54, 17.47], [78.50, 17.47], [78.50, 17.43]]],
}, null, 2);

function MapView({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, 13);
  }, [center, map]);
  return null;
}

function GeoMapping({ user }) {
  const [location, setLocation] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingBoundary, setSavingBoundary] = useState(false);
  const [creatingDemoCoverage, setCreatingDemoCoverage] = useState(false);
  const [geoInfo, setGeoInfo] = useState(null);
  const [franchiseMapping, setFranchiseMapping] = useState(null);
  const [franchises, setFranchises] = useState([]);
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [demoCoverageCustomerId, setDemoCoverageCustomerId] = useState('');
  const [franchiseId, setFranchiseId] = useState('');
  const [geometry, setGeometry] = useState(SAMPLE_POLYGON);
  const canManageBoundaries = user?.role === 'HQ_ADMIN';

  const token = localStorage.getItem('token');
  const config = { headers: { Authorization: `Bearer ${token}` } };

  const loadOptions = async () => {
    try {
      const [franchiseResponse, userResponse] = await Promise.all([
        axios.get('/api/franchises', { ...config, params: { status: 'ACTIVE' } }),
        axios.get('/api/users', config),
      ]);
      const boundaryFranchises = franchiseResponse.data.filter((franchise) => (
        franchise.level === 'POINT' || franchise.level === 'NODE'
      ));
      setFranchises(boundaryFranchises);
      setUsers(userResponse.data);
      if (!franchiseId && boundaryFranchises.length) setFranchiseId(boundaryFranchises[0].id);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load franchise and user options.');
    }
  };

  useEffect(() => {
    loadOptions();
  }, []);

  const processCoordinates = async (coordinates, saveToUser = false) => {
    setLocation(coordinates);
    setFranchiseMapping(null);
    setGeoInfo(null);
    const params = { latitude: coordinates.latitude, longitude: coordinates.longitude };
    const [addressResponse, mappingResponse] = await Promise.all([
      axios.post('/api/geo/reverse-geocode', params, config),
      axios.get('/api/geo/franchise-map', { ...config, params }),
    ]);
    setGeoInfo(addressResponse.data);
    setFranchiseMapping(mappingResponse.data);
    if (saveToUser && userId) {
      await axios.post('/api/locations/capture', {
        userId,
        ...coordinates,
        ...addressResponse.data,
        source: 'browser_gps',
      }, config);
      setNotice('Coordinates mapped and saved to the selected user.');
    } else {
      setNotice(userId
        ? 'Coordinates mapped without saving. Use Capture my location to save a GPS fix to the selected user.'
        : 'Coordinates mapped. Select a user above if you also want to save a GPS fix.');
    }
  };

  const captureLocation = () => {
    setLoading(true);
    setError('');
    setNotice('');
    if (!navigator.geolocation) {
      setError('This browser does not support location access.');
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          await processCoordinates({
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
          }, Boolean(userId));
        } catch (err) {
          setError(err.response?.data?.error || `Could not process location: ${err.message}`);
        } finally {
          setLoading(false);
        }
      },
      (geoError) => {
        const messages = {
          1: 'Location permission was denied. Allow location access in your browser settings.',
          2: 'Your device could not determine a location. Try again where GPS is available.',
          3: 'Location lookup timed out. Please try again.',
        };
        setError(messages[geoError.code] || 'Unable to retrieve your location.');
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const previewDemoCoordinates = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await processCoordinates({ latitude: 17.45, longitude: 78.52 }, false);
    } catch (err) {
      setError(err.response?.data?.error || `Could not map sample coordinates: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadDemoBoundary = async () => {
    setSavingBoundary(true);
    setError('');
    setNotice('');
    try {
      const response = await axios.post('/api/geo/demo-boundary', {}, config);
      setNotice(response.data.message);
      await loadOptions();
      setFranchiseId('DEMO-PNT');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create the demo boundary.');
    } finally {
      setSavingBoundary(false);
    }
  };

  const createDemoCustomerCoverage = async () => {
    if (!demoCoverageCustomerId) {
      setError('Select a customer before creating demo-only coverage.');
      return;
    }
    const approved = window.confirm(
      'Create clearly labeled DEMO-only Point and Node boundaries around this customer’s saved GPS and add a demo attribution snapshot? This is not a real franchise assignment.'
    );
    if (!approved) return;

    setCreatingDemoCoverage(true);
    setError('');
    setNotice('');
    try {
      const response = await axios.post('/api/geo/demo-customer-coverage', {
        customerId: demoCoverageCustomerId,
      }, config);
      setNotice(response.data.message);
      setLocation({
        latitude: response.data.location.latitude,
        longitude: response.data.location.longitude,
      });
      setFranchiseMapping({
        status: response.data.status,
        physical: response.data.attribution.physical,
        digital: response.data.attribution.digital,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create demo-only coverage for this customer.');
    } finally {
      setCreatingDemoCoverage(false);
    }
  };

  const saveBoundary = async (event) => {
    event.preventDefault();
    setSavingBoundary(true);
    setError('');
    setNotice('');
    try {
      const parsedGeometry = JSON.parse(geometry);
      const response = await axios.post('/api/geo/boundaries', {
        franchise_id: franchiseId,
        geometry: parsedGeometry,
      }, config);
      setNotice(response.data.message);
      if (location) await processCoordinates(location);
    } catch (err) {
      setError(err.response?.data?.error || (err instanceof SyntaxError ? 'Enter valid JSON for the polygon.' : 'Could not save this boundary.'));
    } finally {
      setSavingBoundary(false);
    }
  };

  return (
    <section className="geo-mapping">
      <div className="section-header">
        <div>
          <h2>Geo Mapping</h2>
          <p>Capture a GPS position and resolve it against active franchise boundaries.</p>
        </div>
        <button className="btn-primary" onClick={captureLocation} disabled={loading}>
          {loading ? 'Finding location…' : 'Capture my location'}
        </button>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="geo-notice" role="status">{notice}</div>}

      {canManageBoundaries && (
        <div className="geo-card">
          <h3>Boundary setup</h3>
          <p>Use GeoJSON Polygon coordinates in [longitude, latitude] order.</p>
          <div className="geo-boundary-actions">
            <label>
              Customer for demo-only coverage
              <select value={demoCoverageCustomerId} onChange={(event) => setDemoCoverageCustomerId(event.target.value)}>
                <option value="">Select a customer</option>
                {users.filter((candidate) => candidate.role === 'CUSTOMER').map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.id})</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-secondary"
              onClick={createDemoCustomerCoverage}
              disabled={creatingDemoCoverage || !demoCoverageCustomerId}
            >
              {creatingDemoCoverage ? 'Creating demo coverage…' : 'Create demo coverage for customer GPS'}
            </button>
            <span>HQ Admin only. Uses the selected customer’s saved GPS, creates demo Point/Node boundaries, and records an explicit demo mapping snapshot. Not real coverage.</span>
          </div>
          <div className="geo-boundary-actions">
            <button className="btn-secondary" onClick={loadDemoBoundary} disabled={savingBoundary}>
              {savingBoundary ? 'Preparing…' : 'Load Hyderabad demo boundary'}
            </button>
            <span>Save a boundary for a physical Point or a digital Node. Sample area: 17.43–17.47° N, 78.50–78.54° E.</span>
          </div>
          <form className="geo-boundary-form" onSubmit={saveBoundary}>
            <label>
              Active Point or Node franchise
              <select value={franchiseId} onChange={(event) => setFranchiseId(event.target.value)} required>
                <option value="">Select a Point or Node</option>
                {franchises.map((franchise) => (
                  <option key={franchise.id} value={franchise.id}>{franchise.level}: {franchise.name} ({franchise.id})</option>
                ))}
              </select>
            </label>
            <label>
              Polygon boundary (GeoJSON)
              <textarea value={geometry} onChange={(event) => setGeometry(event.target.value)} rows={6} required />
            </label>
            <button className="btn-primary" type="submit" disabled={savingBoundary || !franchiseId}>
              Save boundary
            </button>
          </form>
        </div>
      )}

      <div className="geo-card">
        <h3>Location capture</h3>
        <p>Your coordinates are checked only against boundaries saved in this system. Address lookup is not configured.</p>
        <label className="geo-user-select">
          Save location to user (optional)
          <select value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">Do not save; preview only</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.email})</option>)}
          </select>
        </label>
        <div className="geo-boundary-actions">
          <button className="btn-secondary" onClick={previewDemoCoordinates} disabled={loading}>
            Preview demo coordinates
          </button>
          <span>17.45° N, 78.52° E (sample only)</span>
        </div>
        {location && (
          <div className="geo-location-summary">
            <span><strong>Latitude</strong> {location.latitude.toFixed(6)}</span>
            <span><strong>Longitude</strong> {location.longitude.toFixed(6)}</span>
            <span><strong>Accuracy</strong> {Number.isFinite(location.accuracy) ? `${Math.round(location.accuracy)} m` : 'Not provided'}</span>
          </div>
        )}
        {geoInfo && <p className="geo-muted">{geoInfo.message}</p>}
      </div>

      {franchiseMapping && (
        <div className="geo-card">
          <div className="geo-mapping-status">
            <h3>Franchise match</h3>
            <span className={`geo-status geo-status-${franchiseMapping.status.toLowerCase()}`}>{franchiseMapping.status}</span>
          </div>
          <p>{franchiseMapping.message}</p>
          {franchiseMapping.status === 'MAPPED' && (
            <div className="geo-hierarchy">
              {['point', 'center', 'hub', 'command', 'hq'].map((level, index) => (
                <React.Fragment key={level}>
                  {index > 0 && <span className="geo-arrow" aria-hidden="true">→</span>}
                  <div><strong>{level[0].toUpperCase() + level.slice(1)}</strong><span>{franchiseMapping[level].name}</span><small>{franchiseMapping[level].id}</small></div>
                </React.Fragment>
              ))}
            </div>
          )}
          {franchiseMapping.digital && (
            <div>
              <div className="geo-mapping-status">
                <h3>Digital hierarchy</h3>
                <span className={`geo-status geo-status-${franchiseMapping.digital.status.toLowerCase()}`}>
                  {franchiseMapping.digital.status}
                </span>
              </div>
              <p>{franchiseMapping.digital.message}</p>
              {franchiseMapping.digital.status === 'MAPPED' && (
                <div className="geo-hierarchy">
                  {['node', 'zone', 'territory', 'region', 'nation'].map((level, index) => (
                    <React.Fragment key={level}>
                      {index > 0 && <span className="geo-arrow" aria-hidden="true">→</span>}
                      <div>
                        <strong>{level[0].toUpperCase() + level.slice(1)}</strong>
                        <span>{franchiseMapping.digital[level].name}</span>
                        <small>{franchiseMapping.digital[level].id}</small>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          )}
          {franchiseMapping.mappingVersion && <small className="geo-muted">Boundary version {franchiseMapping.mappingVersion}</small>}
        </div>
      )}

      {location ? (
        <div className="geo-map">
          <MapContainer center={[location.latitude, location.longitude]} zoom={13} scrollWheelZoom style={{ height: '380px', width: '100%' }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            <Marker position={[location.latitude, location.longitude]}>
              <Popup>Captured GPS position</Popup>
            </Marker>
            <MapView center={[location.latitude, location.longitude]} />
          </MapContainer>
        </div>
      ) : (
        <div className="geo-placeholder">Allow browser location access to preview and map a GPS position.</div>
      )}
    </section>
  );
}

export default GeoMapping;
