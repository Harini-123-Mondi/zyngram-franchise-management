import React, { useState, useEffect } from 'react';
import axios from 'axios';

function FranchiseManagement() {
  const [franchises, setFranchises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    level: 'POINT',
    name: '',
    ownerId: '',
    parentId: ''
  });
  const [error, setError] = useState('');
  const parentLevels = {
    POINT: 'CENTER',
    CENTER: 'HUB',
    HUB: 'COMMAND',
    COMMAND: 'HQ',
    HQ: null,
    NODE: 'ZONE',
    ZONE: 'TERRITORY',
    TERRITORY: 'REGION',
    REGION: 'NATION',
    NATION: null,
  };
  const requiredParentLevel = parentLevels[formData.level];
  const parentOptions = franchises.filter((franchise) => (
    franchise.status === 'ACTIVE' && franchise.level === requiredParentLevel
  ));

  useEffect(() => {
    fetchFranchises();
  }, [levelFilter, statusFilter]);

  const fetchFranchises = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/franchises', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setFranchises(response.data);
    } catch (err) {
      console.error('Failed to fetch franchises:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFranchise = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const token = localStorage.getItem('token');
      await axios.post('/api/franchises', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowCreateForm(false);
      setFormData({ level: 'POINT', name: '', ownerId: '', parentId: '' });
      fetchFranchises();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create franchise');
    }
  };

  const getLevelBadge = (level) => {
    const colors = {
      'POINT': '#0d9488',
      'CENTER': '#0891b2',
      'HUB': '#7c3aed',
      'COMMAND': '#dc2626',
      'HQ': '#1d4ed8',
      'NODE': '#0d9488',
      'ZONE': '#0891b2',
      'TERRITORY': '#7c3aed',
      'REGION': '#dc2626',
      'NATION': '#1d4ed8'
    };
    return { backgroundColor: colors[level] || '#64748b' };
  };

  const getStatusBadge = (status) => {
    return status === 'ACTIVE' 
      ? { backgroundColor: '#10b981', color: 'white' }
      : { backgroundColor: '#ef4444', color: 'white' };
  };

  return (
    <div className="franchise-management">
      <div className="section-header">
        <div>
          <h2>Franchise Management</h2>
          <p>Manage franchise units across all levels</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreateForm(true)}>
          + Create Franchise
        </button>
      </div>

      {showCreateForm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Create New Franchise</h3>
              <button className="close-btn" onClick={() => setShowCreateForm(false)}>×</button>
            </div>
            {error && <div className="error">{error}</div>}
            <form onSubmit={handleCreateFranchise}>
              <div className="form-group">
                <label>Franchise Level</label>
                <select
                  value={formData.level}
                  onChange={(e) => setFormData({...formData, level: e.target.value, parentId: ''})}
                >
                  <option value="POINT">Point</option>
                  <option value="CENTER">Center</option>
                  <option value="HUB">Hub</option>
                  <option value="COMMAND">Command</option>
                  <option value="HQ">HQ</option>
                  <option value="NODE">Node</option>
                  <option value="ZONE">Zone</option>
                  <option value="TERRITORY">Territory</option>
                  <option value="REGION">Region</option>
                  <option value="NATION">Nation</option>
                </select>
              </div>
              <div className="form-group">
                <label>Franchise Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="Enter franchise name"
                  required
                />
              </div>
              <div className="form-group">
                <label>Owner ID (Optional)</label>
                <input
                  type="text"
                  value={formData.ownerId}
                  onChange={(e) => setFormData({...formData, ownerId: e.target.value})}
                  placeholder="Enter owner ID"
                />
              </div>
              {requiredParentLevel ? (
                <div className="form-group">
                  <label>{requiredParentLevel} Parent (Required)</label>
                  <select
                    value={formData.parentId}
                    onChange={(e) => setFormData({...formData, parentId: e.target.value})}
                    required
                  >
                    <option value="">Select an active {requiredParentLevel}</option>
                    {parentOptions.map((franchise) => (
                      <option key={franchise.id} value={franchise.id}>{franchise.name} ({franchise.id})</option>
                    ))}
                  </select>
                  {!parentOptions.length && <small>Create an active {requiredParentLevel} first.</small>}
                </div>
              ) : (
                <p>{formData.level} is the root of its independent hierarchy.</p>
              )}
              <div className="form-actions">
                <button type="submit" className="btn-primary">Create Franchise</button>
                <button type="button" className="btn-secondary" onClick={() => setShowCreateForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="filters-bar">
        <div className="filter-group">
          <label>Level:</label>
          <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
            <option value="">All Levels</option>
            <option value="POINT">Point</option>
            <option value="CENTER">Center</option>
            <option value="HUB">Hub</option>
            <option value="COMMAND">Command</option>
            <option value="HQ">HQ</option>
            <option value="NODE">Node</option>
            <option value="ZONE">Zone</option>
            <option value="TERRITORY">Territory</option>
            <option value="REGION">Region</option>
            <option value="NATION">Nation</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Status:</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading franchises...</div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Level</th>
                <th>Name</th>
                <th>Owner ID</th>
                <th>Parent ID</th>
                <th>Status</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {franchises.length === 0 ? (
                <tr><td colSpan="7" className="empty-state">No franchises found</td></tr>
              ) : (
                franchises.filter((franchise) => (!levelFilter || franchise.level === levelFilter) &&
                  (!statusFilter || franchise.status === statusFilter)).map((franchise) => (
                  <tr key={franchise.id}>
                    <td className="id-cell">{franchise.id}</td>
                    <td>
                      <span className="level-badge" style={getLevelBadge(franchise.level)}>
                        {franchise.level}
                      </span>
                    </td>
                    <td className="name-cell">{franchise.name}</td>
                    <td className="owner-cell">{franchise.owner_id || '—'}</td>
                    <td className="parent-cell">{franchise.parent_id || '—'}</td>
                    <td>
                      <span className="status-badge" style={getStatusBadge(franchise.status)}>
                        {franchise.status}
                      </span>
                    </td>
                    <td className="date-cell">{new Date(franchise.created_at).toLocaleDateString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default FranchiseManagement;
