import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ROLE_COLOR, PENDING_COLOR, gcalColor } from './calendarConstants.js';

/* MeetingTooltip — click-to-show floating tooltip for calendar events */
export default function MeetingTooltip({ tooltip, setTooltip, onMeetingClick, googleConnected, profile }) {
  const tooltipDomRef = useRef(null);

  // Close tooltip when clicking outside of it
  useEffect(() => {
    if (!tooltip) return;
    const close = (e) => { if (!e.target.closest('.cv-tooltip')) setTooltip(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [tooltip, setTooltip]);

  // Keep tooltip pinned to its event element while the page scrolls.
  // capture:true catches scroll in any container (e.g. .main-content with overflow-y:auto).
  useEffect(() => {
    if (!tooltip?.el) return;
    const TW = 310, TH = 260, GAP = 12;
    const reposition = () => {
      if (!tooltipDomRef.current) return;
      const r = tooltip.el.getBoundingClientRect();
      const spaceRight = window.innerWidth - r.right;
      const left = spaceRight >= TW + GAP ? r.right + GAP : Math.max(GAP, r.left - TW - GAP);
      const top  = Math.max(GAP, Math.min(r.top, window.innerHeight - TH - GAP));
      tooltipDomRef.current.style.top  = `${top}px`;
      tooltipDomRef.current.style.left = `${left}px`;
    };
    document.addEventListener('scroll', reposition, { passive: true, capture: true });
    return () => document.removeEventListener('scroll', reposition, { capture: true });
  }, [tooltip]);

  if (!tooltip) return null;
  const ev = tooltip.ev;
  const isGcal = ev._type === 'gcal';

  const gcalContent = () => {
    const colors = gcalColor(ev);
    const sourceLabel = ev.source === 'ics' ? 'ICS Calendar' : 'Google Calendar';
    return (
      <>
        <div className="cv-tt-title" style={{ borderLeft: `3px solid ${colors.border}`, paddingLeft: 8 }}>
          {ev.title}
        </div>
        <div className="cv-tt-row">🕐 {ev.startStr}{ev.endStr ? ` – ${ev.endStr}` : ''}</div>
        {ev.location && <div className="cv-tt-row">📍 {ev.location}</div>}
        {ev.description && (
          <div className="cv-tt-row cv-tt-desc">
            {ev.description.length > 120 ? ev.description.slice(0, 120) + '…' : ev.description}
          </div>
        )}
        {ev.attendees?.length > 0 && (
          <div className="cv-tt-row">
            👥 {ev.attendees.slice(0, 3).join(', ')}
            {ev.attendees.length > 3 ? ` +${ev.attendees.length - 3} more` : ''}
          </div>
        )}
        <div className="cv-tt-role">{sourceLabel}</div>
        {ev.htmlLink && (
          <a className="cv-tt-link" href={ev.htmlLink} target="_blank" rel="noreferrer">
            Open in Google Calendar ↗
          </a>
        )}
      </>
    );
  };

  const appContent = () => {
    const m = ev.meeting;
    const colors = ev.status === 'pending' ? PENDING_COLOR : (ROLE_COLOR[ev.userRole] || ROLE_COLOR.organizer);
    const participantCount = m?.participantUserIds?.length || 0;

    // Build Google Calendar link: direct event link if we have an externalEventId, else day view
    let gcalLink = null;
    if (googleConnected && ev.status === 'confirmed' && m?.selectedSlotStart) {
      const d = new Date(m.selectedSlotStart);
      const rawId = m.externalEventIds?.[profile?.userId];
      const eventId = rawId?.startsWith('google:') ? rawId.slice(7) : null;
      const url = eventId
        ? `https://www.google.com/calendar/event?eid=${btoa(eventId + ' primary')}`
        : `https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
      gcalLink = <a className="cv-tt-link" href={url} target="_blank" rel="noreferrer">📅 Open in Google Calendar ↗</a>;
    }

    return (
      <>
        <div className="cv-tt-title" style={{ borderLeft: `3px solid ${colors.border}`, paddingLeft: 8 }}>
          {ev.title}
        </div>
        <div className="cv-tt-row">🕐 {ev.startStr} · {m?.durationMinutes ?? '?'} min</div>
        {participantCount > 0 && (
          <div className="cv-tt-row">👥 {participantCount} participant{participantCount !== 1 ? 's' : ''}</div>
        )}
        <div className="cv-tt-row">
          📋 {ev.status === 'confirmed' ? '✅ Confirmed' : '⏳ Pending'}
          {' · '}{ev.userRole === 'organizer' ? 'You organized' : 'You were invited'}
        </div>
        {gcalLink}
        <button
          className="cv-tt-btn"
          onClick={() => { setTooltip(null); onMeetingClick?.(ev.meeting); }}
        >
          View Details →
        </button>
      </>
    );
  };

  const TW = 310, TH = 260, GAP = 12;
  const r = tooltip.el.getBoundingClientRect();
  const spaceRight = window.innerWidth - r.right;
  const tooltipLeft = spaceRight >= TW + GAP ? r.right + GAP : Math.max(GAP, r.left - TW - GAP);
  const tooltipTop  = Math.max(GAP, Math.min(r.top, window.innerHeight - TH - GAP));
  return createPortal(
    <div className="cv-tooltip" ref={tooltipDomRef} style={{ top: tooltipTop, left: tooltipLeft }}>
      <button className="cv-tt-close" onClick={() => setTooltip(null)}>✕</button>
      {isGcal ? gcalContent() : appContent()}
    </div>,
    document.body
  );
}
