import React, { useState, useEffect } from 'react';
import axios from 'axios';

function DepartmentDesignation() {
  const [activeTab, setActiveTab] = useState('departments');
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [showDesigForm, setShowDesigForm] = useState(false);
  const [selectedDesignation, setSelectedDesignation] = useState(null);
  const [error, setError] = useState('');
  const [designationNotice, setDesignationNotice] = useState('');
  
  const [deptFormData, setDeptFormData] = useState({ name: '', description: '' });
  const [desigFormData, setDesigFormData] = useState({ name: '', department_id: '', description: '' });

  useEffect(() => {
    fetchDepartments();
    fetchDesignations();
  }, []);

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/departments', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDepartments(response.data);
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDesignations = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/designations', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDesignations(response.data);
    } catch (err) {
      console.error('Failed to fetch designations:', err);
    }
  };

  const handleCreateDepartment = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const token = localStorage.getItem('token');
      await axios.post('/api/departments', deptFormData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowDeptForm(false);
      setDeptFormData({ name: '', description: '' });
      fetchDepartments();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create department');
    }
  };

  const handleCreateDesignation = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const token = localStorage.getItem('token');
      await axios.post('/api/designations', desigFormData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowDesigForm(false);
      setDesigFormData({ name: '', department_id: '', description: '' });
      setDesignationNotice('Designation created successfully.');
      await fetchDesignations();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create designation');
    }
  };

  const handleEditDesignation = (designation) => {
    setSelectedDesignation(designation);
    setDesigFormData({
      name: designation.name,
      department_id: designation.department_id || '',
      description: designation.description || ''
    });
    setError('');
    setDesignationNotice('');
    setShowDesigForm(true);
  };

  const handleUpdateDesignation = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const token = localStorage.getItem('token');
      await axios.put(`/api/designations/${selectedDesignation.id}`, desigFormData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowDesigForm(false);
      setSelectedDesignation(null);
      setDesigFormData({ name: '', department_id: '', description: '' });
      setDesignationNotice('Designation details updated successfully.');
      await fetchDesignations();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update designation');
    }
  };

  const closeDesignationForm = () => {
    setShowDesigForm(false);
    setSelectedDesignation(null);
    setDesigFormData({ name: '', department_id: '', description: '' });
    setError('');
  };

  const handleDeptStatusChange = async (id, status) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(`/api/departments/${id}/status`, { status }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchDepartments();
    } catch (err) {
      alert('Failed to update status: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDesigStatusChange = async (id, status) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(`/api/designations/${id}/status`, { status }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchDesignations();
    } catch (err) {
      alert('Failed to update status: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="department-designation">
      <div className="section-header">
        <div>
          <h2>Departments & Designations</h2>
          <p>Manage organizational structure</p>
        </div>
      </div>

      <div className="tabs">
        <button 
          className={activeTab === 'departments' ? 'active' : ''}
          onClick={() => setActiveTab('departments')}
        >
          Departments
        </button>
        <button 
          className={activeTab === 'designations' ? 'active' : ''}
          onClick={() => setActiveTab('designations')}
        >
          Designations
        </button>
      </div>

      {activeTab === 'departments' && (
        <div className="tab-content">
          <div className="section-header">
            <h3>Departments</h3>
            <button className="btn-primary" onClick={() => setShowDeptForm(true)}>+ Add Department</button>
          </div>

          {showDeptForm && (
            <div className="modal-overlay">
              <div className="modal">
                <div className="modal-header">
                  <h3>Create Department</h3>
                  <button onClick={() => setShowDeptForm(false)}>×</button>
                </div>
                {error && <div className="error">{error}</div>}
                <form onSubmit={handleCreateDepartment}>
                  <div className="form-group">
                    <label>Department Name *</label>
                    <input
                      type="text"
                      value={deptFormData.name}
                      onChange={(e) => setDeptFormData({...deptFormData, name: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      value={deptFormData.description}
                      onChange={(e) => setDeptFormData({...deptFormData, description: e.target.value})}
                      rows={3}
                    />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn-primary">Create Department</button>
                    <button type="button" onClick={() => setShowDeptForm(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {loading ? (
            <div className="loading">Loading departments...</div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Created At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.length === 0 ? (
                    <tr><td colSpan="5" className="empty">No departments found</td></tr>
                  ) : (
                    departments.map((dept) => (
                      <tr key={dept.id}>
                        <td>{dept.name}</td>
                        <td>{dept.description || '-'}</td>
                        <td>
                          <span className={`status ${dept.status.toLowerCase()}`}>{dept.status}</span>
                        </td>
                        <td>{new Date(dept.created_at).toLocaleDateString()}</td>
                        <td>
                          <select 
                            value={dept.status}
                            onChange={(e) => handleDeptStatusChange(dept.id, e.target.value)}
                            className="status-select"
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="INACTIVE">Inactive</option>
                          </select>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'designations' && (
        <div className="tab-content">
          <div className="section-header">
            <h3>Designations</h3>
            <button
              className="btn-primary"
              onClick={() => {
                setSelectedDesignation(null);
                setDesigFormData({ name: '', department_id: '', description: '' });
                setError('');
                setDesignationNotice('');
                setShowDesigForm(true);
              }}
            >
              + Add Designation
            </button>
          </div>
          {designationNotice && <div className="geo-notice" role="status">{designationNotice}</div>}

          {showDesigForm && (
            <div className="modal-overlay">
              <div className="modal">
                <div className="modal-header">
                  <h3>{selectedDesignation ? 'Edit Designation' : 'Create Designation'}</h3>
                  <button type="button" onClick={closeDesignationForm}>×</button>
                </div>
                {error && <div className="error">{error}</div>}
                <form onSubmit={selectedDesignation ? handleUpdateDesignation : handleCreateDesignation}>
                  <div className="form-group">
                    <label>Designation Name *</label>
                    <input
                      type="text"
                      value={desigFormData.name}
                      onChange={(e) => setDesigFormData({...desigFormData, name: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Department</label>
                    <select
                      value={desigFormData.department_id}
                      onChange={(e) => setDesigFormData({...desigFormData, department_id: e.target.value})}
                    >
                      <option value="">Select Department</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      value={desigFormData.description}
                      onChange={(e) => setDesigFormData({...desigFormData, description: e.target.value})}
                      rows={3}
                    />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn-primary">
                      {selectedDesignation ? 'Save Changes' : 'Create Designation'}
                    </button>
                    <button type="button" onClick={closeDesignationForm}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {loading ? (
            <div className="loading">Loading designations...</div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Created At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {designations.length === 0 ? (
                    <tr><td colSpan="6" className="empty">No designations found</td></tr>
                  ) : (
                    designations.map((desig) => (
                      <tr key={desig.id}>
                        <td>{desig.name}</td>
                        <td>{departments.find(d => d.id === desig.department_id)?.name || '-'}</td>
                        <td>{desig.description || '-'}</td>
                        <td>
                          <span className={`status ${desig.status.toLowerCase()}`}>{desig.status}</span>
                        </td>
                        <td>{new Date(desig.created_at).toLocaleDateString()}</td>
                        <td>
                          <button onClick={() => handleEditDesignation(desig)} className="btn-sm">
                            Edit
                          </button>
                          <select 
                            value={desig.status}
                            onChange={(e) => handleDesigStatusChange(desig.id, e.target.value)}
                            className="status-select"
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="INACTIVE">Inactive</option>
                          </select>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DepartmentDesignation;
