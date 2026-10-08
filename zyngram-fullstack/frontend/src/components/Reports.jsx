import React, { useState, useEffect } from 'react';
import axios from 'axios';

function Reports() {
  const [activeTab, setActiveTab] = useState('performance');
  const [loading, setLoading] = useState(false);
  const [performanceData, setPerformanceData] = useState(null);
  const [dateRangeType, setDateRangeType] = useState('today');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [dateReportData, setDateReportData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (activeTab === 'performance') {
      fetchPerformanceReport();
    }
  }, [activeTab]);

  const fetchPerformanceReport = async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/reports/franchise-performance', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPerformanceData(response.data);
    } catch (err) {
      setError('Failed to fetch performance report');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDateReport = async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const params = { rangeType: dateRangeType };
      if (dateRangeType === 'custom') {
        params.customStartDate = customStartDate;
        params.customEndDate = customEndDate;
      }
      const response = await axios.get('/api/reports/date-range', {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });
      setDateReportData(response.data);
    } catch (err) {
      setError('Failed to fetch date report');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="reports">
      <div className="section-header">
        <div>
          <h2>Reports</h2>
          <p>View performance metrics and date-based analytics</p>
        </div>
      </div>

      <div className="tabs">
        <button 
          className={activeTab === 'performance' ? 'active' : ''}
          onClick={() => setActiveTab('performance')}
        >
          Franchise Performance
        </button>
        <button 
          className={activeTab === 'date' ? 'active' : ''}
          onClick={() => setActiveTab('date')}
        >
          Date Range Report
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {activeTab === 'performance' && (
        <div className="report-content">
          {loading ? (
            <div className="loading">Loading performance report...</div>
          ) : performanceData ? (
            <>
            <div className="metrics-grid">
              <div className="metric-card">
                <h3>Total Franchise Units</h3>
                <div className="metric-value">{performanceData.totalFranchiseUnits}</div>
              </div>
              <div className="metric-card">
                <h3>Total Customers</h3>
                <div className="metric-value">{performanceData.totalUsers}</div>
              </div>
              <div className="metric-card">
                <h3>Mapped Customers</h3>
                <div className="metric-value">{performanceData.mappedUsers}</div>
              </div>
              <div className="metric-card">
                <h3>Unmapped Customers</h3>
                <div className="metric-value">{performanceData.unmappedUsers}</div>
              </div>
              <div className="metric-card">
                <h3>New Customers (30d)</h3>
                <div className="metric-value">{performanceData.activeUsers}</div>
              </div>
              <div className="metric-card">
                <h3>Mapping Rate</h3>
                <div className="metric-value">{performanceData.mappingRate}%</div>
              </div>
            </div>

            <div className="dashboard-grid">
              <div className="card">
                <h3>Top Centers</h3>
                <div className="chart-list">
                  {performanceData.topCenters && performanceData.topCenters.length > 0 ? (
                    performanceData.topCenters.map((item, index) => (
                      <div key={item.id} className="chart-item">
                        <span>{index + 1}. {item.id}</span>
                        <span>{item.count}</span>
                      </div>
                    ))
                  ) : (
                    <p className="empty-state">No data available</p>
                  )}
                </div>
              </div>
              <div className="card">
                <h3>Top Hubs</h3>
                <div className="chart-list">
                  {performanceData.topHubs && performanceData.topHubs.length > 0 ? (
                    performanceData.topHubs.map((item, index) => (
                      <div key={item.id} className="chart-item">
                        <span>{index + 1}. {item.id}</span>
                        <span>{item.count}</span>
                      </div>
                    ))
                  ) : (
                    <p className="empty-state">No data available</p>
                  )}
                </div>
              </div>
            </div>
            </>
          ) : (
            <p className="empty-state">No performance data available</p>
          )}
        </div>
      )}

      {activeTab === 'date' && (
        <div className="report-content">
          <div className="filters-bar">
            <div className="filter-group">
              <label>Date Range:</label>
              <select 
                value={dateRangeType} 
                onChange={(e) => setDateRangeType(e.target.value)}
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7days">Last 7 Days</option>
                <option value="last30days">Last 30 Days</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            {dateRangeType === 'custom' && (
              <>
                <div className="filter-group">
                  <label>Start Date:</label>
                  <input 
                    type="date" 
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label>End Date:</label>
                  <input 
                    type="date" 
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                  />
                </div>
              </>
            )}
            <button className="btn-primary" onClick={fetchDateReport}>
              Generate Report
            </button>
          </div>

          {loading ? (
            <div className="loading">Loading date report...</div>
          ) : dateReportData ? (
            <div className="metrics-grid">
              <div className="metric-card">
                <h3>{dateReportData.rangeLabel}</h3>
                <p>{dateReportData.startDate} to {dateReportData.endDate}</p>
              </div>
              <div className="metric-card">
                <h3>Total Registrations</h3>
                <div className="metric-value">{dateReportData.totalRegistrations}</div>
              </div>
              <div className="metric-card">
                <h3>Mapped Registrations</h3>
                <div className="metric-value">{dateReportData.mappedRegistrations}</div>
              </div>
              <div className="metric-card">
                <h3>Unmapped Registrations</h3>
                <div className="metric-value">{dateReportData.unmappedRegistrations}</div>
              </div>
            </div>
          ) : (
            <p className="empty-state">Generate a report to view data</p>
          )}
        </div>
      )}
    </div>
  );
}

export default Reports;
