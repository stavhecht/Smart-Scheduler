import { useState, useEffect, useMemo } from 'react';
import { apiPost, apiScoreSlot } from '../apiClient';
import { Mail, CalendarPlus, Pencil, Trash2, RefreshCw, Ban, X, Search, CalendarDays, ClipboardList } from 'lucide-react';
import { useToast } from '../context/ToastContext.jsx';
import './MeetingDashboard.css';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validateEmails = (str) => {
  const list = str.split(',').map(s => s.trim()).filter(Boolean);
  return { list, invalid: list.filter(e => !EMAIL_REGEX.test(e)) };
};

/* ─────────────────────────────────────────────
   MeetingDashboard
   Props:
     meetings      – array from /api/meetings (each has userRole field)
     onRefresh     – fn to reload meetings
     currentUserId – authenticated user's ID (profile.id)
───────────────────────────────────────────── */
const getInitials = (name) => name
  ? name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
  : '?';

export default function MeetingDashboard({ meetings, onRefresh, currentUserId, onParticipantClick, lastRefreshed, onNewMeetingClick }) {
  const notify = useToast();
  const [expandedId, setExpandedId]             = useState(null);
  const [loading, setLoading]                   = useState(false);
  const [busyId, setBusyId]                     = useState(null); // requestId of in-flight book/accept
  const [editModal, setEditModal]               = useState(null);       // { requestId, title, durationMinutes }
  const [cancelConfirmId, setCancelConfirmId]   = useState(null);       // requestId
  const [rescheduleConfirmId, setRescheduleConfirmId] = useState(null); // requestId
  const [showCancelled, setShowCancelled]       = useState(false);
  const [declineConfirmId, setDeclineConfirmId] = useState(null);   // requestId
  const [searchQuery, setSearchQuery]           = useState('');
  const [filterStatus, setFilterStatus]         = useState('all');
  // Custom time picker state per meeting: { [requestId]: { datetime, scoring, scored } }
  const [customPicker, setCustomPicker]         = useState({});
  const [lastBookedIcs, setLastBookedIcs]       = useState(null); // { content, title }

  // Search + filter
  const filteredMeetings = useMemo(() => {
    let list = meetings;
    if (filterStatus !== 'all') list = list.filter(m => m.status === filterStatus);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(m =>
        m.title?.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [meetings, searchQuery, filterStatus]);

  // Split meetings by status then role
  const activeMeetings    = filteredMeetings.filter(m => m.status !== 'cancelled');
  const cancelledMeetings = meetings.filter(m => m.status === 'cancelled');
  const myActiveMeetings  = activeMeetings.filter(m => m.userRole === 'organizer');

  // Sort invitations so "needs action" ones appear first
  const invitations = activeMeetings
    .filter(m => m.userRole === 'participant')
    .sort((a, b) => {
      const aNeedsAct = a.status === 'confirmed' && !(a.acceptedBy || []).includes(currentUserId) ? 1 : 0;
      const bNeedsAct = b.status === 'confirmed' && !(b.acceptedBy || []).includes(currentUserId) ? 1 : 0;
      return bNeedsAct - aNeedsAct;
    });
  const needsAction = invitations.filter(
    m => m.status === 'confirmed' && !(m.acceptedBy || []).includes(currentUserId)
  ).length;

  /* ── Keyboard: Escape closes open modals ── */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (editModal) setEditModal(null);
      else if (cancelConfirmId) setCancelConfirmId(null);
      else if (rescheduleConfirmId) setRescheduleConfirmId(null);
      else if (declineConfirmId) setDeclineConfirmId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editModal, cancelConfirmId, rescheduleConfirmId, declineConfirmId]);

  const toggle = (id) => setExpandedId(prev => prev === id ? null : id);

  const fmt = (iso, opts) => new Date(iso).toLocaleString('en-US', opts);
  const fmtDate = (iso) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = (iso) => fmt(iso, { hour: '2-digit', minute: '2-digit' });
  const fmtFull = (iso) => `${fmtDate(iso)} · ${fmtTime(iso)}`;

  /* ── Handlers ── */
  const handleBook = async (meetingId, slot) => {
    setBusyId(meetingId);
    setExpandedId(null);
    try {
      const result = await apiPost(`/api/meetings/${meetingId}/book/${encodeURIComponent(slot.startIso)}`);
      if (result?.calendarSyncWarning) {
        notify(result.calendarSyncWarning, 'error');
      } else {
        notify('Slot booked! Participants have been notified.', 'success');
      }
      if (result?.icsContent) {
        setLastBookedIcs({ content: result.icsContent, title: slot.title || 'meeting' });
      }
    } catch (err) {
      notify(err.message || 'Failed to book slot', 'error');
    } finally {
      setBusyId(null);
      onRefresh();
    }
  };

  const handleAccept = async (meetingId) => {
    setBusyId(meetingId);
    try {
      await apiPost(`/api/meetings/${meetingId}/accept`);
      notify('Meeting accepted!', 'success');
      onRefresh();
    } catch {
      notify('Failed to accept', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async () => {
    if (!declineConfirmId) return;
    try {
      await apiPost(`/api/meetings/${declineConfirmId}/decline`);
      notify('Meeting declined.', 'info');
      setDeclineConfirmId(null);
      onRefresh();
    } catch {
      notify('Failed to decline meeting', 'error');
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editModal) return;
    setLoading(true);
    try {
      await apiPost(`/api/meetings/${editModal.requestId}/edit`, {
        title: editModal.title,
        description: editModal.description ?? '',
        durationMinutes: Number(editModal.durationMinutes),
      });
      notify('Meeting updated!', 'success');
      setEditModal(null);
      onRefresh();
    } catch {
      notify('Failed to update meeting', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelConfirmId) return;
    setLoading(true);
    try {
      await apiPost(`/api/meetings/${cancelConfirmId}/cancel`);
      notify('Meeting cancelled.', 'info');
      setCancelConfirmId(null);
      setExpandedId(null);
      onRefresh();
    } catch {
      notify('Failed to cancel meeting', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleReschedule = async () => {
    if (!rescheduleConfirmId) return;
    setLoading(true);
    try {
      await apiPost(`/api/meetings/${rescheduleConfirmId}/reschedule`);
      notify('Meeting reset to pending — AI is regenerating slots…', 'info');
      setRescheduleConfirmId(null);
      setExpandedId(null);
      onRefresh();
    } catch {
      notify('Failed to reschedule', 'error');
    } finally {
      setLoading(false);
    }
  };

  /** Score a custom datetime for a specific meeting's participants. */
  const handleScoreCustomTime = async (meetingId, meeting) => {
    const picker = customPicker[meetingId] || {};
    if (!picker.datetime) return;
    setCustomPicker(prev => ({ ...prev, [meetingId]: { ...picker, scoring: true, scored: null } }));
    try {
      const result = await apiScoreSlot(
        picker.datetime,
        meeting.durationMinutes,
        meeting.participantUserIds || [],
      );
      setCustomPicker(prev => ({ ...prev, [meetingId]: { ...picker, scoring: false, scored: result } }));
    } catch {
      notify('Could not score that time', 'error');
      setCustomPicker(prev => ({ ...prev, [meetingId]: { ...picker, scoring: false } }));
    }
  };

  /** Book a custom time (not from AI-generated slots). */
  const handleBookCustom = async (meetingId, meeting) => {
    const picker = customPicker[meetingId];
    if (!picker?.scored) return;
    setLoading(true);
    setExpandedId(null);
    try {
      const result = await apiPost(`/api/meetings/${meetingId}/book_custom`, picker.scored);
      if (result?.calendarSyncWarning) {
        notify(result.calendarSyncWarning, 'error');
      } else {
        notify('Custom time booked! Participants have been notified.', 'success');
      }
      if (result?.icsContent) {
        setLastBookedIcs({ content: result.icsContent, title: meeting.title || 'meeting' });
      }
      setCustomPicker(prev => { const n = { ...prev }; delete n[meetingId]; return n; });
      onRefresh();
    } catch {
      notify('Failed to book custom time', 'error');
    } finally {
      setLoading(false);
    }
  };

  /* ── Render ── */
  return (
    <div className="md-wrap">

      {/* Toast notifications (stacked) */}
      {/* .ics download banner */}
      {lastBookedIcs && (
        <div className="ics-download-banner">
          <span><CalendarDays size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />Add to your calendar:</span>
          <a
            href={`data:text/calendar;charset=utf-8,${encodeURIComponent(lastBookedIcs.content)}`}
            download={`${lastBookedIcs.title}.ics`}
          >
            Download .ics invite
          </a>
          <button className="ics-banner-close" onClick={() => setLastBookedIcs(null)}><X size={14} /></button>
        </div>
      )}

      {/* Page header */}
      <div className="md-header">
        <div>
          <h2 className="md-title">Meetings</h2>
          <p className="md-sub">
            AI-optimised scheduling · Social Fairness Algorithm
            {lastRefreshed && (
              <span className="last-refreshed"> · Updated {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn-refresh" onClick={onRefresh} title="Refresh meetings"><RefreshCw size={14} /></button>
          <button className="btn-new" onClick={onNewMeetingClick}>
            + New Meeting
          </button>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="md-search-bar">
        <div className="md-search-wrap">
          <Search size={14} className="md-search-icon" />
          <input
            type="text"
            className="md-search-input"
            placeholder="Search meetings…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className="md-filter-select"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>
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




      {/* ── Edit Modal ── */}
      {editModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditModal(null)}>
          <div className="modal-box">
            <div className="modal-head">
              <h3><Pencil size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />Edit Meeting</h3>
              <button className="modal-close" onClick={() => setEditModal(null)}><X size={14} /></button>
            </div>
            <form onSubmit={handleEdit} className="modal-form">
              <div className="form-group">
                <label>Meeting Title</label>
                <input
                  autoFocus required
                  value={editModal.title}
                  onChange={e => setEditModal({ ...editModal, title: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Duration</label>
                <div className="dur-pills">
                  {[15, 30, 45, 60, 90].map(d => (
                    <button
                      key={d} type="button"
                      className={`dur-pill ${editModal.durationMinutes === d ? 'active' : ''}`}
                      onClick={() => setEditModal({ ...editModal, durationMinutes: d })}
                    >
                      {d < 60 ? `${d}m` : d === 60 ? '1h' : '1.5h'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Agenda / Notes</label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  placeholder="Agenda, links, context…"
                  value={editModal.description ?? ''}
                  onChange={e => setEditModal({ ...editModal, description: e.target.value })}
                  style={{ resize: 'vertical', minHeight: '70px' }}
                />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn-submit">💾 Save Changes</button>
                <button type="button" className="btn-cancel" onClick={() => setEditModal(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Cancel Confirmation ── */}
      {cancelConfirmId && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setCancelConfirmId(null)}>
          <div className="modal-box confirm-box">
            <div className="modal-head">
              <h3><Trash2 size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />Cancel Meeting</h3>
              <button className="modal-close" onClick={() => setCancelConfirmId(null)}><X size={14} /></button>
            </div>
            <div className="confirm-body">
              <p>Are you sure you want to cancel this meeting? All participants will be notified.</p>
              <div className="modal-actions">
                <button className="btn-danger" onClick={handleCancel} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  {loading ? <><span className="btn-spinner" />Cancelling…</> : 'Yes, Cancel Meeting'}
                </button>
                <button className="btn-cancel" onClick={() => setCancelConfirmId(null)}>Keep It</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reschedule Confirmation ── */}
      {rescheduleConfirmId && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setRescheduleConfirmId(null)}>
          <div className="modal-box confirm-box">
            <div className="modal-head">
              <h3><RefreshCw size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />Reschedule Meeting</h3>
              <button className="modal-close" onClick={() => setRescheduleConfirmId(null)}><X size={14} /></button>
            </div>
            <div className="confirm-body">
              <p>This will reset the meeting to <strong>pending</strong> and the AI will generate new time slots.</p>
              <div className="modal-actions">
                <button className="btn-submit" onClick={handleReschedule}>Regenerate Slots</button>
                <button className="btn-cancel" onClick={() => setRescheduleConfirmId(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Decline Confirmation ── */}
      {declineConfirmId && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setDeclineConfirmId(null)}>
          <div className="modal-box confirm-box">
            <div className="modal-head">
              <h3><Ban size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />Decline Meeting</h3>
              <button className="modal-close" onClick={() => setDeclineConfirmId(null)}><X size={14} /></button>
            </div>
            <div className="confirm-body">
              <p>Are you sure you want to decline this meeting? The organizer will be notified.</p>
              <div className="modal-actions">
                <button className="btn-danger" onClick={handleDecline} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  {loading ? <><span className="btn-spinner" />Declining…</> : 'Yes, Decline'}
                </button>
                <button className="btn-cancel" onClick={() => setDeclineConfirmId(null)}>Keep It</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── INVITATIONS section ── */}
      <section className="md-section">
        <div className="section-head">
          <span className="section-icon"><Mail size={15} /></span>
          <h3>Invitations</h3>
          {invitations.length > 0 && <span className="count-chip participant">{invitations.length}</span>}
          {needsAction > 0 && <span className="count-chip warning">{needsAction} need action</span>}
        </div>
        {invitations.length === 0 ? (
          <div className="empty-state empty-state-sm">
            <span className="empty-icon">✅</span>
            <div>
              <p>You're all caught up!</p>
              <p style={{ fontSize: '0.74rem', marginTop: '0.2rem', opacity: 0.6 }}>No pending invitations right now.</p>
            </div>
          </div>
        ) : (
          <div className="cards-list">
            {invitations.map((m, i) => (
              <MeetingCard
                key={m.requestId}
                meeting={m}
                style={{ '--delay': `${Math.min(i * 35, 350)}ms` }}
                currentUserId={currentUserId}
                isExpanded={expandedId === m.requestId}
                onToggle={() => toggle(m.requestId)}
                onAccept={() => handleAccept(m.requestId)}
                onDecline={() => setDeclineConfirmId(m.requestId)}
                onBook={handleBook}
                busyId={busyId}
                fmtDate={fmtDate}
                fmtTime={fmtTime}
                fmtFull={fmtFull}
                onParticipantClick={onParticipantClick}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── MY MEETINGS section ── */}
      <section className="md-section">
        <div className="section-head">
          <span className="section-icon"><ClipboardList size={15} /></span>
          <h3>My Meetings</h3>
          <span className="count-chip organizer">{myActiveMeetings.length}</span>
        </div>

        {myActiveMeetings.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><CalendarPlus size={48} strokeWidth={1} /></div>
            <p>No meetings yet. Create one to get started!</p>
            <p style={{ fontSize: '0.78rem', opacity: 0.5, marginTop: '-0.75rem' }}>The AI will optimise slots based on everyone's fairness score.</p>
            <button className="btn-new-sm btn-new-sm-pulse" onClick={onNewMeetingClick}>
              + Schedule a Meeting
            </button>
          </div>
        ) : (
          <div className="cards-list">
            {myActiveMeetings.map((m, i) => (
              <MeetingCard
                key={m.requestId}
                meeting={m}
                style={{ '--delay': `${Math.min(i * 35, 350)}ms` }}
                currentUserId={currentUserId}
                isExpanded={expandedId === m.requestId}
                onToggle={() => toggle(m.requestId)}
                onAccept={() => {}}
                onBook={handleBook}
                onEdit={() => setEditModal({ requestId: m.requestId, title: m.title, durationMinutes: m.durationMinutes, description: m.description || '' })}
                onCancel={() => setCancelConfirmId(m.requestId)}
                onReschedule={m.status === 'confirmed' ? () => setRescheduleConfirmId(m.requestId) : null}
                fmtDate={fmtDate}
                fmtTime={fmtTime}
                fmtFull={fmtFull}
                customPicker={customPicker[m.requestId] || {}}
                onCustomPickerChange={val => setCustomPicker(prev => ({ ...prev, [m.requestId]: { ...(prev[m.requestId] || {}), ...val } }))}
                onScoreCustom={() => handleScoreCustomTime(m.requestId, m)}
                onBookCustom={() => handleBookCustom(m.requestId, m)}
                onParticipantClick={onParticipantClick}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── CANCELLED section ── */}
      {cancelledMeetings.length > 0 && (
        <section className="md-section">
          <div
            className="section-head section-head-toggle"
            onClick={() => setShowCancelled(p => !p)}
          >
            <span className="section-icon"><Trash2 size={15} /></span>
            <h3>Cancelled</h3>
            <span className="count-chip count-chip-cancelled">{cancelledMeetings.length}</span>
            <span className="expand-arrow" style={{ marginLeft: 'auto' }}>
              {showCancelled ? '▲' : '▼'}
            </span>
          </div>
          {showCancelled && (
            <div className="cards-list">
              {cancelledMeetings.map(m => (
                <div key={m.requestId} className="mc cancelled-card">
                  <div className="mc-head" style={{ cursor: 'default' }}>
                    <div className="mc-left">
                      <div className="mc-title-row">
                        <span className="mc-title cancelled-title">{m.title}</span>
                        <span className="mc-role-badge organizer" style={{ opacity: 0.5 }}>
                          {m.userRole === 'organizer' ? 'Organizer' : 'Invited'}
                        </span>
                      </div>
                      <div className="mc-meta">
                        <span>⏱ {m.durationMinutes}m</span>
                        {m.cancelledAt && (
                          <span className="cancelled-time">
                            Cancelled {fmtDate(m.cancelledAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="status-chip cancelled-chip">Cancelled</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   SlotTimeline — visual day-grid for AI slots
───────────────────────────────────────────── */
function SlotTimeline({ slots, onBook }) {
  const HOUR_PX = 54;
  const scoreColor = sc => sc >= 80 ? '#22c55e' : sc >= 60 ? '#f59e0b' : '#ef4444';

  // Group by local date
  const dayMap = {};
  slots.forEach((slot, idx) => {
    const d   = new Date(slot.startIso);
    const key = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
    if (!dayMap[key]) dayMap[key] = [];
    dayMap[key].push({ slot, idx });
  });
  const days = Object.keys(dayMap).sort().slice(0, 7);

  // Hour range
  let minHour = 23, maxHour = 8;
  slots.forEach(s => {
    const start = new Date(s.startIso);
    const end   = new Date(s.endIso);
    minHour = Math.min(minHour, start.getHours());
    maxHour = Math.max(maxHour, end.getHours() + (end.getMinutes() > 0 ? 1 : 0));
  });
  const totalHours = Math.max(1, maxHour - minHour);
  const gridH      = totalHours * HOUR_PX;

  const fmtHour = h => {
    const d = new Date(); d.setHours(h, 0, 0, 0);
    return d.toLocaleTimeString([], { hour: 'numeric' });
  };

  return (
    <div className="slot-timeline">
      {/* Column headers */}
      <div className="slt-header">
        <div className="slt-gutter" />
        {days.map(day => {
          const d = new Date(day + 'T12:00:00');
          return (
            <div key={day} className="slt-day-header">
              <span className="slt-weekday">{d.toLocaleDateString([], { weekday: 'short' })}</span>
              <span className="slt-date">{d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
            </div>
          );
        })}
      </div>

      {/* Grid body */}
      <div className="slt-body">
        {/* Time gutter */}
        <div className="slt-gutter" style={{ position: 'relative', height: gridH }}>
          {Array.from({ length: totalHours + 1 }, (_, i) => (
            <div key={i} className="slt-hour-label" style={{ top: i * HOUR_PX - 7 }}>
              {fmtHour(minHour + i)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map(day => (
          <div key={day} className="slt-day-col" style={{ height: gridH }}>
            {/* Grid lines */}
            {Array.from({ length: totalHours + 1 }, (_, i) => (
              <div key={i} className="slt-grid-line" style={{ top: i * HOUR_PX }} />
            ))}
            {/* Slot blocks */}
            {(dayMap[day] || []).map(({ slot, idx }) => {
              const start    = new Date(slot.startIso);
              const end      = new Date(slot.endIso);
              const startMin = start.getHours() * 60 + start.getMinutes();
              const endMin   = end.getHours()   * 60 + end.getMinutes();
              const topPx    = (startMin - minHour * 60) / 60 * HOUR_PX;
              const heightPx = Math.max(22, (endMin - startMin) / 60 * HOUR_PX - 2);
              const sc       = Math.round(slot.score);
              const color    = scoreColor(sc);
              const isTop    = idx === 0;
              return (
                <div
                  key={idx}
                  className={`slt-slot${isTop ? ' slt-top' : ''}`}
                  style={{ top: topPx, height: heightPx, borderLeft: `3px solid ${color}`, background: `${color}1a` }}
                  onClick={() => onBook(slot)}
                  title={`${sc}% fairness${slot.explanation ? ' — ' + slot.explanation : ''}`}
                >
                  <span className="slt-slot-time">
                    {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="slt-slot-score" style={{ color }}>{isTop ? '⭐ ' : ''}{sc}%</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   MeetingCard sub-component
───────────────────────────────────────────── */
function MeetingCard({
  meeting, currentUserId, isExpanded, onToggle, onAccept, onDecline, onBook,
  onEdit, onCancel, onReschedule, busyId, style,
  fmtDate, fmtTime, fmtFull,
  customPicker = {}, onCustomPickerChange, onScoreCustom, onBookCustom,
  onParticipantClick,
}) {
  const [slotView, setSlotView] = useState('timeline');
  const isOrganizer    = meeting.userRole === 'organizer';
  const isConfirmed    = meeting.status === 'confirmed';
  const hasSlots       = Array.isArray(meeting.slots) && meeting.slots.length > 0;
  const userAccepted   = (meeting.acceptedBy || []).includes(currentUserId);
  const userDeclined   = (meeting.declinedBy || []).includes(currentUserId);
  const needsAccept    = !isOrganizer && isConfirmed && !userAccepted && !userDeclined;
  const participantCount = (meeting.participantUserIds || []).length;
  const participantNames = meeting.participantNames || {};

  // Avatar stack for header
  const topParticipants = (meeting.participantUserIds || []).slice(0, 3);
  const overflowCount   = Math.max(0, (meeting.participantUserIds || []).length - 3);

  return (
    <div className={`mc ${meeting.userRole} ${isConfirmed ? 'confirmed' : 'pending'} ${needsAccept ? 'needs-action' : ''}`} style={style}>

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
            {participantCount > 0 && (
              <div className="participant-avatars">
                {topParticipants.map(pid => {
                  const nameInfo = participantNames[pid];
                  return (
                    <div key={pid} className="p-avatar-chip" title={nameInfo?.name || pid}>
                      {getInitials(nameInfo?.name || '')}
                    </div>
                  );
                })}
                {overflowCount > 0 && <div className="p-avatar-overflow">+{overflowCount}</div>}
              </div>
            )}
            {isConfirmed && meeting.selectedSlotStart && (
              <span className="mc-confirmed-time">
                <CalendarDays size={12} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />{fmtFull(meeting.selectedSlotStart)}
              </span>
            )}
            {!isConfirmed && hasSlots && isOrganizer && (
              <span className="mc-slots-hint">{meeting.slots.length} slots available</span>
            )}
          </div>
        </div>

        <div className="mc-right">
          {/* Accept / Decline buttons for participant */}
          {needsAccept && (
            <>
              <button
                className="btn-accept"
                onClick={e => { e.stopPropagation(); onAccept(); }}
                disabled={busyId === meeting.requestId}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              >
                {busyId === meeting.requestId ? <><span className="btn-spinner" />Accepting…</> : '✓ Accept'}
              </button>
              {onDecline && (
                <button
                  className="btn-action-sm btn-action-danger"
                  title="Decline meeting"
                  onClick={e => { e.stopPropagation(); onDecline(); }}
                >
                  <Ban size={13} />
                </button>
              )}
            </>
          )}
          {!isOrganizer && isConfirmed && userAccepted && (
            <span className="badge-accepted">✓ Accepted</span>
          )}
          {!isOrganizer && userDeclined && (
            <span className="badge-declined">✗ Declined</span>
          )}

          {/* Organizer action buttons */}
          {isOrganizer && onEdit && (
            <button
              className="btn-action-sm"
              title="Edit meeting"
              onClick={e => { e.stopPropagation(); onEdit(); }}
            >
              <Pencil size={13} />
            </button>
          )}
          {isOrganizer && onReschedule && (
            <button
              className="btn-action-sm"
              title="Reschedule (regenerate slots)"
              onClick={e => { e.stopPropagation(); onReschedule(); }}
            >
              <RefreshCw size={13} />
            </button>
          )}
          {isOrganizer && onCancel && (
            <button
              className="btn-action-sm btn-action-danger"
              title="Cancel meeting"
              onClick={e => { e.stopPropagation(); onCancel(); }}
            >
              <Trash2 size={13} />
            </button>
          )}

          <span className={`status-chip ${isConfirmed ? 'confirmed' : 'pending'}`}>
            {isConfirmed ? 'Confirmed' : 'Pending'}
          </span>

          {/* Expand arrow */}
          {isOrganizer && (
            <span className="expand-arrow">{isExpanded ? '▲' : '▼'}</span>
          )}
        </div>
      </div>

      {/* Slot selection panel — organizer, pending, expanded */}
      {isExpanded && isOrganizer && !isConfirmed && (
        <div className="mc-panel slots-panel">
          {/* AI-generated slots */}
          {hasSlots && (
            <>
              <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>AI-Optimised Time Slots — click to confirm</span>
                <div className="slot-view-toggle">
                  <button
                    className={`slot-view-btn${slotView === 'timeline' ? ' active' : ''}`}
                    onClick={() => setSlotView('timeline')}
                    title="Timeline view"
                  >▦ Timeline</button>
                  <button
                    className={`slot-view-btn${slotView === 'list' ? ' active' : ''}`}
                    onClick={() => setSlotView('list')}
                    title="List view"
                  >☰ List</button>
                </div>
              </div>

              {slotView === 'timeline' ? (
                <SlotTimeline
                  slots={meeting.slots}
                  onBook={slot => onBook(meeting.requestId, slot)}
                />
              ) : (
                /* List view (original) */
                (() => {
                  const dayGroups = meeting.slots.reduce((acc, slot, idx) => {
                    const day = fmtDate(slot.startIso);
                    if (!acc[day]) acc[day] = [];
                    acc[day].push({ slot, idx });
                    return acc;
                  }, {});
                  return Object.entries(dayGroups).map(([day, items]) => (
                    <div key={day}>
                      <div className="slot-day-heading">{day}</div>
                      <div className="slots-grid">
                        {items.map(({ slot, idx }) => {
                          const sc = Math.round(slot.score);
                          const borderColor = sc >= 80 ? '#22c55e' : sc >= 60 ? '#f59e0b' : '#ef4444';
                          const isTop = idx === 0;
                          return (
                            <div
                              key={idx}
                              className={`slot-card ${isTop ? 'top-pick' : ''}`}
                              style={{ borderLeft: `3px solid ${borderColor}` }}
                              onClick={() => onBook(meeting.requestId, slot)}
                              title={slot.explanation}
                            >
                              {isTop && <div className="top-badge">⭐ Best Match</div>}
                              <div className="slot-time">{fmtTime(slot.startIso)} – {fmtTime(slot.endIso)}</div>
                              <div className="slot-score-row">
                                <span className="slot-score-label">Fairness</span>
                                <div className="slot-score-track">
                                  <div className="slot-score-fill" style={{ width: `${Math.min(100, sc)}%`, background: borderColor }} />
                                </div>
                                <span className="slot-score-val" style={{ color: borderColor }}>{sc}%</span>
                              </div>
                              {isTop && slot.explanation && (
                                <div className="slot-explain">{slot.explanation}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()
              )}
            </>
          )}

          {/* Custom time picker */}
          {onCustomPickerChange && (
            <div className="custom-picker">
              <div className="custom-picker-title">🕐 Or pick a custom time</div>
              <div className="custom-picker-row">
                <input
                  type="datetime-local"
                  className="custom-datetime-input"
                  value={customPicker.datetime || ''}
                  onChange={e => onCustomPickerChange({ datetime: e.target.value, scored: null })}
                />
                <button
                  className="btn-score"
                  disabled={!customPicker.datetime || customPicker.scoring}
                  onClick={onScoreCustom}
                >
                  {customPicker.scoring ? '⏳ Scoring…' : '📊 Calculate Fairness'}
                </button>
              </div>

              {customPicker.scored && (
                <div className="custom-scored">
                  <div className="slot-score-row" style={{ marginBottom: '0.5rem' }}>
                    <span className="slot-score-label">Fairness</span>
                    <div className="slot-score-track">
                      <div
                        className="slot-score-fill"
                        style={{ width: `${Math.min(100, Math.round(customPicker.scored.score))}%` }}
                      />
                    </div>
                    <span className="slot-score-val">{Math.round(customPicker.scored.score)}%</span>
                  </div>
                  <div className="slot-explain" style={{ marginBottom: '0.75rem' }}>
                    "{customPicker.scored.explanation}"
                  </div>
                  <button className="btn-book-custom" onClick={onBookCustom}>
                    ✅ Book This Time
                  </button>
                </div>
              )}
            </div>
          )}

          {!hasSlots && !customPicker.scored && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              AI is still generating slots… pick a custom time above to proceed immediately.
            </p>
          )}
        </div>
      )}

      {/* Participant acceptance panel — organizer, confirmed, expanded */}
      {isExpanded && isOrganizer && isConfirmed && (
        <div className="mc-panel accept-panel">
          {meeting.description && (
            <div className="mc-description">
              <strong>📋 Agenda:</strong> {meeting.description}
            </div>
          )}
          <div className="panel-title">👥 Participant Status</div>
          <div className="participant-list">
            <div className="participant-row">
              <span className="p-dot accepted" />
              <span className="p-name">You (Organizer)</span>
              <span className="p-status confirmed">✓ Organized</span>
            </div>
            {(meeting.participantUserIds || []).map(pid => {
              const accepted  = (meeting.acceptedBy || []).includes(pid);
              const declined  = (meeting.declinedBy || []).includes(pid);
              const nameInfo  = participantNames[pid];
              const display   = nameInfo?.name || pid;
              const statusClass = accepted ? 'confirmed' : declined ? 'declined' : 'pending';
              const statusLabel = accepted ? '✓ Accepted' : declined ? '✗ Declined' : '⏳ Pending';
              return (
                <div
                  key={pid}
                  className="participant-row clickable"
                  onClick={(e) => { e.stopPropagation(); onParticipantClick?.(pid); }}
                >
                  <div className="p-avatar-sm" title={nameInfo?.email || pid}>
                    {getInitials(display)}
                  </div>
                  <span className="p-name" title={nameInfo?.email || pid}>{display}</span>
                  <span className={`p-status ${statusClass}`}>{statusLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Info panel — participant, pending (meeting not yet booked) */}
      {isExpanded && !isOrganizer && !isConfirmed && (
        <div className="mc-panel info-panel">
          {meeting.description && (
            <div className="mc-description">
              <strong>📋 Agenda:</strong> {meeting.description}
            </div>
          )}
          <p>The organizer is still selecting a time slot. You'll be notified once a time is confirmed.</p>
        </div>
      )}

      {/* Info panel — participant, confirmed */}
      {isExpanded && !isOrganizer && isConfirmed && (
        <div className="mc-panel info-panel">
          {meeting.description && (
            <div className="mc-description">
              <strong>📋 Agenda:</strong> {meeting.description}
            </div>
          )}
          {meeting.selectedSlotStart && (
            <p><CalendarDays size={13} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />Scheduled for: <strong>{fmtFull(meeting.selectedSlotStart)}</strong></p>
          )}
        </div>
      )}
    </div>
  );
}
