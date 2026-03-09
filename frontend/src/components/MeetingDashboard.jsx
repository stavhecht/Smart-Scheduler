import { useState } from 'react';
import { apiPost } from '../apiClient';
import './MeetingDashboard.css';

/* ─────────────────────────────────────────────
   MeetingDashboard
   Props:
     meetings      – array from /api/meetings (each has userRole field)
     onRefresh     – fn to reload meetings
     currentUserId – authenticated user's ID (profile.id)
───────────────────────────────────────────── */
export default function MeetingDashboard({ meetings, onRefresh, currentUserId }) {
  const [expandedId, setExpandedId]     = useState(null);
  const [loading, setLoading]           = useState(false);
  const [showCreate, setShowCreate]     = useState(false);
  const [notification, setNotification] = useState(null);
  const [newMeeting, setNewMeeting]     = useState({
    title: '',
    durationMinutes: 60,
    participantEmails: '',
    daysForward: 7,
  });

  // Split meetings by role; sort invitations so "needs action" ones appear first
  const myMeetings  = meetings.filter(m => m.userRole === 'organizer');
  const invitations = meetings
    .filter(m => m.userRole === 'participant')
    .sort((a, b) => {
      const aNeedsAct = a.status === 'confirmed' && !(a.acceptedBy || []).includes(currentUserId) ? 1 : 0;
      const bNeedsAct = b.status === 'confirmed' && !(b.acceptedBy || []).includes(currentUserId) ? 1 : 0;
      return bNeedsAct - aNeedsAct;
    });
  const needsAction = invitations.filter(
    m => m.status === 'confirmed' && !(m.acceptedBy || []).includes(currentUserId)
  ).length;

  /* ── Helpers ── */
  const notify = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const toggle = (id) => setExpandedId(prev => prev === id ? null : id);

  const fmt = (iso, opts) => new Date(iso).toLocaleString('en-US', opts);
  const fmtDate = (iso) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = (iso) => fmt(iso, { hour: '2-digit', minute: '2-digit' });
  const fmtFull = (iso) => `${fmtDate(iso)} · ${fmtTime(iso)}`;

  /* ── Handlers ── */
  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setShowCreate(false);
    try {
      const emails = newMeeting.participantEmails
        .split(',').map(s => s.trim()).filter(Boolean);
      await apiPost('/api/meetings/create', {
        title: newMeeting.title,
        durationMinutes: Number(newMeeting.durationMinutes),
        participantEmails: emails,
        participantIds: [],
        daysForward: newMeeting.daysForward,
      });
      setNewMeeting({ title: '', durationMinutes: 60, participantEmails: '', daysForward: 7 });
      notify('Meeting created! AI is optimizing slots…');
      onRefresh();
    } catch (err) {
      notify('Failed to create meeting', 'error');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleBook = async (meetingId, slot) => {
    setLoading(true);
    setExpandedId(null);
    try {
      await apiPost(`/api/meetings/${meetingId}/book/${encodeURIComponent(slot.startIso)}`);
      notify('Slot booked! Participants have been notified.');
      onRefresh();
    } catch (err) {
      notify('Failed to book slot', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (meetingId) => {
    try {
      await apiPost(`/api/meetings/${meetingId}/accept`);
      notify('Meeting accepted! ✓');
      onRefresh();
    } catch (err) {
      notify('Failed to accept', 'error');
    }
  };

  /* ── Render ── */
  return (
    <div className="md-wrap">

      {/* Toast notification */}
      {notification && (
        <div className={`md-toast md-toast-${notification.type}`}>
          {notification.type === 'success' ? '✅' : '❌'} {notification.msg}
        </div>
      )}

      {/* Page header */}
      <div className="md-header">
        <div>
          <h2 className="md-title">Meetings</h2>
          <p className="md-sub">AI-optimised scheduling · Social Fairness Algorithm</p>
        </div>
        <button className="btn-new" onClick={() => setShowCreate(true)}>
          + New Meeting
        </button>
      </div>

      {/* Action-needed banner */}
      {needsAction > 0 && (
        <div className="md-alert">
          <span>🔔</span>
          <span>
            You have <strong>{needsAction}</strong> confirmed meeting
            {needsAction > 1 ? 's' : ''} awaiting your acceptance.
          </span>
        </div>
      )}

      {/* Spinner overlay */}
      {loading && (
        <div className="md-loading">
          <div className="spinner-sm" />
          <span>Processing…</span>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal-box">
            <div className="modal-head">
              <h3>📅 New Meeting Request</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate} className="modal-form">
              <div className="form-group">
                <label>Meeting Title</label>
                <input
                  autoFocus required
                  placeholder="e.g. Weekly Team Sync"
                  value={newMeeting.title}
                  onChange={e => setNewMeeting({ ...newMeeting, title: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Duration</label>
                <div className="dur-pills">
                  {[15, 30, 45, 60, 90].map(d => (
                    <button
                      key={d} type="button"
                      className={`dur-pill ${newMeeting.durationMinutes === d ? 'active' : ''}`}
                      onClick={() => setNewMeeting({ ...newMeeting, durationMinutes: d })}
                    >
                      {d < 60 ? `${d}m` : d === 60 ? '1h' : '1.5h'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Scheduling Horizon</label>
                <div className="dur-pills">
                  {[
                    { days: 3,  label: '3 days'  },
                    { days: 7,  label: '1 week'  },
                    { days: 14, label: '2 weeks' },
                  ].map(({ days, label }) => (
                    <button
                      key={days} type="button"
                      className={`dur-pill ${newMeeting.daysForward === days ? 'active' : ''}`}
                      onClick={() => setNewMeeting({ ...newMeeting, daysForward: days })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="form-hint">How far ahead the AI will search for available slots.</span>
              </div>

              <div className="form-group">
                <label>Invite Participants</label>
                <input
                  type="text"
                  placeholder="alice@co.com, bob@co.com"
                  value={newMeeting.participantEmails}
                  onChange={e => setNewMeeting({ ...newMeeting, participantEmails: e.target.value })}
                />
                <span className="form-hint">Comma-separated emails. They'll see this in their dashboard.</span>
              </div>

              <div className="modal-actions">
                <button type="submit" className="btn-submit">
                  🤖 Optimise & Create
                </button>
                <button type="button" className="btn-cancel" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── INVITATIONS section ── */}
      {invitations.length > 0 && (
        <section className="md-section">
          <div className="section-head">
            <span className="section-icon">📨</span>
            <h3>Invitations</h3>
            <span className="count-chip participant">{invitations.length}</span>
            {needsAction > 0 && <span className="count-chip warning">{needsAction} need action</span>}
          </div>
          <div className="cards-list">
            {invitations.map(m => (
              <MeetingCard
                key={m.requestId}
                meeting={m}
                currentUserId={currentUserId}
                isExpanded={expandedId === m.requestId}
                onToggle={() => toggle(m.requestId)}
                onAccept={() => handleAccept(m.requestId)}
                onBook={handleBook}
                fmtDate={fmtDate}
                fmtTime={fmtTime}
                fmtFull={fmtFull}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── MY MEETINGS section ── */}
      <section className="md-section">
        <div className="section-head">
          <span className="section-icon">📋</span>
          <h3>My Meetings</h3>
          <span className="count-chip organizer">{myMeetings.length}</span>
        </div>

        {myMeetings.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            <p>No meetings yet. Create one to get started!</p>
            <button className="btn-new-sm" onClick={() => setShowCreate(true)}>
              + Schedule a Meeting
            </button>
          </div>
        ) : (
          <div className="cards-list">
            {myMeetings.map(m => (
              <MeetingCard
                key={m.requestId}
                meeting={m}
                currentUserId={currentUserId}
                isExpanded={expandedId === m.requestId}
                onToggle={() => toggle(m.requestId)}
                onAccept={() => {}}
                onBook={handleBook}
                fmtDate={fmtDate}
                fmtTime={fmtTime}
                fmtFull={fmtFull}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────────────────────────────
   MeetingCard sub-component
───────────────────────────────────────────── */
function MeetingCard({ meeting, currentUserId, isExpanded, onToggle, onAccept, onBook, fmtDate, fmtTime, fmtFull }) {
  const isOrganizer = meeting.userRole === 'organizer';
  const isConfirmed = meeting.status === 'confirmed';
  const hasSlots    = Array.isArray(meeting.slots) && meeting.slots.length > 0;
  const userAccepted = (meeting.acceptedBy || []).includes(currentUserId);
  const needsAccept = !isOrganizer && isConfirmed && !userAccepted;
  const participantCount = (meeting.participantUserIds || []).length;

  return (
    <div className={`mc ${meeting.userRole} ${isConfirmed ? 'confirmed' : 'pending'} ${needsAccept ? 'needs-action' : ''}`}>

      {/* Card header — always visible */}
      <div className="mc-head" onClick={onToggle}>
        <div className="mc-left">
          <div className="mc-title-row">
            <span className="mc-status-dot" />
            <span className="mc-title">{meeting.title}</span>
            <span className={`mc-role-badge ${meeting.userRole}`}>
              {isOrganizer ? 'Organizer' : 'Invited'}
            </span>
          </div>
          <div className="mc-meta">
            <span>⏱ {meeting.durationMinutes}m</span>
            {participantCount > 0 && <span>👥 {participantCount + 1} people</span>}
            {isConfirmed && meeting.selectedSlotStart && (
              <span className="mc-confirmed-time">
                📅 {fmtFull(meeting.selectedSlotStart)}
              </span>
            )}
            {!isConfirmed && hasSlots && isOrganizer && (
              <span className="mc-slots-hint">{meeting.slots.length} slots available</span>
            )}
          </div>
        </div>

        <div className="mc-right">
          {/* Accept button for participant */}
          {needsAccept && (
            <button
              className="btn-accept"
              onClick={e => { e.stopPropagation(); onAccept(); }}
            >
              ✓ Accept
            </button>
          )}
          {!isOrganizer && isConfirmed && userAccepted && (
            <span className="badge-accepted">✓ Accepted</span>
          )}
          <span className={`status-chip ${isConfirmed ? 'confirmed' : 'pending'}`}>
            {isConfirmed ? 'Confirmed' : 'Pending'}
          </span>
          {/* Expand arrow — show for organizer pending OR any expanded state */}
          {(isOrganizer && !isConfirmed && hasSlots) && (
            <span className="expand-arrow">{isExpanded ? '▲' : '▼'}</span>
          )}
          {isOrganizer && isConfirmed && (
            <span className="expand-arrow">{isExpanded ? '▲' : '▼'}</span>
          )}
        </div>
      </div>

      {/* Slot selection panel — organizer, pending, expanded */}
      {isExpanded && isOrganizer && !isConfirmed && hasSlots && (
        <div className="mc-panel slots-panel">
          <div className="panel-title">🤖 AI-Optimised Time Slots — click to confirm</div>
          <div className="slots-grid">
            {meeting.slots.map((slot, idx) => (
              <div
                key={idx}
                className={`slot-card ${idx === 0 ? 'top-pick' : ''}`}
                onClick={() => onBook(meeting.requestId, slot)}
              >
                {idx === 0 && <div className="top-badge">⭐ Best Match</div>}
                <div className="slot-date">{fmtDate(slot.startIso)}</div>
                <div className="slot-time">{fmtTime(slot.startIso)} – {fmtTime(slot.endIso)}</div>
                <div className="slot-score-row">
                  <span className="slot-score-label">Fairness</span>
                  <div className="slot-score-track">
                    <div
                      className="slot-score-fill"
                      style={{ width: `${Math.min(100, Math.round(slot.score))}%` }}
                    />
                  </div>
                  <span className="slot-score-val">{Math.round(slot.score)}%</span>
                </div>
                <div className="slot-explain">"{slot.explanation}"</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Participant acceptance panel — organizer, confirmed, expanded */}
      {isExpanded && isOrganizer && isConfirmed && (
        <div className="mc-panel accept-panel">
          <div className="panel-title">👥 Participant Status</div>
          <div className="participant-list">
            <div className="participant-row">
              <span className="p-dot accepted" />
              <span className="p-name">You (Organizer)</span>
              <span className="p-status confirmed">✓ Organized</span>
            </div>
            {(meeting.participantUserIds || []).map(pid => {
              const accepted = (meeting.acceptedBy || []).includes(pid);
              return (
                <div key={pid} className="participant-row">
                  <span className={`p-dot ${accepted ? 'accepted' : 'pending'}`} />
                  <span className="p-name">{pid}</span>
                  <span className={`p-status ${accepted ? 'confirmed' : 'pending'}`}>
                    {accepted ? '✓ Accepted' : '⏳ Pending'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Info panel — participant, pending (meeting not yet booked) */}
      {isExpanded && !isOrganizer && !isConfirmed && (
        <div className="mc-panel info-panel">
          <p>The organizer is still selecting a time slot. You'll be notified once a time is confirmed.</p>
        </div>
      )}
    </div>
  );
}
