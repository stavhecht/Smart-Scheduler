import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiGet, apiRegisterCalendarWatch, apiCheckCalendarSync } from '../apiClient';
import { useToast } from '../context/ToastContext';
import './CalendarView.css';

const HOUR_START  = 7;
const HOUR_END    = 22;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i);

const ROLE_COLOR = {
  organizer:   { bg: 'rgba(56,189,248,0.78)',  border: '#38bdf8', text: '#002a3a' },
  participant: { bg: 'rgba(129,140,248,0.78)', border: '#818cf8', text: '#1a1a40' },
};
const PENDING_COLOR = { bg: 'rgba(251,191,36,0.18)', border: '#fbbf24', text: '#78350f' };

// Maps Google Calendar colorId values (1–11) to visual styles.
// Text colors are light so they're readable on dark-mode semi-transparent backgrounds.
// Light mode overrides dark text via [data-theme="light"] .cv-event-gcal in CSS.
const GCAL_COLOR_MAP = {
  '':   { bg: 'rgba(52,211,153,0.20)',  border: '#34d399', text: '#6ee7b7' }, // default green
  '1':  { bg: 'rgba(121,134,203,0.20)', border: '#7986cb', text: '#c7d2fe' }, // Lavender
  '2':  { bg: 'rgba(51,182,121,0.20)',  border: '#33b679', text: '#6ee7b7' }, // Sage
  '3':  { bg: 'rgba(192,86,234,0.20)',  border: '#c056ea', text: '#e9d5ff' }, // Grape
  '4':  { bg: 'rgba(230,124,115,0.20)', border: '#e67c73', text: '#fca5a5' }, // Flamingo
  '5':  { bg: 'rgba(246,191,38,0.20)',  border: '#f6bf26', text: '#fde68a' }, // Banana
  '6':  { bg: 'rgba(244,81,30,0.20)',   border: '#f4511e', text: '#fdba74' }, // Tangerine
  '7':  { bg: 'rgba(3,155,229,0.20)',   border: '#039be5', text: '#7dd3fc' }, // Peacock
  '8':  { bg: 'rgba(99,102,241,0.20)',  border: '#6366f1', text: '#c7d2fe' }, // Blueberry
  '9':  { bg: 'rgba(52,211,153,0.20)',  border: '#34d399', text: '#a7f3d0' }, // Basil
  '10': { bg: 'rgba(239,68,68,0.20)',   border: '#ef4444', text: '#fca5a5' }, // Tomato
  '11': { bg: 'rgba(156,163,175,0.20)', border: '#9ca3af', text: '#e5e7eb' }, // Graphite
};
// ICS calendar gets a distinct purple tint to differentiate from Google events
const ICS_COLOR = { bg: 'rgba(168,85,247,0.20)', border: '#a855f7', text: '#e9d5ff' };

const hasTime = (iso) => iso && iso.includes('T');

function gcalColor(ev) {
  if (ev.source === 'ics') return ICS_COLOR;
  return GCAL_COLOR_MAP[ev.colorId || ''] ?? GCAL_COLOR_MAP[''];
}

