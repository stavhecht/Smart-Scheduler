export default function ParticipantList({ participants, acceptedBy, currentUserId }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      {participants.map((p, i) => {
        const name    = p.name || p.displayName || p.email || '?';
        const initials = name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
        const accepted = acceptedBy.includes(p.userId || p.id);
        const isMe     = (p.userId || p.id) === currentUserId;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.25rem 0.6rem',
            borderRadius: '20px',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            fontSize: '0.78rem',
          }}>
            <div style={{
              width: '20px', height: '20px',
              borderRadius: '50%',
              background: isMe ? 'linear-gradient(135deg, var(--accent), var(--purple))' : 'var(--bg-surface)',
              border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.6rem', fontWeight: 700,
              color: isMe ? '#000' : 'var(--text-secondary)',
              flexShrink: 0,
            }}>
              {initials}
            </div>
            <span style={{ color: 'var(--text-primary)', fontWeight: isMe ? 600 : 400 }}>
              {name}{isMe ? ' (you)' : ''}
            </span>
            {accepted && (
              <span style={{ color: 'var(--success)', fontSize: '0.65rem' }}>✓</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
