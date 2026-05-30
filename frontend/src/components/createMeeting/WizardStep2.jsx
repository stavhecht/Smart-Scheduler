import { CalendarDays } from 'lucide-react';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* Step 2: Who & When */
export default function WizardStep2({
  wizardDatetime,
  selectedUsers, addUser, removeUser,
  searchQuery, setSearchQuery,
  dropdownOpen, setDropdownOpen,
  filteredUsers, usersLoadError,
  searchRef, dropdownRef,
  schedPreset, setSchedPreset,
  customFrom, setCustomFrom,
  customDays, setCustomDays,
  timeWindow, setTimeWindow,
  excludedWeekdays, toggleWeekday,
  showAdvanced, setShowAdvanced,
  onBack, onNext,
}) {
  return (
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
        <button type="button" className="btn-cancel" onClick={onBack}>← Back</button>
        <button type="button" className="btn-submit"
          disabled={selectedUsers.length === 0}
          onClick={onNext}
        >Next →</button>
      </div>
    </div>
  );
}
