const ACTIVITY_ACTION_META = {
  created:     { dot: 'var(--accent)',   verb: 'created' },
  booked:      { dot: 'var(--success)',  verb: 'confirmed a time for' },
  accepted:    { dot: 'var(--success)',  verb: 'accepted' },
  declined:    { dot: 'var(--danger)',   verb: 'declined' },
  cancelled:   { dot: 'var(--danger)',   verb: 'cancelled' },
  rescheduled: { dot: 'var(--warning)', verb: 'rescheduled' },
  edited:      { dot: '#a78bfa',         verb: 'edited' },
};

const fmtRel = (iso) => {
  const diff = new Date() - new Date(iso);
  const min = Math.floor(diff / 60000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}h ago`;
  if (h < 48)   return 'yesterday';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function ActivityFeed({ activities }) {
  const ACTION_META = ACTIVITY_ACTION_META;
  if (!activities || activities.length === 0) {
    return <p className="empty-hint">No recent activity yet.</p>;
  }
  return (
    <div className="activity-feed">
      {activities.map((entry, i) => {
        const meta = ACTION_META[entry.action] || { dot: 'var(--text-muted)', verb: entry.action };
        return (
          <div key={i} className="activity-row">
            <div className="activity-dot" style={{ background: meta.dot }} />
            <div className="activity-body">
              <span className="activity-actor">{entry.actorName || 'Someone'}</span>
              {' '}{meta.verb}{' '}
              <span className="activity-meeting">"{entry.meetingTitle}"</span>
            </div>
            <span className="activity-time">{fmtRel(entry.at)}</span>
          </div>
        );
      })}
    </div>
  );
}
