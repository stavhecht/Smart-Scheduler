export default function ActionBtn({ label, color, bg, border, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.45rem 1rem',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${border || 'var(--border)'}`,
        background: bg || 'var(--bg-raised)',
        color: color || 'var(--text-primary)',
        fontSize: '0.82rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all var(--transition)',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
    >
      {label}
    </button>
  );
}
