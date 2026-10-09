import React, { useState, useEffect } from 'react';
import axios from 'axios';

function UserManagement({ user }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    mobile: '',
    email: '',
    password: '',
    role: 'CENTER_ADMIN'
  });
  const [error, setError] = useState('');
  const [resetUserId, setResetUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [notice, setNotice] = useState('');
  const canManageUsers = user?.role === 'HQ_ADMIN';

  useEffect(() => {
    fetchUsers();
  }, [search, roleFilter, statusFilter]);

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = {};
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      if (statusFilter) params.status = statusFilter;

      const response = await axios.get('/api/users', {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsers(response.data);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post('/api/users', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotice(response.data.message);
      setShowCreateForm(false);
      setFormData({ name: '', mobile: '', email: '', password: '', role: 'CENTER_ADMIN' });
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setResetError('');
    setNotice('');
    try {
      const token = localStorage.getItem('token');
      const response = await axios.put(`/api/users/${resetUserId}/password`, { password: resetPassword }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotice(response.data.message);
      setResetUserId('');
      setResetPassword('');
    } catch (err) {
      setResetError(err.response?.data?.error || 'Failed to reset password');
    }
  };

  const handleExportUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = {};
      if (search) params.query = search;
      if (statusFilter) params.status = statusFilter;
      
      const response = await axios.get('/api/users/export', {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Convert to CSV
      const users = response.data.users;
      if (users.length === 0) {
        alert('No users to export');
        return;
      }
      
      const headers = Object.keys(users[0]).join(',');
      const rows = users.map(u => Object.values(u).join(','));
      const csv = [headers, ...rows].join('\n');
      
      // Download
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `users_export_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      alert(`Exported ${response.data.recordCount} users successfully`);
    } catch (err) {
      alert('Export failed: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="user-management">
      <div className="section-header">
        <div>
          <h2>User Management</h2>
          <p>Manage system users and administrators</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={handleExportUsers}>Export Users</button>
          {canManageUsers && <button className="btn-primary" onClick={() => setShowCreateForm(true)}>+ Create User</button>}
        </div>
      </div>

      {showCreateForm && (
        <div className="create-form">
          <h3>Create New User</h3>
          {error && <div className="error">{error}</div>}
          <form onSubmit={handleCreateUser}>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                required
              />
            </div>
            <div className="form-group">
              <label>Mobile</label>
              <input
                type="text"
                value={formData.mobile}
                onChange={(e) => setFormData({...formData, mobile: e.target.value})}
                required
              />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                minLength={8}
                required
              />
              <small className="field-hint">The user signs in with this email and password. Use at least 8 characters.</small>
            </div>
            <div className="form-group">
              <label>Role</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({...formData, role: e.target.value})}
              >
                <option value="HQ_ADMIN">HQ Admin</option>
                <option value="COMMAND_ADMIN">Command Admin</option>
                <option value="HUB_ADMIN">Hub Admin</option>
                <option value="CENTER_ADMIN">Center Admin</option>
                <option value="FRANCHISE_OWNER">Franchise Owner</option>
              </select>
              {formData.role === 'FRANCHISE_OWNER' && (
                <small className="field-hint">Franchise Owners can log in to Zynpi. Assign this account to a franchise to enable its franchise-scoped data.</small>
              )}
            </div>
            <div className="form-actions">
              <button type="submit">Create User</button>
              <button type="button" onClick={() => setShowCreateForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="filters">
        <input
          type="text"
          placeholder="Search by name, mobile, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">All Roles</option>
          <option value="HQ_ADMIN">HQ Admin</option>
          <option value="COMMAND_ADMIN">Command Admin</option>
          <option value="HUB_ADMIN">Hub Admin</option>
          <option value="CENTER_ADMIN">Center Admin</option>
          <option value="FRANCHISE_OWNER">Franchise Owner</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      {notice && <div className="geo-notice" role="status">{notice}</div>}
      {resetError && <div className="error" role="alert">{resetError}</div>}

      {loading ? (
        <div className="loading">Loading users...</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>User ID</th>
                <th>Name</th>
                <th>Mobile</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created At</th>
                {canManageUsers && <th>Access</th>}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={canManageUsers ? 8 : 7} className="empty">No users found</td></tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.user_code || user.id}</td>
                    <td>{user.name}</td>
                    <td>{user.mobile}</td>
                    <td>{user.email}</td>
                    <td>{user.role.replace(/_/g, ' ')}</td>
                    <td>
                      <span className={`status ${user.status.toLowerCase()}`}>{user.status}</span>
                    </td>
                    <td>{new Date(user.created_at).toLocaleDateString()}</td>
                    {canManageUsers && <td>
                      {resetUserId === user.id ? (
                        <form className="user-password-reset" onSubmit={handleResetPassword}>
                          <input
                            type="password"
                            aria-label={`New password for ${user.email}`}
                            placeholder="New password (8+ chars)"
                            value={resetPassword}
                            onChange={(event) => setResetPassword(event.target.value)}
                            minLength={8}
                            autoComplete="new-password"
                            required
                          />
                          <button type="submit" className="btn-sm">Save</button>
                          <button type="button" className="btn-secondary btn-sm" onClick={() => { setResetUserId(''); setResetPassword(''); setResetError(''); }}>Cancel</button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => { setResetUserId(user.id); setResetPassword(''); setResetError(''); setNotice(''); }}
                        >
                          Reset password
                        </button>
                      )}
                    </td>}
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

export default UserManagement;
