import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiUpdateIcsUrl } from '../apiClient';
import './ProfileView.css';

const STATUS_PRESETS = [
  "🎯 Focused", "🤝 Open to connect", "🔴 Busy",
  "✈️ Travelling", "🌱 Learning", "💡 Thinking", "🎉 Available",
];

const TIMEZONES = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver',
  'America/Chicago', 'America/New_York', 'America/Sao_Paulo', 'Atlantic/Reykjavik',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Helsinki',
  'Asia/Jerusalem', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
  'Pacific/Auckland',
];

function getStatusDotColor(msg) {
  if (!msg) return '#3d4e68';
  const m = msg.toLowerCase();
  if (m.includes('available') || m.includes('open') || m.includes('learning') || m.includes('thinking')) return '#34d399';
  if (m.includes('busy') || m.includes('travelling') || m.includes('focused')) return '#fbbf24';
  return '#6b7a94';
}

function computeCompleteness(p) {
  let score = 0;
  if (p.name || p.displayName) score += 20;
  if (p.bio) score += 20;
  if (p.role) score += 15;
  if (p.department) score += 15;
  if ((p.skills || []).length > 0) score += 15;
  if (p.statusMessage || p.status_message) score += 15;
  return score;
}

function parseHour(timeStr) {
  if (!timeStr) return 0;
  return parseInt(timeStr.split(':')[0], 10) || 0;
}

/* ── Toggle Switch ── */
function Toggle({ on, onChange }) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{
        width: '38px', height: '22px',
        borderRadius: '11px',
        background: on ? 'rgba(52,211,153,0.35)' : 'var(--bg-raised)',
        border: on ? '1px solid rgba(52,211,153,0.4)' : '1px solid var(--border)',
        position: 'relative',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'all 0.2s',
      }}
    >
      <div style={{
        position: 'absolute',
        top: '3px',
        left: on ? '17px' : '3px',
        width: '14px', height: '14px',
        borderRadius: '50%',
        background: on ? 'var(--success)' : 'var(--text-muted)',
        transition: 'all 0.2s',
      }} />
    </div>
  );
}

