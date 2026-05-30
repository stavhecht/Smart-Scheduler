import { useState, useMemo } from 'react';

/* SlotCalendar — full-week calendar reusing cv-* classes from CalendarView.css */
export default function SlotCalendar({ slots, preferredHours, calEvents = null, ssMeetings = [], onBook }) {
  const scoreColor = sc => sc >= 80 ? '#22c55e' : sc >= 60 ? '#f59e0b' : '#ef4444';

  const slotHours = useMemo(() => slots.flatMap(s => {
    const h = new Date(s.startIso).getHours();
    const eh = new Date(s.endIso).getHours() + (new Date(s.endIso).getMinutes() > 0 ? 1 : 0);
    return [h, eh];
  }), [slots]);
  const CAL_START = slots.length ? Math.max(0, Math.min(7, ...slotHours) - 1) : 7;
  const CAL_END   = slots.length ? Math.min(24, Math.max(22, ...slotHours) + 1) : 22;
  const CAL_HOURS = Array.from({ length: CAL_END - CAL_START }, (_, i) => CAL_START + i);

  const initialOffset = useMemo(() => {
    if (!slots.length) return 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const toMon = today.getDay() === 0 ? -6 : 1 - today.getDay();
    const monday = new Date(today); monday.setDate(today.getDate() + toMon);
    const first = new Date(slots[0].startIso); first.setHours(0, 0, 0, 0);
    return Math.floor((first - monday) / (7 * 864e5));
  }, [slots]);

  const [weekOffset, setWeekOffset] = useState(initialOffset);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() + (today.getDay() === 0 ? -6 : 1 - today.getDay()) + weekOffset * 7);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    return { date: d, name: d.toLocaleDateString('en-US', { weekday: 'short' }), label: d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }), isToday: d.toDateString() === new Date().toDateString() };
  });

  const weekLabel = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).formatRange(weekDays[0].date, weekDays[6].date);
  const topSlotIso = slots.length ? slots[0].startIso : null;

  const _evPos = (ev) => {
    const start = new Date(ev.start), end = new Date(ev.end || ev.start);
    const h = start.getHours() + start.getMinutes() / 60;
    const endH = end.getHours() + end.getMinutes() / 60;
    const cs = Math.max(h, CAL_START), ce = Math.min(endH || h + 1, CAL_END);
    const range = CAL_END - CAL_START;
    return { topPct: (cs - CAL_START) / range * 100, heightPct: Math.max((ce - cs) / range * 100, 1.5), startStr: start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), visible: ce > cs };
  };

  const getCalEventsForDay = (dayDate) => (calEvents || [])
    .filter(ev => ev.start && new Date(ev.start).toDateString() === dayDate.toDateString())
    .map(ev => ({ title: ev.summary || 'Busy', ..._evPos(ev) }))
    .filter(e => e.visible);

  const getSSEventsForDay = (dayDate) => (ssMeetings || [])
    .filter(ev => ev.start && new Date(ev.start).toDateString() === dayDate.toDateString())
    .map(ev => ({ title: ev.summary || 'Meeting', ..._evPos(ev) }))
    .filter(e => e.visible);

  const getSlotsForDay = (dayDate) => slots
    .filter(s => new Date(s.startIso).toDateString() === dayDate.toDateString())
    .map(s => {
      const start = new Date(s.startIso), end = new Date(s.endIso);
      const h = start.getHours() + start.getMinutes() / 60;
      const endH = end.getHours() + end.getMinutes() / 60;
      const cs = Math.max(h, CAL_START), ce = Math.min(endH, CAL_END);
      const range = CAL_END - CAL_START;
      return { s, topPct: (cs - CAL_START) / range * 100, heightPct: Math.max((ce - cs) / range * 100, 2), startStr: start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), sc: Math.round(s.score), isTop: s.startIso === topSlotIso, visible: ce > cs };
    })
    .filter(e => e.visible);

  const hasSlots = weekDays.some(day => getSlotsForDay(day.date).length > 0);

  return (
    <div className="cv-wrap" style={{ marginTop: '0.5rem' }}>
      <div className="cv-header">
        <div className="cv-nav">
          <button className="cv-btn" onClick={() => setWeekOffset(w => w - 1)}>‹ Prev</button>
          <button className="cv-today-btn" onClick={() => setWeekOffset(initialOffset)}>Slots week</button>
          <button className="cv-btn" onClick={() => setWeekOffset(w => w + 1)}>Next ›</button>
        </div>
        <span className="cv-week-label">{weekLabel}</span>
      </div>
      {(ssMeetings.length > 0 || (calEvents && calEvents.length > 0)) && (
        <div style={{ display: 'flex', gap: '1rem', padding: '0.3rem 0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          {ssMeetings.length > 0 && <span><span style={{ color: '#6366f1' }}>■</span> Existing meetings</span>}
          {calEvents && calEvents.length > 0 && <span><span style={{ color: '#6b7280' }}>■</span> Calendar events</span>}
          <span><span style={{ color: '#22c55e' }}>■</span> Proposed slots</span>
        </div>
      )}
      <div className="cv-scroll">
        <div className="cv-grid">
          <div className="cv-time-col">
            <div className="cv-corner" />
            {CAL_HOURS.map(h => <div key={h} className="cv-hour-label">{h}:00</div>)}
          </div>
          {weekDays.map(day => (
            <div key={day.name} className={`cv-day-col${day.isToday ? ' today-col' : ''}`}>
              <div className={`cv-day-header${day.isToday ? ' today' : ''}`}>
                <span className="cv-day-name">{day.name}</span>
                <span className={`cv-day-num${day.isToday ? ' today-num' : ''}`}>{day.label}</span>
              </div>
              <div className="cv-day-body">
                {CAL_HOURS.map(h => <div key={h} className="cv-hour-cell" />)}
                {getCalEventsForDay(day.date).map((ev, j) => (
                  <div key={`ce-${j}`} className="cv-event"
                    style={{ top: `calc(${ev.topPct}% + 1px)`, height: `calc(${ev.heightPct}% - 2px)`, left: '2px', right: '2px', background: '#6b728030', borderLeft: '3px solid #6b7280', color: '#9ca3af', cursor: 'default', zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}
                    title={`${ev.title} @ ${ev.startStr}`}
                  >
                    <span className="cv-ev-title" style={{ fontSize: '0.65rem', opacity: 0.8 }}>{ev.title}</span>
                  </div>
                ))}
                {getSSEventsForDay(day.date).map((ev, j) => (
                  <div key={`ss-${j}`} className="cv-event"
                    style={{ top: `calc(${ev.topPct}% + 1px)`, height: `calc(${ev.heightPct}% - 2px)`, left: '2px', right: '2px', background: '#6366f130', borderLeft: '3px solid #6366f1', color: '#818cf8', cursor: 'default', zIndex: 1, pointerEvents: 'none', overflow: 'hidden' }}
                    title={`📌 ${ev.title} · ${ev.startStr}`}
                  >
                    <span className="cv-ev-title" style={{ fontSize: '0.65rem', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📌 {ev.startStr}</span>
                  </div>
                ))}
                {getSlotsForDay(day.date).map((e, i) => {
                  const color = scoreColor(e.sc);
                  return (
                    <div key={i} className="cv-event"
                      style={{ top: `calc(${e.topPct}% + 1px)`, height: `calc(${e.heightPct}% - 2px)`, left: '2px', right: '2px', background: `${color}1a`, borderLeft: `3px solid ${color}`, color, cursor: 'pointer' }}
                      onClick={() => onBook(e.s)}
                      title={`${e.sc}% fairness${e.s.isPreferred && preferredHours?.length > 0 ? ' ⏰ preferred' : ''}${e.s.aiScored ? ' (AI-scored)' : ''}${e.s.explanation ? ' — ' + e.s.explanation : ''}${e.s.aiSuggestions ? '\n💡 ' + e.s.aiSuggestions : ''}`}
                    >
                      <span className="cv-ev-title">{e.isTop ? '⭐ ' : ''}{e.s.aiScored ? '🧠 ' : ''}{e.startStr}</span>
                      <span className="cv-ev-time">{e.sc}% fair</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {!hasSlots && <div className="cv-empty"><span>📭</span><span>No slots this week — use the arrows to navigate.</span></div>}
    </div>
  );
}
