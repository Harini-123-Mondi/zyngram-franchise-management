import React, { useEffect, useState } from 'react';
import axios from 'axios';
import ZyngramLogo from './ZyngramLogo';

function CustomerHome({ user, onLogout }) {
  const [attribution, setAttribution] = useState(null);
  const [rechargeOptions, setRechargeOptions] = useState(null);
  const [rechargeOrders, setRechargeOrders] = useState([]);
  const [rechargeForm, setRechargeForm] = useState({
    mobileNumber: '',
    operator: '',
    circle: '',
    amount: ''
  });
  const [idempotencyKey, setIdempotencyKey] = useState(() => window.crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [refreshingLocation, setRefreshingLocation] = useState(false);
  const [submittingRecharge, setSubmittingRecharge] = useState(false);
  const [rechargeMessage, setRechargeMessage] = useState('');
  const [locationUpdateMessage, setLocationUpdateMessage] = useState('');
  const [locationUpdateError, setLocationUpdateError] = useState('');
  const [error, setError] = useState('');
  const [rechargeError, setRechargeError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      axios.get('/api/customers/me/attribution', { headers }),
      axios.get('/api/recharge/options', { headers }),
      axios.get('/api/recharge/orders', { headers })
    ]).then(([attributionResponse, optionsResponse, ordersResponse]) => {
      setAttribution(attributionResponse.data);
      setRechargeOptions(optionsResponse.data);
      setRechargeOrders(ordersResponse.data);
    }).catch((requestError) => {
      if (requestError.config?.url?.includes('/api/customers/me/attribution') &&
          requestError.response?.status === 404) {
        setError(requestError.response.data.error);
      } else if (requestError.config?.url?.includes('/api/recharge/')) {
        setRechargeError(requestError.response?.data?.error || 'Could not load Mobile Recharge options or order history.');
      } else {
        setError(requestError.response?.data?.error || 'Could not load your location mapping status.');
      }
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  const handleRefreshLocation = () => {
    setLocationUpdateError('');
    setLocationUpdateMessage('');
    if (!navigator.geolocation) {
      setLocationUpdateError('This browser does not support GPS location.');
      return;
    }

    setRefreshingLocation(true);
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const token = localStorage.getItem('token');
        const response = await axios.post('/api/customers/me/location', {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          locationConsent: true
        }, {
          headers: { Authorization: 'Bearer ' + token }
        });
        setAttribution({
          ...response.data.attribution,
          location: response.data.location
        });
        setLocationUpdateMessage(response.data.message);
      } catch (requestError) {
        setLocationUpdateError(requestError.response?.data?.error || 'Could not update your location. Please try again.');
      } finally {
        setRefreshingLocation(false);
      }
    }, (locationFailure) => {
      const messages = {
        1: 'Location permission was denied. Allow location access in your browser settings and try again.',
        2: 'Your device could not determine its location. Check GPS or network location and try again.',
        3: 'Location request timed out. Please try again.'
      };
      setLocationUpdateError(messages[locationFailure.code] || 'Could not get your location. Please try again.');
      setRefreshingLocation(false);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  };

  const handleRecharge = async (event) => {
    event.preventDefault();
    setRechargeError('');
    setRechargeMessage('');
    setSubmittingRecharge(true);
    try {
      const token = localStorage.getItem('token');
      let response;
      try {
        response = await axios.post('/api/recharge/orders', {
          ...rechargeForm,
          amount: Number(rechargeForm.amount)
        }, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Idempotency-Key': idempotencyKey
          }
        });
      } catch (requestError) {
        const requestMessage = requestError.response?.data?.error || 'The backend could not process this recharge request.';
        setRechargeError(requestMessage);
        if (requestError.response?.status === 409) {
          setIdempotencyKey(window.crypto.randomUUID());
          setRechargeForm((current) => ({ ...current, mobileNumber: '', amount: '' }));
          try {
            const ordersResponse = await axios.get('/api/recharge/orders', {
              headers: { Authorization: 'Bearer ' + token }
            });
            setRechargeOrders(ordersResponse.data);
            setRechargeError('');
            setRechargeMessage('This request was already accepted. Order history was refreshed; no second order was created.');
          } catch (historyError) {
            setRechargeError(`${requestMessage} Order history could not be refreshed: ${historyError.response?.data?.error || historyError.message}`);
          }
        }
        return;
      }

      setRechargeMessage(`${response.data.orderId}: ${response.data.providerWarning}`);
      setIdempotencyKey(window.crypto.randomUUID());
      setRechargeForm({ mobileNumber: '', operator: '', circle: '', amount: '' });
      try {
        const ordersResponse = await axios.get('/api/recharge/orders', {
          headers: { Authorization: 'Bearer ' + token }
        });
        setRechargeOrders(ordersResponse.data);
      } catch (historyError) {
        setRechargeError(`Order ${response.data.orderId} was created, but history could not be refreshed: ${historyError.response?.data?.error || historyError.message}`);
      }
    } finally {
      setSubmittingRecharge(false);
    }
  };

  const currentMappingReady = attribution?.status === 'MAPPED';

  return (
    <main className="customer-home">
      <header className="customer-home-header">
        <div className="customer-brand">
          <ZyngramLogo className="customer-brand-mark" />
          <div>
            <span className="login-intro-label">ZYNGRAM CUSTOMER</span>
            <h1>Welcome, {user.name}</h1>
            <p>{user.email}</p>
          </div>
        </div>
        <button type="button" onClick={onLogout}>Logout</button>
      </header>
      <section className="customer-home-card" aria-labelledby="customer-mapping-title">
        <h2 id="customer-mapping-title">Your franchise location</h2>
        {loading && <p>Loading your saved mapping status...</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {!loading && attribution?.status === 'MAPPED' && (
          <div className="registration-result mapped" role="status">
            <strong>Mapped to active franchise boundaries</strong>
            <p><strong>Physical:</strong> {attribution.physical.point.name} → {attribution.physical.center.name} → {attribution.physical.hub.name} → {attribution.physical.command.name} → {attribution.physical.hq.name}</p>
            <p><strong>Digital:</strong> {attribution.digital.node.name} → {attribution.digital.zone.name} → {attribution.digital.territory.name} → {attribution.digital.region.name} → {attribution.digital.nation.name}</p>
          </div>
        )}
        {!loading && attribution?.status === 'UNMAPPED' && (
          <div className="registration-result unmapped" role="status">
            <strong>UNMAPPED — no franchise has been assigned</strong>
            <p>Your saved GPS is outside an approved boundary. Recharge stays disabled until an approved boundary covers your location.</p>
          </div>
        )}
        {attribution?.location && (
          <p className="field-hint">
            Saved GPS: {Number(attribution.location.latitude).toFixed(5)}, {Number(attribution.location.longitude).toFixed(5)}
          </p>
        )}
        {locationUpdateError && <p className="error" role="alert">{locationUpdateError}</p>}
        {locationUpdateMessage && <p className="field-hint" role="status">{locationUpdateMessage}</p>}
        <button type="button" className="btn-secondary" onClick={handleRefreshLocation} disabled={loading || refreshingLocation}>
          {refreshingLocation ? 'Getting GPS and checking boundaries...' : 'Refresh GPS & remap'}
        </button>
        <p className="field-hint">This checks your GPS against approved boundaries; it never assigns a franchise by guess.</p>
        {!loading && !error && !attribution && <p>No saved franchise attribution is available yet.</p>}
      </section>

      <section className="customer-home-card recharge-card" aria-labelledby="recharge-title">
        <div className="customer-section-heading">
          <div>
            <span className="login-intro-label">FIRST AVAILABLE SERVICE</span>
            <h2 id="recharge-title">Mobile Recharge</h2>
          </div>
          <span className="recharge-provider-mode">Demo simulation</span>
        </div>
        <p className="recharge-disclaimer">This local demo validates and records an order, but it does not connect to a telecom provider, charge money, or send a recharge.</p>
        {rechargeError && <div className="error" role="alert">{rechargeError}</div>}
        {rechargeMessage && <div className="order-created-message" role="status">{rechargeMessage}</div>}
        {!currentMappingReady && !loading && (
          <p className="registration-location-error">Recharge is unavailable unless both complete franchise hierarchies map to your saved GPS location.</p>
        )}
        <form className="recharge-form" onSubmit={handleRecharge}>
          <div className="form-group">
            <label htmlFor="recharge-mobile">Mobile number to recharge</label>
            <input id="recharge-mobile" type="tel" autoComplete="tel" placeholder="10-digit Indian mobile number" value={rechargeForm.mobileNumber} onChange={(event) => setRechargeForm({ ...rechargeForm, mobileNumber: event.target.value })} required />
          </div>
          <div className="form-group">
            <label htmlFor="recharge-operator">Operator</label>
            <select id="recharge-operator" value={rechargeForm.operator} onChange={(event) => setRechargeForm({ ...rechargeForm, operator: event.target.value })} required>
              <option value="">Select operator</option>
              {rechargeOptions?.operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="recharge-circle">Circle</label>
            <select id="recharge-circle" value={rechargeForm.circle} onChange={(event) => setRechargeForm({ ...rechargeForm, circle: event.target.value })} required>
              <option value="">Select circle</option>
              {rechargeOptions?.circles.map((circle) => <option key={circle} value={circle}>{circle}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="recharge-amount">Amount (₹10–₹5,000)</label>
            <input id="recharge-amount" type="number" min="10" max="5000" step="0.01" inputMode="decimal" value={rechargeForm.amount} onChange={(event) => setRechargeForm({ ...rechargeForm, amount: event.target.value })} required />
          </div>
          <button type="submit" disabled={loading || submittingRecharge || !currentMappingReady || !rechargeOptions}>
            {submittingRecharge ? 'Processing order...' : 'Place recharge order'}
          </button>
        </form>
      </section>

      <section className="customer-home-card recharge-orders" aria-labelledby="recharge-orders-title">
        <h2 id="recharge-orders-title">Recharge orders and status</h2>
        {rechargeOrders.length === 0 ? <p>No Mobile Recharge orders yet.</p> : (
          <div className="table-container">
            <table>
              <thead><tr><th>Order ID / Time</th><th>Customer / Location</th><th>Service / Mobile</th><th>Operator / Circle</th><th>Amount</th><th>Status / Mapping</th><th>Processing</th></tr></thead>
              <tbody>
                {rechargeOrders.map((order) => (
                  <tr key={order.orderId}>
                    <td><span className="order-id">{order.orderId}</span><br />{new Date(order.createdAt).toLocaleString()}</td>
                    <td>
                      {order.customerId}<br />
                      <span className="field-hint">
                        Location: {order.locationId}<br />
                        GPS: {Number(order.latitude).toFixed(6)}, {Number(order.longitude).toFixed(6)}
                      </span>
                    </td>
                    <td>{order.serviceName} · {order.mobileNumber}</td>
                    <td>{order.operator} · {order.circle}</td>
                    <td>₹{Number(order.amount).toFixed(2)}</td>
                    <td>
                      <span className={`status ${order.status.toLowerCase()}`}>{order.status}</span><br />
                      <span className="field-hint">
                        Physical: {order.franchiseMapping.physical.map((franchise) => franchise.name || franchise.id).join(' → ')} (v{order.franchiseMapping.physicalMappingVersion})<br />
                        Digital: {order.franchiseMapping.digital.map((franchise) => franchise.name || franchise.id).join(' → ')} (v{order.franchiseMapping.digitalMappingVersion})
                      </span>
                    </td>
                    <td>{order.processingReference}<br /><span className="field-hint">{order.processingMessage}</span><ol className="order-status-history">{order.statusHistory.map((entry, index) => <li key={`${order.orderId}-${index}`}>{entry.status}: {entry.message}</li>)}</ol></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default CustomerHome;
