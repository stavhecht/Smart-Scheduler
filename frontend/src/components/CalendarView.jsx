import React, { useState, useEffect, useRef } from 'react';
import { apiGet } from '../apiClient';
import './CalendarView.css';

/* Hours displayed: 7am – 9pm */
const HOUR_START  = 7;
const HOUR_END    = 21;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i);

const ROLE_COLOR = {
  organizer:   { bg: 'rgba(56,189,248,0.78)',  border: '#38bdf8', text: '#002a3a' },
  participant: { bg: 'rgba(129,140,248,0.78)', border: '#818cf8', text: '#1a1a40' },
};
const PENDING_COLOR = { bg: 'rgba(251,191,36,0.18)', border: '#fbbf24', text: '#78350f' };
const GCAL_COLOR    = { bg: 'rgba(52,211,153,0.22)', border: '#34d399', text: '#064e3b' };

/* Returns true for all-day Google events (date-only string, no time) */
const hasTime = (iso) => iso && iso.includes('T');

export default function CalendarView({ meetings, calendarStatus, onMeetingClick, onCreateAt }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayOffset, setDayOffset]   = useState(0);
  const [isMobile, setIsMobile]     = useState(() => window.innerWidth < 600);
  const [gcalEvents, setGcalEvents] = useState([]);
  const nowRef      = useRef(null);
  const touchStartX = useRef(null);

  const googleConnected = calendarStatus?.google?.connected;
  // Keep a ref to weekOffset so the visibility handler can always read the latest value
  const weekOffsetRef = useRef(weekOffset);
  useEffect(() => { weekOffsetRef.current = weekOffset; }, [weekOffset]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* ── Week dates (derived from weekOffset) ── */
  const todayBase = new Date();
  todayBase.setHours(0, 0, 0, 0);
  const dow    = todayBase.getDay();
  const toMon  = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(todayBase);
  monday.setDate(todayBase.getDate() + toMon + weekOffset * 7);

  const weekDays = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      date:    d,
      name:    d.toLocaleDateString('en-US', { weekday: 'short' }),
      label:   d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
      isToday: d.toDateString() === new Date().toDateString(),
    };
  });

  const weekLabel = `${weekDays[0].date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – ${weekDays[4].date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

  /* ── Mobile single-day ── */
  const mobileDay = new Date();
  mobileDay.setHours(0, 0, 0, 0);
  mobileDay.setDate(mobileDay.getDate() + dayOffset);
  const mobileDayLabel   = mobileDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const mobileDayIsToday = mobileDay.toDateString() === new Date().toDateString();

  /* ── Fetch Google Calendar events ── */
  // Computes the ISO range for a given weekOffset and fetches events.
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
    }
  };

  // Sync on mount, on week change, and when Google connection status changes
  useEffect(() => {
    if (!googleConnected) { setGcalEvents([]); return; }
    fetchGcalEvents(weekOffset);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset, googleConnected]);

  // Re-sync whenever the user returns to this tab / page
  useEffect(() => {
    if (!googleConnected) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchGcalEvents(weekOffsetRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleConnected]);

  /* ── App meetings (all confirmed/pending with a slot) ── */
  const confirmed = meetings.filter(m =>
    (m.status === 'confirmed' || m.status === 'pending') && m.selectedSlotStart
  );

  /* ── Build event list for a given day ── */
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

    // Google Calendar events — skip all-day events (no time component)
    const gEvents = gcalEvents
      .filter(ev => hasTime(ev.start))
      .filter(ev => new Date(ev.start).toDateString() === dayDate.toDateString())
      .map(ev => {
        const start = new Date(ev.start);
        const end   = ev.end && hasTime(ev.end) ? new Date(ev.end) : new Date(start.getTime() + 60 * 60 * 1000);
        const h    = start.getHours() + start.getMinutes() / 60;
        const endH = end.getHours()   + end.getMinutes()   / 60;
        // If event spans midnight, cap at HOUR_END
        const effectiveEnd   = endH <= h ? HOUR_END : endH;
        const clampedStart   = Math.max(h, HOUR_START);
        const clampedEnd     = Math.min(effectiveEnd, HOUR_END);
        return {
          _id:       `gcal-${ev.start}-${ev.summary}`,
          _type:     'gcal',
          _startH:   h,
          _endH:     effectiveEnd,
          topPct:    ((clampedStart - HOUR_START) / TOTAL_HOURS) * 100,
          heightPct: ((clampedEnd - clampedStart) / TOTAL_HOURS) * 100,
          startStr:  start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          title:     ev.summary || 'Busy',
          visible:   clampedEnd > clampedStart,
        };
      })
      .filter(e => e.visible);

    const raw = [...appEvents, ...gEvents];

    // Overlap detection → assign column indices
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

  /* ── Now line ── */
  const now       = new Date();
  const nowHour   = now.getHours() + now.getMinutes() / 60;
  const nowTopPct = ((nowHour - HOUR_START) / TOTAL_HOURS) * 100;
  const showNow   = weekOffset === 0 && nowHour >= HOUR_START && nowHour <= HOUR_END;

  useEffect(() => {
    if (nowRef.current) nowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const thisWeekHasEvents = confirmed.some(m =>
    weekDays.some(day => new Date(m.selectedSlotStart).toDateString() === day.date.toDateString())
  ) || gcalEvents.some(ev =>
    hasTime(ev.start) && weekDays.some(day => new Date(ev.start).toDateString() === day.date.toDateString())
  );

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
          {(isMobile
            ? [{ date: mobileDay, name: 'Today', label: mobileDayLabel, isToday: mobileDayIsToday }]
            : weekDays
          ).map(day => (
            <div key={day.name} className="cv-day-col">
              <div className={`cv-day-header ${day.isToday ? 'today' : ''}`}>
                <span className="cv-day-name">{day.name}</span>
                <span className={`cv-day-num ${day.isToday ? 'today-num' : ''}`}>
                  {day.isToday ? day.date.getDate() : day.label}
                </span>
              </div>

              <div
                className="cv-day-body"
                style={{ cursor: onCreateAt ? 'crosshair' : undefined }}
                onClick={(e) => {
                  if (!onCreateAt) return;
                  if (e.target.classList.contains('cv-event') || e.target.classList.contains('cv-ev-title') || e.target.classList.contains('cv-ev-time')) return;
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
                  const colors    = isGcal ? GCAL_COLOR : isPending ? PENDING_COLOR : (ROLE_COLOR[ev.userRole] || ROLE_COLOR.organizer);
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
                        cursor:     isGcal ? 'default' : 'pointer',
                      }}
                      onClick={(e) => { e.stopPropagation(); if (!isGcal) onMeetingClick?.(ev.meeting); }}
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
