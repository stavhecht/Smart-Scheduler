import { useState } from 'react';
import { apiPost } from '../apiClient';
import './PublicProfile.css';

export default function PublicProfile({ profile, onClose }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSendMessage = async (type = 'general') => {
    if (!message.trim() && type === 'general') return;
    setSending(true);
    try {
      const content = type === 'kudos' ? "Sent you some kudos! 🌟" : type === 'nudge' ? "Hey, just checking in on our meeting! 🔔" : message;
      await apiPost(`/api/profile/${profile.id}/message`, { content, type });
      if (type === 'general') {
        setSuccess(true);
        setTimeout(() => { setSuccess(false); setMessage(''); }, 3000);
      } else {
        alert(`${type.charAt(0).toUpperCase() + type.slice(1)} sent!`);
      }
    } catch (err) {
      alert('Failed to send: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const initials = profile.name
    ? profile.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '??';

  const score = Math.round(profile.score ?? 100);
  const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div className="pp-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pp-modal">
        <button className="pp-close" onClick={onClose}>✕</button>
        
        <div className="pp-head">
          <div className="pp-avatar">{initials}</div>
          <div className="pp-info">
            <h2 className="pp-name">{profile.name}</h2>
            <div className="pp-badges">
              <span className="pp-role">{profile.role || 'Teammate'}</span>
              <span className="pp-dept">{profile.department || 'Smart Co.'}</span>
            </div>
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
                {sending ? '...' : success ? '✓ Sent' : 'Send Message'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
