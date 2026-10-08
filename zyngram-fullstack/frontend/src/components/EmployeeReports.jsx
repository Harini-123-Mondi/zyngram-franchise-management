import React, { useState, useEffect } from 'react';
import axios from 'axios';

function EmployeeReports() {
  const [activeTab, setActiveTab] = useState('summary');
  const [summaryData, setSummaryData] = useState(null);
  const [attendanceData, setAttendanceData] = useState(null);
  const [targetData, setTargetData] = useState(null);
  const [franchiseData, setFranchiseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [attendanceFilterError, setAttendanceFilterError] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    fetchSummaryData();
    fetchTargetData();
    fetchFranchiseData();
  }, []);

  const fetchSummaryData = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/reports/employee-summary', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSummaryData(response.data);
    } catch (err) {
      console.error('Failed to fetch summary:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAttendanceData = async () => {
    setAttendanceFilterError('');
    if (startDate && endDate && startDate > endDate) {
      setAttendanceData(null);
      setAttendanceFilterError('Start date must be on or before the end date.');
      return;
    }

    setAttendanceLoading(true);
    setAttendanceError('');
    try {
      const token = localStorage.getItem('token');
      const params = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const response = await axios.get('/api/reports/attendance', {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });
      setAttendanceData(response.data);
    } catch (err) {
      console.error('Failed to fetch attendance report:', err);
      setAttendanceData(null);
      setAttendanceError(err.response?.data?.error || 'Failed to load attendance report.');
    } finally {
      setAttendanceLoading(false);
    }
  };

  const fetchTargetData = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/reports/targets', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTargetData(response.data);
    } catch (err) {
      console.error('Failed to fetch target report:', err);
    }
  };

  const fetchFranchiseData = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/reports/franchise-employees', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setFranchiseData(response.data);
    } catch (err) {
      console.error('Failed to fetch franchise report:', err);
    }
  };

  useEffect(() => {
    if (activeTab === 'attendance') {
      fetchAttendanceData();
    }
  }, [activeTab]);

  return (
    <div className="employee-reports">
      <div className="section-header">
        <div>
          <h2>Employee Reports</h2>
          <p>View comprehensive employee analytics and reports</p>
        </div>
      </div>

      <div className="tabs">
        <button 
          className={activeTab === 'summary' ? 'active' : ''}
          onClick={() => setActiveTab('summary')}
        >
          Employee Summary
        </button>
        <button 
          className={activeTab === 'attendance' ? 'active' : ''}
          onClick={() => setActiveTab('attendance')}
        >
          Attendance Report
        </button>
        <button 
          className={activeTab === 'targets' ? 'active' : ''}
          onClick={() => setActiveTab('targets')}
        >
          Target Achievement
        </button>
        <button 
          className={activeTab === 'franchise' ? 'active' : ''}
          onClick={() => setActiveTab('franchise')}
        >
          Franchise Report
        </button>
      </div>

      {activeTab === 'summary' && (
        <div className="tab-content">
          <h3>Employee Summary</h3>
          {loading ? (
            <div className="loading">Loading summary...</div>
          ) : summaryData ? (
            <div className="stats-grid">
              <div className="stat-card">
                <h4>Total Employees</h4>
                <span className="stat-value">{summaryData.total}</span>
              </div>
              <div className="stat-card success">
                <h4>Active</h4>
                <span className="stat-value">{summaryData.active}</span>
              </div>
              <div className="stat-card warning">
                <h4>Inactive</h4>
                <span className="stat-value">{summaryData.inactive}</span>
              </div>
              <div className="stat-card danger">
                <h4>Resigned</h4>
                <span className="stat-value">{summaryData.resigned}</span>
              </div>
              <div className="stat-card danger">
                <h4>Terminated</h4>
                <span className="stat-value">{summaryData.terminated}</span>
              </div>
            </div>
          ) : (
            <div className="empty">No data available</div>
          )}
        </div>
      )}

      {activeTab === 'attendance' && (
        <div className="tab-content">
          <h3>Attendance Report</h3>
          <div className="filters-bar">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={endDate || undefined}
              placeholder="Start Date"
              aria-label="Start date"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
              placeholder="End Date"
              aria-label="End date"
            />
            <button onClick={fetchAttendanceData} className="btn-primary" disabled={attendanceLoading}>
              {attendanceLoading ? 'Loading…' : 'Apply Filter'}
            </button>
          </div>
          {attendanceFilterError && <div className="error" role="alert">{attendanceFilterError}</div>}
          {attendanceError && <div className="error" role="alert">{attendanceError}</div>}
          {attendanceData?.total === 0 ? (
            <div className="empty" role="status">
              No attendance records found for this date range. Use the Attendance tab to check in an employee, then apply the filter again.
            </div>
          ) : attendanceData ? (
            <div className="stats-grid">
              <div className="stat-card">
                <h4>Total Records</h4>
                <span className="stat-value">{attendanceData.total}</span>
              </div>
              <div className="stat-card success">
                <h4>Present</h4>
                <span className="stat-value">{attendanceData.present}</span>
              </div>
              <div className="stat-card danger">
                <h4>Absent</h4>
                <span className="stat-value">{attendanceData.absent}</span>
              </div>
              <div className="stat-card warning">
                <h4>Half Day</h4>
                <span className="stat-value">{attendanceData.halfDay}</span>
              </div>
              <div className="stat-card info">
                <h4>Leave</h4>
                <span className="stat-value">{attendanceData.leave}</span>
              </div>
              <div className="stat-card">
                <h4>Attendance %</h4>
                <span className="stat-value">{attendanceData.attendancePercentage}%</span>
              </div>
            </div>
          ) : attendanceLoading ? (
            <div className="loading">Loading attendance report…</div>
          ) : (
            !attendanceError && <div className="empty">Select a valid date range to view attendance.</div>
          )}
        </div>
      )}

      {activeTab === 'targets' && (
        <div className="tab-content">
          <h3>Target Achievement Report</h3>
          {targetData ? (
            <div className="stats-grid">
              <div className="stat-card">
                <h4>Total Targets</h4>
                <span className="stat-value">{targetData.total}</span>
              </div>
              <div className="stat-card success">
                <h4>Achieved (≥100%)</h4>
                <span className="stat-value">{targetData.achieved}</span>
              </div>
              <div className="stat-card warning">
                <h4>Below Target (50-99%)</h4>
                <span className="stat-value">{targetData.belowTarget}</span>
              </div>
              <div className="stat-card danger">
                <h4>Poor (&lt;50%)</h4>
                <span className="stat-value">{targetData.poor}</span>
              </div>
              <div className="stat-card">
                <h4>Overall Achievement %</h4>
                <span className="stat-value">{targetData.overallAchievementPercentage}%</span>
              </div>
            </div>
          ) : (
            <div className="empty">No target data available</div>
          )}
        </div>
      )}

      {activeTab === 'franchise' && (
        <div className="tab-content">
          <h3>Franchise Employee Report</h3>
          {franchiseData && franchiseData.length > 0 ? (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Franchise ID</th>
                    <th>Name</th>
                    <th>Level</th>
                    <th>Total Employees</th>
                    <th>Active Employees</th>
                  </tr>
                </thead>
                <tbody>
                  {franchiseData.map((franchise) => (
                    <tr key={franchise.id}>
                      <td>{franchise.id}</td>
                      <td>{franchise.name}</td>
                      <td>{franchise.level}</td>
                      <td>{franchise.employee_count}</td>
                      <td>{franchise.activeEmployees}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No franchise data available</div>
          )}
        </div>
      )}
    </div>
  );
}

export default EmployeeReports;
