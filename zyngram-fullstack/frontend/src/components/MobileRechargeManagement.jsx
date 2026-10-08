import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';

function displayDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function MobileRechargeManagement() {
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [operators, setOperators] = useState([]);
  const [circles, setCircles] = useState([]);
  const [form, setForm] = useState({ customerId: '', mobileNumber: '', operator: '', circle: '', amount: '' });
  const [idempotencyKey, setIdempotencyKey] = useState(() => window.crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchOrders = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/admin/recharge/orders', {
        headers: { Authorization: 'Bearer ' + token }
      });
      setOrders(response.data);
      return true;
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not load Mobile Recharge orders.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOptions = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/admin/recharge/options', {
        headers: { Authorization: 'Bearer ' + token }
      });
      setCustomers(response.data.customers);
      setOperators(response.data.operators);
      setCircles(response.data.circles);
      setForm((current) => ({
        ...current,
        customerId: current.customerId || response.data.customers[0]?.id || '',
        operator: current.operator || response.data.operators[0]?.id || '',
        circle: current.circle || response.data.circles[0] || ''
      }));
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not load customers and Mobile Recharge options.');
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    fetchOptions();
  }, [fetchOrders, fetchOptions]);

  const submitRecharge = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post('/api/admin/recharge/orders', {
        ...form,
        amount: Number(form.amount)
      }, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Idempotency-Key': idempotencyKey
        }
      });
      setSuccess(`${response.data.orderId} created for ${response.data.customerId}. ${response.data.providerWarning}`);
      setIdempotencyKey(window.crypto.randomUUID());
      setForm((current) => ({ ...current, mobileNumber: '', amount: '' }));
      await fetchOrders();
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not process the Mobile Recharge request.');
      if (requestError.response?.status === 409) {
        setIdempotencyKey(window.crypto.randomUUID());
        setForm((current) => ({ ...current, mobileNumber: '', amount: '' }));
        if (await fetchOrders()) {
          setError('');
          setSuccess('This request was already accepted. Order history was refreshed; no second order was created.');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const pendingCount = orders.filter((order) => order.status === 'PENDING' || order.status === 'PROCESSING').length;
  const completedCount = orders.filter((order) => order.status === 'SIMULATED_SUCCESS').length;

  return (
    <section className="mobile-recharge-management" aria-labelledby="mobile-recharge-management-title">
      <div className="section-header">
        <div>
          <h2 id="mobile-recharge-management-title">Mobile Recharge</h2>
          <p>View customer recharge requests, processing status, and attribution snapshots.</p>
        </div>
        <button type="button" onClick={fetchOrders} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <p className="recharge-disclaimer">
        Demo simulation only. No telecom provider was contacted and no recharge or payment was made.
      </p>

      {error && <div className="error" role="alert">{error}</div>}
      {success && <div className="order-created-message" role="status">{success}</div>}

      <form className="create-form" onSubmit={submitRecharge}>
        <h3>Create Mobile Recharge request</h3>
        <p>Select a customer with a saved GPS mapped to both active demo/approved franchise hierarchies.</p>
        <div className="recharge-form">
          <div className="form-group">
            <label htmlFor="admin-recharge-customer">Customer</label>
            <select
              id="admin-recharge-customer"
              value={form.customerId}
              onChange={(event) => setForm({ ...form, customerId: event.target.value })}
              required
              disabled={!customers.length}
            >
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name} — {customer.id} ({customer.email})</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="admin-recharge-mobile">Mobile number to recharge</label>
            <input
              id="admin-recharge-mobile"
              type="tel"
              inputMode="numeric"
              placeholder="10-digit Indian mobile number"
              value={form.mobileNumber}
              onChange={(event) => setForm({ ...form, mobileNumber: event.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="admin-recharge-operator">Operator</label>
            <select id="admin-recharge-operator" value={form.operator} onChange={(event) => setForm({ ...form, operator: event.target.value })} required>
              <option value="">Select operator</option>
              {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="admin-recharge-circle">Circle</label>
            <select id="admin-recharge-circle" value={form.circle} onChange={(event) => setForm({ ...form, circle: event.target.value })} required>
              <option value="">Select circle</option>
              {circles.map((circle) => <option key={circle} value={circle}>{circle}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="admin-recharge-amount">Amount (₹10–₹5,000)</label>
            <input
              id="admin-recharge-amount"
              type="number"
              min="10"
              max="5000"
              step="0.01"
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              required
            />
          </div>
        </div>
        <button type="submit" disabled={submitting || !customers.length || !form.customerId || !form.operator || !form.circle || !form.amount}>
          {submitting ? 'Processing demo order...' : 'Create demo recharge order'}
        </button>
      </form>

      <div className="metrics-grid">
        <article className="metric-card">
          <h3>Recent recharge orders</h3>
          <p className="metric-value">{orders.length}</p>
        </article>
        <article className="metric-card">
          <h3>Pending / processing</h3>
          <p className="metric-value">{pendingCount}</p>
        </article>
        <article className="metric-card">
          <h3>Simulated success</h3>
          <p className="metric-value">{completedCount}</p>
        </article>
      </div>

      {loading ? <div className="loading">Loading Mobile Recharge orders...</div> : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Order / time</th>
                <th>Customer / location</th>
                <th>Mobile / operator / circle</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Franchise attribution</th>
                <th>Processing history</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan="7" className="empty">No Mobile Recharge orders found.</td></tr>
              ) : orders.map((order) => (
                <tr key={order.orderId}>
                  <td><span className="order-id">{order.orderId}</span><br />{displayDate(order.createdAt)}</td>
                  <td>
                    {order.customerName || order.customerId}<br />
                    <span className="field-hint">{order.customerEmail}<br />Customer: {order.customerId}</span>
                    <span className="field-hint">
                      Location: {order.locationId || '—'}<br />
                      GPS: {order.latitude !== null && order.latitude !== undefined &&
                        order.longitude !== null && order.longitude !== undefined &&
                        Number.isFinite(Number(order.latitude)) && Number.isFinite(Number(order.longitude))
                        ? `${Number(order.latitude).toFixed(6)}, ${Number(order.longitude).toFixed(6)}`
                        : '—'}
                    </span>
                  </td>
                  <td>{order.mobileNumber || '—'}<br />{order.operator || '—'} · {order.circle || '—'}</td>
                  <td>₹{Number(order.amount).toFixed(2)}</td>
                  <td>
                    <span className={`status ${String(order.status || '').toLowerCase()}`}>{order.status}</span>
                    {order.processedAt && <span className="field-hint">{displayDate(order.processedAt)}</span>}
                    <span className="field-hint">
                      Commission entries: {order.commissionEntries || 0}
                      {order.commissionAmount > 0 && ` · ₹${Number(order.commissionAmount).toFixed(2)}`}
                    </span>
                  </td>
                  <td>
                    <span className="field-hint">
                      Physical: {order.franchiseMapping.physical.map((franchise) => franchise.name || franchise.id || '—').join(' → ')}
                      {order.franchiseMapping.physicalMappingVersion ? ` (v${order.franchiseMapping.physicalMappingVersion})` : ''}<br />
                      Digital: {order.franchiseMapping.digital.map((franchise) => franchise.name || franchise.id || '—').join(' → ')}
                      {order.franchiseMapping.digitalMappingVersion ? ` (v${order.franchiseMapping.digitalMappingVersion})` : ''}
                    </span>
                  </td>
                  <td>
                    {order.processingReference && <span className="field-hint">{order.processingReference}<br /></span>}
                    {order.statusHistory.length ? (
                      <ol className="order-status-history">
                        {order.statusHistory.map((entry, index) => (
                          <li key={`${order.orderId}-${index}`}>
                            {entry.status}: {entry.message} <span className="field-hint">{displayDate(entry.createdAt)}</span>
                          </li>
                        ))}
                      </ol>
                    ) : order.processingMessage || 'No processing history'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default MobileRechargeManagement;