export default function CalendarView({ meetings, calendarStatus, onMeetingClick, onCreateAt }) {
  const toast = useToast();
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayOffset, setDayOffset]   = useState(0);
  const [isMobile, setIsMobile]     = useState(() => window.innerWidth < 600);
  const [gcalEvents, setGcalEvents]   = useState([]);
  const [tooltip, setTooltip]         = useState(null); // { ev, el }
  const [webhookActive, setWebhookActive] = useState(false);
  const nowRef           = useRef(null);
  const touchStartX      = useRef(null);
  const lastChangeToken  = useRef(null);
  const scrollContainerRef = useRef(null); // ref to .main-content (the actual scroll container)

  const googleConnected = calendarStatus?.google?.connected;
  const icsConnected    = calendarStatus?.ics?.connected;
  const anyCalConnected = googleConnected || icsConnected;

  // Keep a ref to weekOffset so the visibility handler and poll interval always read the latest value
  const weekOffsetRef = useRef(weekOffset);
  useEffect(() => { weekOffsetRef.current = weekOffset; }, [weekOffset]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    scrollContainerRef.current = document.querySelector('.main-content') || document.body;
  }, []);

  // Close tooltip when clicking outside of it
  useEffect(() => {
    if (!tooltip) return;
    const close = (e) => { if (!e.target.closest('.cv-tooltip')) setTooltip(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [tooltip]);


  /* ── Week dates (derived from weekOffset) ── */
  const todayBase = new Date();
  todayBase.setHours(0, 0, 0, 0);
  const dow    = todayBase.getDay();
  const toMon  = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(todayBase);
  monday.setDate(todayBase.getDate() + toMon + weekOffset * 7);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      date:    d,
      name:    d.toLocaleDateString('en-US', { weekday: 'short' }),
      label:   d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
      isToday: d.toDateString() === new Date().toDateString(),
    };
  });

  const weekLabel = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).formatRange(weekDays[0].date, weekDays[6].date);

  /* ── Mobile single-day ── */
  const mobileDay = new Date();
  mobileDay.setHours(0, 0, 0, 0);
  mobileDay.setDate(mobileDay.getDate() + dayOffset);
  const mobileDayLabel   = mobileDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const mobileDayIsToday = mobileDay.toDateString() === new Date().toDateString();

  const displayDays = isMobile
    ? [{ date: mobileDay, name: 'Today', label: mobileDayLabel, isToday: mobileDayIsToday }]
    : weekDays;

  /* ── Fetch Google/ICS Calendar events ── */
  const fetchGcalEvents = async (offset) => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const dayOfWeek = base.getDay();
    const toMonday  = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const mon = new Date(base);
    mon.setDate(base.getDate() + toMonday + offset * 7);
    const end = new Date(mon);
    end.setDate(mon.getDate() + 7);
    const timeMin = mon.toISOString();
    const timeMax = end.toISOString();
    try {
      const data = await apiGet(`/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
      setGcalEvents(Array.isArray(data) ? data : []);
    } catch {
      setGcalEvents([]);
      if (googleConnected) {
        toast('Could not load Google Calendar events — your session may have expired. Try reconnecting in Settings.', 'warning');
      }
    }
  };

  // Fetch on mount / week change / connection change; poll every 30 s as fallback
  useEffect(() => {
    if (!anyCalConnected) { setGcalEvents([]); return; }
    fetchGcalEvents(weekOffset);
    const id = setInterval(() => fetchGcalEvents(weekOffsetRef.current), 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset, anyCalConnected]);

  // Re-sync when the user returns to this tab
  useEffect(() => {
    if (!anyCalConnected) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchGcalEvents(weekOffsetRef.current);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyCalConnected]);

  // Register a Google Calendar push-notification watch channel once connected.
  // Falls back gracefully if WEBHOOK_BASE_URL isn't configured on the backend.
  useEffect(() => {
    if (!googleConnected) { setWebhookActive(false); return; }
    apiRegisterCalendarWatch()
      .then(res => setWebhookActive(res?.status === 'registered' || res?.status === 'active'))
      .catch(() => setWebhookActive(false));
  }, [googleConnected]);

  // When webhooks are active, poll check_calendar_sync every 5 s.
  // A changeToken change means Google fired a notification → re-fetch immediately.
  useEffect(() => {
    if (!webhookActive) return;
    const id = setInterval(async () => {
      try {
        const { changeToken } = await apiCheckCalendarSync();
        if (lastChangeToken.current !== null && changeToken !== lastChangeToken.current) {
          fetchGcalEvents(weekOffsetRef.current);
        }
        lastChangeToken.current = changeToken;
      } catch { /* ignore — 30 s poll is still running as fallback */ }
    }, 5_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webhookActive]);

  /* ── App meetings (confirmed/pending with a booked slot) ── */
  const confirmed = meetings.filter(m =>
    (m.status === 'confirmed' || m.status === 'pending') && m.selectedSlotStart
  );

  /* ── All-day events for a given day (Google date-only events) ── */
  const getAllDayEvents = (dayDate) =>
    gcalEvents.filter(ev => {
      if (hasTime(ev.start)) return false;
      const evStart = new Date(ev.start + 'T00:00:00');
      const evEnd   = ev.end ? new Date(ev.end + 'T00:00:00') : new Date(evStart.getTime() + 86_400_000);
      return evStart <= dayDate && evEnd > dayDate;
    });

  /* ── Timed events (with overlap column assignments) for a given day ── */
  const getEvents = (dayDate) => {
    const appEvents = confirmed
      .filter(m => new Date(m.selectedSlotStart).toDateString() === dayDate.toDateString())
      .map(m => {
        const start = new Date(m.selectedSlotStart);
        const h    = start.getHours() + start.getMinutes() / 60;
        const endH = h + m.durationMinutes / 60;
        const clampedStart = Math.max(h, HOUR_START);
        const clampedEnd   = Math.min(endH, HOUR_END);
        return {
          _id:       m.requestId,
          _type:     'app',
          _startH:   h,
          _endH:     endH,
          topPct:    ((clampedStart - HOUR_START) / TOTAL_HOURS) * 100,
          heightPct: ((clampedEnd - clampedStart) / TOTAL_HOURS) * 100,
          startStr:  start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          title:     m.title,
          status:    m.status,
          userRole:  m.userRole,
          meeting:   m,
          visible:   clampedEnd > clampedStart,
        };
      })
      .filter(e => e.visible);

    const gEvents = gcalEvents
      .filter(ev => hasTime(ev.start))
      .filter(ev => new Date(ev.start).toDateString() === dayDate.toDateString())
      .map(ev => {
        const start = new Date(ev.start);
        const end   = ev.end && hasTime(ev.end) ? new Date(ev.end) : new Date(start.getTime() + 3_600_000);
        const h    = start.getHours() + start.getMinutes() / 60;
        const endH = end.getHours()   + end.getMinutes()   / 60;
        const effectiveEnd = endH <= h ? HOUR_END : endH;
        const clampedStart = Math.max(h, HOUR_START);
        const clampedEnd   = Math.min(effectiveEnd, HOUR_END);
        return {
          _id:         `gcal-${ev.id || ev.start}-${ev.summary}`,
          _type:       'gcal',
          _startH:     h,
          _endH:       effectiveEnd,
          topPct:      ((clampedStart - HOUR_START) / TOTAL_HOURS) * 100,
          heightPct:   ((clampedEnd - clampedStart) / TOTAL_HOURS) * 100,
          startStr:    start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          endStr:      end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          title:       ev.summary || 'Busy',
          description: ev.description || '',
          location:    ev.location || '',
          colorId:     ev.colorId || '',
          attendees:   ev.attendees || [],
          htmlLink:    ev.htmlLink || '',
          source:      ev.source || 'google',
          visible:     clampedEnd > clampedStart,
        };
      })
      .filter(e => e.visible);

    const raw = [...appEvents, ...gEvents];

    // Assign overlap columns
    const overlaps = (a, b) => a._startH < b._endH && b._startH < a._endH;
    const assigned = raw.map(() => ({ colIndex: 0, totalCols: 1 }));
    for (let i = 0; i < raw.length; i++) {
      const cluster = raw.filter((_, j) => overlaps(raw[i], raw[j]));
      if (cluster.length <= 1) continue;
      cluster.forEach((ev, ci) => {
        assigned[raw.indexOf(ev)] = { colIndex: ci, totalCols: cluster.length };
      });
    }
    return raw.map((ev, i) => ({ ...ev, ...assigned[i] }));
  };

  /* ── Now indicator ── */
  const now       = new Date();
  const nowHour   = now.getHours() + now.getMinutes() / 60;
  const nowTopPct = ((nowHour - HOUR_START) / TOTAL_HOURS) * 100;
  const showNow   = weekOffset === 0 && nowHour >= HOUR_START && nowHour <= HOUR_END;

  useEffect(() => {
    if (nowRef.current) nowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const thisWeekHasEvents = confirmed.some(m =>
    weekDays.some(day => new Date(m.selectedSlotStart).toDateString() === day.date.toDateString())
  ) || gcalEvents.some(ev => {
    if (hasTime(ev.start)) {
      return weekDays.some(day => new Date(ev.start).toDateString() === day.date.toDateString());
    }
    return weekDays.some(day => {
      const evStart = new Date(ev.start + 'T00:00:00');
      const evEnd   = ev.end ? new Date(ev.end + 'T00:00:00') : new Date(evStart.getTime() + 86_400_000);
      return evStart <= day.date && evEnd > day.date;
    });
  });

  const showAllDayStrip = gcalEvents.some(ev =>
    !hasTime(ev.start) &&
    displayDays.some(day => {
      const evStart = new Date(ev.start + 'T00:00:00');
      const evEnd   = ev.end ? new Date(ev.end + 'T00:00:00') : new Date(evStart.getTime() + 86_400_000);
      return evStart <= day.date && evEnd > day.date;
    })
  );

  /* ── Tooltip renderer ── */
  const renderTooltip = () => {
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
          <button
            className="cv-tt-btn"
            onClick={() => { setTooltip(null); onMeetingClick?.(ev.meeting); }}
          >
            View Details →
          </button>
        </>
      );
    };

    const portalTarget = scrollContainerRef.current || document.body;
    return createPortal(
      <div className="cv-tooltip" style={{ top: tooltip.top, left: tooltip.left }}>
        <button className="cv-tt-close" onClick={() => setTooltip(null)}>✕</button>
        {isGcal ? gcalContent() : appContent()}
      </div>,
      portalTarget
    );
  };

  return (
    <div className="cv-wrap">

      {/* ── Toolbar ── */}
      <div className="cv-header">
        <div className="cv-nav">
          <button className="cv-btn" onClick={() => isMobile ? setDayOffset(d => d - 1) : setWeekOffset(w => w - 1)}>‹ Prev</button>
          <button className="cv-today-btn" onClick={() => isMobile ? setDayOffset(0) : setWeekOffset(0)}>Today</button>
          <button className="cv-btn" onClick={() => isMobile ? setDayOffset(d => d + 1) : setWeekOffset(w => w + 1)}>Next ›</button>
        </div>
        <span className="cv-week-label">{isMobile ? mobileDayLabel : weekLabel}</span>
      </div>

      {/* ── All-day events strip (shown only when there are all-day events in view) ── */}
      {showAllDayStrip && (
        <div className="cv-allday-strip">
          <div className="cv-allday-gutter" />
          {displayDays.map(day => (
            <div key={day.name} className="cv-allday-cell">
              {getAllDayEvents(day.date).map(ev => {
                const colors = gcalColor(ev);
                return (
                  <div
                    key={`allday-${ev.id || ev.start}-${ev.summary}`}
                    className="cv-allday-chip"
                    style={{ background: colors.bg, borderLeft: `3px solid ${colors.border}`, color: colors.text }}
                    title={ev.summary || 'All day'}
                  >
                    {ev.summary || 'All day'}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ── Scrollable grid ── */}
      <div
        className="cv-scroll"
        onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (touchStartX.current === null) return;
          const delta = e.changedTouches[0].clientX - touchStartX.current;
          touchStartX.current = null;
          if (Math.abs(delta) < 40) return;
          if (isMobile) setDayOffset(d => d + (delta < 0 ? 1 : -1));
          else setWeekOffset(w => w + (delta < 0 ? 1 : -1));
        }}
      >
        <div className="cv-grid">

          {/* Time column */}
          <div className="cv-time-col">
            <div className="cv-corner" />
            {hours.map(h => (
              <div key={h} className="cv-hour-label">{h}:00</div>
            ))}
          </div>

          {/* Day columns */}
          {displayDays.map(day => (
            <div key={day.name} className={`cv-day-col${day.isToday ? ' today-col' : ''}`}>
              <div className={`cv-day-header ${day.isToday ? 'today' : ''}`}>
                <span className="cv-day-name">{day.name}</span>
                <span className={`cv-day-num ${day.isToday ? 'today-num' : ''}`}>
                  {day.label}
                </span>
              </div>

              <div
                className="cv-day-body"
                style={{ cursor: onCreateAt ? 'crosshair' : undefined }}
                onClick={(e) => {
                  if (!onCreateAt) return;
                  if (e.target.classList.contains('cv-event') || e.target.classList.contains('cv-ev-title') || e.target.classList.contains('cv-ev-time')) return;
                  setTooltip(null);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const hourFrac = ((e.clientY - rect.top) / rect.height) * TOTAL_HOURS + HOUR_START;
                  const snapped  = Math.floor(hourFrac * 2) / 2;
                  const dt = new Date(day.date);
                  dt.setHours(Math.floor(snapped), Math.round((snapped % 1) * 60), 0, 0);
                  onCreateAt(dt.toISOString());
                }}
              >
                {hours.map(h => <div key={h} className="cv-hour-cell" />)}

                {showNow && day.isToday && (
                  <div className="cv-now-line" style={{ top: `${nowTopPct}%` }} ref={nowRef}>
                    <div className="cv-now-dot" />
                  </div>
                )}

                {getEvents(day.date).map(ev => {
                  const isGcal    = ev._type === 'gcal';
                  const isPending = !isGcal && ev.status === 'pending';
                  const colors    = isGcal ? gcalColor(ev) : isPending ? PENDING_COLOR : (ROLE_COLOR[ev.userRole] || ROLE_COLOR.organizer);
                  const colW      = 100 / ev.totalCols;
                  return (
                    <div
                      key={ev._id}
                      className={`cv-event${isPending ? ' cv-event-pending' : ''}${isGcal ? ' cv-event-gcal' : ''}`}
                      style={{
                        top:        `calc(${ev.topPct}% + 1px)`,
                        height:     `calc(${ev.heightPct}% - 2px)`,
                        left:       `${ev.colIndex * colW}%`,
                        width:      `calc(${colW}% - 2px)`,
                        background: colors.bg,
                        borderLeft: `3px solid ${colors.border}`,
                        color:      colors.text,
                        cursor:     'pointer',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (tooltip?.ev._id === ev._id) { setTooltip(null); return; }
                        const TW = 310, GAP = 12;
                        const scrollEl = scrollContainerRef.current || document.body;
                        const parentRect = scrollEl.getBoundingClientRect();
                        const r = e.currentTarget.getBoundingClientRect();
                        // top/left are relative to .main-content (the scroll container)
                        const top = r.top - parentRect.top + scrollEl.scrollTop;
                        const spaceRight = window.innerWidth - r.right;
                        const viewLeft = spaceRight >= TW + GAP ? r.right + GAP : Math.max(GAP, r.left - TW - GAP);
                        const left = viewLeft - parentRect.left;
                        setTooltip({ ev, top, left });
                      }}
                    >
                      <span className="cv-ev-title">{ev.title}</span>
                      {ev.heightPct > 3 && <span className="cv-ev-time">{ev.startStr}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tooltip (fixed, click-triggered) ── */}
      {renderTooltip()}

      {/* ── Empty state ── */}
      {confirmed.length === 0 && gcalEvents.length === 0 && (
        <div className="cv-empty">
          <span>📅</span>
          <span>No confirmed meetings yet. Create one to see it here!</span>
        </div>
      )}
      {(confirmed.length > 0 || gcalEvents.length > 0) && !thisWeekHasEvents && (
        <div className="cv-empty">
          <span>📭</span>
          <span>No events this week. Use the arrows to navigate.</span>
        </div>
      )}
    </div>
  );
}
