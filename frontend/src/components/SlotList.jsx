/* SlotList — compact list view of candidate time slots */
export default function SlotList({ slots, calEvents = null, ssMeetings = [], onBook }) {
  const scoreColor = sc => sc >= 80 ? '#22c55e' : sc >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div className="slot-list">
      {slots.map((s, i) => {
        const sc = Math.round(s.score);
        const color = scoreColor(sc);
        const dt = new Date(s.startIso);
        const slotStart = new Date(s.startIso), slotEnd = new Date(s.endIso);
        const isNearby = (ev) => {
          if (!ev.start) return false;
          const evEnd = new Date(ev.end || ev.start);
          const evStart = new Date(ev.start);
          return evEnd > new Date(slotStart.getTime() - 2 * 3600000) &&
                 evStart < new Date(slotEnd.getTime() + 2 * 3600000);
        };
        const nearbyGcal  = (calEvents || []).filter(isNearby);
        const nearbySS    = (ssMeetings || []).filter(isNearby);
        const nearbyAll   = [...nearbySS, ...nearbyGcal];
        const stillLoading = calEvents === null && nearbySS.length === 0;
        return (
          <div key={i} className="slot-list-item" onClick={() => onBook(s)} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.3rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="sli-left">
                <span className="sli-date">
                  {i === 0 ? '⭐ ' : ''}
                  {dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <span className="sli-time">
                  {dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  <span
                    className="sli-ai"
                    title={s.aiScored ? 'Score produced by AI fairness model' : 'Score produced by the deterministic engine (AI unavailable)'}
                    style={s.aiScored ? undefined : { background: 'rgba(148,163,184,0.15)', color: '#94a3b8', borderColor: 'rgba(148,163,184,0.3)' }}
                  >
                    {s.aiScored ? '🧠 AI' : '⚙ Engine'}
                  </span>
                </span>
              </div>
              <div className="sli-right">
                <div className="slot-score-track" style={{ width: '80px' }}>
                  <div className="slot-score-fill" style={{ width: `${sc}%`, background: color }} />
                </div>
                <span className="sli-score" style={{ color }}>{sc}%</span>
              </div>
            </div>
            <div style={{ fontSize: '0.7rem', paddingLeft: '0.25rem' }}>
              {stillLoading
                ? <span style={{ color: '#6b7280' }}>⏳ Loading calendar…</span>
                : nearbyAll.length === 0
                  ? <span style={{ color: '#22c55e' }}>✓ Clear</span>
                  : <span style={{ color: '#9ca3af' }}>📅 {nearbyAll.map(ev => ev.summary || 'Busy').join(', ')}</span>
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}
