import Toggle from './Toggle.jsx';

/* ── Setting Row with toggle ── */
export default function PrefRow({ label, desc, on, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '1rem',
      padding: '0.85rem 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {desc && <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>{desc}</div>}
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}
