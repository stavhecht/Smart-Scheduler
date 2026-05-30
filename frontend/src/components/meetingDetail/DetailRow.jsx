export default function DetailRow({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
      <span style={{
        minWidth: '90px',
        fontSize: '0.72rem',
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        paddingTop: '0.2rem',
        flexShrink: 0,
      }}>
        {label}
      </span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
