/* ── Toggle Switch ── */
export default function Toggle({ on, onChange }) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{
        width: '38px', height: '22px',
        borderRadius: '11px',
        background: on ? 'rgba(52,211,153,0.35)' : 'var(--bg-raised)',
        border: on ? '1px solid rgba(52,211,153,0.4)' : '1px solid var(--border)',
        position: 'relative',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'all 0.2s',
      }}
    >
      <div style={{
        position: 'absolute',
        top: '3px',
        left: on ? '17px' : '3px',
        width: '14px', height: '14px',
        borderRadius: '50%',
        background: on ? 'var(--success)' : 'var(--text-muted)',
        transition: 'all 0.2s',
      }} />
    </div>
  );
}
