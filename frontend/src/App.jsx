import { useState, useEffect } from 'react'
import './App.css'
import MeetingDashboard from './components/MeetingDashboard';

function App() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('https://aeox6n4cja.execute-api.us-east-1.amazonaws.com/api/profile')
      .then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then(data => {
        setProfile(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error:', err);
        setError('לא הצלחנו להתחבר לשרת. וודא שה-Docker רץ.');
        setLoading(false);
      });
  }, []);

  return (

    <div className="app-container">
      <h1>Smart Scheduler 📅</h1>

      {loading && <div className="loading">טוען נתונים מהשרת...</div>}

      {error && (
        <div className="error-message">
          <p>⚠️ <strong>תקלה:</strong> {error}</p>
        </div>
      )}

      {profile && (
        <>
          <div className="profile-card">
            <div className="profile-info">
              <h2>שלום, {profile.name} 👋</h2>
              <span className="profile-role">{profile.role}</span>

              {profile.details && (
                <div className="stats-grid">
                  <div className="stat-item">📉 פגישות: {profile.details.meetings_this_week}</div>
                  <div className="stat-item">⚠️ ביטולים: {profile.details.cancellations_last_month}</div>
                  <div className="stat-item">🛡️ בונוס: {profile.details.suffering_score}</div>
                </div>
              )}

              <p style={{ opacity: 0.7, marginTop: '1rem' }}>
                ציון גבוה מאפשר גמישות רבה יותר בלו"ז.
              </p>
            </div>

            <div className="score-display">
              <div
                className="score-value"
                style={{ color: profile.fairness_score > 80 ? 'var(--success)' : 'var(--warning)' }}
              >
                {profile.fairness_score}
              </div>
              <div className="score-label">ציון הוגנות</div>
            </div>
          </div>

          <MeetingDashboard />
        </>
      )}
    </div>
  )

}

export default App