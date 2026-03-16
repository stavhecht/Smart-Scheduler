import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../apiClient';
import './ProfileView.css';

/* ─────────────────────────────────────────────
   ProfileView
   Props:
     profile               – user profile object
     meetings              – array of all user meetings
     calendarStatus        – { google: {connected, email}, microsoft: {connected, email} }
     onCalendarConnect     – fn(provider) → initiates OAuth flow
     onCalendarDisconnect  – fn(provider) → disconnects calendar
───────────────────────────────────────────── */
export default function ProfileView({ 
  profile: initialProfile, 
  meetings, 
  calendarStatus, 
  onCalendarConnect, 
  onCalendarDisconnect,
  onProfileUpdate
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [activeTab, setActiveTab] = useState('overview'); // overview | inbox | insights
  const [isEditing, setIsEditing] = useState(false);
  const [tempProfile, setTempProfile] = useState(initialProfile);
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [replyTo, setReplyTo] = useState(null); // { messageId, fromUserId, text }
  const [replying, setReplying] = useState(false);
  const [disconnectConfirm, setDisconnectConfirm] = useState(null); // provider string
  const [stats, setStats] = useState(null);

  // Derived stats (from meetings prop, updated by real /stats endpoint)
  const score      = Math.round(profile.fairness_score ?? 100);
  const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
  const total      = meetings.length;
  const confirmed  = meetings.filter(m => m.status === 'confirmed').length;
  const organized  = stats?.total_organized ?? meetings.filter(m => m.userRole === 'organizer').length;
  const invited    = meetings.filter(m => m.userRole === 'participant').length;
  const thisWeek   = stats?.meetings_this_week ?? profile.details?.meetings_this_week ?? 0;
  const sufferingScore = stats?.suffering_score ?? sufferingScore;

  useEffect(() => {
    apiGet('/api/profile/stats').then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === 'inbox') {
      fetchMessages();
    }
  }, [activeTab]);

  const fetchMessages = async () => {
    setMsgLoading(true);
    try {
      const msgs = await apiGet('/api/profile/messages');
      setMessages(msgs);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setMsgLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    setSaveError('');
    setIsUpdating(true);
    try {
      const res = await apiPost('/api/profile/update', tempProfile);
      if (res.status === 'success') {
        const updated = { ...profile, ...res.profile, displayName: res.profile.displayName };
        setProfile(updated);
        setIsEditing(false);
        if (onProfileUpdate) onProfileUpdate(updated);
      }
    } catch (err) {
      setSaveError('Failed to update profile: ' + err.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReply = async (m) => {
    if (!replyTo?.text?.trim()) return;
    setReplying(true);
    try {
      await apiPost(`/api/profile/${m.fromUserId}/message`, { content: replyTo.text, type: 'general' });
      setReplyTo(null);
    } catch (err) {
      console.error('Reply failed:', err);
    } finally {
      setReplying(false);
    }
  };

  const handleDisconnect = (provider) => setDisconnectConfirm(provider);
  const confirmDisconnect = () => {
    if (disconnectConfirm) {
      onCalendarDisconnect(disconnectConfirm);
      setDisconnectConfirm(null);
    }
  };

  const pvDisplayName = profile.displayName || profile.name || '';
  const initials = pvDisplayName
    ? pvDisplayName.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '??';

  return (
    <div className="pv-wrap">

      {/* Disconnect calendar confirmation dialog */}
      {disconnectConfirm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDisconnectConfirm(null)}>
          <div className="modal-box confirm-box" style={{ maxWidth: '380px' }}>
            <div className="modal-head">
              <h3>Disconnect Calendar</h3>
              <button className="modal-close" onClick={() => setDisconnectConfirm(null)}>✕</button>
            </div>
            <div className="confirm-body">
              <p>Disconnect {disconnectConfirm === 'google' ? 'Google Calendar' : 'Outlook'}? Your meetings will no longer sync.</p>
              <div className="modal-actions">
                <button className="btn-danger" onClick={confirmDisconnect}>Disconnect</button>
                <button className="btn-cancel" onClick={() => setDisconnectConfirm(null)}>Keep Connected</button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* ── Tabs ── */}
      <div className="pv-tabs">
        <button 
          className={`pv-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          👤 Overview
        </button>
        <button 
          className={`pv-tab ${activeTab === 'inbox' ? 'active' : ''}`}
          onClick={() => setActiveTab('inbox')}
        >
          ✉️ Inbox {messages.filter(m => !m.isRead).length > 0 && <span className="tab-badge" />}
        </button>
        <button 
          className={`pv-tab ${activeTab === 'insights' ? 'active' : ''}`}
          onClick={() => setActiveTab('insights')}
        >
          🔭 Fairness Insights
        </button>
      </div>

      {activeTab === 'overview' && (
        <>
          {/* ── Hero card ── */}
          <div className="pv-hero">
            <div className="pv-avatar">{initials}</div>

            <div className="pv-info">
              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <input 
                    className="pv-input-name"
                    value={tempProfile.name || ''} 
                    onChange={e => setTempProfile({...tempProfile, name: e.target.value, displayName: e.target.value})}
                    placeholder="Display Name"
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input 
                      className="pv-input-sub"
                      value={tempProfile.role || ''} 
                      onChange={e => setTempProfile({...tempProfile, role: e.target.value})}
                      placeholder="Role (e.g. Lead Dev)"
                    />
                    <input 
                      className="pv-input-sub"
                      value={tempProfile.department || ''} 
                      onChange={e => setTempProfile({...tempProfile, department: e.target.value})}
                      placeholder="Department"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="pv-name">{profile.displayName || profile.name}</h2>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span className="pv-role-chip">{profile.role || 'Professional'}</span>
                    <span className="pv-dept-chip">{profile.department || 'General'}</span>
                  </div>
                </>
              )}
              
              <div className="pv-meta">
                <span>📧 {profile.email}</span>
                <span>🌍 {profile.timezone || 'Asia/Jerusalem'}</span>
                <span>💬 "{profile.status_message || 'Focused & Ready'}"</span>
              </div>
            </div>

            <div className="pv-actions">
              {isEditing ? (
                <>
                  <button className="pv-btn secondary" onClick={() => setIsEditing(false)}>Cancel</button>
                  <button className="pv-btn primary" onClick={handleSaveProfile} disabled={isUpdating}>
                    {isUpdating ? 'Saving...' : 'Save Changes'}
                  </button>
                </>
              ) : (
                <button className="pv-btn ghost" onClick={() => { setTempProfile(profile); setIsEditing(true); setSaveError(''); }}>
                  ✏️ Edit Profile
                </button>
              )}
              {saveError && <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '0.5rem' }}>{saveError}</p>}
            </div>
          </div>

          <div className="pv-detail-grid">
            {/* Bio & Skills */}
            <div className="pv-card">
              <h3>📝 Bio & Expertise</h3>
              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <textarea 
                    className="pv-textarea"
                    value={tempProfile.bio || ''}
                    onChange={e => setTempProfile({...tempProfile, bio: e.target.value})}
                    placeholder="Tell us about yourself..."
                  />
                  <div>
                    <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.4rem', display: 'block' }}>
                      SKILLS (Comma separated)
                    </label>
                    <input 
                      className="pv-input-sub"
                      value={(tempProfile.skills || []).join(', ')}
                      onChange={e => setTempProfile({...tempProfile, skills: e.target.value.split(',').map(s => s.trim())})}
                      placeholder="React, UI Design, Fairness..."
                    />
                  </div>
                </div>
              ) : (
                <>
                  <p className="pv-bio">{profile.bio || "No bio yet. Click Edit to add one!"}</p>
                  <div className="pv-skills">
                    {(profile.skills || []).map(skill => (
                      <span key={skill} className="pv-skill-tag">{skill}</span>
                    ))}
                    {(profile.skills || []).length === 0 && <span className="empty-hint">No skills listed</span>}
                  </div>
                </>
              )}
            </div>

            {/* Integration Status */}
            <div className="pv-card">
              <h3>🗓️ Calendar Connectivity</h3>
              <div className="cal-providers">
                <CalendarRow 
                  brand="google" 
                  name="Google Calendar" 
                  status={calendarStatus?.google} 
                  onConnect={onCalendarConnect} 
                  onDisconnect={handleDisconnect}
                />
                <CalendarRow
                  brand="microsoft"
                  name="Outlook"
                  status={calendarStatus?.microsoft}
                  onConnect={onCalendarConnect}
                  onDisconnect={handleDisconnect}
                />
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="pv-stats">
            <StatItem icon="📅" val={total} label="Total" />
            <StatItem icon="✅" val={confirmed} label="Confirmed" />
            <StatItem icon="🎯" val={organized} label="Organized" />
            <StatItem icon="📨" val={invited} label="Invited" />
            <StatItem icon="📊" val={thisWeek} label="This Week" />
          </div>
        </>
      )}

      {activeTab === 'inbox' && (
        <div className="pv-card" style={{ minHeight: '400px' }}>
          <div className="pv-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3>✉️ Your Communication Inbox</h3>
            <button className="pv-btn ghost tiny" onClick={fetchMessages} disabled={msgLoading}>
              {msgLoading ? '...' : '↻ Refresh'}
            </button>
          </div>
          
          <div className="inbox-list">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <p>No messages yet. When people nudge you or send kudos, they'll appear here.</p>
              </div>
            ) : (
              messages.map(m => (
                <div key={m.messageId} className={`msg-item ${m.isRead ? 'read' : 'unread'}`}>
                  <div className="msg-icon">{m.messageType === 'kudos' ? '🌟' : m.messageType === 'nudge' ? '🔔' : '💬'}</div>
                  <div className="msg-body" style={{ flex: 1 }}>
                    <div className="msg-header">
                      <span className="msg-from">{m.fromDisplayName}</span>
                      <span className="msg-time">{new Date(m.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="msg-text">{m.content}</p>
                    {replyTo?.messageId === m.messageId && (
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                        <input
                          autoFocus
                          className="pv-input-sub"
                          style={{ flex: 1 }}
                          placeholder="Write a reply..."
                          value={replyTo.text}
                          onChange={e => setReplyTo(r => ({ ...r, text: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') handleReply(m); if (e.key === 'Escape') setReplyTo(null); }}
                        />
                        <button className="pv-btn primary tiny" onClick={() => handleReply(m)} disabled={replying || !replyTo.text?.trim()}>
                          {replying ? '...' : 'Send'}
                        </button>
                        <button className="pv-btn tiny" onClick={() => setReplyTo(null)}>✕</button>
                      </div>
                    )}
                  </div>
                  <div className="msg-actions">
                    <button className="pv-btn tiny" onClick={() => setReplyTo({ messageId: m.messageId, fromUserId: m.fromUserId, text: '' })}>
                      Reply
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'insights' && (
        <div className="pv-card">
          <h3>🔭 Deep Fairness Analysis</h3>
          <p className="fa-insight">
            Based on your last {total} meetings, you have a fairness score of <strong>{score}</strong>. 
            This places you in the <strong>top {100 - score + 5}%</strong> of your organization.
          </p>
          {/* Detailed metrics from the original view */}
          <div className="fa-metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
             <div className="fa-metric-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
               <span className="fa-b-label" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Meetings Last 7 Days</span>
               <span className="fa-b-val" style={{ color: scoreColor, fontSize: '1.4rem', fontWeight: 800 }}>{thisWeek}</span>
             </div>
             <div className="fa-metric-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
               <span className="fa-b-label" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Inconvenient Meetings</span>
               <span className="fa-b-val" style={{ fontSize: '1.4rem', fontWeight: 800 }}>{sufferingScore}</span>
             </div>
             <div className="fa-metric-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
               <span className="fa-b-label" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Inconvenience Reward</span>
               <span className="fa-b-val" style={{ color: '#22c55e', fontSize: '1.4rem', fontWeight: 800 }}>+{sufferingScore} pts</span>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingRow({ label, desc, action, toggle, defaultOn, disabled }) {
  return (
    <div className="sr">
      <div className="sr-info">
        <span className="sr-label">{label}</span>
        <span className="sr-desc">{desc}</span>
      </div>
      {toggle ? (
        <div className={`toggle ${defaultOn ? 'on' : ''}`} />
      ) : (
        <button
          className={`sr-btn ${disabled ? 'disabled' : ''}`}
          disabled={disabled}
        >
          {action}
        </button>
      )}
    </div>
  );
}
function CalendarRow({ brand, name, status, onConnect, onDisconnect }) {
  const isConnected = !!status?.connected;
  return (
    <div className={`cal-row ${brand} ${isConnected ? 'connected' : ''}`}>
      <div className="cal-icon">{brand === 'google' ? 'G' : 'O'}</div>
      <div className="cal-body">
        <span className="cal-name">{name}</span>
        <span className="cal-email">{isConnected ? status.email : 'Not connected'}</span>
      </div>
      {isConnected ? (
        <button className="cal-btn disconnect" onClick={() => onDisconnect(brand)}>Disconnect</button>
      ) : (
        <button className="cal-btn connect" onClick={() => onConnect(brand)}>Connect</button>
      )}
    </div>
  );
}

function StatItem({ icon, val, label }) {
  return (
    <div className="stat-v-item">
      <span className="stat-v-icon">{icon}</span>
      <div className="stat-v-body">
        <span className="stat-v-val">{val}</span>
        <span className="stat-v-label">{label}</span>
      </div>
    </div>
  );
}
