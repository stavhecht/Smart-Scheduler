import { useState } from 'react';
import { apiPost } from '../../apiClient';
import { useToast } from '../../context/ToastContext.jsx';

/* ── Fairness score breakdown + reset ── */
export default function FairnessBreakdown({ profile, score, onUpdated }) {
  const notify = useToast();
  const [resetting, setResetting] = useState(false);

  const details = profile.details || {};
  const balance        = details.fairness_balance ?? 0;
  const inconvenient   = details.inconvenient_count ?? 0;
  const convenient     = details.convenient_count ?? 0;
  const cancellations  = details.cancellations_last_month ?? 0;
  const lastReset      = details.last_week_reset;

  // Days until next auto-reset
  let daysUntilReset = null;
  if (lastReset) {
    const diff = 7 - Math.floor((Date.now() - new Date(lastReset).getTime()) / 86400000);
    daysUntilReset = Math.max(0, diff);
  }

  const showReset = score < 45 || score > 80;

  const handleReset = async () => {
    setResetting(true);
    try {
      const result = await apiPost('/api/profile/fairness/reset', {});
      onUpdated?.({
        ...profile,
        fairness_score: result.fairnessScore,
        details: {
          ...details,
          ...result.meetingLoadMetrics,
          fairness_balance: 0,
          inconvenient_count: 0,
          convenient_count: 0,
          cancellations_last_month: 0,
          last_week_reset: new Date().toISOString(),
        },
      });
      notify('Fairness score reset to neutral (50).', 'success');
    } catch (err) {
      notify(err?.message || 'Reset failed', 'error');
    } finally {
      setResetting(false);
    }
  };

  const statusText = score >= 55
    ? `+${Math.round(balance)} — you're owed a good slot next time`
    : score <= 45
    ? `${Math.round(balance)} — you've been getting convenient slots`
    : 'Balanced — neutral standing';

  const statusColor = score >= 55 ? '#34d399' : score <= 45 ? '#fbbf24' : 'var(--text-secondary)';

  return (
    <div className="pv-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>Fairness Balance</h3>
        {daysUntilReset !== null && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Resets in {daysUntilReset}d
          </span>
        )}
      </div>

      {/* Status line */}
      <div style={{ fontSize: '0.8rem', color: statusColor, marginBottom: '0.75rem', fontWeight: 600 }}>
        Balance: {statusText}
      </div>

      {/* Breakdown rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {inconvenient > 0 && (
          <BreakdownRow
            label={`Inconvenient meetings ×${inconvenient}`}
            desc="off-hours / weekend — you sacrificed"
            delta={`+${inconvenient * 8}–${inconvenient * 15}`}
            positive
          />
        )}
        {convenient > 0 && (
          <BreakdownRow
            label={`Convenient meetings ×${convenient}`}
            desc="prime time / normal hours — you got a good deal"
            delta={`−${convenient * 4}–${convenient * 10}`}
            positive={false}
          />
        )}
        {cancellations > 0 && (
          <BreakdownRow
            label={`Cancellations ×${cancellations}`}
            desc="disrupted others' schedules"
            delta={`−${cancellations * 5}`}
            positive={false}
          />
        )}
        {inconvenient === 0 && convenient === 0 && cancellations === 0 && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.4rem 0' }}>
            No meetings recorded yet — score starts at 50 (neutral).
          </div>
        )}

        {/* Final score */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.5rem 0.7rem', borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-surface)', fontSize: '0.82rem', fontWeight: 700,
          borderTop: '1px solid var(--border)', marginTop: '0.2rem',
        }}>
          <div>
            <span>Score: </span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.72rem' }}>
              (50 = neutral · above 50 = owed · below 50 = favored)
            </span>
          </div>
          <span style={{ color: score >= 55 ? '#34d399' : score <= 45 ? '#fbbf24' : 'var(--text-primary)' }}>
            {score} / 100
          </span>
        </div>
      </div>

      {showReset && (
        <button
          onClick={handleReset}
          disabled={resetting}
          style={{
            marginTop: '0.75rem', width: '100%',
            padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)',
            border: '1px solid rgba(99,102,241,0.3)',
            background: 'rgba(99,102,241,0.08)',
            color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 600,
            cursor: resetting ? 'not-allowed' : 'pointer',
            opacity: resetting ? 0.6 : 1,
            transition: 'all var(--transition)',
          }}
          onMouseEnter={e => !resetting && (e.currentTarget.style.background = 'rgba(99,102,241,0.15)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.08)')}
        >
          {resetting ? 'Resetting…' : 'Reset to neutral (50)'}
        </button>
      )}
    </div>
  );
}

function BreakdownRow({ label, desc, delta, positive }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '0.4rem 0.7rem', borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-raised)', fontSize: '0.78rem', gap: '0.5rem',
    }}>
      <div>
        <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{label}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{desc}</div>
      </div>
      <span style={{ fontWeight: 700, color: positive ? '#34d399' : '#fbbf24', flexShrink: 0 }}>
        {positive ? '+' : ''}{delta}
      </span>
    </div>
  );
}
