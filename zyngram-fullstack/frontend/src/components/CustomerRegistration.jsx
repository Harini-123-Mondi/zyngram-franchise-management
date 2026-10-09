import React, { useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import ZyngramLogo from './ZyngramLogo';

function CustomerRegistration({ onLogin }) {
  const [formData, setFormData] = useState({ name: '', email: '', mobile: '', password: '' });
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [locationConsent, setLocationConsent] = useState(false);
  const [error, setError] = useState('');
  const [accountExists, setAccountExists] = useState(false);
  const [result, setResult] = useState(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const requestLocation = () => {
    setLocationError('');
    setLocation(null);
    if (!navigator.geolocation) {
      setLocationError('This browser does not support GPS location. Use a browser with location support.');
      return;
    }
    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy
        });
        setLoadingLocation(false);
      },
      (locationFailure) => {
        const messages = {
          1: 'Location permission was denied. Allow location access in your browser settings and try again.',
          2: 'Your device could not determine its location. Check GPS or network location and try again.',
          3: 'Location request timed out. Please try again.'
        };
        setLocationError(messages[locationFailure.code] || 'Could not get your location. Please try again.');
        setLoadingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setAccountExists(false);
    setSubmitting(true);
    try {
      const response = await axios.post('/api/auth/register/customer', {
        ...formData,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        locationConsent
      });
      setResult(response.data);
    } catch (registrationError) {
      const message = registrationError.response?.data?.error ||
        (registrationError.request
          ? 'Cannot reach the registration service. Check that the backend is running, then try again.'
          : 'Customer registration could not be submitted. Please try again.');
      setError(message);
      if (registrationError.response?.status === 409) {
        setAccountExists(true);
        setFormData((current) => ({ ...current, password: '' }));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const mapped = result.attribution.status === 'MAPPED';
    return (
      <div className="login-container">
        <section className="login-card registration-card" aria-labelledby="registration-result-title">
          <div className="login-brand">
            <ZyngramLogo className="login-brand-mark" />
            <div className="login-brand-copy">
              <h1>Zyngram</h1>
              <span>FRANCHISE NETWORK</span>
            </div>
          </div>
          <h2 id="registration-result-title">Registration complete</h2>
          <div className={mapped ? 'registration-result mapped' : 'registration-result unmapped'} role="status">
            <strong>{mapped ? 'Mapped to active franchise boundaries' : 'UNMAPPED — no franchise assigned'}</strong>
            <p>{result.message}</p>
          </div>
          {mapped && (
            <div className="registration-chain">
              <p><strong>Physical:</strong> {result.attribution.physical.point.name} → {result.attribution.physical.center.name} → {result.attribution.physical.hub.name} → {result.attribution.physical.command.name} → {result.attribution.physical.hq.name}</p>
              <p><strong>Digital:</strong> {result.attribution.digital.node.name} → {result.attribution.digital.zone.name} → {result.attribution.digital.territory.name} → {result.attribution.digital.region.name} → {result.attribution.digital.nation.name}</p>
            </div>
          )}
          <p className="field-hint">Your GPS coordinates and the mapping result were saved as an attribution snapshot.</p>
          <button type="button" onClick={() => onLogin(result.user, result.token)}>
            Continue to your account
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="login-container">
      <section className="login-card registration-card" aria-labelledby="registration-title">
        <div className="login-brand">
          <ZyngramLogo className="login-brand-mark" />
          <div className="login-brand-copy">
            <h1>Zyngram</h1>
            <span>FRANCHISE NETWORK</span>
          </div>
        </div>
        <h2 id="registration-title">Create customer account</h2>
        <p className="login-description">Your location is matched against active franchise boundaries by the server. If none match, you will be registered as UNMAPPED.</p>
        {error && (
          <div className="error" role="alert">
            {error}
            {accountExists && <> <Link to="/login">Sign in to your existing account</Link>.</>}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="customer-name">Full name</label>
            <input id="customer-name" type="text" autoComplete="name" minLength="2" maxLength="120" value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} required />
          </div>
          <div className="form-group">
            <label htmlFor="customer-email">Email</label>
            <input id="customer-email" type="email" autoComplete="email" maxLength="254" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} required />
          </div>
          <div className="form-group">
            <label htmlFor="customer-mobile">Mobile number (with country code)</label>
            <input id="customer-mobile" type="tel" autoComplete="tel" placeholder="+919876543210" value={formData.mobile} onChange={(event) => setFormData({ ...formData, mobile: event.target.value })} required />
          </div>
          <div className="form-group">
            <label htmlFor="customer-password">Password</label>
            <input id="customer-password" type="password" autoComplete="new-password" minLength="10" maxLength="128" value={formData.password} onChange={(event) => setFormData({ ...formData, password: event.target.value })} required />
          </div>
          <div className="registration-location">
            <button type="button" className="btn-secondary" onClick={requestLocation} disabled={loadingLocation || submitting}>
              {loadingLocation ? 'Getting GPS location...' : location ? 'Refresh GPS location' : 'Allow location and get GPS'}
            </button>
            {location && <p role="status">GPS captured ({location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}), accuracy about {Math.round(location.accuracy)} m.</p>}
            {locationError && <p className="registration-location-error" role="alert">{locationError}</p>}
          </div>
          <label className="registration-consent">
            <input type="checkbox" checked={locationConsent} onChange={(event) => setLocationConsent(event.target.checked)} required />
            <span>I agree to use my device location to find an active franchise. If there is no match, no franchise will be assigned.</span>
          </label>
          <button type="submit" disabled={submitting || !location || !locationConsent}>
            {submitting ? 'Registering...' : 'Register'}
          </button>
        </form>
        <p className="registration-login-link">Already have an account? <Link to="/login">Sign in</Link></p>
      </section>
    </div>
  );
}

export default CustomerRegistration;
