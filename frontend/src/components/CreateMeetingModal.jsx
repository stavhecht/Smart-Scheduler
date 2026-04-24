import { useState, useEffect } from 'react';
import { apiPost } from '../apiClient';
import { CalendarPlus, CalendarDays, X } from 'lucide-react';
import { useToast } from '../context/ToastContext.jsx';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validateEmails = (str) => {
  const list = str.split(',').map(s => s.trim()).filter(Boolean);
  return { list, invalid: list.filter(e => !EMAIL_REGEX.test(e)) };
};

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
  const [emailError, setEmailError] = useState('');
  const [newMeeting, setNewMeeting] = useState({
    title: '', durationMinutes: 60, participantEmails: '', daysForward: 7, description: '',
  });

  // Apply prefill on mount
  useEffect(() => {
    if (prefill) {
      if (typeof prefill === 'object' && prefill?.datetime) {
        setWizardDatetime(prefill.datetime);
      } else if (typeof prefill === 'string') {
        setNewMeeting(prev => ({ ...prev, participantEmails: prefill }));
      }
    }
  }, []);

  // Escape key closes modal
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const { list: emails, invalid } = validateEmails(newMeeting.participantEmails);
    if (invalid.length > 0) {
      setEmailError(`Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`);
      return;
    }
    setEmailError('');
    setCreating(true);
    try {
      await apiPost('/api/meetings/create', {
        title: newMeeting.title,
        description: newMeeting.description || '',
        durationMinutes: Number(newMeeting.durationMinutes),
        participantEmails: emails,
        participantIds: [],
        daysForward: newMeeting.daysForward,
      });
      notify('Meeting created! AI is optimizing slots…', 'success');
      onRefresh?.();
      onCreated?.();
    } catch (err) {
      notify('Failed to create meeting', 'error');
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
                <button type="button" className="btn-submit"
                  onClick={() => {
                    if (!newMeeting.title.trim()) { setTitleTouched(true); return; }
                    setWizardStep(2);
                  }}
                >Next →</button>
                <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
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
                {(() => {
                  const count = newMeeting.participantEmails.split(',').map(s => s.trim()).filter(Boolean).length;
                  return (
                    <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Invite Participants</span>
                      {count > 0 && <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{count} participant{count !== 1 ? 's' : ''}</span>}
                    </label>
                  );
                })()}
                <input
                  type="text" autoFocus required
                  placeholder="alice@co.com, bob@co.com"
                  value={newMeeting.participantEmails}
                  onChange={e => { setNewMeeting({ ...newMeeting, participantEmails: e.target.value }); setEmailError(''); }}
                  onKeyDown={e => e.key === 'Enter' && e.preventDefault()}
                />
                {emailError
                  ? <span className="form-hint" style={{ color: '#f87171' }}>{emailError}</span>
                  : <span className="form-hint">Comma-separated emails. They'll see this in their dashboard.</span>
                }
              </div>
              <div className="form-group">
                <label>Scheduling Horizon</label>
                <div className="dur-pills">
                  {[{ days: 3, label: '3 days' }, { days: 7, label: '1 week' }, { days: 14, label: '2 weeks' }].map(({ days, label }) => (
                    <button key={days} type="button"
                      className={`dur-pill ${newMeeting.daysForward === days ? 'active' : ''}`}
                      onClick={() => setNewMeeting({ ...newMeeting, daysForward: days })}
                    >{label}</button>
                  ))}
                </div>
                <span className="form-hint">How far ahead the AI will search for available slots.</span>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setWizardStep(1)}>← Back</button>
                <button type="button" className="btn-submit"
                  disabled={!newMeeting.participantEmails.trim()}
                  onClick={() => {
                    const { invalid } = validateEmails(newMeeting.participantEmails);
                    if (invalid.length > 0) {
                      setEmailError(`Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`);
                    } else {
                      setEmailError('');
                      setWizardStep(3);
                    }
                  }}
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
                    {newMeeting.participantEmails.split(',').map(e => e.trim()).filter(Boolean).map(e => (
                      <span key={e} className="review-chip">{e}</span>
                    ))}
                  </div>
                </div>
                <div className="review-row">
                  <span className="review-label">Horizon</span>
                  <span className="review-chip">{newMeeting.daysForward === 3 ? '3 days' : newMeeting.daysForward === 7 ? '1 week' : '2 weeks'}</span>
                </div>
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
