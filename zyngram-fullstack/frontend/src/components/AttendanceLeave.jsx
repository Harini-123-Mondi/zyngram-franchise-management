import React, { useState, useEffect } from 'react';
import axios from 'axios';

function AttendanceLeave({ onNavigate }) {
  const [activeTab, setActiveTab] = useState('attendance');
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [attendanceEmployeeId, setAttendanceEmployeeId] = useState('');
  const [error, setError] = useState('');
  const [employeesError, setEmployeesError] = useState('');
  const [notice, setNotice] = useState('');
  
  const [leaveFormData, setLeaveFormData] = useState({
    employee_id: '',
    leave_type: '',
    start_date: '',
    end_date: '',
    reason: ''
  });

  useEffect(() => {
    fetchAttendance();
    fetchLeaves();
    fetchEmployees();
  }, []);

  const fetchAttendance = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/attendance', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAttendance(response.data);
    } catch (err) {
      console.error('Failed to fetch attendance:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaves = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/leaves', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLeaves(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load leave requests');
    }
  };

  const fetchEmployees = async () => {
    setEmployeesLoading(true);
    setEmployeesError('');
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/employees', {
        params: { status: 'ACTIVE', limit: 100 },
        headers: { Authorization: `Bearer ${token}` }
      });
      setEmployees(response.data.employees || []);
    } catch (err) {
      setEmployeesError(err.response?.data?.error || 'Could not load employees.');
    } finally {
      setEmployeesLoading(false);
    }
  };

  const handleCheckIn = async (employeeId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post('/api/attendance/check-in', { employee_id: employeeId }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchAttendance();
      alert('Checked in successfully');
    } catch (err) {
      alert('Check-in failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleCheckOut = async (employeeId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post('/api/attendance/check-out', { employee_id: employeeId }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchAttendance();
      alert('Checked out successfully');
    } catch (err) {
      alert('Check-out failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleLeaveSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!employees.length) {
      setError('Create an active employee first, then submit a leave request.');
      return;
    }
    
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post('/api/leaves', leaveFormData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowLeaveForm(false);
      setLeaveFormData({ employee_id: '', leave_type: '', start_date: '', end_date: '', reason: '' });
      setNotice(response.data.message);
      await fetchLeaves();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create leave request');
    }
  };

  const handleApproveLeave = async (leaveId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(`/api/leaves/${leaveId}/approve`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchLeaves();
    } catch (err) {
      alert('Failed to approve: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRejectLeave = async (leaveId) => {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;
    
    try {
      const token = localStorage.getItem('token');
      await axios.patch(`/api/leaves/${leaveId}/reject`, { rejection_reason: reason }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchLeaves();
    } catch (err) {
      alert('Failed to reject: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="attendance-leave">
      <div className="section-header">
        <div>
          <h2>Attendance & Leave</h2>
          <p>Manage employee attendance and leave requests</p>
        </div>
      </div>

      <div className="tabs">
        <button 
          className={activeTab === 'attendance' ? 'active' : ''}
          onClick={() => setActiveTab('attendance')}
        >
          Attendance
        </button>
        <button 
          className={activeTab === 'leaves' ? 'active' : ''}
          onClick={() => setActiveTab('leaves')}
        >
          Leave Requests
        </button>
      </div>

      {activeTab === 'attendance' && (
        <div className="tab-content">
          <div className="section-header">
            <h3>Attendance Records</h3>
          </div>
          {employeesError && <div className="error" role="alert">{employeesError}</div>}
          {!employeesLoading && !employeesError && employees.length === 0 && (
            <div className="geo-notice" role="status">
              No active employees found. Add an employee before recording attendance.
              <button className="btn-secondary btn-sm" onClick={() => onNavigate?.('employees')}>Go to Employees</button>
            </div>
          )}
          {employees.length > 0 && (
            <div className="filters-bar">
              <select
                value={attendanceEmployeeId}
                onChange={(e) => setAttendanceEmployeeId(e.target.value)}
                aria-label="Employee to check in"
                disabled={employeesLoading}
              >
                <option value="">Select employee to check in</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name} ({employee.employee_id})
                  </option>
                ))}
              </select>
              <button
                className="btn-primary"
                onClick={() => handleCheckIn(attendanceEmployeeId)}
                disabled={!attendanceEmployeeId || employeesLoading}
              >
                Check In Employee
              </button>
            </div>
          )}

          {loading ? (
            <div className="loading">Loading attendance...</div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Employee</th>
                    <th>Check In</th>
                    <th>Check Out</th>
                    <th>Working Hours</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.length === 0 ? (
                    <tr><td colSpan="7" className="empty">No attendance records found</td></tr>
                  ) : (
                    attendance.map((att) => (
                      <tr key={att.id}>
                        <td>{att.date}</td>
                        <td>{att.employee_name || att.emp_id}</td>
                        <td>{att.check_in_time ? new Date(att.check_in_time).toLocaleTimeString() : '-'}</td>
                        <td>{att.check_out_time ? new Date(att.check_out_time).toLocaleTimeString() : '-'}</td>
                        <td>{att.working_hours || '-'}</td>
                        <td>
                          <span className={`status ${att.attendance_status?.toLowerCase() || 'active'}`}>{att.attendance_status || 'PRESENT'}</span>
                        </td>
                        <td>
                          {!att.check_in_time && (
                            <button onClick={() => handleCheckIn(att.employee_id)} className="btn-sm">Check In</button>
                          )}
                          {att.check_in_time && !att.check_out_time && (
                            <button onClick={() => handleCheckOut(att.employee_id)} className="btn-sm">Check Out</button>
                          )}
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

      {activeTab === 'leaves' && (
        <div className="tab-content">
          <div className="section-header">
            <h3>Leave Requests</h3>
            <button
              className="btn-primary"
              onClick={() => { setError(''); setShowLeaveForm(true); }}
              disabled={employeesLoading || employees.length === 0}
            >
              {employeesLoading ? 'Loading employees…' : '+ Request Leave'}
            </button>
          </div>
          {employeesError && <div className="error" role="alert">{employeesError}</div>}
          {!employeesLoading && !employeesError && employees.length === 0 && (
            <div className="geo-notice" role="status">
              No active employees found. Add an employee in Employees before requesting leave.
              <button className="btn-secondary btn-sm" onClick={() => onNavigate?.('employees')}>Go to Employees</button>
            </div>
          )}
          {notice && <div className="geo-notice" role="status">{notice}</div>}
          {error && !showLeaveForm && <div className="error" role="alert">{error}</div>}

          {showLeaveForm && (
            <div className="modal-overlay">
              <div className="modal">
                <div className="modal-header">
                  <h3>Request Leave</h3>
                  <button onClick={() => setShowLeaveForm(false)}>×</button>
                </div>
                {error && <div className="error">{error}</div>}
                <form onSubmit={handleLeaveSubmit}>
                  <div className="form-group">
                    <label>Employee *</label>
                    <select
                      value={leaveFormData.employee_id}
                      onChange={(e) => setLeaveFormData({...leaveFormData, employee_id: e.target.value})}
                      required
                    >
                      <option value="">{employeesLoading ? 'Loading employees…' : 'Select Employee'}</option>
                      {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_id})</option>)}
                    </select>
                    {!employeesLoading && !employeesError && employees.length === 0 && (
                      <small className="field-hint">Create an active employee before requesting leave.</small>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Leave Type *</label>
                    <select
                      value={leaveFormData.leave_type}
                      onChange={(e) => setLeaveFormData({...leaveFormData, leave_type: e.target.value})}
                      required
                    >
                      <option value="">Select Type</option>
                      <option value="Sick Leave">Sick Leave</option>
                      <option value="Casual Leave">Casual Leave</option>
                      <option value="Earned Leave">Earned Leave</option>
                      <option value="Maternity Leave">Maternity Leave</option>
                      <option value="Paternity Leave">Paternity Leave</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Start Date *</label>
                    <input
                      type="date"
                      value={leaveFormData.start_date}
                      onChange={(e) => setLeaveFormData({
                        ...leaveFormData,
                        start_date: e.target.value,
                        end_date: leaveFormData.end_date && e.target.value > leaveFormData.end_date ? e.target.value : leaveFormData.end_date
                      })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>End Date *</label>
                    <input
                      type="date"
                      value={leaveFormData.end_date}
                      onChange={(e) => setLeaveFormData({...leaveFormData, end_date: e.target.value})}
                      min={leaveFormData.start_date || undefined}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Reason</label>
                    <textarea
                      value={leaveFormData.reason}
                      onChange={(e) => setLeaveFormData({...leaveFormData, reason: e.target.value})}
                      rows={3}
                    />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn-primary" disabled={employeesLoading || employees.length === 0}>Submit Request</button>
                    <button type="button" onClick={() => setShowLeaveForm(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {loading ? (
            <div className="loading">Loading leave requests...</div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Leave Type</th>
                    <th>Start Date</th>
                    <th>End Date</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.length === 0 ? (
                    <tr><td colSpan="7" className="empty">No leave requests found</td></tr>
                  ) : (
                    leaves.map((leave) => (
                      <tr key={leave.id}>
                        <td>{leave.employee_name || leave.emp_id}</td>
                        <td>{leave.leave_type}</td>
                        <td>{leave.start_date}</td>
                        <td>{leave.end_date}</td>
                        <td>{leave.reason || '-'}</td>
                        <td>
                          <span className={`status ${leave.status.toLowerCase()}`}>{leave.status}</span>
                        </td>
                        <td>
                          {leave.status === 'PENDING' && (
                            <>
                              <button onClick={() => handleApproveLeave(leave.id)} className="btn-sm">Approve</button>
                              <button onClick={() => handleRejectLeave(leave.id)} className="btn-sm btn-danger">Reject</button>
                            </>
                          )}
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

export default AttendanceLeave;
