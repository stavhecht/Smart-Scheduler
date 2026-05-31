export default function StatItem({ val, label, color }) {
  return (
    <div className="pv-stat">
      <span className="pv-stat-val" style={{ color: color || 'var(--text-primary)' }}>{val}</span>
      <span className="pv-stat-label">{label}</span>
    </div>
  );
}
