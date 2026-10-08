import React, { useState, useEffect } from 'react';
import axios from 'axios';

function OrderManagement() {
  const [orders, setOrders] = useState([]);
  const [orderCustomers, setOrderCustomers] = useState([]);
  const [orderServices, setOrderServices] = useState([]);
  const [customerLocations, setCustomerLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    customerId: '',
    serviceId: '',
    amount: '',
    locationId: ''
  });
  const [error, setError] = useState('');
  const [createdOrderId, setCreatedOrderId] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [franchiseMapping, setFranchiseMapping] = useState(null);

  useEffect(() => {
    fetchOrders();
    fetchOrderOptions();
  }, []);

  const fetchOrderOptions = async () => {
    setError('');
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/orders/options', {
        headers: { Authorization: 'Bearer ' + token }
      });
      const { customers, services, locations } = response.data;
      setOrderCustomers(customers);
      setOrderServices(services);
      setCustomerLocations(locations);
      setFormData((current) => ({
        ...current,
        customerId: current.customerId || customers[0]?.id || '',
        serviceId: current.serviceId || services[0]?.id || ''
      }));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load active customers and services for order creation.');
    } finally {
      setLoadingOptions(false);
    }
  };

  const fetchOrders = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(response.data);
    } catch (err) {
      console.error('Failed to fetch orders:', err);
      setError(err.response?.data?.error || 'Could not load orders.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post('/api/orders', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCreatedOrderId(response.data.orderId || response.data.id);
      setError('');
      setShowCreateForm(false);
      setFormData({
        customerId: orderCustomers[0]?.id || '',
        serviceId: orderServices[0]?.id || '',
        amount: '',
        locationId: ''
      });
      await fetchOrders();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create order');
    }
  };

  const handleConfirmOrder = async (order) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/orders/${order.id}/confirm`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      fetchOrders();
      alert('Order confirmed with attribution snapshot');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to confirm order');
    }
  };

  return (
    <div className="order-management">
      <div className="section-header">
        <h2>Order Management</h2>
        <button onClick={() => { setError(''); setShowCreateForm(true); }}>+ Create Order</button>
      </div>

      {createdOrderId && (
        <div className="order-created-message" role="status">
          Order created successfully. Order ID: <strong>{createdOrderId}</strong>
          <button type="button" className="order-message-close" onClick={() => setCreatedOrderId('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {error && !showCreateForm && <div className="error" role="alert">{error}</div>}

      {showCreateForm && (
        <div className="create-form">
          <h3>Create New Order</h3>
          {error && <div className="error">{error}</div>}
          <form onSubmit={handleCreateOrder}>
            <div className="form-group">
              <label>Customer ID</label>
              <select
                value={formData.customerId}
                onChange={(e) => setFormData({ ...formData, customerId: e.target.value, locationId: '' })}
                required
                disabled={loadingOptions || orderCustomers.length === 0}
              >
                <option value="">{loadingOptions ? 'Loading active customers...' : 'Select an active customer'}</option>
                {orderCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} — {customer.user_code || customer.id} ({customer.email})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Service ID</label>
              <select
                value={formData.serviceId}
                onChange={(e) => setFormData({...formData, serviceId: e.target.value})}
                required
                disabled={loadingOptions || orderServices.length === 0}
              >
                <option value="">{loadingOptions ? 'Loading active services...' : 'Select an active service'}</option>
                {orderServices.map((service) => (
                  <option key={service.id} value={service.id}>{service.name} — {service.id}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Amount</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({...formData, amount: e.target.value})}
                required
              />
            </div>
            <div className="form-group">
              <label>Saved Customer Location (Optional)</label>
              <select
                value={formData.locationId}
                onChange={(e) => setFormData({...formData, locationId: e.target.value})}
                disabled={loadingOptions}
              >
                <option value="">No location selected</option>
                {customerLocations
                  .filter((location) => location.customerId === formData.customerId)
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.latitude}, {location.longitude} — {location.id}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-actions">
              <button type="submit" disabled={loadingOptions || !formData.customerId || !formData.serviceId}>Create Order</button>
              <button type="button" onClick={() => setShowCreateForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading orders...</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer ID</th>
                <th>Service ID</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan="7" className="empty">No orders found</td></tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id}>
                    <td><span className="order-id">{order.id}</span></td>
                    <td>{order.customer_id}</td>
                    <td>{order.service_id}</td>
                    <td>₹{parseFloat(order.amount).toFixed(2)}</td>
                    <td>
                      <span className={`status ${order.status.toLowerCase()}`}>{order.status}</span>
                    </td>
                    <td>{new Date(order.created_at).toLocaleString()}</td>
                    <td>
                      {order.status === 'PENDING' && (
                        <button onClick={() => handleConfirmOrder(order)}>Confirm</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedOrder && (
        <div className="order-details">
          <h3>Order Attribution Snapshot</h3>
          <p>Order ID: {selectedOrder.id}</p>
          <p>Status: {selectedOrder.status}</p>
        </div>
      )}
    </div>
  );
}

export default OrderManagement;
