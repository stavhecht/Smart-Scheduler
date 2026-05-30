import { useState, useEffect } from 'react';
import { Ban, X, ArrowLeft, Check } from 'lucide-react';

const REASONS = [
  { key: 'personal', label: 'Personal',  hint: 'Personal commitment'           },
  { key: 'busy',     label: 'Busy',      hint: 'Conflicts with my schedule'    },
  { key: 'other',    label: 'Other',     hint: 'Something else'                },
];

/**
 * Multi-step decline wizard:
 *   1. Confirm   — "Are you sure?"
 *   2. Reason    — Personal / Busy / Other (optional comment when Other)
 *   3. Done      — confirmation
 *
 * Props:
 *   meeting       (optional) – the meeting being declined, for context (title)
 *   onSubmit(reason, comment) – async; throws to abort step transition
 *   onClose()                 – called on cancel / close / after Done
 */
export default function DeclineWizard({ meeting, onSubmit, onClose }) {
  const [step, setStep]         = useState(1);
  const [reason, setReason]     = useState(null);
  const [comment, setComment]   = useState('');
  const [submitting, setSubmit] = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !submitting) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const handleSubmit = async () => {
    if (!reason) return;
    setSubmit(true);
    setError(null);
    try {
      await onSubmit(reason, comment.trim() || null);
      setStep(3);
    } catch (err) {
      setError(err?.message || 'Failed to submit decline');
    } finally {
      setSubmit(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={e => e.target === e.currentTarget && !submitting && onClose()}
    >
      <div className="modal-box confirm-box" style={{ minWidth: 380, maxWidth: 460 }}>
        <div className="modal-head">
          <h3>
            <Ban size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
            Decline Meeting
          </h3>
          <button className="modal-close" onClick={onClose} disabled={submitting}>
            <X size={14} />
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 6, padding: '0.5rem 1rem 0.25rem', justifyContent: 'center' }}>
          {[1, 2, 3].map(n => (
            <span
              key={n}
              style={{
                width: 8, height: 8, borderRadius: '50%',
                background: step >= n ? '#ef4444' : 'rgba(148,163,184,0.3)',
                transition: 'background 200ms',
              }}
            />
          ))}
        </div>

        <div className="confirm-body" style={{ minHeight: 160 }}>
          {step === 1 && (
            <>
              <p style={{ marginBottom: '0.5rem' }}>
                Are you sure you want to decline
                {meeting?.title ? <> <strong>"{meeting.title}"</strong></> : ' this meeting'}?
              </p>
              <p style={{ fontSize: '0.78rem', opacity: 0.7 }}>
                The organizer will be notified. If all invited users decline, the organizer will pick a new slot.
              </p>
              <div className="modal-actions" style={{ marginTop: '1rem' }}>
                <button className="btn-cancel" onClick={onClose}>Cancel</button>
                <button className="btn-danger" onClick={() => setStep(2)}>Continue</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p style={{ marginBottom: '0.6rem', fontSize: '0.86rem' }}>Pick a reason:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {REASONS.map(r => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setReason(r.key)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.6rem 0.8rem',
                      border: `1px solid ${reason === r.key ? '#ef4444' : 'rgba(148,163,184,0.25)'}`,
                      background: reason === r.key ? 'rgba(239,68,68,0.08)' : 'transparent',
                      borderRadius: 6,
                      cursor: 'pointer',
                      color: 'inherit',
                      transition: 'all 150ms',
                      textAlign: 'left',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{r.label}</div>
                      <div style={{ fontSize: '0.74rem', opacity: 0.65 }}>{r.hint}</div>
                    </div>
                    {reason === r.key && <Check size={14} color="#ef4444" />}
                  </button>
                ))}
              </div>
              {reason === 'other' && (
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="(Optional) Add a short note for the organizer"
                  maxLength={500}
                  rows={2}
                  style={{
                    width: '100%', marginTop: '0.6rem',
                    padding: '0.5rem', fontSize: '0.82rem',
                    background: 'rgba(15,23,42,0.4)',
                    border: '1px solid rgba(148,163,184,0.25)',
                    borderRadius: 6, color: 'inherit', resize: 'vertical',
                  }}
                />
              )}
              {error && (
                <p style={{ color: '#f87171', fontSize: '0.78rem', marginTop: '0.5rem' }}>{error}</p>
              )}
              <div className="modal-actions" style={{ marginTop: '0.9rem' }}>
                <button className="btn-cancel" onClick={() => setStep(1)} disabled={submitting}>
                  <ArrowLeft size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Back
                </button>
                <button
                  className="btn-danger"
                  onClick={handleSubmit}
                  disabled={!reason || submitting}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  {submitting ? <><span className="btn-spinner" />Declining…</> : 'Decline Meeting'}
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'rgba(52,211,153,0.12)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                margin: '0.25rem auto 0.75rem',
              }}>
                <Check size={26} color="#34d399" />
              </div>
              <p style={{ marginBottom: '0.3rem', fontWeight: 600 }}>Decline sent</p>
              <p style={{ fontSize: '0.78rem', opacity: 0.7 }}>
                The organizer has been notified.
              </p>
              <div className="modal-actions" style={{ marginTop: '1rem', justifyContent: 'center' }}>
                <button className="btn-cancel" onClick={onClose}>Close</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
