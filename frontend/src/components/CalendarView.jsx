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

export default function CalendarView({ meetings }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [hovered, setHovered]       = useState(null);
  const nowRef = useRef(null);

  const confirmed = meetings.filter(m => m.status === 'confirmed' && m.selectedSlotStart);

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

  /* ── Events for a day ── */
  const getEvents = (dayDate) =>
    confirmed
      .filter(m => new Date(m.selectedSlotStart).toDateString() === dayDate.toDateString())
      .map(m => {
        const start = new Date(m.selectedSlotStart);
        const h = start.getHours() + start.getMinutes() / 60;
        return {
          ...m,
          topPct:    ((h - HOUR_START) / TOTAL_HOURS) * 100,
          heightPct: ((m.durationMinutes / 60) / TOTAL_HOURS) * 100,
          startStr:  start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        };
      });

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

  return (
    <div className="cv-wrap">

      {/* ── Toolbar ── */}
      <div className="cv-header">
        <div className="cv-nav">
          <button className="cv-btn" onClick={() => setWeekOffset(w => w - 1)}>‹ Prev</button>
          <button className="cv-today-btn" onClick={() => setWeekOffset(0)}>Today</button>
          <button className="cv-btn" onClick={() => setWeekOffset(w => w + 1)}>Next ›</button>
        </div>

        <span className="cv-week-label">{weekLabel}</span>

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

          {/* Day columns */}
          {weekDays.map(day => (
            <div key={day.name} className="cv-day-col">

              {/* Day header */}
              <div className={`cv-day-header ${day.isToday ? 'today' : ''}`}>
                <span className="cv-day-name">{day.name}</span>
                <span className={`cv-day-num ${day.isToday ? 'today-num' : ''}`}>{day.label}</span>
              </div>

              {/* Body with events */}
              <div className="cv-day-body">
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
                  const colors = ROLE_COLOR[ev.userRole] || ROLE_COLOR.organizer;
                  return (
                    <div
                      key={ev.requestId}
                      className="cv-event"
                      style={{
                        top:        `calc(${ev.topPct}% + 1px)`,
                        height:     `calc(${ev.heightPct}% - 2px)`,
                        background: colors.bg,
                        borderLeft: `3px solid ${colors.border}`,
                        color:      colors.text,
                      }}
                      onMouseEnter={() => setHovered(ev)}
                      onMouseLeave={() => setHovered(null)}
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

      {/* ── Hover tooltip ── */}
      {hovered && (
        <div className="cv-tooltip">
          <div className="cv-tt-title">{hovered.title}</div>
          <div className="cv-tt-row">
            📅 {new Date(hovered.selectedSlotStart).toLocaleDateString('en-US', {
              weekday: 'long', month: 'short', day: 'numeric',
            })}
          </div>
          <div className="cv-tt-row">🕐 {hovered.startStr} · {hovered.durationMinutes}m</div>
          <div className="cv-tt-row cv-tt-role">
            {hovered.userRole === 'organizer' ? '📋 You organized this' : '📨 You were invited'}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {confirmed.length === 0 && (
        <div className="cv-empty">
          <span>📅</span>
          <span>No confirmed meetings this week. Create one to see it here!</span>
        </div>
      )}
    </div>
  );
}
