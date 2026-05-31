import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Ban } from 'lucide-react';

const REASON_LABELS = { personal: 'Personal', busy: 'Busy', other: 'Other' };

/**
 * Small red badge with a decline count. Click → popover (portal) listing each decline.
 * Rendered via a portal so it escapes overflow:hidden on the meeting card.
 */
export default function DeclineBadge({ meeting, onParticipantClick }) {
  const [open, setOpen]       = useState(false);
  const [coords, setCoords]   = useState({ top: 0, right: 0 });
  const btnRef                = useRef(null);
  const popoverRef            = useRef(null);
  const declines              = meeting.declinedBy || [];
  const details               = meeting.declineDetails || {};
  const names                 = meeting.participantNames || {};

  // Position the portal popover below the badge button
  const openPopover = (e) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom + 6 + window.scrollY, right: window.innerWidth - r.right });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = e => {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        popoverRef.current && !popoverRef.current.contains(e.target)
      ) setOpen(false);
    };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Close if badge scrolls off-screen
  useEffect(() => {
    if (!open) return;
    const onScroll = () => setOpen(false);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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

  const popover = open && createPortal(
    <div
      ref={popoverRef}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: coords.top,
        right: coords.right,
        minWidth: 280, maxWidth: 340,
        zIndex: 9999,
        background: 'var(--surface, #0f172a)',
        border: '1px solid rgba(148,163,184,0.25)',
        borderRadius: 8,
        padding: '0.7rem 0.8rem',
        boxShadow: '0 10px 28px rgba(0,0,0,0.55)',
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
                  onClick={() => { onParticipantClick?.(uid); setOpen(false); }}
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
                  whiteSpace: 'nowrap',
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
    </div>,
    document.body,
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPopover}
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
      {popover}
    </>
  );
}
