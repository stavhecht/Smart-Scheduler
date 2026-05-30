/* ─────────────────────────────────────────────
   AiAnalysisPanel
   Renders the AI fairness verdict computed synchronously during meeting
   creation. Reads from meeting.aiAnalysis (no polling, no async loading).

   Shape of `analysis`:
     {
       method: 'ai' | 'heuristic_fallback',
       model: string,
       summary: string,
       bestSlot: string (ISO),
       bestSlotReason: string,
       calendarSuggestions: string[],
       meetingFairnessScore: number,
     }
───────────────────────────────────────────── */
export default function AiAnalysisPanel({ analysis, selectedSlotStart }) {
  if (!analysis) return null;
  const score = Math.round(Number(analysis.meetingFairnessScore || 0));
  const method = analysis.method || '';
  const summary = analysis.summary || '';
  const bestSlot = analysis.bestSlot || '';
  const bestSlotReason = analysis.bestSlotReason || '';
  const suggestions = analysis.calendarSuggestions || [];

  const scoreColor =
    score >= 80 ? 'var(--success)' :
    score >= 60 ? 'var(--accent)' :
    score >= 40 ? '#fbbf24'        : 'var(--danger)';

  const methodLabel =
    method === 'ai' ? (analysis.model || 'gpt-4o-mini') :
    method === 'heuristic_fallback' ? 'heuristic fallback' :
    method;

  const fmtSlot = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const isBestTheSelected = bestSlot && selectedSlotStart && bestSlot === selectedSlotStart;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      {/* Score line */}
      <div>
        <span style={{ color: scoreColor, fontWeight: 700, fontSize: '0.95rem' }}>
          {score} / 100
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: '0.5rem' }}>
          ({methodLabel})
        </span>
      </div>

      {/* Summary */}
      {summary && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.5 }}>
          {summary}
        </p>
      )}

      {/* Best slot recommendation */}
      {bestSlot && (
        <div style={{
          padding: '0.6rem 0.75rem',
          borderRadius: 'var(--radius-md)',
          background: isBestTheSelected ? 'rgba(52,211,153,0.08)' : 'var(--bg-raised)',
          border: `1px solid ${isBestTheSelected ? 'rgba(52,211,153,0.25)' : 'var(--border)'}`,
        }}>
          <div style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: isBestTheSelected ? 'var(--success)' : 'var(--accent)',
            marginBottom: '0.3rem',
          }}>
            {isBestTheSelected ? '✓ AI recommended (this slot)' : 'AI recommended slot'}
          </div>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.85rem' }}>
            {fmtSlot(bestSlot)}
          </div>
          {bestSlotReason && (
            <p style={{
              margin: '0.35rem 0 0',
              color: 'var(--text-secondary)',
              fontSize: '0.78rem',
              lineHeight: 1.5,
            }}>
              {bestSlotReason}
            </p>
          )}
        </div>
      )}

      {/* Calendar suggestions */}
      {suggestions.length > 0 && (
        <div>
          <div style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--text-muted)',
            marginBottom: '0.35rem',
          }}>
            Calendar tips for better slots
          </div>
          <ul style={{
            margin: 0,
            paddingLeft: '1.1rem',
            color: 'var(--text-secondary)',
            fontSize: '0.78rem',
            lineHeight: 1.55,
          }}>
            {suggestions.map((s, i) => (
              <li key={i} style={{ marginBottom: '0.25rem' }}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
