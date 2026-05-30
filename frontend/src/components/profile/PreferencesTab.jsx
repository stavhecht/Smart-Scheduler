import { useState, useEffect, useRef } from 'react';
import { apiPost } from '../../apiClient';
import PrefRow from './PrefRow.jsx';
import { DAYS, TIMEZONES, extractPrefs, parseHour } from './profileUtils.js';

export default function PreferencesTab({ profile, onProfileUpdate }) {
  const [prefsDraft, setPrefsDraft]   = useState(() => extractPrefs(profile));
  const [savedPrefs, setSavedPrefs]   = useState(() => extractPrefs(profile));
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSaved, setPrefsSaved]   = useState(false);
  const prefsDraftRef                 = useRef(prefsDraft);
  const [tzSearch, setTzSearch]       = useState('');
  const [tzOpen, setTzOpen]           = useState(false);
  const tzRef                         = useRef(null);
  const trackRef                      = useRef(null);

  // Close timezone dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (tzRef.current && !tzRef.current.contains(e.target)) setTzOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSaveAllPrefs = async () => {
    setPrefsSaving(true);
    try {
      const merged = { ...profile, ...prefsDraft };
      const res = await apiPost('/api/profile/update', merged);
      if (res.status === 'success') {
        const updated = { ...profile, ...res.profile };
        if (onProfileUpdate) onProfileUpdate(updated);
        const newPrefs = extractPrefs(updated);
        setPrefsDraft(newPrefs);
        setSavedPrefs(newPrefs);
        setPrefsSaved(true);
        setTimeout(() => setPrefsSaved(false), 2000);
      }
    } catch (err) {
      console.error('Preferences save failed:', err);
    } finally {
      setPrefsSaving(false);
    }
  };

  // Preferences display reads exclusively from prefsDraft so saving + remounting always
  // reflects the last-saved state without any profile↔draft sync issues.
  const workingHours = prefsDraft.workingHours || { start: '09:00', end: '18:00' };
  const workingDays  = prefsDraft.workingDays  || [0, 1, 2, 3, 4];
  const lunchBreak   = prefsDraft.lunchBreak   || { start: '12:00', duration: 60 };
  const whStartPct   = (parseHour(workingHours.start) / 24) * 100;
  const whEndPct     = (parseHour(workingHours.end)   / 24) * 100;
  const notifPrefs   = prefsDraft.notificationPrefs || { invites: true, reminders: true, digest: false };

  // Keep ref pointing at latest prefsDraft so wheel/drag listeners with [] deps stay fresh
  prefsDraftRef.current = prefsDraft;

  // Non-passive wheel listener so we can call e.preventDefault() and block page scroll
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (e) => {
      e.preventDefault();
      const wh = prefsDraftRef.current.workingHours || { start: '09:00', end: '18:00' };
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 2) return;
      const shift = delta > 0 ? 1 : -1;
      const curS = parseHour(wh.start);
      const curE = parseHour(wh.end);
      if (curS + shift >= 0 && curE + shift <= 24) {
        const fmt = h => `${h.toString().padStart(2, '0')}:00`;
        const newWh = { start: fmt(curS + shift), end: fmt(curE + shift) };
        setPrefsDraft(d => ({ ...d, workingHours: newWh }));
      }
    };
    track.addEventListener('wheel', onWheel, { passive: false });
    return () => track.removeEventListener('wheel', onWheel);
  }, []);

  // Drag handler: 'start' handle | 'end' handle | 'move' (whole bar)
  const handleBarMouseDown = (e, dragType) => {
    e.preventDefault();
    const track = trackRef.current;
    if (!track) return;
    const rect     = track.getBoundingClientRect();
    const startX   = e.clientX;
    const wh0      = prefsDraftRef.current.workingHours || { start: '09:00', end: '18:00' };
    const startS   = parseHour(wh0.start);
    const startE   = parseHour(wh0.end);
    const duration = startE - startS;
    const fmt = h => `${h.toString().padStart(2, '0')}:00`;

    const onMove = (ev) => {
      const dx        = ev.clientX - startX;
      const hourDelta = Math.round((dx / rect.width) * 24);
      let newWh;
      if (dragType === 'start') {
        const newS = Math.max(0, Math.min(startE - 1, startS + hourDelta));
        newWh = { start: fmt(newS), end: fmt(startE) };
      } else if (dragType === 'end') {
        const newE = Math.max(startS + 1, Math.min(24, startE + hourDelta));
        newWh = { start: fmt(startS), end: fmt(newE) };
      } else {
        const newS = Math.max(0, Math.min(24 - duration, startS + hourDelta));
        newWh = { start: fmt(newS), end: fmt(newS + duration) };
      }
      setPrefsDraft(d => ({ ...d, workingHours: newWh }));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      {/* Timezone & Working Hours */}
      <div className="pv-card">
        <h3>Time & Availability</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
              Timezone
            </label>
            {/* Searchable timezone picker */}
            <div ref={tzRef} style={{ position: 'relative' }}>
              <div
                className="pv-input-sub"
                onClick={() => { setTzOpen(o => !o); setTzSearch(''); }}
                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span>{prefsDraft.timezone || 'Asia/Jerusalem'}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{tzOpen ? '▲' : '▼'}</span>
              </div>
              {tzOpen && (
                <div style={{
                  position: 'absolute', zIndex: 100, top: '100%', left: 0, right: 0,
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-raised)',
                  overflow: 'hidden', marginTop: '2px',
                }}>
                  <input
                    autoFocus
                    className="pv-input-sub"
                    placeholder="Search timezone…"
                    value={tzSearch}
                    onChange={e => setTzSearch(e.target.value)}
                    style={{ margin: '6px', width: 'calc(100% - 12px)', boxSizing: 'border-box' }}
                    onKeyDown={e => { if (e.key === 'Escape') setTzOpen(false); }}
                    onClick={e => e.stopPropagation()}
                  />
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {TIMEZONES.filter(tz => tz.toLowerCase().includes(tzSearch.toLowerCase())).map(tz => {
                      const isSelected = tz === (prefsDraft.timezone || 'Asia/Jerusalem');
                      return (
                        <div
                          key={tz}
                          onClick={() => { setPrefsDraft(d => ({ ...d, timezone: tz })); setTzOpen(false); }}
                          style={{
                            padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '0.82rem',
                            background: isSelected ? 'var(--accent-dim)' : 'transparent',
                            color: isSelected ? 'var(--accent)' : 'var(--text-primary)',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-raised)'; }}
                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                        >
                          {tz}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
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
                onChange={e => { setPrefsDraft(d => ({ ...d, workingHours: { ...d.workingHours, start: e.target.value } })); }}
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>End</span>
              <input
                type="time"
                className="pv-input-sub"
                style={{ width: 'auto' }}
                value={workingHours.end}
                onChange={e => { setPrefsDraft(d => ({ ...d, workingHours: { ...d.workingHours, end: e.target.value } })); }}
              />
            </div>
            <div ref={trackRef} className="wh-track" style={{ marginTop: '0.75rem' }}>
              <div
                className="wh-fill"
                style={{ left: `${whStartPct}%`, width: `${whEndPct - whStartPct}%` }}
                onMouseDown={e => handleBarMouseDown(e, 'move')}
              />
              <div
                className="wh-handle"
                style={{ left: `${whStartPct}%` }}
                onMouseDown={e => { e.stopPropagation(); handleBarMouseDown(e, 'start'); }}
              />
              <div
                className="wh-handle"
                style={{ left: `${whEndPct}%` }}
                onMouseDown={e => { e.stopPropagation(); handleBarMouseDown(e, 'end'); }}
              />
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'flex', justifyContent: 'space-between' }}>
              <span>{workingHours.start} – {workingHours.end}</span>
              <span style={{ fontStyle: 'italic', opacity: 0.7 }}>Drag handles · scroll sideways to shift</span>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
              Lunch Break
            </label>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Start</span>
              <input
                type="time"
                className="pv-input-sub"
                style={{ width: 'auto' }}
                value={lunchBreak.start}
                onChange={e => {
                  setPrefsDraft(d => ({ ...d, lunchBreak: { ...d.lunchBreak, start: e.target.value } }));
                }}
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Duration</span>
              <select
                className="pv-input-sub"
                style={{ width: 'auto' }}
                value={lunchBreak.duration}
                onChange={e => {
                  setPrefsDraft(d => ({ ...d, lunchBreak: { ...d.lunchBreak, duration: parseInt(e.target.value, 10) } }));
                }}
              >
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
                <option value={90}>90 min</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
              Working Days
            </label>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {DAYS.map((d, i) => {
                const isActive = workingDays.includes(i);
                return (
                  <button
                    key={d}
                    className={`wd-day-btn${isActive ? ' active' : ''}`}
                    onClick={() => {
                      const newDays = isActive
                        ? workingDays.filter(day => day !== i)
                        : [...workingDays, i].sort();
                      setPrefsDraft(d => ({ ...d, workingDays: newDays }));
                    }}
                  >
                    {d}
                  </button>
                );
              })}
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
            onChange={v => { setPrefsDraft(d => ({ ...d, notificationPrefs: { ...d.notificationPrefs, invites: v } })); }}
          />
          <PrefRow
            label="Meeting reminders"
            desc="Email me reminders 1 hour before meetings"
            on={notifPrefs.reminders}
            onChange={v => { setPrefsDraft(d => ({ ...d, notificationPrefs: { ...d.notificationPrefs, reminders: v } })); }}
          />
          <div style={{ borderBottom: 'none' }}>
            <PrefRow
              label="Weekly fairness digest"
              desc="Weekly email summary of your fairness score and activity"
              on={notifPrefs.digest}
              onChange={v => { setPrefsDraft(d => ({ ...d, notificationPrefs: { ...d.notificationPrefs, digest: v } })); }}
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
            on={prefsDraft.showFairnessScore ?? true}
            onChange={v => { setPrefsDraft(d => ({ ...d, showFairnessScore: v })); }}
          />
        </div>
      </div>

      {/* Save preferences button */}
      {(() => {
        const isDirty = JSON.stringify(prefsDraft) !== JSON.stringify(savedPrefs);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingTop: '0.25rem' }}>
            <button
              className="pv-btn primary"
              style={{ minWidth: '120px' }}
              disabled={!isDirty || prefsSaving}
              onClick={handleSaveAllPrefs}
            >
              {prefsSaving ? 'Saving…' : prefsSaved ? 'Saved ✓' : 'Save Preferences'}
            </button>
            {!isDirty && !prefsSaved && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No unsaved changes</span>
            )}
          </div>
        );
      })()}
    </div>
  );
}
