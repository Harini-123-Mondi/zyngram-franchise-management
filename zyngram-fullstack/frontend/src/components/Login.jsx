import React, { useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import ZyngramLogo from './ZyngramLogo';

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await axios.post('/api/auth/login', { email: email.trim().toLowerCase(), password });
      onLogin(response.data.user, response.data.token);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-brand">
          <ZyngramLogo className="login-brand-mark" />
          <div className="login-brand-copy">
            <h1>Zyngram</h1>
            <span>FRANCHISE NETWORK</span>
          </div>
        </div>
        <section className="login-intro" aria-label="About Zyngram">
          <span className="login-intro-label">GROWING TOGETHER</span>
          <p className="login-quote">“Better connected teams build stronger franchise networks.”</p>
          <p className="login-description">
            Manage your people, locations, targets, orders, and commissions in one connected workspace.
          </p>
        </section>
        <h2>Login</h2>
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@zyngram.com"
              autoCapitalize="none"
              autoComplete="username"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        <div className="demo-note">
          <p>Sign in with your account</p>
          <p>All active accounts created by the administrator can log in using their own email and password.</p>
          <p>Forgot your password? Ask an HQ administrator to reset it in User Management.</p>
          {import.meta.env.DEV && (
            <p className="demo-credentials">Local demo admin account is available only for local development.</p>
          )}
        </div>
        <p className="registration-login-link">New customer? <Link to="/register">Create an account</Link></p>
      </div>
    </div>
  );
}

export default Login;
