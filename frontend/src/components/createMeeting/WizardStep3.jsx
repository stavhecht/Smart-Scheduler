const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* Step 3: Review & Create */
export default function WizardStep3({
  newMeeting, setNewMeeting,
  selectedUsers,
  schedLabel,
  timeWindow, timeLabel,
  excludedWeekdays,
  creating,
  onBack,
}) {
  return (
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
        <button type="button" className="btn-cancel" onClick={onBack}>← Back</button>
        <button type="submit" className="btn-submit" disabled={creating} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center' }}>
          {creating ? <><span className="btn-spinner" />Creating…</> : 'Optimise & Create'}
        </button>
      </div>
    </div>
  );
}
