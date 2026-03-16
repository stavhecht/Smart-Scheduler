import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../apiClient';
import './PublicProfile.css';

export default function PublicProfile({ profile, onClose, onScheduleWith, currentUserId }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null); // { msg, type: 'success'|'error' }
  const [sharedMeetings, setSharedMeetings] = useState(null);

  useEffect(() => {
    if (profile?.id && currentUserId && profile.id !== currentUserId) {
      apiGet(`/api/users/${profile.id}/shared_meetings`)
        .then(setSharedMeetings)
        .catch(() => {});
    }
  }, [profile?.id, currentUserId]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSendMessage = async (type = 'general') => {
    if (!message.trim() && type === 'general') return;
    setSending(true);
    try {
      const content = type === 'kudos' ? "Sent you some kudos! 🌟" : type === 'nudge' ? "Hey, just checking in on our meeting! 🔔" : message;
      await apiPost(`/api/profile/${profile.id}/message`, { content, type });
      if (type === 'general') {
        setMessage('');
      }
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      showToast(`${label} sent!`);
    } catch (err) {
      showToast('Failed to send: ' + err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const displayName = profile.name || profile.displayName || '';
  const initials = displayName
    ? displayName.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '??';

  const score = Math.round(profile.fairness_score ?? profile.score ?? 100);
  const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div className="pp-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pp-modal">
        <button className="pp-close" onClick={onClose}>✕</button>
        {toast && (
          <div style={{
            position: 'absolute', top: '0.75rem', left: '50%', transform: 'translateX(-50%)',
            background: toast.type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
            border: `1px solid ${toast.type === 'error' ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'}`,
            color: toast.type === 'error' ? '#f87171' : '#4ade80',
            padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.82rem', whiteSpace: 'nowrap',
            zIndex: 10,
          }}>
            {toast.msg}
          </div>
        )}
        
        <div className="pp-head">
          <div className="pp-avatar">{initials}</div>
          <div className="pp-info">
            <h2 className="pp-name">{displayName || 'Unknown'}</h2>
            <div className="pp-badges">
              <span className="pp-role">{profile.role || 'Teammate'}</span>
              <span className="pp-dept">{profile.department || 'Smart Co.'}</span>
            </div>
            {(profile.status || profile.statusMessage) && (
              <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.4rem' }}>
                {profile.status || profile.statusMessage}
              </div>
            )}
            {sharedMeetings?.count > 0 && (
              <div style={{ fontSize: '0.74rem', color: 'var(--accent-color)', marginTop: '0.3rem' }}>
                🤝 {sharedMeetings.count} meeting{sharedMeetings.count !== 1 ? 's' : ''} together
              </div>
            )}
          </div>
          <div className="pp-gauge">
             <div className="pp-gauge-val" style={{ color: scoreColor }}>{score}</div>
             <div className="pp-gauge-label">FAIRNESS</div>
          </div>
        </div>

        <div className="pp-body">
          <section className="pp-section">
            <label>BIO</label>
            <p>{profile.bio || "This user hasn't added a bio yet."}</p>
          </section>

          <section className="pp-section">
            <label>SKILLS</label>
            <div className="pp-skills">
              {(profile.skills || []).map(s => <span key={s} className="pp-skill">{s}</span>)}
              {(profile.skills || []).length === 0 && <span className="empty-hint">No skills listed</span>}
            </div>
          </section>

          <section className="pp-section">
            <label>QUICK ACTIONS</label>
            <div className="pp-quick-actions">
              <button className="pp-action-btn" onClick={() => handleSendMessage('kudos')} disabled={sending}>
                🌟 Send Kudos
              </button>
              <button className="pp-action-btn" onClick={() => handleSendMessage('nudge')} disabled={sending}>
                🔔 Nudge
              </button>
              {onScheduleWith && (
                <button
                  className="pp-action-btn pp-schedule-btn"
                  onClick={() => { onClose(); onScheduleWith(profile.email); }}
                >
                  📅 Schedule Meeting
                </button>
              )}
            </div>
          </section>

          <section className="pp-section">
            <label>SEND A MESSAGE</label>
            <div className="pp-message-box">
              <textarea 
                placeholder="Write something..." 
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
              <button 
                className="pp-send-btn" 
                onClick={() => handleSendMessage('general')}
                disabled={sending || !message.trim()}
              >
                {sending ? '...' : 'Send Message'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
