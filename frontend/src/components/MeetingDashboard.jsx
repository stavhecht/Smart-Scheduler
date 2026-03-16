import { useState, useEffect, useRef, useMemo } from 'react';
import { apiPost, apiScoreSlot } from '../apiClient';
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
export default function MeetingDashboard({ meetings, onRefresh, currentUserId, onParticipantClick, lastRefreshed }) {
  const [expandedId, setExpandedId]             = useState(null);
  const [loading, setLoading]                   = useState(false);
  const [showCreate, setShowCreate]             = useState(false);
  const [toasts, setToasts]                     = useState([]);        // { id, msg, type }
  const [editModal, setEditModal]               = useState(null);       // { requestId, title, durationMinutes }
  const [cancelConfirmId, setCancelConfirmId]   = useState(null);       // requestId
  const [rescheduleConfirmId, setRescheduleConfirmId] = useState(null); // requestId
  const [showCancelled, setShowCancelled]       = useState(false);
  const [declineConfirmId, setDeclineConfirmId] = useState(null);   // requestId
  const [searchQuery, setSearchQuery]           = useState('');
  const [filterStatus, setFilterStatus]         = useState('all');
  const [newMeeting, setNewMeeting]             = useState({
    title: '', durationMinutes: 60, participantEmails: '', daysForward: 7, description: '',
  });
  // Custom time picker state per meeting: { [requestId]: { datetime, scoring, scored } }
  const [customPicker, setCustomPicker]         = useState({});
  const [emailError, setEmailError]             = useState('');
  const [lastBookedIcs, setLastBookedIcs]       = useState(null); // { content, title }
  const toastCounter = useRef(0);

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
      if (showCreate) setShowCreate(false);
      else if (editModal) setEditModal(null);
      else if (cancelConfirmId) setCancelConfirmId(null);
      else if (rescheduleConfirmId) setRescheduleConfirmId(null);
      else if (declineConfirmId) setDeclineConfirmId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showCreate, editModal, cancelConfirmId, rescheduleConfirmId, declineConfirmId]);

  /* ── Helpers ── */
  const notify = (msg, type = 'success') => {
    const id = ++toastCounter.current;
    setToasts(prev => [...prev.slice(-2), { id, msg, type }]); // max 3
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

  const toggle = (id) => setExpandedId(prev => prev === id ? null : id);

  const fmt = (iso, opts) => new Date(iso).toLocaleString('en-US', opts);
  const fmtDate = (iso) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = (iso) => fmt(iso, { hour: '2-digit', minute: '2-digit' });
  const fmtFull = (iso) => `${fmtDate(iso)} · ${fmtTime(iso)}`;

  /* ── Handlers ── */
  const handleCreate = async (e) => {
    e.preventDefault();
    const { list: emails, invalid } = validateEmails(newMeeting.participantEmails);
    if (invalid.length > 0) {
      setEmailError(`Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`);
      setShowCreate(true);
      return;
    }
    setEmailError('');
    setLoading(true);
    setShowCreate(false);
    try {
      await apiPost('/api/meetings/create', {
        title: newMeeting.title,
        description: newMeeting.description || '',
        durationMinutes: Number(newMeeting.durationMinutes),
        participantEmails: emails,
        participantIds: [],
        daysForward: newMeeting.daysForward,
      });
      setNewMeeting({ title: '', durationMinutes: 60, participantEmails: '', daysForward: 7, description: '' });
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
      const result = await apiPost(`/api/meetings/${meetingId}/book/${encodeURIComponent(slot.startIso)}`);
      if (result?.calendarSyncWarning) {
        notify(result.calendarSyncWarning, 'error');
      } else {
        notify('Slot booked! Participants have been notified.');
      }
      if (result?.icsContent) {
        setLastBookedIcs({ content: result.icsContent, title: slot.title || 'meeting' });
      }
    } catch (err) {
      notify(err.message || 'Failed to book slot', 'error');
    } finally {
      setLoading(false);
      onRefresh();
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

  const handleDecline = async () => {
    if (!declineConfirmId) return;
    try {
      await apiPost(`/api/meetings/${declineConfirmId}/decline`);
      notify('Meeting declined.');
      setDeclineConfirmId(null);
      onRefresh();
    } catch (err) {
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
      notify('Meeting updated!');
      setEditModal(null);
      onRefresh();
    } catch (err) {
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
      notify('Meeting cancelled.');
      setCancelConfirmId(null);
      setExpandedId(null);
      onRefresh();
    } catch (err) {
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
      notify('Meeting reset to pending — AI is regenerating slots…');
      setRescheduleConfirmId(null);
      setExpandedId(null);
      onRefresh();
    } catch (err) {
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
    } catch (err) {
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
        notify('Custom time booked! Participants have been notified.');
      }
      if (result?.icsContent) {
        setLastBookedIcs({ content: result.icsContent, title: meeting.title || 'meeting' });
      }
      setCustomPicker(prev => { const n = { ...prev }; delete n[meetingId]; return n; });
      onRefresh();
    } catch (err) {
      notify('Failed to book custom time', 'error');
    } finally {
      setLoading(false);
    }
  };

  /* ── Render ── */
  return (
    <div className="md-wrap">

      {/* Toast notifications (stacked) */}
      <div className="md-toast-stack">
        {toasts.map((t, i) => (
          <div key={t.id} className={`md-toast md-toast-${t.type}`} style={{ bottom: `${i * 68}px` }}>
            {t.type === 'success' ? '✅' : '❌'} {t.msg}
            <button className="md-toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>

      {/* .ics download banner */}
      {lastBookedIcs && (
        <div className="ics-download-banner">
          <span>📅 Add to your calendar:</span>
          <a
            href={`data:text/calendar;charset=utf-8,${encodeURIComponent(lastBookedIcs.content)}`}
            download={`${lastBookedIcs.title}.ics`}
          >
            Download .ics invite
          </a>
          <button className="ics-banner-close" onClick={() => setLastBookedIcs(null)}>✕</button>
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
          <button className="btn-refresh" onClick={onRefresh} title="Refresh meetings">⟳</button>
          <button className="btn-new" onClick={() => setShowCreate(true)}>
            + New Meeting
          </button>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="md-search-bar">
        <input
          type="text"
          className="md-search-input"
          placeholder="🔍 Search meetings…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
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

      {/* Spinner overlay */}
      {loading && (
        <div className="md-loading">
          <div className="spinner-sm" />
          <span>Processing…</span>
        </div>
      )}

      {/* ── Create Modal ── */}
      {showCreate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal-box">
            <div className="modal-head">
              <h3>📅 New Meeting Request</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate} className="modal-form">
              <div className="form-group">
                <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Meeting Title</span>
                  <span style={{ fontWeight: 400, color: newMeeting.title.length > 180 ? '#f87171' : 'var(--text-secondary)', fontSize: '0.75rem' }}>
                    {newMeeting.title.length}/200
                  </span>
                </label>
                <input
                  autoFocus required maxLength={200}
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
                {(() => {
                  const count = newMeeting.participantEmails.split(',').map(s => s.trim()).filter(Boolean).length;
                  return (
                    <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Invite Participants *</span>
                      {count > 0 && <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{count} participant{count !== 1 ? 's' : ''}</span>}
                    </label>
                  );
                })()}
                <input
                  type="text"
                  required
                  placeholder="alice@co.com, bob@co.com"
                  value={newMeeting.participantEmails}
                  onChange={e => { setNewMeeting({ ...newMeeting, participantEmails: e.target.value }); setEmailError(''); }}
                />
                {emailError
                  ? <span className="form-hint" style={{ color: '#f87171' }}>{emailError}</span>
                  : <span className="form-hint">Comma-separated emails. They'll see this in their dashboard.</span>
                }
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Agenda / Notes <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>(optional)</span></span>
                  <span style={{ fontWeight: 400, color: (newMeeting.description?.length || 0) > 1800 ? '#f87171' : 'var(--text-secondary)', fontSize: '0.75rem' }}>
                    {newMeeting.description?.length || 0}/2000
                  </span>
                </label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  placeholder="What will you discuss? Any context or links…"
                  value={newMeeting.description}
                  onChange={e => setNewMeeting({ ...newMeeting, description: e.target.value })}
                  style={{ resize: 'vertical', minHeight: '70px' }}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="submit"
                  className="btn-submit"
                  disabled={!newMeeting.title || !newMeeting.participantEmails.trim() || loading}
                >
                  {loading ? '⏳ Creating...' : '🤖 Optimise & Create'}
                </button>
                <button type="button" className="btn-cancel" onClick={() => setShowCreate(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditModal(null)}>
          <div className="modal-box">
            <div className="modal-head">
              <h3>✏️ Edit Meeting</h3>
              <button className="modal-close" onClick={() => setEditModal(null)}>✕</button>
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
              <h3>🗑️ Cancel Meeting</h3>
              <button className="modal-close" onClick={() => setCancelConfirmId(null)}>✕</button>
            </div>
            <div className="confirm-body">
              <p>Are you sure you want to cancel this meeting? All participants will be notified.</p>
              <div className="modal-actions">
                <button className="btn-danger" onClick={handleCancel}>Yes, Cancel Meeting</button>
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
              <h3>🔄 Reschedule Meeting</h3>
              <button className="modal-close" onClick={() => setRescheduleConfirmId(null)}>✕</button>
            </div>
            <div className="confirm-body">
              <p>This will reset the meeting to <strong>pending</strong> and the AI will generate new time slots.</p>
              <div className="modal-actions">
                <button className="btn-submit" onClick={handleReschedule}>🤖 Regenerate Slots</button>
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
              <h3>🚫 Decline Meeting</h3>
              <button className="modal-close" onClick={() => setDeclineConfirmId(null)}>✕</button>
            </div>
            <div className="confirm-body">
              <p>Are you sure you want to decline this meeting? The organizer will be notified.</p>
              <div className="modal-actions">
                <button className="btn-danger" onClick={handleDecline}>Yes, Decline</button>
                <button className="btn-cancel" onClick={() => setDeclineConfirmId(null)}>Keep It</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── INVITATIONS section ── */}
      <section className="md-section">
        <div className="section-head">
          <span className="section-icon">📨</span>
          <h3>Invitations</h3>
          {invitations.length > 0 && <span className="count-chip participant">{invitations.length}</span>}
          {needsAction > 0 && <span className="count-chip warning">{needsAction} need action</span>}
        </div>
        {invitations.length === 0 ? (
          <div className="empty-state empty-state-sm">
            <span className="empty-icon">✅</span>
            <p>You're all caught up! No pending invitations.</p>
          </div>
        ) : (
          <div className="cards-list">
            {invitations.map(m => (
              <MeetingCard
                key={m.requestId}
                meeting={m}
                currentUserId={currentUserId}
                isExpanded={expandedId === m.requestId}
                onToggle={() => toggle(m.requestId)}
                onAccept={() => handleAccept(m.requestId)}
                onDecline={() => setDeclineConfirmId(m.requestId)}
                onBook={handleBook}
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
          <span className="section-icon">📋</span>
          <h3>My Meetings</h3>
          <span className="count-chip organizer">{myActiveMeetings.length}</span>
        </div>

        {myActiveMeetings.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            <p>No meetings yet. Create one to get started!</p>
            <button className="btn-new-sm" onClick={() => setShowCreate(true)}>
              + Schedule a Meeting
            </button>
          </div>
        ) : (
          <div className="cards-list">
            {myActiveMeetings.map(m => (
              <MeetingCard
                key={m.requestId}
                meeting={m}
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
            <span className="section-icon">🗑️</span>
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
   MeetingCard sub-component
───────────────────────────────────────────── */
function MeetingCard({
  meeting, currentUserId, isExpanded, onToggle, onAccept, onDecline, onBook,
  onEdit, onCancel, onReschedule,
  fmtDate, fmtTime, fmtFull,
  customPicker = {}, onCustomPickerChange, onScoreCustom, onBookCustom,
  onParticipantClick,
}) {
  const isOrganizer    = meeting.userRole === 'organizer';
  const isConfirmed    = meeting.status === 'confirmed';
  const hasSlots       = Array.isArray(meeting.slots) && meeting.slots.length > 0;
  const userAccepted   = (meeting.acceptedBy || []).includes(currentUserId);
  const userDeclined   = (meeting.declinedBy || []).includes(currentUserId);
  const needsAccept    = !isOrganizer && isConfirmed && !userAccepted && !userDeclined;
  const participantCount = (meeting.participantUserIds || []).length;
  const participantNames = meeting.participantNames || {};

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
          {/* Accept / Decline buttons for participant */}
          {needsAccept && (
            <>
              <button
                className="btn-accept"
                onClick={e => { e.stopPropagation(); onAccept(); }}
              >
                ✓ Accept
              </button>
              {onDecline && (
                <button
                  className="btn-action-sm btn-action-danger"
                  title="Decline meeting"
                  onClick={e => { e.stopPropagation(); onDecline(); }}
                >
                  🚫
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
              ✏️
            </button>
          )}
          {isOrganizer && onReschedule && (
            <button
              className="btn-action-sm"
              title="Reschedule (regenerate slots)"
              onClick={e => { e.stopPropagation(); onReschedule(); }}
            >
              🔄
            </button>
          )}
          {isOrganizer && onCancel && (
            <button
              className="btn-action-sm btn-action-danger"
              title="Cancel meeting"
              onClick={e => { e.stopPropagation(); onCancel(); }}
            >
              🗑️
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
              const dotClass  = accepted ? 'accepted' : declined ? 'declined' : 'pending';
              const statusClass = accepted ? 'confirmed' : declined ? 'declined' : 'pending';
              const statusLabel = accepted ? '✓ Accepted' : declined ? '✗ Declined' : '⏳ Pending';
              return (
                <div
                  key={pid}
                  className="participant-row clickable"
                  onClick={(e) => { e.stopPropagation(); onParticipantClick?.(pid); }}
                >
                  <span className={`p-dot ${dotClass}`} />
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
            <p>📅 Scheduled for: <strong>{fmtFull(meeting.selectedSlotStart)}</strong></p>
          )}
        </div>
      )}
    </div>
  );
}
