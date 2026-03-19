import React, { useState, useEffect, useRef } from 'react';
import './CalendarView.css';

/* Hours displayed: 8am – 6pm */
const HOUR_START  = 8;
const HOUR_END    = 18;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i);

/* Role → color */
const ROLE_COLOR = {
  organizer:   { bg: 'rgba(56,189,248,0.78)',  border: '#38bdf8', text: '#002a3a' },
  participant: { bg: 'rgba(129,140,248,0.78)', border: '#818cf8', text: '#1a1a40' },
};
const PENDING_COLOR = { bg: 'rgba(251,191,36,0.18)', border: '#fbbf24', text: '#78350f' };

export default function CalendarView({ meetings, onMeetingClick, onCreateAt }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayOffset, setDayOffset]   = useState(0);   // mobile day offset from today
  const [isMobile, setIsMobile]     = useState(() => window.innerWidth < 600);
  const nowRef = useRef(null);

  /* Detect mobile viewport */
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const confirmed = meetings.filter(m => (m.status === 'confirmed' || m.status === 'pending') && m.selectedSlotStart);

  /* ── Week dates ── */
  const todayBase = new Date();
  todayBase.setHours(0, 0, 0, 0);
  const dow       = todayBase.getDay();
  const toMon     = dow === 0 ? -6 : 1 - dow;
  const monday    = new Date(todayBase);
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
  const mobileDayLabel = mobileDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const mobileDayIsToday = mobileDay.toDateString() === new Date().toDateString();

  /* ── Events for a day (with overlap detection) ── */
  const getEvents = (dayDate) => {
    const raw = confirmed
      .filter(m => new Date(m.selectedSlotStart).toDateString() === dayDate.toDateString())
      .map(m => {
        const start = new Date(m.selectedSlotStart);
        const h = start.getHours() + start.getMinutes() / 60;
        const endH = h + (m.durationMinutes / 60);
        return {
          ...m,
          _startH:   h,
          _endH:     endH,
          topPct:    ((h - HOUR_START) / TOTAL_HOURS) * 100,
          heightPct: ((m.durationMinutes / 60) / TOTAL_HOURS) * 100,
          startStr:  start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        };
      });

    // Assign colIndex / totalCols by clustering overlapping events
    const overlaps = (a, b) => a._startH < b._endH && b._startH < a._endH;
    const assigned = raw.map(() => ({ colIndex: 0, totalCols: 1 }));

    for (let i = 0; i < raw.length; i++) {
      // Find all events that overlap with event i (including i itself)
      const cluster = raw.filter((_, j) => overlaps(raw[i], raw[j]));
      if (cluster.length <= 1) continue;
      const totalCols = cluster.length;
      cluster.forEach((ev, ci) => {
        const idx = raw.indexOf(ev);
        assigned[idx] = { colIndex: ci, totalCols };
      });
    }

    return raw.map((ev, i) => ({ ...ev, ...assigned[i] }));
  };

  /* ── Current time ── */
  const now      = new Date();
  const nowHour  = now.getHours() + now.getMinutes() / 60;
  const nowTopPct = ((nowHour - HOUR_START) / TOTAL_HOURS) * 100;
  const showNow   = weekOffset === 0 && nowHour >= HOUR_START && nowHour <= HOUR_END;

  /* Scroll to now on load */
  useEffect(() => {
    if (nowRef.current) {
      nowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  /* Which confirmed meetings fall in the visible week */
  const thisWeekEvents = confirmed.filter(m =>
    weekDays.some(day => new Date(m.selectedSlotStart).toDateString() === day.date.toDateString())
  );

  return (
    <div className="cv-wrap">

      {/* ── Toolbar ── */}
      <div className="cv-header">
        <div className="cv-nav">
          {isMobile ? (
            <>
              <button className="cv-btn" onClick={() => setDayOffset(d => d - 1)}>‹ Prev</button>
              <button className="cv-today-btn" onClick={() => setDayOffset(0)}>Today</button>
              <button className="cv-btn" onClick={() => setDayOffset(d => d + 1)}>Next ›</button>
            </>
          ) : (
            <>
              <button className="cv-btn" onClick={() => setWeekOffset(w => w - 1)}>‹ Prev</button>
              <button className="cv-today-btn" onClick={() => setWeekOffset(0)}>Today</button>
              <button className="cv-btn" onClick={() => setWeekOffset(w => w + 1)}>Next ›</button>
            </>
          )}
        </div>

        <span className="cv-week-label">{isMobile ? mobileDayLabel : weekLabel}</span>

        <div className="cv-legend">
          <span className="cv-legend-item organizer">Organized</span>
          <span className="cv-legend-item participant">Invited</span>
        </div>
      </div>

      {/* ── Scrollable grid ── */}
      <div className="cv-scroll">
        <div className="cv-grid">

          {/* Time column */}
          <div className="cv-time-col">
            <div className="cv-corner" />
            {hours.map(h => (
              <div key={h} className="cv-hour-label">{h}:00</div>
            ))}
          </div>

          {/* Day columns — 5-day week on desktop, single day on mobile */}
          {(isMobile ? [{ date: mobileDay, name: 'Today', label: mobileDayLabel, isToday: mobileDayIsToday }] : weekDays).map(day => (
            <div key={day.name} className="cv-day-col">

              {/* Day header */}
              <div className={`cv-day-header ${day.isToday ? 'today' : ''}`}>
                <span className="cv-day-name">{day.name}</span>
                <span className={`cv-day-num ${day.isToday ? 'today-num' : ''}`}>{day.label}</span>
              </div>

              {/* Body with events — click empty area to create meeting */}
              <div className="cv-day-body"
                style={{ cursor: onCreateAt ? 'crosshair' : undefined }}
                onClick={(e) => {
                  if (!onCreateAt) return;
                  if (e.target.classList.contains('cv-event') || e.target.classList.contains('cv-ev-title') || e.target.classList.contains('cv-ev-time')) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const hourFrac = ((e.clientY - rect.top) / rect.height) * TOTAL_HOURS + HOUR_START;
                  const snapped = Math.floor(hourFrac * 2) / 2;
                  const hour = Math.floor(snapped);
                  const mins = Math.round((snapped % 1) * 60);
                  const dt = new Date(day.date);
                  dt.setHours(hour, mins, 0, 0);
                  onCreateAt(dt.toISOString());
                }}
              >
                {/* Grid lines */}
                {hours.map(h => (
                  <div key={h} className="cv-hour-cell" />
                ))}

                {/* Now line */}
                {showNow && day.isToday && (
                  <div className="cv-now-line" style={{ top: `${nowTopPct}%` }} ref={nowRef}>
                    <div className="cv-now-dot" />
                  </div>
                )}

                {/* Events */}
                {getEvents(day.date).map(ev => {
                  const isPending = ev.status === 'pending';
                  const colors = isPending ? PENDING_COLOR : (ROLE_COLOR[ev.userRole] || ROLE_COLOR.organizer);
                  const colW  = 100 / ev.totalCols;
                  const left  = ev.colIndex * colW;
                  return (
                    <div
                      key={ev.requestId}
                      className={`cv-event${isPending ? ' cv-event-pending' : ''}`}
                      style={{
                        top:        `calc(${ev.topPct}% + 1px)`,
                        height:     `calc(${ev.heightPct}% - 2px)`,
                        left:       `${left}%`,
                        width:      `calc(${colW}% - 2px)`,
                        background: colors.bg,
                        borderLeft: `3px solid ${colors.border}`,
                        color:      colors.text,
                        cursor:     'pointer',
                      }}
                      onClick={(e) => { e.stopPropagation(); onMeetingClick?.(ev); }}
                    >
                      <span className="cv-ev-title">{ev.title}</span>
                      {ev.heightPct > 3 && (
                        <span className="cv-ev-time">{ev.startStr}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Empty state ── */}
      {confirmed.length === 0 && (
        <div className="cv-empty">
          <span>📅</span>
          <span>No confirmed meetings yet. Create one to see it here!</span>
        </div>
      )}
      {confirmed.length > 0 && thisWeekEvents.length === 0 && (
        <div className="cv-empty">
          <span>📭</span>
          <span>No meetings this week. Use the arrows to navigate to other weeks.</span>
        </div>
      )}
    </div>
  );
}
