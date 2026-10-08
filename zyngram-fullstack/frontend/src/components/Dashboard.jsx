import React, { useState, useEffect } from 'react';
import axios from 'axios';
import GeoMapping from './GeoMapping';
import UserManagement from './UserManagement';
import FranchiseManagement from './FranchiseManagement';
import OrderManagement from './OrderManagement';
import MobileRechargeManagement from './MobileRechargeManagement';
import CommissionLedger from './CommissionLedger';
import Reports from './Reports';
import EmployeeManagement from './EmployeeManagement';
import DepartmentDesignation from './DepartmentDesignation';
import AttendanceLeave from './AttendanceLeave';
import TargetsDocuments from './TargetsDocuments';
import EmployeeReports from './EmployeeReports';
import FranchiseDashboard from './FranchiseDashboard';
import ZyngramLogo from './ZyngramLogo';

const APPS_SCRIPT_PORTAL_URL = 'https://script.google.com/macros/s/AKfycbxYx0wD-_z_uHhhLTsyYZy7u1ZfYhPosyvA3_4IMvrYThdWdCO9djYaKxf6xm2tIjR02Q/exec';

function Dashboard({ user, onLogout }) {
  const [dashboardData, setDashboardData] = useState(null);
  const [dashboardError, setDashboardError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/dashboard', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDashboardData(response.data);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setDashboardError(err.response?.data?.error || 'Dashboard data could not be loaded. Refresh and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  const dashboardMetrics = user?.role === 'HQ_ADMIN'
    ? [
        ['Total Users', dashboardData?.totalUsers],
        ['Customers', dashboardData?.totalCustomers],
        ['Franchises', dashboardData?.totalFranchises],
        ['Franchise Owners', dashboardData?.totalFranchiseOwners],
        ['Orders', dashboardData?.totalOrders],
        ['Pending Orders', dashboardData?.pendingOrders],
        ['Completed Orders', dashboardData?.confirmedOrders],
        ['Order Amount', `₹${Number(dashboardData?.totalOrderAmount || 0).toLocaleString('en-IN')}`],
        ['Employees', dashboardData?.totalEmployees],
        ['Present Today', dashboardData?.attendanceToday],
        ['Pending Leaves', dashboardData?.pendingLeaves],
        ['Active Targets', dashboardData?.activeTargets],
        ['Unmapped Customers', dashboardData?.unmappedCustomers],
        ['Pending Actions', dashboardData?.pendingActions]
      ]
    : [
        ['My Franchises', dashboardData?.franchiseCount],
        ['Authorized Customers', dashboardData?.totalCustomers],
        ['Orders', dashboardData?.totalOrders],
        ['Pending Orders', dashboardData?.pendingOrders],
        ['Order Amount', `₹${Number(dashboardData?.totalOrderAmount || 0).toLocaleString('en-IN')}`],
        ['Pending Commissions', dashboardData?.pendingCommissions],
        ['Settled Commissions', dashboardData?.settledCommissions],
        ['Employees', dashboardData?.totalEmployees],
        ['Present Today', dashboardData?.attendanceToday],
        ['Pending Leaves', dashboardData?.pendingLeaves],
        ['Active Targets', dashboardData?.activeTargets]
      ];

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="brand-lockup">
          <ZyngramLogo className="brand-mark" />
          <div className="brand-copy">
            <h1>Zyngram</h1>
            <span>FRANCHISE NETWORK</span>
          </div>
        </div>
        <div className="user-info">
          <span>{user.name} ({user.role})</span>
          <button onClick={onLogout}>Logout</button>
        </div>
      </header>

      <nav className="dashboard-nav">
        <button 
          className={activeTab === 'overview' ? 'active' : ''} 
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        {user?.role === 'FRANCHISE_OWNER' && (
          <button 
            className={activeTab === 'franchise-dashboard' ? 'active' : ''} 
            onClick={() => setActiveTab('franchise-dashboard')}
          >
            My Dashboard
          </button>
        )}
        {user?.role === 'HQ_ADMIN' && (
          <>
            <button
              className={activeTab === 'users' ? 'active' : ''}
              onClick={() => setActiveTab('users')}
            >
              Users
            </button>
            <button
              className={activeTab === 'franchises' ? 'active' : ''}
              onClick={() => setActiveTab('franchises')}
            >
              Franchises
            </button>
          </>
        )}
        <button 
          className={activeTab === 'employees' ? 'active' : ''} 
          onClick={() => setActiveTab('employees')}
        >
          Employees
        </button>
        <button 
          className={activeTab === 'departments' ? 'active' : ''} 
          onClick={() => setActiveTab('departments')}
        >
          Departments
        </button>
        <button 
          className={activeTab === 'attendance' ? 'active' : ''} 
          onClick={() => setActiveTab('attendance')}
        >
          Attendance
        </button>
        <button 
          className={activeTab === 'targets' ? 'active' : ''} 
          onClick={() => setActiveTab('targets')}
        >
          Targets
        </button>
        <button 
          className={activeTab === 'employee-reports' ? 'active' : ''} 
          onClick={() => setActiveTab('employee-reports')}
        >
          Emp Reports
        </button>
        {user?.role === 'HQ_ADMIN' && (
          <button
            className={activeTab === 'orders' ? 'active' : ''}
            onClick={() => setActiveTab('orders')}
          >
            Orders
          </button>
        )}
        {user?.role === 'HQ_ADMIN' && (
          <button
            className={activeTab === 'mobile-recharge' ? 'active' : ''}
            onClick={() => setActiveTab('mobile-recharge')}
          >
            Mobile Recharge
          </button>
        )}
        <button 
          className={activeTab === 'commissions' ? 'active' : ''} 
          onClick={() => setActiveTab('commissions')}
        >
          Commissions
        </button>
        {user?.role === 'HQ_ADMIN' && (
          <>
            <button
              className={activeTab === 'reports' ? 'active' : ''}
              onClick={() => setActiveTab('reports')}
            >
              Reports
            </button>
            <button
              className={activeTab === 'geo' ? 'active' : ''}
              onClick={() => setActiveTab('geo')}
            >
              Geo Mapping
            </button>
            <a
              className="dashboard-nav-link"
              href={APPS_SCRIPT_PORTAL_URL}
              target="_blank"
              rel="noreferrer"
            >
              Franchise Network
            </a>
          </>
        )}
      </nav>

      <main className="dashboard-content">
        {activeTab === 'overview' && (
          <div className="overview">
            <div className="overview-heading">
              <span className="overview-eyebrow">YOUR NETWORK, AT A GLANCE</span>
              <h2>Welcome back, {user.name?.split(' ')[0] || 'there'}</h2>
              <p>See the people, performance, and progress behind your franchise network.</p>
            </div>
            {dashboardError && <div className="error" role="alert">{dashboardError}</div>}
            {dashboardData && (
              <div className="metrics-grid">
                {dashboardMetrics.map(([label, value]) => (
                  <div className="metric-card" key={label}>
                    <h3>{label}</h3>
                    <p className="metric-value">{value ?? 0}</p>
                  </div>
                ))}
              </div>
            )}
            <section className="about-zyngram" aria-labelledby="about-zyngram-title">
              <div className="about-copy">
                <span className="about-eyebrow">A LITTLE ABOUT ZYNGRAM</span>
                <h3 id="about-zyngram-title">Franchise growth works better when everything connects.</h3>
                <p>
                  Zyngram brings franchise operations into one connected workspace—from managing
                  teams and locations to tracking orders, targets, and commissions. Clearer
                  visibility helps every part of your network move forward together.
                </p>
              </div>
              <div className="about-pillars">
                <div className="about-pillar">
                  <span className="pillar-number">01</span>
                  <strong>Connected teams</strong>
                  <span>People and locations, organised in one place.</span>
                </div>
                <div className="about-pillar">
                  <span className="pillar-number">02</span>
                  <strong>Visible progress</strong>
                  <span>Targets, orders, and performance at a glance.</span>
                </div>
                <div className="about-pillar">
                  <span className="pillar-number">03</span>
                  <strong>Shared momentum</strong>
                  <span>Commission and reporting that keep growth in view.</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'franchise-dashboard' && <FranchiseDashboard user={user} />}

        {activeTab === 'users' && <UserManagement user={user} />}

        {activeTab === 'franchises' && <FranchiseManagement />}

        {activeTab === 'employees' && <EmployeeManagement onNavigate={setActiveTab} />}

        {activeTab === 'departments' && <DepartmentDesignation />}

        {activeTab === 'attendance' && <AttendanceLeave onNavigate={setActiveTab} />}

        {activeTab === 'targets' && <TargetsDocuments />}

        {activeTab === 'employee-reports' && <EmployeeReports />}

        {activeTab === 'orders' && <OrderManagement />}

        {activeTab === 'mobile-recharge' && user?.role === 'HQ_ADMIN' && <MobileRechargeManagement />}

        {activeTab === 'commissions' && <CommissionLedger />}

        {activeTab === 'reports' && <Reports />}

        {activeTab === 'geo' && <GeoMapping user={user} />}

      </main>
    </div>
  );
}

export default Dashboard;
