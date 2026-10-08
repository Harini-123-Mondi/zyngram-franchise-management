import React, { useState, useEffect } from 'react';
import axios from 'axios';

function CommissionLedger() {
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    fetchCommissions();
  }, [statusFilter]);

  const fetchCommissions = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = {};
      if (statusFilter) params.status = statusFilter;

      const response = await axios.get('/api/commissions', {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });
      setCommissions(response.data);
    } catch (err) {
      console.error('Failed to fetch commissions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSettleCommission = async (commissionId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.put(`/api/commissions/${commissionId}/settle`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchCommissions();
    } catch (err) {
      alert('Failed to settle commission');
    }
  };

  return (
    <div className="commission-ledger">
      <h2>Commission Ledger</h2>
      
      <div className="filters">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="ELIGIBLE">Eligible</option>
          <option value="SETTLED">Settled</option>
          <option value="REVERSED">Reversed</option>
        </select>
      </div>

      {loading ? (
        <div className="loading">Loading commissions...</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Order ID</th>
                <th>Owner ID</th>
                <th>Level</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {commissions.length === 0 ? (
                <tr><td colSpan="9" className="empty">No commissions found</td></tr>
              ) : (
                commissions.map((commission) => (
                  <tr key={commission.id}>
                    <td>{commission.id}</td>
                    <td>{commission.order_id}</td>
                    <td>{commission.owner_id}</td>
                    <td>{commission.level}</td>
                    <td>{(commission.rate * 100).toFixed(1)}%</td>
                    <td>₹{parseFloat(commission.amount).toFixed(2)}</td>
                    <td>
                      <span className={`status ${commission.status.toLowerCase()}`}>{commission.status}</span>
                    </td>
                    <td>{new Date(commission.created_at).toLocaleString()}</td>
                    <td>
                      {commission.status === 'PENDING' && (
                        <button onClick={() => handleSettleCommission(commission.id)}>Settle</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="commission-summary">
        <h3>Commission Summary</h3>
        <div className="summary-grid">
          <div className="summary-item">
            <label>Total Pending:</label>
            <span>₹{commissions.filter(c => c.status === 'PENDING').reduce((sum, c) => sum + parseFloat(c.amount), 0).toFixed(2)}</span>
          </div>
          <div className="summary-item">
            <label>Total Settled:</label>
            <span>₹{commissions.filter(c => c.status === 'SETTLED').reduce((sum, c) => sum + parseFloat(c.amount), 0).toFixed(2)}</span>
          </div>
          <div className="summary-item">
            <label>Total Commissions:</label>
            <span>₹{commissions.reduce((sum, c) => sum + parseFloat(c.amount), 0).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CommissionLedger;
