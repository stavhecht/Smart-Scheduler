import { Pencil, X } from 'lucide-react';

/* Edit meeting modal — controlled by parent via editModal + setEditModal */
export default function EditMeetingModal({ editModal, setEditModal, onSubmit }) {
  if (!editModal) return null;
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditModal(null)}>
      <div className="modal-box">
        <div className="modal-head">
          <h3><Pencil size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />Edit Meeting</h3>
          <button className="modal-close" onClick={() => setEditModal(null)}><X size={14} /></button>
        </div>
        <form onSubmit={onSubmit} className="modal-form">
          <div className="form-group">
            <label>Meeting Title</label>
            <input
              autoFocus required
              value={editModal.title}
              onChange={e => setEditModal({ ...editModal, title: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Duration</label>
            <div className="dur-pills">
              {[15, 30, 45, 60, 90].map(d => (
                <button
                  key={d} type="button"
                  className={`dur-pill ${editModal.durationMinutes === d ? 'active' : ''}`}
                  onClick={() => setEditModal({ ...editModal, durationMinutes: d })}
                >
                  {d < 60 ? `${d}m` : d === 60 ? '1h' : '1.5h'}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Scheduling Range</label>
            <div className="dur-pills">
              {[{ label: '3 days', value: '3' }, { label: '1 week', value: '7' }, { label: '2 weeks', value: '14' }, { label: '1 month', value: '30' }, { label: 'Custom', value: 'custom' }].map(opt => (
                <button
                  key={opt.value} type="button"
                  className={`dur-pill ${editModal.schedPreset === opt.value ? 'active' : ''}`}
                  onClick={() => setEditModal({ ...editModal, schedPreset: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {editModal.schedPreset === 'custom' && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={editModal.customDays || 14}
                  onChange={e => setEditModal({ ...editModal, customDays: parseInt(e.target.value) || 14 })}
                  style={{ width: '80px' }}
                />
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>days from today</span>
              </div>
            )}
            {editModal.isPending
              ? <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>Saving will regenerate slot suggestions.</p>
              : <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>Preferences saved. Click <strong>Regenerate</strong> after saving to get new slots.</p>
            }
          </div>
          <div className="form-group">
            <label>Time of Day</label>
            <div className="dur-pills">
              {[{ label: 'Any time', value: 'all' }, { label: 'Morning 8–12', value: 'morning' }, { label: 'Afternoon 12–17', value: 'afternoon' }, { label: 'Evening 17–20', value: 'evening' }].map(opt => (
                <button
                  key={opt.value} type="button"
                  className={`dur-pill ${editModal.timeWindow === opt.value ? 'active' : ''}`}
                  onClick={() => setEditModal({ ...editModal, timeWindow: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Skip Weekdays <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <div className="dur-pills" style={{ flexWrap: 'wrap' }}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
                <button
                  key={i} type="button"
                  className={`dur-pill ${(editModal.excludedWeekdays || []).includes(i) ? 'active' : ''}`}
                  style={(editModal.excludedWeekdays || []).includes(i) ? { background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.5)', color: '#ef4444' } : {}}
                  onClick={() => {
                    const curr = editModal.excludedWeekdays || [];
                    const next = curr.includes(i) ? curr.filter(d => d !== i) : [...curr, i];
                    setEditModal({ ...editModal, excludedWeekdays: next });
                  }}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Agenda / Notes</label>
            <textarea
              rows={3}
              maxLength={2000}
              placeholder="Agenda, links, context…"
              value={editModal.description ?? ''}
              onChange={e => setEditModal({ ...editModal, description: e.target.value })}
              style={{ resize: 'vertical', minHeight: '70px' }}
            />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn-submit">💾 Save Changes</button>
            <button type="button" className="btn-cancel" onClick={() => setEditModal(null)}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
