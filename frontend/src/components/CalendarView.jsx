import React, { useState, useEffect, useRef } from 'react';
import { apiGet, apiRegisterCalendarWatch, apiCheckCalendarSync } from '../apiClient';
import { useToast } from '../context/ToastContext';
import MeetingTooltip from './MeetingTooltip.jsx';
import { ROLE_COLOR, PENDING_COLOR, gcalColor } from './calendarConstants.js';
import './CalendarView.css';

const HOUR_START  = 7;
const HOUR_END    = 22;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i);

const hasTime = (iso) => iso && iso.includes('T');

export default function CalendarView({ meetings, calendarStatus, profile, onMeetingClick, onCreateAt }) {
  const toast = useToast();
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayOffset, setDayOffset]   = useState(0);
  const [isMobile, setIsMobile]     = useState(() => window.innerWidth < 600);
  const [gcalEvents, setGcalEvents]   = useState([]);
  const [tooltip, setTooltip]         = useState(null); // { ev, el }
  const [webhookActive, setWebhookActive] = useState(false);
  const nowRef             = useRef(null);
  const touchStartX        = useRef(null);
  const lastChangeToken    = useRef(null);
  const scrollContainerRef = useRef(null);
  const tokenErrorShown    = useRef(false);

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
      if (googleConnected && !tokenErrorShown.current) {
        tokenErrorShown.current = true;
        toast('Could not sync Google Calendar — your token may have expired. Go to Profile → Calendar tab to reconnect.', 'warning');
      }
    }
  };

  // Fetch on mount / week change / connection change.
  // When the Google push channel is active, poll the cheap changeToken endpoint
  // every 10s and only re-fetch events when the token actually changes. When
  // the webhook is unavailable (e.g. WEBHOOK_BASE_URL unset, ICS-only), fall
  // back to an unconditional 60s event re-fetch.
  useEffect(() => {
    if (!anyCalConnected) { setGcalEvents([]); return; }
    fetchGcalEvents(weekOffset);

    if (webhookActive) {
      apiCheckCalendarSync()
        .then(r => { lastChangeToken.current = r?.changeToken ?? null; })
        .catch(() => {});
      const id = setInterval(async () => {
        try {
          const { changeToken } = await apiCheckCalendarSync();
          if (changeToken !== lastChangeToken.current) {
            lastChangeToken.current = changeToken;
            fetchGcalEvents(weekOffsetRef.current);
          }
        } catch { /* transient sync-check failures are fine; next tick retries */ }
      }, 10_000);
      return () => clearInterval(id);
    }

    const id = setInterval(() => fetchGcalEvents(weekOffsetRef.current), 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset, anyCalConnected, webhookActive]);

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

  // Reset token error flag when connection state changes so the warning can re-appear after reconnect
  useEffect(() => { tokenErrorShown.current = false; }, [googleConnected]);

  // Register a Google Calendar push-notification watch channel once connected.
  // Falls back gracefully if WEBHOOK_BASE_URL isn't configured on the backend.
  useEffect(() => {
    if (!googleConnected) { setWebhookActive(false); return; }
    apiRegisterCalendarWatch()
      .then(res => setWebhookActive(res?.status === 'registered' || res?.status === 'active'))
      .catch(() => setWebhookActive(false));
  }, [googleConnected]);


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

    // Build set of Google event IDs already shown as Smart Scheduler app events
    // (meetings written to Google Calendar via _write_to_calendars should not be shown twice)
    const knownGoogleIds = new Set();
    for (const m of confirmed) {
      for (const val of Object.values(m.externalEventIds || {})) {
        if (typeof val === 'string' && val.startsWith('google:')) {
          knownGoogleIds.add(val.slice(7));
        }
      }
    }

    const gEvents = gcalEvents
      .filter(ev => hasTime(ev.start))
      .filter(ev => !knownGoogleIds.has(ev.id))
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
                        setTooltip({ ev, el: e.currentTarget });
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
      <MeetingTooltip
        tooltip={tooltip}
        setTooltip={setTooltip}
        onMeetingClick={onMeetingClick}
        googleConnected={googleConnected}
        profile={profile}
      />

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
