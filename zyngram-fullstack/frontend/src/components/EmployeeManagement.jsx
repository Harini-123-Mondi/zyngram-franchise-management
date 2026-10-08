import React, { useState, useEffect } from 'react';
import axios from 'axios';

function EmployeeManagement({ onNavigate }) {
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [franchises, setFranchises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [error, setError] = useState('');
  const [designationError, setDesignationError] = useState('');
  const [notice, setNotice] = useState('');
  
  // Filters
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [designationFilter, setDesignationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [franchiseFilter, setFranchiseFilter] = useState('');
  
  // Form data
  const [formData, setFormData] = useState({
    employee_id: '',
    zin_id: '',
    name: '',
    profile_photo: '',
    mobile: '',
    email: '',
    date_of_birth: '',
    gender: '',
    address: '',
    state: '',
    district: '',
    department_id: '',
    designation_id: '',
    employment_type: '',
    joining_date: '',
    reporting_manager_id: '',
    work_location_id: '',
    franchise_id: ''
  });

  useEffect(() => {
    fetchEmployees();
    fetchDepartments();
    fetchDesignations();
    fetchFranchises();
  }, [search, departmentFilter, designationFilter, statusFilter, franchiseFilter]);

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = {};
      if (search) params.search = search;
      if (departmentFilter) params.department_id = departmentFilter;
      if (designationFilter) params.designation_id = designationFilter;
      if (statusFilter) params.status = statusFilter;
      if (franchiseFilter) params.franchise_id = franchiseFilter;

      const response = await axios.get('/api/employees', {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });
      setEmployees(response.data.employees || []);
    } catch (err) {
      console.error('Failed to fetch employees:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/departments', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDepartments(response.data);
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    }
  };

  const fetchDesignations = async () => {
    setDesignationError('');
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/designations', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDesignations(response.data);
    } catch (err) {
      console.error('Failed to fetch designations:', err);
      setDesignationError(err.response?.data?.error || 'Could not load designations.');
    }
  };

  const fetchFranchises = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/franchises', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setFranchises(response.data);
    } catch (err) {
      console.error('Failed to fetch franchises:', err);
    }
  };

  const handleCreateEmployee = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post('/api/employees', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotice(`${response.data.message} (${formData.employee_id})`);
      setShowCreateForm(false);
      setFormData({
        employee_id: '', zin_id: '', name: '', mobile: '', email: '',
          profile_photo: '',
        date_of_birth: '', gender: '', address: '', state: '', district: '',
        department_id: '', designation_id: '', employment_type: '',
        joining_date: '', reporting_manager_id: '', work_location_id: '', franchise_id: ''
      });
      setSearch('');
      setDepartmentFilter('');
      setDesignationFilter('');
      setStatusFilter('');
      setFranchiseFilter('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create employee');
    }
  };

  const handleUpdateEmployee = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const token = localStorage.getItem('token');
      await axios.put(`/api/employees/${selectedEmployee.id}`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowEditForm(false);
      setSelectedEmployee(null);
      fetchEmployees();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update employee');
    }
  };

  const handleEditClick = (employee) => {
    setSelectedEmployee(employee);
    setFormData({
      employee_id: employee.employee_id,
      zin_id: employee.zin_id || '',
      name: employee.name,
      profile_photo: employee.profile_photo || '',
      mobile: employee.mobile,
      email: employee.email,
      date_of_birth: employee.date_of_birth || '',
      gender: employee.gender || '',
      address: employee.address || '',
      state: employee.state || '',
      district: employee.district || '',
      department_id: employee.department_id || '',
      designation_id: employee.designation_id || '',
      employment_type: employee.employment_type || '',
      joining_date: employee.joining_date,
      reporting_manager_id: employee.reporting_manager_id || '',
      work_location_id: employee.work_location_id || '',
      franchise_id: employee.franchise_id || ''
    });
    setShowEditForm(true);
  };

  const handleStatusChange = async (employeeId, newStatus) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(`/api/employees/${employeeId}/status`, { status: newStatus }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchEmployees();
    } catch (err) {
      alert('Failed to update status: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleProfilePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPG, PNG, or WebP profile photo.');
      event.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Choose an image smaller than 5 MB.');
      event.target.value = '';
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 800 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          setError('Could not process this profile photo. Please choose another image.');
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setFormData((current) => ({ ...current, profile_photo: canvas.toDataURL('image/jpeg', 0.82) }));
      };
      image.onerror = () => setError('Could not read this profile photo. Please choose another image.');
      image.src = String(reader.result);
    };
    reader.onerror = () => setError('Could not read this profile photo. Please choose another image.');
    reader.readAsDataURL(file);
  };

  return (
    <div className="employee-management">
      <div className="section-header">
        <div>
          <h2>Employee Management</h2>
          <p>Manage employees within your franchise scope</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreateForm(true)}>+ Add Employee</button>
      </div>
      {notice && <div className="geo-notice" role="status">{notice}</div>}

      {(showCreateForm || showEditForm) && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{showCreateForm ? 'Create New Employee' : 'Edit Employee'}</h3>
              <button onClick={() => { setShowCreateForm(false); setShowEditForm(false); setSelectedEmployee(null); }}>×</button>
            </div>
            {error && <div className="error">{error}</div>}
            <form onSubmit={showCreateForm ? handleCreateEmployee : handleUpdateEmployee}>
              <div className="form-grid">
                <div className="form-group employee-photo-field">
                  <label htmlFor="employee-profile-photo">Profile Picture</label>
                  <input
                    id="employee-profile-photo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleProfilePhotoChange}
                  />
                  <small className="field-hint">JPG, PNG, or WebP; up to 5 MB. Images are resized before saving.</small>
                  {formData.profile_photo && (
                    <div className="employee-photo-preview">
                      <img src={formData.profile_photo} alt="Employee profile preview" />
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setFormData((current) => ({ ...current, profile_photo: '' }))}>
                        Remove photo
                      </button>
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label>Employee ID *</label>
                  <input
                    type="text"
                    value={formData.employee_id}
                    onChange={(e) => setFormData({...formData, employee_id: e.target.value})}
                    required
                    disabled={showEditForm}
                  />
                </div>
                <div className="form-group">
                  <label>ZIN ID</label>
                  <input
                    type="text"
                    value={formData.zin_id}
                    onChange={(e) => setFormData({...formData, zin_id: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Mobile *</label>
                  <input
                    type="text"
                    value={formData.mobile}
                    onChange={(e) => setFormData({...formData, mobile: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Email *</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Date of Birth</label>
                  <input
                    type="date"
                    value={formData.date_of_birth}
                    onChange={(e) => setFormData({...formData, date_of_birth: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Gender</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({...formData, gender: e.target.value})}
                  >
                    <option value="">Select</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Department</label>
                  <select
                    value={formData.department_id}
                    onChange={(e) => setFormData({...formData, department_id: e.target.value})}
                  >
                    <option value="">Select</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Designation</label>
                  <select
                    value={formData.designation_id}
                    onChange={(e) => setFormData({...formData, designation_id: e.target.value})}
                  >
                    <option value="">Select</option>
                    {designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  {designationError && <small className="field-hint" role="alert">{designationError}</small>}
                  {!designationError && designations.length === 0 && (
                    <small className="field-hint">
                      No designations have been added yet. Create one under Departments → Designations.
                      <button type="button" className="btn-secondary btn-sm" onClick={() => onNavigate?.('departments')}>
                        Manage designations
                      </button>
                    </small>
                  )}
                </div>
                <div className="form-group">
                  <label>Employment Type</label>
                  <select
                    value={formData.employment_type}
                    onChange={(e) => setFormData({...formData, employment_type: e.target.value})}
                  >
                    <option value="">Select</option>
                    <option value="Full-time">Full-time</option>
                    <option value="Part-time">Part-time</option>
                    <option value="Contract">Contract</option>
                    <option value="Intern">Intern</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Joining Date *</label>
                  <input
                    type="date"
                    value={formData.joining_date}
                    onChange={(e) => setFormData({...formData, joining_date: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Franchise</label>
                  <select
                    value={formData.franchise_id}
                    onChange={(e) => setFormData({...formData, franchise_id: e.target.value})}
                  >
                    <option value="">Select</option>
                    {franchises.map(f => <option key={f.id} value={f.id}>{f.id} - {f.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Address</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({...formData, address: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={(e) => setFormData({...formData, state: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>District</label>
                  <input
                    type="text"
                    value={formData.district}
                    onChange={(e) => setFormData({...formData, district: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn-primary">{showCreateForm ? 'Create Employee' : 'Update Employee'}</button>
                <button type="button" onClick={() => { setShowCreateForm(false); setShowEditForm(false); setSelectedEmployee(null); }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="filters-bar">
        <input
          type="text"
          placeholder="Search by ID, name, mobile, or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={designationFilter} onChange={(e) => setDesignationFilter(e.target.value)}>
          <option value="">{designations.length ? 'All Designations' : 'No designations created'}</option>
          {designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {designationError && <small className="field-hint" role="alert">{designationError}</small>}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="RESIGNED">Resigned</option>
          <option value="TERMINATED">Terminated</option>
        </select>
        <select value={franchiseFilter} onChange={(e) => setFranchiseFilter(e.target.value)}>
          <option value="">All Franchises</option>
          {franchises.map(f => <option key={f.id} value={f.id}>{f.id}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="loading">Loading employees...</div>
      ) : (
        <div className="table-container employee-table-container">
          <table className="employee-data-table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Mobile</th>
                <th>Email</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Franchise</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan="9" className="empty">
                    No employees found.
                    {(search || departmentFilter || designationFilter || statusFilter || franchiseFilter) && (
                      <span> Current filters may be hiding employees. <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => {
                          setSearch('');
                          setDepartmentFilter('');
                          setDesignationFilter('');
                          setStatusFilter('');
                          setFranchiseFilter('');
                        }}
                      >Clear filters</button></span>
                    )}
                  </td>
                </tr>
              ) : (
                employees.map((employee) => (
                  <tr key={employee.id}>
                    <td>{employee.employee_id}</td>
                    <td>
                      <span className="employee-name-cell">
                        {employee.profile_photo && <img src={employee.profile_photo} alt="" className="employee-avatar" />}
                        {employee.name}
                      </span>
                    </td>
                    <td>{employee.mobile}</td>
                    <td>{employee.email}</td>
                    <td>{departments.find(d => d.id === employee.department_id)?.name || '-'}</td>
                    <td>{designations.find(d => d.id === employee.designation_id)?.name || '-'}</td>
                    <td>{employee.franchise_id || '-'}</td>
                    <td>
                      <span className={`status ${employee.status.toLowerCase()}`}>{employee.status}</span>
                    </td>
                    <td className="employee-actions-cell">
                      <div className="employee-row-actions">
                        <button
                          type="button"
                          onClick={() => handleEditClick(employee)}
                          className="employee-edit-button"
                        >
                          Edit profile
                        </button>
                        <select 
                          value={employee.status}
                          onChange={(e) => handleStatusChange(employee.id, e.target.value)}
                          className="employee-status-action"
                          aria-label={`Change status for ${employee.name}`}
                          title="Change employee status"
                        >
                          <option value="ACTIVE">Active</option>
                          <option value="INACTIVE">Inactive</option>
                          <option value="RESIGNED">Resigned</option>
                          <option value="TERMINATED">Terminated</option>
                        </select>
                      </div>
                    </td>
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

export default EmployeeManagement;
