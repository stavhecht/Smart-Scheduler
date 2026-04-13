import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../apiClient';
import { X, Users, Check, Star, Bell, CalendarPlus } from 'lucide-react';
import { useToast } from '../context/ToastContext.jsx';
import './PublicProfile.css';

export default function PublicProfile({ profile, onClose, onScheduleWith, currentUserId }) {
  const showToast = useToast();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentType, setSentType] = useState(null); // 'kudos' | 'nudge' — for success flash
  const [sharedMeetings, setSharedMeetings] = useState(null);

  useEffect(() => {
    if (profile?.id && currentUserId && profile.id !== currentUserId) {
      apiGet(`/api/users/${profile.id}/shared_meetings`)
        .then(setSharedMeetings)
        .catch(() => {});
    }
  }, [profile?.id, currentUserId]);

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
      if (type === 'kudos' || type === 'nudge') {
        setSentType(type);
        setTimeout(() => setSentType(null), 2000);
      }
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
  const scoreColor = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div className="pp-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pp-modal">
        <button className="pp-close" onClick={onClose}><X size={14} /></button>

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
              <div style={{ fontSize: '0.74rem', color: 'var(--accent-color)', marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Users size={12} />{sharedMeetings.count} meeting{sharedMeetings.count !== 1 ? 's' : ''} together
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
                {sentType === 'kudos' ? <><Check size={13} /> Kudos sent!</> : <><Star size={13} /> Send Kudos</>}
              </button>
              <button className="pp-action-btn" onClick={() => handleSendMessage('nudge')} disabled={sending}>
                {sentType === 'nudge' ? <><Check size={13} /> Nudge sent!</> : <><Bell size={13} /> Nudge</>}
              </button>
              {onScheduleWith && (
                <button
                  className="pp-action-btn pp-schedule-btn"
                  onClick={() => { onClose(); onScheduleWith(profile.email); }}
                >
                  <CalendarPlus size={13} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />Schedule Meeting
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
