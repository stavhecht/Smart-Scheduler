import { useState, useEffect } from 'react'
import './App.css'
import MeetingDashboard from './components/MeetingDashboard';
import CalendarView from './components/CalendarView';

// Amplify Auth Imports
import { Amplify } from 'aws-amplify';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import awsConfig from './aws-exports';

Amplify.configure(awsConfig);

function AppContent() {
  const { user, signOut } = useAuthenticator((context) => [context.user]);
  const [profile, setProfile] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return;
    
    // Initial data fetch
    const fetchWithCheck = (url) => fetch(url).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText} at ${url}`);
      return res.json();
    });

    Promise.all([
      fetchWithCheck('https://aeox6n4cja.execute-api.us-east-1.amazonaws.com/api/profile'),
      fetchWithCheck('https://aeox6n4cja.execute-api.us-east-1.amazonaws.com/api/meetings')
    ])
      .then(([profileData, meetingsData]) => {
        setProfile(profileData);
        setMeetings(meetingsData);
        setLoading(false);
      })
      .catch(err => {
        console.error('Detailed Error:', err);
        setError(err.message || 'Unknown connection error');
        setLoading(false);
      });
  }, [user]);

  const refreshMeetings = () => {
    fetch('https://aeox6n4cja.execute-api.us-east-1.amazonaws.com/api/meetings')
      .then(res => res.json())
      .then(data => setMeetings(data))
      .catch(err => console.error("Refresh failed", err));
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Smart Scheduler 📅</h1>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <div className="view-toggle">
            <button className="active">Dashboard</button>
            <button disabled title="Coming soon">Analytics</button>
          </div>
          <button onClick={signOut} className="signout-btn">Sign Out</button>
        </div>
      </header>

      {loading && <div className="loading">Syncing with AWS... 🤖</div>}

      {error && (
        <div className="error-message">
          <p>⚠️ <strong>Error:</strong> {error}</p>
        </div>
      )}

      {profile && (
        <>
          <div className="profile-card">
            <div className="profile-info">
              <h2>Welcome back, {profile.name} 👋</h2>
              <span className="profile-role">{profile.role}</span>

              {profile.details && (
                <div className="stats-grid">
                  <div className="stat-item">📉 Meetings: {profile.details.meetings_this_week}</div>
                  <div className="stat-item">⚠️ Conflicts: {profile.details.cancellations_last_month}</div>
                  <div className="stat-item">🛡️ Focus Score: {profile.details.suffering_score}</div>
                </div>
              )}

              <p style={{ opacity: 0.7, marginTop: '1rem' }}>
                Your high fairness score grants you more flexibility in upcoming slots.
              </p>
            </div>

            <div className="score-display">
              <div
                className="score-value"
                style={{ color: profile.fairness_score > 80 ? 'var(--success)' : 'var(--warning)' }}
              >
                {Math.round(profile.fairness_score)}
              </div>
              <div className="score-label">Fairness Score</div>
            </div>
          </div>

          <CalendarView meetings={meetings} />
          <MeetingDashboard meetings={meetings} onRefresh={refreshMeetings} />
        </>
      )}
    </div>
  )
}

export default function App() {
  return (
    <Authenticator.Provider>
      <Authenticator>
        <AppContent />
      </Authenticator>
    </Authenticator.Provider>
  );
}