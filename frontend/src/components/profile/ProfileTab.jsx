import { useState } from 'react';
import { apiPost } from '../../apiClient';
import StatItem from './StatItem.jsx';
import { STATUS_PRESETS, getStatusDotColor, computeCompleteness } from './profileUtils.js';

export default function ProfileTab({ profile, meetings, stats, onProfileUpdate }) {
  const [isEditing, setIsEditing]     = useState(false);
  const [tempProfile, setTempProfile] = useState(profile);
  const [skillInput, setSkillInput]   = useState('');
  const [isUpdating, setIsUpdating]   = useState(false);
  const [saveError, setSaveError]     = useState('');

  const total      = meetings.length;
  const confirmed  = meetings.filter(m => m.status === 'confirmed').length;
  const organized  = stats?.total_organized ?? meetings.filter(m => m.userRole === 'organizer').length;
  const invited    = meetings.filter(m => m.userRole === 'participant').length;
  const thisWeek   = stats?.meetings_this_week ?? profile.details?.meetings_this_week ?? 0;

  const handleSaveProfile = async () => {
    setSaveError('');
    setIsUpdating(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(tempProfile).filter(([, v]) => v !== null && v !== undefined)
      );
      const res = await apiPost('/api/profile/update', payload);
      if (res.status === 'success') {
        const updated = { ...profile, ...res.profile, displayName: res.profile.displayName };
        setIsEditing(false);
        onProfileUpdate?.(updated);
      }
    } catch (err) {
      setSaveError('Failed to update: ' + err.message);
    } finally {
      setIsUpdating(false);
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

  return (
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
              {(() => {
                const n = profile.displayName || profile.name || '';
                const looksLikeUsername = !n.includes(' ') && /[\d.]/.test(n);
                return looksLikeUsername ? (
                  <div style={{ fontSize: '0.74rem', color: '#fbbf24', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '6px', padding: '0.35rem 0.6rem', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    💡 Set your real name for a better experience{' '}
                    <button
                      onClick={() => { setTempProfile(profile); setIsEditing(true); setSaveError(''); setSkillInput(''); }}
                      style={{ background: 'none', border: 'none', color: '#fbbf24', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 'inherit', fontFamily: 'inherit' }}
                    >Edit profile</button>
                  </div>
                ) : null;
              })()}
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
  );
}