/* ── Setting Row with toggle ── */
function PrefRow({ label, desc, on, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '1rem',
      padding: '0.85rem 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {desc && <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>{desc}</div>}
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

/* ─────────────────────────────────────────────
   ProfileView — 5-tab settings page
───────────────────────────────────────────── */
export default function ProfileView({
  profile: initialProfile,
  meetings,
  calendarStatus,
  onCalendarConnect,
  onCalendarDisconnect,
  onProfileUpdate,
  onUnreadCountChange,
  initialTab,
}) {
  const [profile, setProfile]         = useState(initialProfile);
  const [activeTab, setActiveTab]     = useState(initialTab || 'profile');
  const [isEditing, setIsEditing]     = useState(false);
  const [tempProfile, setTempProfile] = useState(initialProfile);
  const [skillInput, setSkillInput]   = useState('');
  const [messages, setMessages]       = useState([]);
  const [msgLoading, setMsgLoading]   = useState(false);
  const [isUpdating, setIsUpdating]   = useState(false);
  const [saveError, setSaveError]     = useState('');
  const [replyTo, setReplyTo]         = useState(null);
  const [replying, setReplying]       = useState(false);
  const [disconnectConfirm, setDisconnectConfirm] = useState(null);
  const [stats, setStats]             = useState(null);
  const [icsUrl, setIcsUrl]           = useState(calendarStatus?.ics?.url || '');
  const [icsEditing, setIcsEditing]   = useState(false);
  const [icsSaving, setIcsSaving]     = useState(false);
  const [icsSaveMsg, setIcsSaveMsg]   = useState('');
  const [showFairnessExplainer, setShowFairnessExplainer] = useState(false);

  const score      = Math.round(profile.fairness_score ?? 100);
  const scoreColor = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
  const total      = meetings.length;
  const confirmed  = meetings.filter(m => m.status === 'confirmed').length;
  const organized  = stats?.total_organized ?? meetings.filter(m => m.userRole === 'organizer').length;
  const invited    = meetings.filter(m => m.userRole === 'participant').length;
  const thisWeek   = stats?.meetings_this_week ?? profile.details?.meetings_this_week ?? 0;
  const sufferingScore = stats?.suffering_score ?? profile.details?.suffering_score ?? 0;

  useEffect(() => { apiGet('/api/profile/stats').then(setStats).catch(() => {}); }, []);

  useEffect(() => {
    if (activeTab === 'inbox') fetchMessages();
  }, [activeTab]);

  const fetchMessages = async () => {
    setMsgLoading(true);
    try {
      const msgs = await apiGet('/api/profile/messages');
      setMessages(msgs);
      const unread = (msgs || []).filter(m => !m.isRead).length;
      if (onUnreadCountChange) onUnreadCountChange(unread);
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
      setSaveError('Failed to update: ' + err.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSavePref = async (updates) => {
    try {
      const merged = { ...profile, ...updates };
      const res = await apiPost('/api/profile/update', merged);
      if (res.status === 'success') {
        const updated = { ...profile, ...res.profile };
        setProfile(updated);
        if (onProfileUpdate) onProfileUpdate(updated);
      }
    } catch (err) {
      console.error('Pref save failed:', err);
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

  const confirmDisconnect = () => {
    if (disconnectConfirm) {
      onCalendarDisconnect(disconnectConfirm);
      setDisconnectConfirm(null);
    }
  };

  const handleSaveIcsUrl = async () => {
    setIcsSaving(true);
    setIcsSaveMsg('');
    try {
      await apiUpdateIcsUrl(icsUrl);
      setIcsSaveMsg(icsUrl ? 'Connected' : 'Cleared');
      setIcsEditing(false);
    } catch (err) {
      setIcsSaveMsg('Save failed: ' + err.message);
    } finally {
      setIcsSaving(false);
    }
  };

  const handleDisconnectIcs = async () => {
    setIcsSaving(true);
    setIcsSaveMsg('');
    try {
      await apiUpdateIcsUrl('');
      setIcsUrl('');
      setIcsEditing(false);
      setIcsSaveMsg('');
    } catch (err) {
      setIcsSaveMsg('Save failed: ' + err.message);
    } finally {
      setIcsSaving(false);
    }
  };

  const handleSkillKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = skillInput.trim().replace(/,$/, '');
      if (val && !(tempProfile.skills || []).includes(val)) {
        setTempProfile(p => ({ ...p, skills: [...(p.skills || []), val] }));
      }
      setSkillInput('');
    }
    if (e.key === 'Backspace' && !skillInput && (tempProfile.skills || []).length > 0) {
      setTempProfile(p => ({ ...p, skills: (p.skills || []).slice(0, -1) }));
    }
  };

  const removeSkill = (skill) =>
    setTempProfile(p => ({ ...p, skills: (p.skills || []).filter(s => s !== skill) }));

  const pvDisplayName = profile.displayName || profile.name || '';
  const initials = pvDisplayName
    ? pvDisplayName.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '??';
  const completeness   = computeCompleteness(profile);
  const statusMsg      = profile.statusMessage || profile.status_message || '';
  const statusDotColor = getStatusDotColor(statusMsg);
  const workingHours   = profile.workingHours || { start: '09:00', end: '18:00' };
  const whStartPct     = (parseHour(workingHours.start) / 24) * 100;
  const whEndPct       = (parseHour(workingHours.end)   / 24) * 100;
  const notifPrefs     = profile.notificationPrefs || { invites: true, reminders: true, digest: false };
  const unreadCount    = messages.filter(m => !m.isRead).length;

  const TABS = [
    { id: 'profile',     label: 'Profile'     },
    { id: 'preferences', label: 'Preferences' },
    { id: 'calendar',    label: 'Calendar'    },
    { id: 'inbox',       label: 'Inbox',      badge: unreadCount > 0 },
    { id: 'fairness',    label: 'Fairness'    },
  ];

  return (
    <div className="pv-wrap">

      {/* Disconnect confirmation */}
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
        {TABS.map(t => (
          <button
            key={t.id}
            className={`pv-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
            {t.badge && <span className="tab-badge" />}
          </button>
        ))}
      </div>

      {/* ──────────────── TAB 1: PROFILE ──────────────── */}
      {activeTab === 'profile' && (
        <>
          {/* Hero */}
          <div className="pv-hero">
            <div className="pv-avatar-wrap">
              <div className="pv-avatar">{initials}</div>
              <span className="pv-status-dot" style={{ background: statusDotColor }} title={statusMsg || 'No status'} />
            </div>

            <div className="pv-info">
              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* First / Last name inputs */}
                  {(() => {
                    const parts = (tempProfile.name || tempProfile.displayName || '').split(' ');
                    const firstName = parts[0] || '';
                    const lastName = parts.slice(1).join(' ');
                    const savedName = profile.name || profile.displayName || '';
                    const looksLikeUsername = !savedName.includes(' ') && /[\d.]/.test(savedName);
                    return (
                      <>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <input
                            className="pv-input-name"
                            style={{ flex: 1 }}
                            value={firstName}
                            onChange={e => {
                              const full = `${e.target.value} ${lastName}`.trim();
                              setTempProfile({ ...tempProfile, name: full, displayName: full });
                            }}
                            placeholder="First Name"
                          />
                          <input
                            className="pv-input-name"
                            style={{ flex: 1 }}
                            value={lastName}
                            onChange={e => {
                              const full = `${firstName} ${e.target.value}`.trim();
                              setTempProfile({ ...tempProfile, name: full, displayName: full });
                            }}
                            placeholder="Last Name"
                          />
                        </div>
                        {looksLikeUsername && (
                          <div style={{ fontSize: '0.72rem', color: '#fbbf24', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '6px', padding: '0.4rem 0.6rem' }}>
                            Your name looks like a username — set your real name for a better experience
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      className="pv-input-sub"
                      value={tempProfile.role || ''}
                      onChange={e => setTempProfile({ ...tempProfile, role: e.target.value })}
                      placeholder="Role (e.g. Lead Dev)"
                    />
                    <input
                      className="pv-input-sub"
                      value={tempProfile.department || ''}
                      onChange={e => setTempProfile({ ...tempProfile, department: e.target.value })}
                      placeholder="Department"
                    />
                  </div>
                  <div>
                    <div className="pv-status-presets">
                      {STATUS_PRESETS.map(p => (
                        <button
                          key={p}
                          type="button"
                          className={`pv-preset-chip ${(tempProfile.statusMessage || tempProfile.status_message) === p ? 'active' : ''}`}
                          onClick={() => setTempProfile(t => ({ ...t, statusMessage: p, status_message: p }))}
                        >{p}</button>
                      ))}
                    </div>
                    <input
                      className="pv-input-sub"
                      style={{ marginTop: '0.4rem' }}
                      value={tempProfile.statusMessage || tempProfile.status_message || ''}
                      onChange={e => setTempProfile(t => ({ ...t, statusMessage: e.target.value, status_message: e.target.value }))}
                      placeholder="Or type a custom status…"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="pv-name">{profile.displayName || profile.name}</h2>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                    <span className="pv-role-chip">{profile.role || 'Professional'}</span>
                    <span className="pv-dept-chip">{profile.department || 'General'}</span>
                  </div>
                  {statusMsg && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusDotColor, display: 'inline-block', flexShrink: 0 }} />
                      {statusMsg}
                    </div>
                  )}
                </>
              )}
              {!isEditing && (
                <div className="pv-meta">
                  <span>{profile.email}</span>
                  <span>{profile.timezone || 'Asia/Jerusalem'}</span>
                </div>
              )}
            </div>

            <div className="pv-actions">
              {isEditing ? (
                <>
                  <button className="pv-btn secondary" onClick={() => { setIsEditing(false); setSkillInput(''); }}>Cancel</button>
                  <button className="pv-btn primary" onClick={handleSaveProfile} disabled={isUpdating}>
                    {isUpdating ? 'Saving...' : 'Save'}
                  </button>
                </>
              ) : (
                <button className="pv-btn ghost" onClick={() => { setTempProfile(profile); setIsEditing(true); setSaveError(''); setSkillInput(''); }}>
                  Edit Profile
                </button>
              )}
              {saveError && <p style={{ color: 'var(--danger)', fontSize: '0.78rem', marginTop: '0.4rem' }}>{saveError}</p>}
            </div>
          </div>

          {/* Completeness bar */}
          <div className="pv-completeness">
            <div className="pv-completeness-track">
              <div className="pv-completeness-fill" style={{ width: `${completeness}%` }} />
            </div>
            <span className="pv-completeness-label">
              {completeness >= 100 ? 'Profile complete' : `${completeness}% complete`}
            </span>
          </div>

          <div className="pv-detail-grid">
            {/* Bio & Skills */}
            <div className="pv-card">
              <h3>Bio & Expertise</h3>
              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <textarea
                    className="pv-textarea"
                    value={tempProfile.bio || ''}
                    onChange={e => setTempProfile({ ...tempProfile, bio: e.target.value })}
                    placeholder="Tell us about yourself..."
                  />
                  <div>
                    <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.4rem', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Skills — press Enter or comma to add
                    </label>
                    <div className="skill-chips-wrap">
                      {(tempProfile.skills || []).filter(Boolean).map(s => (
                        <span key={s} className="skill-chip">
                          {s}
                          <button type="button" className="skill-chip-x" onClick={() => removeSkill(s)}>×</button>
                        </span>
                      ))}
                      <input
                        className="skill-chip-input"
                        value={skillInput}
                        onChange={e => setSkillInput(e.target.value)}
                        onKeyDown={handleSkillKeyDown}
                        placeholder={!(tempProfile.skills || []).length ? 'React, Design…' : ''}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <p className="pv-bio">{profile.bio || 'No bio yet. Click Edit Profile to add one.'}</p>
                  <div className="pv-skills">
                    {(profile.skills || []).filter(Boolean).map(skill => (
                      <span key={skill} className="pv-skill-tag">{skill}</span>
                    ))}
                    {(profile.skills || []).length === 0 && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No skills listed</span>}
                  </div>
                </>
              )}
            </div>

            {/* Stats */}
            <div className="pv-card">
              <h3>Meeting Stats</h3>
              <div className="pv-stats">
                <StatItem val={total}     label="Total"     color="var(--accent)" />
                <StatItem val={confirmed} label="Confirmed" color="var(--success)" />
                <StatItem val={organized} label="Organized" color="var(--purple)" />
                <StatItem val={invited}   label="Invited"   color="var(--warning)" />
                <StatItem val={thisWeek}  label="This Week" color="var(--accent)" />
              </div>
            </div>
          </div>
        </>
      )}

      {/* ──────────────── TAB 2: PREFERENCES ──────────────── */}
      {activeTab === 'preferences' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          {/* Timezone & Working Hours */}
          <div className="pv-card">
            <h3>Time & Availability</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                  Timezone
                </label>
                <select
                  className="pv-input-sub"
                  value={profile.timezone || 'Asia/Jerusalem'}
                  onChange={e => handleSavePref({ timezone: e.target.value })}
                  style={{ cursor: 'pointer' }}
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                  Working Hours
                </label>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Start</span>
                  <input
                    type="time"
                    className="pv-input-sub"
                    style={{ width: 'auto' }}
                    value={workingHours.start}
                    onChange={e => handleSavePref({ workingHours: { ...workingHours, start: e.target.value } })}
                  />
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>End</span>
                  <input
                    type="time"
                    className="pv-input-sub"
                    style={{ width: 'auto' }}
                    value={workingHours.end}
                    onChange={e => handleSavePref({ workingHours: { ...workingHours, end: e.target.value } })}
                  />
                </div>
                <div className="wh-track" style={{ marginTop: '0.75rem' }}>
                  <div className="wh-fill" style={{ left: `${whStartPct}%`, width: `${whEndPct - whStartPct}%` }} />
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  {workingHours.start} – {workingHours.end}
                </div>
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="pv-card">
            <h3>Notifications</h3>
            <div style={{ marginTop: '0.25rem' }}>
              <PrefRow
                label="Meeting invitations"
                desc="Email me when someone invites me to a meeting"
                on={notifPrefs.invites}
                onChange={v => handleSavePref({ notificationPrefs: { ...notifPrefs, invites: v } })}
              />
              <PrefRow
                label="Meeting reminders"
                desc="Email me reminders 1 hour before meetings"
                on={notifPrefs.reminders}
                onChange={v => handleSavePref({ notificationPrefs: { ...notifPrefs, reminders: v } })}
              />
              <div style={{ borderBottom: 'none' }}>
                <PrefRow
                  label="Weekly fairness digest"
                  desc="Weekly email summary of your fairness score and activity"
                  on={notifPrefs.digest}
                  onChange={v => handleSavePref({ notificationPrefs: { ...notifPrefs, digest: v } })}
                />
              </div>
            </div>
          </div>

          {/* Visibility */}
          <div className="pv-card">
            <h3>Privacy</h3>
            <div style={{ marginTop: '0.25rem' }}>
              <PrefRow
                label="Show fairness score publicly"
                desc="Allow other users to see your fairness score on your public profile"
                on={profile.showFairnessScore ?? true}
                onChange={v => handleSavePref({ showFairnessScore: v })}
              />
              <div style={{ borderBottom: 'none' }}>
                <PrefRow
                  label="Allow messages"
                  desc="Allow other users to send you kudos and nudges"
                  on={profile.allowMessages ?? true}
                  onChange={v => handleSavePref({ allowMessages: v })}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────── TAB 3: CALENDAR ──────────────── */}
      {activeTab === 'calendar' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <CalendarCard
            brand="google"
            name="Google Calendar"
            status={calendarStatus?.google}
            onConnect={onCalendarConnect}
            onDisconnect={() => setDisconnectConfirm('google')}
          />
          <CalendarCard
            brand="microsoft"
            name="Microsoft Outlook"
            status={calendarStatus?.microsoft}
            onConnect={onCalendarConnect}
            onDisconnect={() => setDisconnectConfirm('microsoft')}
          />
          <div className="pv-card">
            <h3>Outlook Calendar Feed</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 1rem', lineHeight: 1.6 }}>
              No Azure app registration needed — paste your Outlook .ics feed URL to sync availability.
            </p>
            {icsUrl && !icsEditing ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.84rem' }}>✅ Outlook Calendar Connected</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {icsUrl.length > 40 ? icsUrl.slice(0, 40) + '…' : icsUrl}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="cal-btn cal-btn-disconnect" onClick={() => { setIcsEditing(true); setIcsSaveMsg(''); }} disabled={icsSaving}>
                    Change
                  </button>
                  <button className="cal-btn cal-btn-disconnect" onClick={handleDisconnectIcs} disabled={icsSaving}>
                    {icsSaving ? '...' : 'Disconnect'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input
                  className="pv-input-sub"
                  style={{ flex: 1 }}
                  placeholder="https://outlook.live.com/owa/calendar/…/calendar.ics"
                  value={icsUrl}
                  onChange={e => { setIcsUrl(e.target.value); setIcsSaveMsg(''); }}
                />
                <button className="cal-btn cal-btn-connect" onClick={handleSaveIcsUrl} disabled={icsSaving}>
                  {icsSaving ? '...' : 'Save'}
                </button>
                {icsEditing && (
                  <button className="cal-btn cal-btn-disconnect" onClick={() => { setIcsEditing(false); setIcsSaveMsg(''); }} disabled={icsSaving}>
                    Cancel
                  </button>
                )}
              </div>
            )}
            {icsSaveMsg && (
              <span style={{ fontSize: '0.72rem', color: icsSaveMsg.startsWith('Save failed') ? 'var(--danger)' : 'var(--success)' }}>
                {icsSaveMsg}
              </span>
            )}
            <details style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>How to get your Outlook .ics URL</summary>
              <ol style={{ marginTop: '0.5rem', paddingLeft: '1.25rem', lineHeight: 1.7 }}>
                <li>Open Outlook → Settings → View all Outlook settings</li>
                <li>Go to Calendar → Shared calendars</li>
                <li>Under "Publish a calendar", set permissions to "Can view all details"</li>
                <li>Click Publish, then copy the ICS link</li>
              </ol>
            </details>
          </div>
        </div>
      )}

      {/* ──────────────── TAB 4: INBOX ──────────────── */}
      {activeTab === 'inbox' && (
        <div className="pv-card" style={{ minHeight: '400px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: 0 }}>Inbox</h3>
            <button className="pv-btn ghost tiny" onClick={fetchMessages} disabled={msgLoading}>
              {msgLoading ? '...' : '↻ Refresh'}
            </button>
          </div>

          <div className="inbox-list">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">✉</div>
                <p style={{ margin: 0, fontSize: '0.84rem' }}>No messages yet. When people nudge you or send kudos, they'll appear here.</p>
              </div>
            ) : (
              messages.map(m => (
                <div key={m.messageId} className={`msg-item ${m.isRead ? 'read' : 'unread'}`}>
                  <div className="msg-icon">{m.messageType === 'kudos' ? '★' : m.messageType === 'nudge' ? '●' : '✉'}</div>
                  <div className="msg-body">
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

      {/* ──────────────── TAB 5: FAIRNESS ──────────────── */}
      {activeTab === 'fairness' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          {/* Score card */}
          <div className="pv-card">
            <h3>Fairness Score</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              {/* Circular progress */}
              <div style={{ position: 'relative', width: '96px', height: '96px', flexShrink: 0 }}>
                <svg width="96" height="96" viewBox="0 0 96 96">
                  <circle cx="48" cy="48" r="40" fill="none" stroke="var(--bg-raised)" strokeWidth="8" />
                  <circle
                    cx="48" cy="48" r="40"
                    fill="none"
                    stroke={scoreColor}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 40}`}
                    strokeDashoffset={`${2 * Math.PI * 40 * (1 - score / 100)}`}
                    transform="rotate(-90 48 48)"
                    style={{ transition: 'stroke-dashoffset 1s ease' }}
                  />
                </svg>
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 800, color: scoreColor }}>{score}</span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>/ 100</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
                  {score >= 80 ? 'Excellent' : score >= 60 ? 'Good standing' : 'Needs attention'}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  Top {Math.max(1, 100 - score + 5)}% of your organization
                </div>
                <span style={{
                  display: 'inline-block', padding: '0.2rem 0.65rem',
                  borderRadius: '20px', fontSize: '0.72rem', fontWeight: 700,
                  background: score >= 80 ? 'rgba(52,211,153,0.12)' : score >= 60 ? 'rgba(251,191,36,0.12)' : 'rgba(248,113,113,0.12)',
                  color: scoreColor,
                  border: `1px solid ${scoreColor}33`,
                }}>
                  {score >= 80 ? 'Top performer' : score >= 60 ? 'On track' : 'At risk'}
                </span>
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div className="pv-card">
            <h3>Activity Metrics</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem', marginTop: '0.75rem' }}>
              <MetricBox label="Meetings last 7 days" value={thisWeek} color={scoreColor} />
              <MetricBox label="Inconvenient meetings" value={sufferingScore} color="var(--text-primary)" />
              <MetricBox label="Inconvenience reward" value={`+${sufferingScore} pts`} color="var(--success)" />
            </div>
          </div>

          {/* How scoring works explainer */}
          <div className="pv-card">
            <button
              onClick={() => setShowFairnessExplainer(v => !v)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                width: '100%', padding: 0,
                color: 'var(--text-primary)', fontFamily: 'inherit',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600 }}>How is my score calculated?</h3>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{showFairnessExplainer ? '▲' : '▼'}</span>
            </button>
            {showFairnessExplainer && (
              <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {[
                  { label: 'Starting score', desc: 'Everyone starts at 100' },
                  { label: '−2 per meeting this week', desc: 'Each meeting you attend reduces your score slightly' },
                  { label: '−5 per cancellation', desc: 'Cancelling meetings penalizes your score more heavily' },
                  { label: '+3 per inconvenient meeting', desc: 'Accepting meetings outside your preferred hours earns bonus points' },
                  { label: 'Slot scoring', desc: 'Time slots are scored by time-of-day, day-of-week, and participant load balance' },
                ].map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: '0.75rem', padding: '0.6rem 0.8rem',
                    background: 'var(--bg-raised)', borderRadius: 'var(--radius-sm)',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Calendar card (full card version) ── */
function CalendarCard({ brand, name, status, onConnect, onDisconnect }) {
  const isConnected = !!status?.connected;
  return (
    <div className="pv-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <div className={`cal-provider-icon ${brand === 'google' ? 'google-icon' : 'ms-icon'}`}>
        {brand === 'google' ? 'G' : 'M'}
      </div>
      <div className="cal-provider-info">
        <span className="cal-provider-name">{name}</span>
        <span className={isConnected ? 'cal-status-connected' : 'cal-status-disconnected'}>
          {isConnected ? status.email : 'Not connected'}
        </span>
      </div>
      {isConnected ? (
        <button className="cal-btn cal-btn-disconnect" onClick={onDisconnect}>Disconnect</button>
      ) : (
        <button className="cal-btn cal-btn-connect" onClick={() => onConnect(brand)}>Connect</button>
      )}
    </div>
  );
}

function MetricBox({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--bg-raised)', borderRadius: 'var(--radius-md)',
      padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem',
    }}>
      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: '1.5rem', fontWeight: 800, color: color || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

function StatItem({ val, label, color }) {
  return (
    <div className="pv-stat">
      <span className="pv-stat-val" style={{ color: color || 'var(--text-primary)' }}>{val}</span>
      <span className="pv-stat-label">{label}</span>
    </div>
  );
}
