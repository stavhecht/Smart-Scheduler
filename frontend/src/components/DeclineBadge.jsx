import { useState, useEffect, useRef } from 'react';
import { Ban } from 'lucide-react';

const REASON_LABELS = { personal: 'Personal', busy: 'Busy', other: 'Other' };

/**
 * Small red-dot badge with a count of declines. Click → popover listing each decline.
 *
 * Props:
 *   meeting              – meeting object (uses declinedBy, declineDetails, participantNames)
 *   onParticipantClick   – (userId) => void, optional
 */
export default function DeclineBadge({ meeting, onParticipantClick }) {
  const [open, setOpen]  = useState(false);
  const ref              = useRef(null);
  const declines         = meeting.declinedBy || [];
  const details          = meeting.declineDetails || {};
  const names            = meeting.participantNames || {};

  useEffect(() => {
    if (!open) return;
    const onDocClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey      = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (declines.length === 0) return null;

  const fmtTime = iso => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        title={`${declines.length} decline${declines.length > 1 ? 's' : ''}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 12,
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.35)',
          color: '#f87171',
          fontSize: '0.7rem', fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <Ban size={11} />
        {declines.length}
      </button>

      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            minWidth: 280, maxWidth: 340, zIndex: 50,
            background: '#0f172a',
            border: '1px solid rgba(148,163,184,0.25)',
            borderRadius: 8, padding: '0.7rem 0.8rem',
            boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
          }}
        >
          <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6, color: '#f87171' }}>
            Declined by {declines.length} {declines.length === 1 ? 'person' : 'people'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
            {declines.map(uid => {
              const d        = details[uid] || {};
              const nameInfo = names[uid] || {};
              const name     = nameInfo.name || uid;
              const reason   = REASON_LABELS[d.reason] || d.reason || 'Unknown';
              return (
                <div
                  key={uid}
                  style={{
                    borderLeft: '3px solid rgba(239,68,68,0.6)',
                    paddingLeft: 8,
                    fontSize: '0.78rem',
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => onParticipantClick?.(uid)}
                      disabled={!onParticipantClick}
                      style={{
                        background: 'none', border: 'none', color: 'inherit',
                        cursor: onParticipantClick ? 'pointer' : 'default',
                        padding: 0, fontWeight: 600,
                        textDecoration: onParticipantClick ? 'underline dotted' : 'none',
                      }}
                    >
                      {name}
                    </button>
                    <span style={{
                      fontSize: '0.68rem',
                      padding: '1px 6px',
                      borderRadius: 8,
                      background: 'rgba(239,68,68,0.15)',
                      color: '#fca5a5',
                    }}>
                      {reason}
                    </span>
                  </div>
                  <div style={{ opacity: 0.65, fontSize: '0.72rem', marginTop: 2 }}>
                    Slot: {fmtTime(d.slotIso)}
                  </div>
                  {d.comment && (
                    <div style={{ opacity: 0.85, fontSize: '0.74rem', marginTop: 3, fontStyle: 'italic' }}>
                      "{d.comment}"
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
