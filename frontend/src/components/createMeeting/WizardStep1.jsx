/* Step 1: What & How Long */
export default function WizardStep1({
  newMeeting, setNewMeeting,
  titleTouched, setTitleTouched,
  onCancel, onNext,
}) {
  return (
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
        <button type="button" className="btn-cancel" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-submit"
          onClick={() => {
            if (!newMeeting.title.trim()) { setTitleTouched(true); return; }
            onNext();
          }}
        >Next →</button>
      </div>
    </div>
  );
}
