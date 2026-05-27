import { useState, useEffect, useRef } from 'react';
import { apiPost, apiGet } from '../apiClient';
import { CalendarPlus, CalendarDays, X } from 'lucide-react';
import { useToast } from '../context/ToastContext.jsx';

/**
 * Global Create Meeting Modal.
 * Props:
 *   prefill      – string (email) or { datetime: ISO } or null
 *   onClose      – called when modal is dismissed without creating
 *   onCreated    – called after successful creation
 *   onRefresh    – refresh meetings list
 */
export default function CreateMeetingModal({ prefill, onClose, onCreated, onRefresh }) {
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardDatetime, setWizardDatetime] = useState(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [newMeeting, setNewMeeting] = useState({
    title: '', durationMinutes: 60, daysForward: 7, description: '',
  });

  // Scheduling preferences state
  const [schedPreset, setSchedPreset] = useState('7');      // '3','7','14','30','custom'
  const [customFrom, setCustomFrom] = useState('');          // YYYY-MM-DD
  const [customDays, setCustomDays] = useState(14);
  const [timeWindow, setTimeWindow] = useState('all');       // 'all','morning','afternoon','evening'
  const [excludedWeekdays, setExcludedWeekdays] = useState([]); // [0-6]
  const [showAdvanced, setShowAdvanced] = useState(false);

  // User search state
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoadError, setUsersLoadError] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);

  // Load all registered users once on mount
  useEffect(() => {
    apiGet('/api/users').then(data => {
      const list = Array.isArray(data) ? data : (data?.users ?? []);
      setAllUsers(list);
    }).catch(() => setUsersLoadError(true));
  }, []);

  // Apply prefill on mount
  useEffect(() => {
    if (prefill) {
      if (typeof prefill === 'object' && prefill?.parsed) {
        // NL-parsed prefill from the command palette
        const p = prefill.parsed;
        setNewMeeting(m => ({
          ...m,
          title: p.title || m.title,
          durationMinutes: p.durationMinutes || m.durationMinutes,
          daysForward: p.daysForward || m.daysForward,
          description: p.description || m.description,
        }));
        setTitleTouched(true);
        // Resolve parsed participants against the loaded user list
        (p.participants || []).forEach(parsedUser => {
          const match = allUsers.find(u =>
            u.userId === parsedUser.userId ||
            (parsedUser.email && u.email === parsedUser.email)
          );
          if (match) addUser(match);
        });
      } else if (typeof prefill === 'object' && prefill?.datetime) {
        setWizardDatetime(prefill.datetime);
      } else if (typeof prefill === 'string') {
        // Try to match a registered user by email
        const match = allUsers.find(u => u.email === prefill || u.userId === prefill);
        if (match) addUser(match);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUsers]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          searchRef.current && !searchRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Escape key closes modal
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addUser = (user) => {
    if (!selectedUsers.find(u => u.userId === user.userId)) {
      setSelectedUsers(prev => [...prev, user]);
    }
    setSearchQuery('');
    setDropdownOpen(false);
  };

  const removeUser = (userId) => {
    setSelectedUsers(prev => prev.filter(u => u.userId !== userId));
  };

  const filteredUsers = searchQuery.trim()
    ? allUsers.filter(u => {
        if (selectedUsers.find(s => s.userId === u.userId)) return false;
        const q = searchQuery.toLowerCase();
        const name = (u.displayName || u.name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        return name.includes(q) || email.includes(q);
      }).slice(0, 8)
    : [];

  // Derive scheduling params from UI state
  const daysForward = schedPreset === 'custom' ? Math.max(1, Math.min(90, customDays)) : parseInt(schedPreset);
  const dateRangeStart = schedPreset === 'custom' && customFrom ? customFrom : undefined;
  const preferredHours = timeWindow === 'morning'   ? [8, 9, 10, 11]
                       : timeWindow === 'afternoon' ? [12, 13, 14, 15, 16]
                       : timeWindow === 'evening'   ? [17, 18, 19, 20]
                       : null;

  const schedLabel = schedPreset === 'custom'
    ? `${daysForward} days${customFrom ? ` from ${customFrom}` : ''}`
    : schedPreset === '3' ? '3 days' : schedPreset === '7' ? '1 week'
    : schedPreset === '14' ? '2 weeks' : '1 month';

  const timeLabel = timeWindow === 'morning' ? 'Morning (8–12)'
                  : timeWindow === 'afternoon' ? 'Afternoon (12–17)'
                  : timeWindow === 'evening' ? 'Evening (17–20)'
                  : 'All hours';

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const toggleWeekday = (d) => setExcludedWeekdays(prev =>
    prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
  );

  const handleCreate = async (e) => {
    e.preventDefault();
    if (selectedUsers.length === 0) return;
    setCreating(true);
    try {
      await apiPost('/api/meetings/create', {
        title: newMeeting.title,
        description: newMeeting.description || '',
        durationMinutes: Number(newMeeting.durationMinutes),
        participantEmails: selectedUsers.map(u => u.email),
        participantIds: selectedUsers.map(u => u.userId),
        daysForward,
        ...(dateRangeStart ? { dateRangeStart } : {}),
        ...(preferredHours ? { preferredHours } : {}),
        ...(excludedWeekdays.length ? { excludedWeekdays } : {}),
      });
      notify('Meeting created! AI is optimizing slots…', 'success');
      onRefresh?.();
      onCreated?.();
    } catch (err) {
      notify(err?.message || 'Failed to create meeting', 'error');
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-head">
          <h3><CalendarPlus size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />New Meeting Request</h3>
          <button className="modal-close" onClick={onClose}><X size={14} /></button>
        </div>
        <form onSubmit={handleCreate} className="modal-form">
          {/* Wizard step indicator */}
          <div className="wizard-steps">
            {[1,2,3].map(n => (
              <div key={n} className={`wizard-dot${wizardStep >= n ? ' done' : ''}${wizardStep === n ? ' active' : ''}`} />
            ))}
            <span className="wizard-label">Step {wizardStep} of 3</span>
          </div>

          {/* Step 1: What & How Long */}
          {wizardStep === 1 && (
            <div className="wizard-step">
              <div className="wizard-step-title">What are you meeting about?</div>
              <div className="form-group">
                <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Meeting Title</span>
                  <span style={{ fontWeight: 400, color: newMeeting.title.length > 180 ? '#f87171' : 'var(--text-secondary)', fontSize: '0.75rem' }}>
                    {newMeeting.title.length}/200
                  </span>
                </label>
                <input
                  autoFocus required maxLength={200}
                  placeholder="e.g. Weekly Team Sync"
                  value={newMeeting.title}
                  onChange={e => {
                    setNewMeeting({ ...newMeeting, title: e.target.value });
                    if (e.target.value.trim()) setTitleTouched(false);
                  }}
                  onKeyDown={e => e.key === 'Enter' && e.preventDefault()}
                />
                {titleTouched && !newMeeting.title.trim() && (
                  <p className="field-error">Please enter a meeting title</p>
                )}
              </div>
              <div className="form-group">
                <label>Duration</label>
                <div className="dur-pills">
                  {[15, 30, 45, 60, 90].map(d => (
                    <button key={d} type="button"
                      className={`dur-pill ${newMeeting.durationMinutes === d ? 'active' : ''}`}
                      onClick={() => setNewMeeting({ ...newMeeting, durationMinutes: d })}
                    >
                      {d < 60 ? `${d}m` : d === 60 ? '1h' : '1.5h'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
                <button type="button" className="btn-submit"
                  onClick={() => {
                    if (!newMeeting.title.trim()) { setTitleTouched(true); return; }
                    setWizardStep(2);
                  }}
                >Next →</button>
              </div>
            </div>
          )}

          {/* Step 2: Who & When */}
          {wizardStep === 2 && (
            <div className="wizard-step">
              <div className="wizard-step-title">Who's joining and when?</div>
              {wizardDatetime && (
                <div className="wizard-datetime-badge">
                  <CalendarDays size={13} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />Suggested: {new Date(wizardDatetime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              <div className="form-group">
                <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Invite Participants</span>
                  {selectedUsers.length > 0 && (
                    <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      {selectedUsers.length} participant{selectedUsers.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </label>

                {/* Selected user chips */}
                {selectedUsers.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem' }}>
                    {selectedUsers.map(u => (
                      <span key={u.userId} style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                        padding: '0.2rem 0.55rem', borderRadius: '20px', fontSize: '0.78rem',
                        background: 'var(--accent-dim)', color: 'var(--accent)',
                        border: '1px solid rgba(99,102,241,0.3)',
                      }}>
                        {u.displayName || u.name || u.email}
                        <button
                          type="button"
                          onClick={() => removeUser(u.userId)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1, fontSize: '0.9rem' }}
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Search input + dropdown */}
                <div style={{ position: 'relative' }} ref={dropdownRef}>
                  <input
                    ref={searchRef}
                    autoFocus
                    type="text"
                    placeholder="Search by name or email…"
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setDropdownOpen(true); }}
                    onFocus={() => searchQuery && setDropdownOpen(true)}
                    onKeyDown={e => e.key === 'Enter' && e.preventDefault()}
                  />
                  {usersLoadError && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-warning)', marginTop: '0.3rem' }}>
                      Could not load users — enter email manually below
                    </div>
                  )}
                  {dropdownOpen && searchQuery.trim() && (
                    <div style={{
                      position: 'absolute', zIndex: 200, top: '100%', left: 0, right: 0,
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-raised)',
                      marginTop: '2px', maxHeight: '220px', overflowY: 'auto',
                    }}>
                      {filteredUsers.length === 0 ? (
                        <div style={{ padding: '0.75rem 1rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          No registered users found
                        </div>
                      ) : filteredUsers.map(u => (
                        <div
                          key={u.userId}
                          onMouseDown={e => { e.preventDefault(); addUser(u); }}
                          style={{
                            padding: '0.6rem 1rem', cursor: 'pointer', fontSize: '0.84rem',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            borderBottom: '1px solid var(--border)',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-raised)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                            {u.displayName || u.name || u.email}
                          </span>
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{u.email}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <span className="form-hint">Search registered users. They'll see this in their dashboard.</span>
              </div>

              {/* Scheduling range */}
              <div className="form-group">
                <label>Scheduling Range</label>
                <div className="dur-pills" style={{ flexWrap: 'wrap' }}>
                  {[{ v: '3', l: '3 days' }, { v: '7', l: '1 week' }, { v: '14', l: '2 weeks' }, { v: '30', l: '1 month' }, { v: 'custom', l: 'Custom…' }].map(({ v, l }) => (
                    <button key={v} type="button"
                      className={`dur-pill ${schedPreset === v ? 'active' : ''}`}
                      onClick={() => setSchedPreset(v)}
                    >{l}</button>
                  ))}
                </div>
                {schedPreset === 'custom' && (
                  <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>Start date (optional)</span>
                      <input
                        type="date"
                        value={customFrom}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={e => setCustomFrom(e.target.value)}
                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.82rem', width: '145px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>Days to search</span>
                      <input
                        type="number" min={1} max={90}
                        value={customDays}
                        onChange={e => setCustomDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 1)))}
                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.82rem', width: '80px' }}
                      />
                    </div>
                  </div>
                )}
                <span className="form-hint">How far ahead the AI will search for available slots.</span>
              </div>

              {/* Advanced: time preferences */}
              <div className="form-group">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--accent)', fontSize: '0.82rem', padding: 0,
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                  }}
                >
                  <span style={{ fontSize: '0.7rem' }}>{showAdvanced ? '▾' : '▸'}</span>
                  Time & day preferences {(timeWindow !== 'all' || excludedWeekdays.length > 0) && (
                    <span style={{ background: 'var(--accent-dim)', color: 'var(--accent)', borderRadius: '10px', padding: '0 0.4rem', fontSize: '0.72rem' }}>active</span>
                  )}
                </button>

                {showAdvanced && (
                  <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    {/* Time of day */}
                    <div>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>Time of day</span>
                      <div className="dur-pills">
                        {[
                          { v: 'all', l: 'Any time' },
                          { v: 'morning', l: 'Morning 8–12' },
                          { v: 'afternoon', l: 'Afternoon 12–17' },
                          { v: 'evening', l: 'Evening 17–20' },
                        ].map(({ v, l }) => (
                          <button key={v} type="button"
                            className={`dur-pill ${timeWindow === v ? 'active' : ''}`}
                            onClick={() => setTimeWindow(v)}
                          >{l}</button>
                        ))}
                      </div>
                    </div>

                    {/* Exclude weekdays */}
                    <div>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                        Exclude days <span style={{ fontWeight: 400 }}>(click to skip)</span>
                      </span>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {DAY_NAMES.map((name, idx) => (
                          <button key={idx} type="button"
                            onClick={() => toggleWeekday(idx)}
                            style={{
                              padding: '0.25rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem',
                              border: '1px solid var(--border)', cursor: 'pointer',
                              background: excludedWeekdays.includes(idx) ? 'rgba(239,68,68,0.12)' : 'var(--bg-raised)',
                              color: excludedWeekdays.includes(idx) ? '#f87171' : 'var(--text-secondary)',
                              textDecoration: excludedWeekdays.includes(idx) ? 'line-through' : 'none',
                            }}
                          >{name}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setWizardStep(1)}>← Back</button>
                <button type="button" className="btn-submit"
                  disabled={selectedUsers.length === 0}
                  onClick={() => setWizardStep(3)}
                >Next →</button>
              </div>
            </div>
          )}

          {/* Step 3: Review & Create */}
          {wizardStep === 3 && (
            <div className="wizard-step">
              <div className="wizard-step-title">Review & confirm</div>
              <div className="wizard-review">
                <div className="review-row">
                  <span className="review-label">Meeting</span>
                  <span className="review-chip">{newMeeting.title}</span>
                </div>
                <div className="review-row">
                  <span className="review-label">Duration</span>
                  <span className="review-chip">{newMeeting.durationMinutes < 60 ? `${newMeeting.durationMinutes}m` : newMeeting.durationMinutes === 60 ? '1h' : '1.5h'}</span>
                </div>
                <div className="review-row">
                  <span className="review-label">Participants</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {selectedUsers.map(u => (
                      <span key={u.userId} className="review-chip">{u.displayName || u.name || u.email}</span>
                    ))}
                  </div>
                </div>
                <div className="review-row">
                  <span className="review-label">Range</span>
                  <span className="review-chip">{schedLabel}</span>
                </div>
                {(timeWindow !== 'all' || excludedWeekdays.length > 0) && (
                  <div className="review-row">
                    <span className="review-label">Preferences</span>
                    <span className="review-chip">
                      {[
                        timeWindow !== 'all' ? timeLabel : null,
                        excludedWeekdays.length ? `skip ${excludedWeekdays.map(d => DAY_NAMES[d]).join(', ')}` : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Agenda / Notes <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>(optional)</span></span>
                  <span style={{ fontWeight: 400, color: (newMeeting.description?.length || 0) > 1800 ? '#f87171' : 'var(--text-secondary)', fontSize: '0.75rem' }}>
                    {newMeeting.description?.length || 0}/2000
                  </span>
                </label>
                <textarea rows={3} maxLength={2000}
                  placeholder="What will you discuss? Any context or links…"
                  value={newMeeting.description}
                  onChange={e => setNewMeeting({ ...newMeeting, description: e.target.value })}
                  style={{ resize: 'vertical', minHeight: '70px' }}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setWizardStep(2)}>← Back</button>
                <button type="submit" className="btn-submit" disabled={creating} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center' }}>
                  {creating ? <><span className="btn-spinner" />Creating…</> : 'Optimise & Create'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
