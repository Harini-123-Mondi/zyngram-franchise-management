import React, { useState, useEffect } from 'react';
import axios from 'axios';

function FranchiseDashboard({ user }) {
  const [stats, setStats] = useState(null);
  const [overview, setOverview] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [services, setServices] = useState([]);
  const [recentEmployees, setRecentEmployees] = useState([]);
  const [pendingLeaves, setPendingLeaves] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardStats();
    fetchOperationalOverview();
    fetchAuthorizedCustomers();
    fetchFranchiseOrders();
    fetchFranchiseServices();
    fetchRecentEmployees();
    fetchPendingLeaves();
  }, []);

  const fetchOperationalOverview = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/dashboard', {
        headers: { Authorization: 'Bearer ' + token }
      });
      setOverview(response.data);
    } catch (err) {
      console.error('Failed to fetch franchise overview:', err);
    }
  };

  const fetchAuthorizedCustomers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/franchise/customers', {
        headers: { Authorization: 'Bearer ' + token }
      });
      setCustomers(response.data);
    } catch (err) {
      console.error('Failed to fetch authorized customers:', err);
    }
  };

  const fetchFranchiseOrders = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/franchise/orders', {
        headers: { Authorization: 'Bearer ' + token }
      });
      setOrders(response.data);
    } catch (err) {
      console.error('Failed to fetch franchise orders:', err);
    }
  };

  const fetchFranchiseServices = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/franchise/services', {
        headers: { Authorization: 'Bearer ' + token }
      });
      setServices(response.data);
    } catch (err) {
      console.error('Failed to fetch available services:', err);
    }
  };

  const fetchDashboardStats = async () => {
    try {
      const token = localStorage.getItem('token');
      
      // Fetch employee summary
      const summaryRes = await axios.get('/api/reports/employee-summary', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Fetch attendance summary
      const attendanceRes = await axios.get('/api/attendance/summary', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Fetch target summary
      const targetRes = await axios.get('/api/reports/targets', {
        headers: { Authorization: `Bearer ${token}` }
      });

      setStats({
        employees: summaryRes.data,
        attendance: attendanceRes.data,
        targets: targetRes.data
      });
    } catch (err) {
      console.error('Failed to fetch dashboard stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecentEmployees = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/employees', {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: 5 }
      });
      setRecentEmployees(response.data.employees || []);
    } catch (err) {
      console.error('Failed to fetch recent employees:', err);
    }
  };

  const fetchPendingLeaves = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/leaves', {
        headers: { Authorization: `Bearer ${token}` },
        params: { status: 'PENDING' }
      });
      setPendingLeaves(response.data || []);
    } catch (err) {
      console.error('Failed to fetch pending leaves:', err);
    }
  };

  const handleApproveLeave = async (leaveId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(`/api/leaves/${leaveId}/approve`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchPendingLeaves();
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
      fetchPendingLeaves();
    } catch (err) {
      alert('Failed to reject: ' + (err.response?.data?.error || err.message));
    }
  };

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  return (
    <div className="franchise-dashboard">
      <div className="section-header">
        <div>
          <h2>Franchise Dashboard</h2>
          <p>Welcome, {user?.name || user?.email} - {user?.franchiseId || 'Franchise Owner'}</p>
        </div>
      </div>

      {overview && (
        <div className="stats-section">
          <h3>Franchise Operations</h3>
          <div className="stats-grid">
            <div className="stat-card"><h4>Authorized Customers</h4><span className="stat-value">{overview.totalCustomers}</span></div>
            <div className="stat-card"><h4>Orders</h4><span className="stat-value">{overview.totalOrders}</span></div>
            <div className="stat-card warning"><h4>Pending Orders</h4><span className="stat-value">{overview.pendingOrders}</span></div>
            <div className="stat-card"><h4>Order Amount</h4><span className="stat-value">₹{Number(overview.totalOrderAmount || 0).toLocaleString('en-IN')}</span></div>
            <div className="stat-card"><h4>Pending Commissions</h4><span className="stat-value">{overview.pendingCommissions}</span></div>
            <div className="stat-card success"><h4>Settled Commissions</h4><span className="stat-value">{overview.settledCommissions}</span></div>
          </div>
        </div>
      )}

      <div className="stats-section">
        <h3>Available Services</h3>
        <div className="stats-grid">
          {services.length === 0 ? (
            <p className="empty-state">No active services are configured.</p>
          ) : services.map((service) => (
            <div className="stat-card" key={service.id}>
              <h4>{service.name}</h4>
              <span className="stat-value">{service.category}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="stats-section">
        <h3>Authorized Customers</h3>
        <div className="table-container">
          <table>
            <thead><tr><th>Name</th><th>Mobile</th><th>Status</th><th>Point</th><th>Node</th></tr></thead>
            <tbody>
              {customers.length === 0 ? (
                <tr><td colSpan="5" className="empty">No mapped customers in this franchise scope</td></tr>
              ) : customers.map((customer) => (
                <tr key={customer.customer_id}>
                  <td>{customer.name}</td><td>{customer.mobile}</td><td>{customer.status}</td>
                  <td>{customer.point_id || '-'}</td><td>{customer.node_id || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="stats-section">
        <h3>Franchise Orders</h3>
        <div className="table-container">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Service</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan="6" className="empty">No orders in this franchise scope</td></tr>
              ) : orders.map((order) => (
                <tr key={order.order_id}>
                  <td>{order.order_id}</td><td>{order.customer_name || order.customer_mobile || '-'}</td>
                  <td>{order.service_name || '-'}</td><td>₹{Number(order.amount || 0).toLocaleString('en-IN')}</td>
                  <td>{order.status}</td><td>{new Date(order.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Employee Stats */}
      {stats?.employees && (
        <div className="stats-section">
          <h3>Employee Overview</h3>
          <div className="stats-grid">
            <div className="stat-card">
              <h4>Total Employees</h4>
              <span className="stat-value">{stats.employees.total}</span>
            </div>
            <div className="stat-card success">
              <h4>Active</h4>
              <span className="stat-value">{stats.employees.active}</span>
            </div>
            <div className="stat-card warning">
              <h4>Inactive</h4>
              <span className="stat-value">{stats.employees.inactive}</span>
            </div>
            <div className="stat-card danger">
              <h4>Resigned</h4>
              <span className="stat-value">{stats.employees.resigned}</span>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Stats */}
      {stats?.attendance && (
        <div className="stats-section">
          <h3>Attendance Overview</h3>
          <div className="stats-grid">
            <div className="stat-card success">
              <h4>Present Today</h4>
              <span className="stat-value">{stats.attendance.present || 0}</span>
            </div>
            <div className="stat-card danger">
              <h4>Absent Today</h4>
              <span className="stat-value">{stats.attendance.absent || 0}</span>
            </div>
            <div className="stat-card warning">
              <h4>On Leave</h4>
              <span className="stat-value">{stats.attendance.leave || 0}</span>
            </div>
            <div className="stat-card">
              <h4>Attendance Rate</h4>
              <span className="stat-value">{stats.attendance.attendancePercentage || 0}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Target Stats */}
      {stats?.targets && (
        <div className="stats-section">
          <h3>Target Achievement</h3>
          <div className="stats-grid">
            <div className="stat-card">
              <h4>Total Targets</h4>
              <span className="stat-value">{stats.targets.total}</span>
            </div>
            <div className="stat-card success">
              <h4>Achieved</h4>
              <span className="stat-value">{stats.targets.achieved}</span>
            </div>
            <div className="stat-card warning">
              <h4>Below Target</h4>
              <span className="stat-value">{stats.targets.belowTarget}</span>
            </div>
            <div className="stat-card">
              <h4>Overall Achievement</h4>
              <span className="stat-value">{stats.targets.overallAchievementPercentage}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Recent Employees */}
      <div className="stats-section">
        <h3>Recent Employees</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Department</th>
                <th>Status</th>
                <th>Joining Date</th>
              </tr>
            </thead>
            <tbody>
              {recentEmployees.length === 0 ? (
                <tr><td colSpan="5" className="empty">No employees found</td></tr>
              ) : (
                recentEmployees.map((emp) => (
                  <tr key={emp.id}>
                    <td>{emp.employee_id}</td>
                    <td>{emp.name}</td>
                    <td>{emp.department_id || '-'}</td>
                    <td>
                      <span className={`status ${emp.status?.toLowerCase() || 'active'}`}>{emp.status}</span>
                    </td>
                    <td>{new Date(emp.joining_date).toLocaleDateString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Leave Requests */}
      <div className="stats-section">
        <h3>Pending Leave Requests</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Leave Type</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingLeaves.length === 0 ? (
                <tr><td colSpan="6" className="empty">No pending leave requests</td></tr>
              ) : (
                pendingLeaves.map((leave) => (
                  <tr key={leave.id}>
                    <td>{leave.employee_name || '-'}</td>
                    <td>{leave.leave_type}</td>
                    <td>{leave.start_date}</td>
                    <td>{leave.end_date}</td>
                    <td>{leave.reason || '-'}</td>
                    <td>
                      <button onClick={() => handleApproveLeave(leave.id)} className="btn-sm">Approve</button>
                      <button onClick={() => handleRejectLeave(leave.id)} className="btn-sm btn-danger">Reject</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default FranchiseDashboard;
