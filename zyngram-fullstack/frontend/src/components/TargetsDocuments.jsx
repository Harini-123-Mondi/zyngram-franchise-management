import React, { useState, useEffect } from 'react';
import axios from 'axios';

function TargetsDocuments() {
  const [activeTab, setActiveTab] = useState('targets');
  const [targets, setTargets] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const [error, setError] = useState('');
  const [targetUpdateError, setTargetUpdateError] = useState('');
  const [documentError, setDocumentError] = useState('');
  const [documentNotice, setDocumentNotice] = useState('');
  const [docFile, setDocFile] = useState(null);
  
  const [targetFormData, setTargetFormData] = useState({
    employee_id: '',
    department_id: '',
    designation_id: '',
    target_period: '',
    target_type: '',
    target_value: ''
  });
  
  const [docFormData, setDocFormData] = useState({
    employee_id: '',
    document_type: '',
    document_name: '',
    file_path: '',
    expiry_date: ''
  });

  useEffect(() => {
    fetchTargets();
    fetchDocuments();
    fetchEmployees();
  }, []);

  const fetchTargets = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/targets', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTargets(response.data);
    } catch (err) {
      console.error('Failed to fetch targets:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDocuments = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/employees/all/documents', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDocuments(response.data || []);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      setDocumentError(err.response?.data?.error || 'Failed to load employee documents.');
    }
  };

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/employees', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setEmployees(response.data.employees || []);
    } catch (err) {
      console.error('Failed to fetch employees:', err);
    }
  };

  const handleTargetSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const token = localStorage.getItem('token');
      await axios.post('/api/targets', targetFormData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowTargetForm(false);
      setTargetFormData({ employee_id: '', department_id: '', designation_id: '', target_period: '', target_type: '', target_value: '' });
      fetchTargets();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create target');
    }
  };

  const handleTargetUpdate = async (target) => {
    const achievementInput = prompt('Enter achievement:', String(target.achievement || 0));
    if (achievementInput === null) return;

    const achievement = Number(achievementInput);
    if (!achievementInput.trim() || !Number.isFinite(achievement) || achievement < 0) {
      setTargetUpdateError('Enter a valid achievement of 0 or more.');
      return;
    }

    setTargetUpdateError('');
    try {
      const token = localStorage.getItem('token');
      await axios.put(`/api/targets/${target.id}`, { achievement }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      await fetchTargets();
    } catch (err) {
      setTargetUpdateError(err.response?.data?.error || 'Failed to update target.');
    }
  };

  const handleDocSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setDocumentNotice('');
    if (!docFile) {
      setError('Choose a document file before uploading.');
      return;
    }
    
    try {
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the selected file.'));
        reader.readAsDataURL(docFile);
      });
      const token = localStorage.getItem('token');
      await axios.post(`/api/employees/${docFormData.employee_id}/documents`, {
        ...docFormData,
        file_data: fileData,
        document_name: docFormData.document_name || docFile.name
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowDocForm(false);
      setDocFormData({ employee_id: '', document_type: '', document_name: '', file_path: '', expiry_date: '' });
      setDocFile(null);
      setDocumentNotice('Document uploaded successfully.');
      fetchDocuments();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload document');
    }
  };

  const handleDocumentFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setError('');
    if (file && file.size > 5 * 1024 * 1024) {
      setDocFile(null);
      event.target.value = '';
      setError('Document must be 5 MB or smaller.');
      return;
    }
    setDocFile(file);
    setDocFormData((current) => ({
      ...current,
      document_name: current.document_name || file?.name || ''
    }));
  };

  const handleDownloadDoc = async (doc) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/documents/${doc.id}/download`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${token}` }
      });
      const objectUrl = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = doc.document_name || `${doc.document_type}-document`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      setDocumentError(err.response?.data?.error || 'Failed to download document');
    }
  };

  const handleDeleteDoc = async (docId) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/documents/${docId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchDocuments();
    } catch (err) {
      alert('Failed to delete document: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="targets-documents">
      <div className="section-header">
        <div>
          <h2>Targets & Documents</h2>
          <p>Manage employee targets and documents</p>
        </div>
      </div>

      <div className="tabs">
        <button 
          className={activeTab === 'targets' ? 'active' : ''}
          onClick={() => setActiveTab('targets')}
        >
          Targets & KPIs
        </button>
        <button 
          className={activeTab === 'documents' ? 'active' : ''}
          onClick={() => setActiveTab('documents')}
        >
          Documents
        </button>
      </div>

      {activeTab === 'targets' && (
        <div className="tab-content">
          <div className="section-header">
            <h3>Employee Targets</h3>
            <button className="btn-primary" onClick={() => setShowTargetForm(true)}>+ Add Target</button>
          </div>
          {targetUpdateError && <div className="error" role="alert">{targetUpdateError}</div>}

          {showTargetForm && (
            <div className="modal-overlay">
              <div className="modal">
                <div className="modal-header">
                  <h3>Create Target</h3>
                  <button onClick={() => setShowTargetForm(false)}>×</button>
                </div>
                {error && <div className="error">{error}</div>}
                <form onSubmit={handleTargetSubmit}>
                  <div className="form-group">
                    <label>Employee *</label>
                    <select
                      value={targetFormData.employee_id}
                      onChange={(e) => setTargetFormData({...targetFormData, employee_id: e.target.value})}
                      required
                    >
                      <option value="">Select Employee</option>
                      {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_id})</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Target Period *</label>
                    <select
                      value={targetFormData.target_period}
                      onChange={(e) => setTargetFormData({...targetFormData, target_period: e.target.value})}
                      required
                    >
                      <option value="">Select Period</option>
                      <option value="Monthly">Monthly</option>
                      <option value="Quarterly">Quarterly</option>
                      <option value="Yearly">Yearly</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Target Type *</label>
                    <select
                      value={targetFormData.target_type}
                      onChange={(e) => setTargetFormData({...targetFormData, target_type: e.target.value})}
                      required
                    >
                      <option value="">Select Type</option>
                      <option value="Sales">Sales</option>
                      <option value="Revenue">Revenue</option>
                      <option value="Customer Acquisition">Customer Acquisition</option>
                      <option value="Productivity">Productivity</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Target Value *</label>
                    <input
                      type="number"
                      value={targetFormData.target_value}
                      onChange={(e) => setTargetFormData({...targetFormData, target_value: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn-primary">Create Target</button>
                    <button type="button" onClick={() => setShowTargetForm(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {loading ? (
            <div className="loading">Loading targets...</div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Period</th>
                    <th>Type</th>
                    <th>Target</th>
                    <th>Achievement</th>
                    <th>Achievement %</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.length === 0 ? (
                    <tr><td colSpan="8" className="empty">No targets found</td></tr>
                  ) : (
                    targets.map((target) => (
                      <tr key={target.id}>
                        <td>{target.employee_name || target.emp_id}</td>
                        <td>{target.target_period}</td>
                        <td>{target.target_type}</td>
                        <td>{target.target_value.toLocaleString()}</td>
                        <td>{target.achievement?.toLocaleString() || 0}</td>
                        <td>
                          <span className={`badge ${target.achievement_percentage >= 100 ? 'success' : target.achievement_percentage >= 50 ? 'warning' : 'danger'}`}>
                            {target.achievement_percentage || 0}%
                          </span>
                        </td>
                        <td>
                          <span className={`status ${target.status?.toLowerCase() || 'active'}`}>{target.status || 'ACTIVE'}</span>
                        </td>
                        <td>
                          <button type="button" onClick={() => handleTargetUpdate(target)} className="btn-sm">Update</button>
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

      {activeTab === 'documents' && (
        <div className="tab-content">
          <div className="section-header">
            <h3>Employee Documents</h3>
            <button
              className="btn-primary"
              onClick={() => {
                setError('');
                setDocumentError('');
                setDocumentNotice('');
                setDocFile(null);
                setShowDocForm(true);
              }}
            >
              + Upload Document
            </button>
          </div>
          {documentNotice && <div className="geo-notice" role="status">{documentNotice}</div>}
          {documentError && <div className="error" role="alert">{documentError}</div>}

          {showDocForm && (
            <div className="modal-overlay">
              <div className="modal">
                <div className="modal-header">
                  <h3>Upload Document</h3>
                  <button type="button" onClick={() => { setShowDocForm(false); setDocFile(null); }}>×</button>
                </div>
                {error && <div className="error">{error}</div>}
                <form onSubmit={handleDocSubmit}>
                  <div className="form-group">
                    <label>Employee *</label>
                    <select
                      value={docFormData.employee_id}
                      onChange={(e) => setDocFormData({...docFormData, employee_id: e.target.value})}
                      required
                    >
                      <option value="">Select Employee</option>
                      {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_id})</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Document Type *</label>
                    <select
                      value={docFormData.document_type}
                      onChange={(e) => setDocFormData({...docFormData, document_type: e.target.value})}
                      required
                    >
                      <option value="">Select Type</option>
                      <option value="ID Proof">ID Proof</option>
                      <option value="Address Proof">Address Proof</option>
                      <option value="Qualification">Qualification</option>
                      <option value="Offer Letter">Offer Letter</option>
                      <option value="Experience Letter">Experience Letter</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Document Name</label>
                    <input
                      type="text"
                      value={docFormData.document_name}
                      onChange={(e) => setDocFormData({...docFormData, document_name: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="employee-document-file">Document File * (PDF, JPG, PNG, or WebP; max 5 MB)</label>
                    <input
                      id="employee-document-file"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                      onChange={handleDocumentFileChange}
                      required
                    />
                    {docFile && <small className="field-hint">Selected: {docFile.name}</small>}
                  </div>
                  <div className="form-group">
                    <label>Expiry Date</label>
                    <input
                      type="date"
                      value={docFormData.expiry_date}
                      onChange={(e) => setDocFormData({...docFormData, expiry_date: e.target.value})}
                    />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn-primary">Upload Document</button>
                    <button type="button" onClick={() => { setShowDocForm(false); setDocFile(null); }}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {loading ? (
            <div className="loading">Loading documents...</div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Document Type</th>
                    <th>Document Name</th>
                    <th>Expiry Date</th>
                    <th>Status</th>
                    <th>Uploaded At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.length === 0 ? (
                    <tr><td colSpan="7" className="empty">No documents found</td></tr>
                  ) : (
                    documents.map((doc) => (
                      <tr key={doc.id}>
                        <td>{doc.employee_name || doc.employee_code || '-'}</td>
                        <td>{doc.document_type}</td>
                        <td>{doc.document_name || '-'}</td>
                        <td>{doc.expiry_date || '-'}</td>
                        <td>
                          <span className={`status ${doc.status?.toLowerCase() || 'pending'}`}>{doc.status || 'PENDING'}</span>
                        </td>
                        <td>{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                        <td>
                          <button onClick={() => handleDownloadDoc(doc)} className="btn-sm">Download</button>
                          <button onClick={() => handleDeleteDoc(doc.id)} className="btn-sm btn-danger">Delete</button>
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

export default TargetsDocuments;
