import { useState, useEffect } from 'react'
import './App.css'
import MeetingDashboard from './components/MeetingDashboard';
import CalendarView from './components/CalendarView';
import { apiGet } from './apiClient';

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
  const [activeView, setActiveView] = useState('dashboard');

  useEffect(() => {
    if (!user) return;
    Promise.all([
      apiGet('/api/profile'),
      apiGet('/api/meetings'),
    ])
      .then(([profileData, meetingsData]) => {
        setProfile(profileData);
        setMeetings(meetingsData);
        setLoading(false);
      })
      .catch(err => {
        console.error('Detailed Error:', err);
        if (err.message && err.message.includes('401')) {
          signOut();
        } else {
          setError(err.message || 'Unknown connection error');
          setLoading(false);
        }
      });
  }, [user]);

  const refreshMeetings = () => {
    apiGet('/api/meetings')
      .then(data => setMeetings(data))
      .catch(err => console.error('Refresh failed', err));
  };

  const navItems = [
    { id: 'dashboard', emoji: '🏠', label: 'Dashboard' },
    { id: 'calendar',  emoji: '🗓️', label: 'Calendar' },
    { id: 'meetings',  emoji: '📋', label: 'Meetings' },
    { id: 'analytics', emoji: '📊', label: 'Analytics', disabled: true },
  ];

  const pendingCount = meetings.filter(m => m.status === 'pending').length;
  const initials = profile?.name
    ? profile.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '??';

  return (
    <div className="layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark">S</div>
          <div className="logo-text">Smart<br />Scheduler</div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item ${activeView === item.id ? 'active' : ''} ${item.disabled ? 'nav-disabled' : ''}`}
              onClick={() => !item.disabled && setActiveView(item.id)}
              title={item.disabled ? 'Coming soon' : item.label}
            >
              <span className="nav-emoji">{item.emoji}</span>
              <span className="nav-label">{item.label}</span>
              {item.id === 'meetings' && pendingCount > 0 && (
                <span className="nav-badge">{pendingCount}</span>
              )}
              {item.disabled && <span className="nav-soon">Soon</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {profile && (
            <div className="sidebar-user">
              <div className="sidebar-avatar">{initials}</div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{profile.name}</div>
                <div className="sidebar-user-role">{profile.role}</div>
              </div>
            </div>
          )}
          <button onClick={signOut} className="signout-btn">Sign Out</button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main-content">
        {loading && (
          <div className="loading-screen">
            <div className="spinner" />
            <span>Syncing with AWS…</span>
          </div>
        )}

        {error && (
          <div className="error-banner">
            ⚠️ <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && profile && (
          <>
            {activeView === 'dashboard' && (
              <DashboardView
                profile={profile}
                meetings={meetings}
                onNavigate={setActiveView}
              />
            )}
            {activeView === 'calendar' && (
              <div className="view-wrap">
                <div className="view-header">
                  <h2>Calendar</h2>
                  <p className="view-subtitle">Your weekly scheduling overview</p>
                </div>
                <CalendarView meetings={meetings} />
              </div>
            )}
            {activeView === 'meetings' && (
              <div className="view-wrap">
                <MeetingDashboard meetings={meetings} onRefresh={refreshMeetings} />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function DashboardView({ profile, meetings, onNavigate }) {
  const pendingMeetings   = meetings.filter(m => m.status === 'pending');
  const confirmedMeetings = meetings.filter(m => m.status === 'confirmed');
  const score      = Math.round(profile.fairness_score);
  const scoreColor = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div className="dashboard">
      {/* Hero */}
      <div className="dash-hero">
        <div>
          <h1 className="dash-greeting">Welcome back, {profile.name} 👋</h1>
          <p className="dash-subtitle">Here's your scheduling overview for today.</p>
        </div>
        <button className="btn-primary" onClick={() => onNavigate('meetings')}>
          + New Meeting
        </button>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card highlight">
          <div className="stat-icon">⚖️</div>
          <div className="stat-body">
            <div className="stat-value" style={{ color: scoreColor }}>{score}</div>
            <div className="stat-label">Fairness Score</div>
          </div>
          <div className="stat-bar-track">
            <div className="stat-bar-fill" style={{ width: `${score}%`, background: scoreColor }} />
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">📅</div>
          <div className="stat-body">
            <div className="stat-value">{profile.details?.meetings_this_week ?? 0}</div>
            <div className="stat-label">Meetings This Week</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">⚠️</div>
          <div className="stat-body">
            <div className="stat-value">{profile.details?.cancellations_last_month ?? 0}</div>
            <div className="stat-label">Conflicts</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">🛡️</div>
          <div className="stat-body">
            <div className="stat-value">{profile.details?.suffering_score ?? 0}</div>
            <div className="stat-label">Focus Score</div>
          </div>
        </div>
      </div>

      {/* Two-column */}
      <div className="dash-grid">
        <div className="dash-card">
          <div className="dash-card-head">
            <h3>Pending Decisions</h3>
            <span className="pill warning">{pendingMeetings.length}</span>
          </div>
          {pendingMeetings.length === 0 ? (
            <p className="empty-hint">All caught up — no pending meetings. ✅</p>
          ) : (
            <div className="mini-list">
              {pendingMeetings.slice(0, 4).map(m => (
                <div key={m.requestId} className="mini-item" onClick={() => onNavigate('meetings')}>
                  <span className="mini-dot pending" />
                  <div className="mini-body">
                    <div className="mini-title">{m.title}</div>
                    <div className="mini-meta">{m.durationMinutes} min · {m.slots?.length ?? 0} slots available</div>
                  </div>
                  <span className="mini-arrow">›</span>
                </div>
              ))}
              {pendingMeetings.length > 4 && (
                <button className="see-all" onClick={() => onNavigate('meetings')}>
                  View all {pendingMeetings.length} →
                </button>
              )}
            </div>
          )}
        </div>

        <div className="dash-card">
          <div className="dash-card-head">
            <h3>Upcoming Scheduled</h3>
            <span className="pill success">{confirmedMeetings.length}</span>
          </div>
          {confirmedMeetings.length === 0 ? (
            <p className="empty-hint">No confirmed meetings yet. Create one to get started!</p>
          ) : (
            <div className="mini-list">
              {confirmedMeetings.slice(0, 4).map(m => (
                <div key={m.requestId} className="mini-item">
                  <span className="mini-dot confirmed" />
                  <div className="mini-body">
                    <div className="mini-title">{m.title}</div>
                    <div className="mini-meta">
                      {m.selectedSlotStart
                        ? new Date(m.selectedSlotStart).toLocaleDateString('en-US', {
                            weekday: 'short', month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })
                        : `${m.durationMinutes} min`}
                    </div>
                  </div>
                  <span className="mini-arrow" style={{ color: 'var(--success)' }}>✓</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Insight */}
      <div className="insight-banner">
        <span>💡</span>
        <span>
          {score >= 80
            ? 'Your high fairness score grants you priority in upcoming slot selections.'
            : 'Your fairness score is below 80 — accepting less convenient slots will improve it over time.'}
        </span>
      </div>
    </div>
  );
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
