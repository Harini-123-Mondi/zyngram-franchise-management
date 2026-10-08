import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import CustomerRegistration from './components/CustomerRegistration';
import CustomerHome from './components/CustomerHome';
import './index.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const clearSession = () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
    };
    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.data?.error === 'Invalid or expired token') {
          clearSession();
        }
        return Promise.reject(error);
      }
    );

    const restoreSession = async () => {
      const token = localStorage.getItem('token');
      const userData = localStorage.getItem('user');

      if (!token || !userData) {
        clearSession();
        setLoading(false);
        return;
      }

      try {
        const response = await axios.get('/api/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setUser(response.data);
        localStorage.setItem('user', JSON.stringify(response.data));
      } catch (error) {
        if (error.response?.status === 401) {
          clearSession();
        } else {
          try {
            setUser(JSON.parse(userData));
          } catch {
            clearSession();
          }
        }
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
    return () => axios.interceptors.response.eject(interceptorId);
  }, []);

  const handleLogin = (userData, token) => {
    setUser(userData);
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <Router>
      <div className="app">
        <Routes>
          <Route 
            path="/login" 
            element={!user ? <Login onLogin={handleLogin} /> : <Navigate to="/dashboard" />} 
          />
          <Route
            path="/register"
            element={!user ? <CustomerRegistration onLogin={handleLogin} /> : <Navigate to="/dashboard" />}
          />
          <Route 
            path="/dashboard" 
            element={user
              ? user.role === 'CUSTOMER'
                ? <CustomerHome user={user} onLogout={handleLogout} />
                : <Dashboard user={user} onLogout={handleLogout} />
              : <Navigate to="/login" />}
          />
          <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
