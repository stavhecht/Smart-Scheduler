import { useState, useEffect, useMemo } from 'react';
import { apiPost, apiGet, apiScoreSlot } from '../apiClient';
import { Mail, CalendarPlus, Pencil, Trash2, RefreshCw, Ban, X, Search, CalendarDays, ClipboardList } from 'lucide-react';
import { useToast } from '../context/ToastContext.jsx';
import './MeetingDashboard.css';
import './CalendarView.css';

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

export default function MeetingDashboard({ meetings, onRefresh, onMeetingUpdate, currentUserId, onParticipantClick, lastRefreshed, onNewMeetingClick, isCalendarConnected, onConnectCalendar }) {
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
  const myActiveMeetings  = activeMeetings
    .filter(m => m.userRole === 'organizer')
    .sort((a, b) => {
      const now = Date.now();
      const aTime = a.selectedSlotStart ? new Date(a.selectedSlotStart).getTime() : 0;
      const bTime = b.selectedSlotStart ? new Date(b.selectedSlotStart).getTime() : 0;
      const aUpcoming = a.status === 'confirmed' && aTime > now;
      const bUpcoming = b.status === 'confirmed' && bTime > now;
      if (aUpcoming && !bUpcoming) return -1;
      if (!aUpcoming && bUpcoming) return 1;
      if (aUpcoming && bUpcoming) return aTime - bTime;
      const aPending = a.status === 'pending' && (a.slots?.length > 0);
      const bPending = b.status === 'pending' && (b.slots?.length > 0);
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;
      return 0;
    });

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
  const fmtRelative = (iso) => {
    const diffMs = new Date(iso) - Date.now();
    if (diffMs < 0) return null;
    const diffH = diffMs / 3600000;
    if (diffH < 1) return 'in < 1h';
    if (diffH < 24) return `in ${Math.round(diffH)}h`;
    const diffD = Math.floor(diffMs / 86400000);
    if (diffD === 1) return 'tomorrow';
    if (diffD <= 7) return `in ${diffD} days`;
    return null;
  };

  /* ── Handlers ── */
  const handleBook = async (meetingId, slot) => {
    setBusyId(meetingId);
    setExpandedId(null);
    try {
      const result = await apiPost(`/api/meetings/${meetingId}/book/${encodeURIComponent(slot.startIso)}`);
      // Optimistic update — immediately reflect confirmed status so the slot panel cannot reopen
      onMeetingUpdate?.(meetingId, { status: 'confirmed', selectedSlotStart: slot.startIso });
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
      const editDaysForward = editModal.schedPreset === 'custom'
        ? Math.max(1, Math.min(90, editModal.customDays || 7))
        : parseInt(editModal.schedPreset || '7');
      const editPreferredHours = editModal.timeWindow === 'morning' ? [8, 9, 10, 11]
        : editModal.timeWindow === 'afternoon' ? [12, 13, 14, 15, 16]
        : editModal.timeWindow === 'evening' ? [17, 18, 19, 20]
        : [];
      const result = await apiPost(`/api/meetings/${editModal.requestId}/edit`, {
        title: editModal.title,
        description: editModal.description ?? '',
        durationMinutes: Number(editModal.durationMinutes),
        daysForward: editDaysForward,
        preferredHours: editPreferredHours,
        excludedWeekdays: editModal.excludedWeekdays || [],
      });
      notify(result?.slotsRegenerated ? 'Meeting updated — new slots generated!' : result?.reopened ? 'Meeting re-opened — participants must accept again.' : 'Preferences saved — click Regenerate to get new slots.', 'success');
      setEditModal(null);
      onRefresh();
    } catch (err) {
      notify(err.message || 'Failed to update meeting', 'error');
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
    } catch (err) {
      notify(err.message || 'Failed to cancel meeting', 'error');
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
    } catch (err) {
      notify(err.message || 'Failed to reschedule', 'error');
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
          <button
            className="btn-new"
            onClick={onNewMeetingClick}
            disabled={!isCalendarConnected}
            title={!isCalendarConnected ? 'Connect Google Calendar to create meetings' : undefined}
            style={!isCalendarConnected ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
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

      {/* Calendar connection required banner */}
      {!isCalendarConnected && (
        <div className="md-alert" style={{ borderColor: 'rgba(96,165,250,0.3)', background: 'rgba(96,165,250,0.06)', cursor: 'pointer' }} onClick={onConnectCalendar}>
          <span>📅</span>
          <span>
            <strong>Connect Google Calendar</strong> to create or approve meetings.{' '}
            <span style={{ color: 'var(--accent)' }}>Go to Calendar settings →</span>
          </span>
        </div>
      )}

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
                <label>Scheduling Range</label>
                <div className="dur-pills">
                  {[{ label: '3 days', value: '3' }, { label: '1 week', value: '7' }, { label: '2 weeks', value: '14' }, { label: '1 month', value: '30' }, { label: 'Custom', value: 'custom' }].map(opt => (
                    <button
                      key={opt.value} type="button"
                      className={`dur-pill ${editModal.schedPreset === opt.value ? 'active' : ''}`}
                      onClick={() => setEditModal({ ...editModal, schedPreset: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {editModal.schedPreset === 'custom' && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={editModal.customDays || 14}
                      onChange={e => setEditModal({ ...editModal, customDays: parseInt(e.target.value) || 14 })}
                      style={{ width: '80px' }}
                    />
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>days from today</span>
                  </div>
                )}
                {editModal.isPending
                  ? <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>Saving will regenerate slot suggestions.</p>
                  : <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>Preferences saved. Click <strong>Regenerate</strong> after saving to get new slots.</p>
                }
              </div>
              <div className="form-group">
                <label>Time of Day</label>
                <div className="dur-pills">
                  {[{ label: 'Any time', value: 'all' }, { label: 'Morning 8–12', value: 'morning' }, { label: 'Afternoon 12–17', value: 'afternoon' }, { label: 'Evening 17–20', value: 'evening' }].map(opt => (
                    <button
                      key={opt.value} type="button"
                      className={`dur-pill ${editModal.timeWindow === opt.value ? 'active' : ''}`}
                      onClick={() => setEditModal({ ...editModal, timeWindow: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Skip Weekdays <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <div className="dur-pills" style={{ flexWrap: 'wrap' }}>
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
                    <button
                      key={i} type="button"
                      className={`dur-pill ${(editModal.excludedWeekdays || []).includes(i) ? 'active' : ''}`}
                      style={(editModal.excludedWeekdays || []).includes(i) ? { background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.5)', color: '#ef4444' } : {}}
                      onClick={() => {
                        const curr = editModal.excludedWeekdays || [];
                        const next = curr.includes(i) ? curr.filter(d => d !== i) : [...curr, i];
                        setEditModal({ ...editModal, excludedWeekdays: next });
                      }}
                    >
                      {day}
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
                isCalendarConnected={isCalendarConnected}
                allMeetings={meetings}
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
            <button
              className="btn-new-sm btn-new-sm-pulse"
              onClick={onNewMeetingClick}
              disabled={!isCalendarConnected}
              style={!isCalendarConnected ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
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
                onEdit={() => {
                  // daysForward may be missing for older meetings — derive from stored date range
                  const daysForward = m.daysForward
                    ?? Math.max(1, Math.round((new Date(m.dateRangeEnd) - new Date(m.dateRangeStart)) / 864e5));
                  const presets = ['3', '7', '14', '30'];
                  const schedPreset = presets.includes(String(daysForward)) ? String(daysForward) : 'custom';
                  let timeWindow = 'all';
                  if (m.preferredHours?.length) {
                    const first = m.preferredHours[0];
                    timeWindow = first <= 11 ? 'morning' : first <= 16 ? 'afternoon' : 'evening';
                  }
                  setEditModal({
                    requestId: m.requestId,
                    title: m.title,
                    durationMinutes: m.durationMinutes,
                    description: m.description || '',
                    isPending: m.status === 'pending',
                    schedPreset,
                    customDays: daysForward,
                    timeWindow,
                    excludedWeekdays: m.excludedWeekdays || [],
                  });
                }}
                onCancel={() => setCancelConfirmId(m.requestId)}
                onReschedule={() => setRescheduleConfirmId(m.requestId)}
                fmtDate={fmtDate}
                fmtTime={fmtTime}
                fmtFull={fmtFull}
                customPicker={customPicker[m.requestId] || {}}
                onCustomPickerChange={val => setCustomPicker(prev => ({ ...prev, [m.requestId]: { ...(prev[m.requestId] || {}), ...val } }))}
                onScoreCustom={() => handleScoreCustomTime(m.requestId, m)}
                onBookCustom={() => handleBookCustom(m.requestId, m)}
                onParticipantClick={onParticipantClick}
                allMeetings={meetings}
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

/* SlotCalendar — full-week calendar reusing cv-* classes from CalendarView.css */
function SlotCalendar({ slots, preferredHours, calEvents = null, ssMeetings = [], onBook }) {
  const scoreColor = sc => sc >= 80 ? '#22c55e' : sc >= 60 ? '#f59e0b' : '#ef4444';

  const slotHours = useMemo(() => slots.flatMap(s => {
    const h = new Date(s.startIso).getHours();
    const eh = new Date(s.endIso).getHours() + (new Date(s.endIso).getMinutes() > 0 ? 1 : 0);
    return [h, eh];
  }), [slots]);
  const CAL_START = slots.length ? Math.max(0, Math.min(7, ...slotHours) - 1) : 7;
  const CAL_END   = slots.length ? Math.min(24, Math.max(22, ...slotHours) + 1) : 22;
  const CAL_HOURS = Array.from({ length: CAL_END - CAL_START }, (_, i) => CAL_START + i);

  const initialOffset = useMemo(() => {
    if (!slots.length) return 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const toMon = today.getDay() === 0 ? -6 : 1 - today.getDay();
    const monday = new Date(today); monday.setDate(today.getDate() + toMon);
    const first = new Date(slots[0].startIso); first.setHours(0, 0, 0, 0);
    return Math.floor((first - monday) / (7 * 864e5));
  }, [slots]);

  const [weekOffset, setWeekOffset] = useState(initialOffset);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() + (today.getDay() === 0 ? -6 : 1 - today.getDay()) + weekOffset * 7);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    return { date: d, name: d.toLocaleDateString('en-US', { weekday: 'short' }), label: d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }), isToday: d.toDateString() === new Date().toDateString() };
  });

  const weekLabel = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).formatRange(weekDays[0].date, weekDays[6].date);
  const topSlotIso = slots.length ? slots[0].startIso : null;

  const _evPos = (ev) => {
    const start = new Date(ev.start), end = new Date(ev.end || ev.start);
    const h = start.getHours() + start.getMinutes() / 60;
    const endH = end.getHours() + end.getMinutes() / 60;
    const cs = Math.max(h, CAL_START), ce = Math.min(endH || h + 1, CAL_END);
    const range = CAL_END - CAL_START;
    return { topPct: (cs - CAL_START) / range * 100, heightPct: Math.max((ce - cs) / range * 100, 1.5), startStr: start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), visible: ce > cs };
  };

  const getCalEventsForDay = (dayDate) => (calEvents || [])
    .filter(ev => ev.start && new Date(ev.start).toDateString() === dayDate.toDateString())
    .map(ev => ({ title: ev.summary || 'Busy', ..._evPos(ev) }))
    .filter(e => e.visible);

  const getSSEventsForDay = (dayDate) => (ssMeetings || [])
    .filter(ev => ev.start && new Date(ev.start).toDateString() === dayDate.toDateString())
    .map(ev => ({ title: ev.summary || 'Meeting', ..._evPos(ev) }))
    .filter(e => e.visible);

  const getSlotsForDay = (dayDate) => slots
    .filter(s => new Date(s.startIso).toDateString() === dayDate.toDateString())
    .map(s => {
      const start = new Date(s.startIso), end = new Date(s.endIso);
      const h = start.getHours() + start.getMinutes() / 60;
      const endH = end.getHours() + end.getMinutes() / 60;
      const cs = Math.max(h, CAL_START), ce = Math.min(endH, CAL_END);
      const range = CAL_END - CAL_START;
      return { s, topPct: (cs - CAL_START) / range * 100, heightPct: Math.max((ce - cs) / range * 100, 2), startStr: start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), sc: Math.round(s.score), isTop: s.startIso === topSlotIso, visible: ce > cs };
    })
    .filter(e => e.visible);

  const hasSlots = weekDays.some(day => getSlotsForDay(day.date).length > 0);

  return (
    <div className="cv-wrap" style={{ marginTop: '0.5rem' }}>
      <div className="cv-header">
        <div className="cv-nav">
          <button className="cv-btn" onClick={() => setWeekOffset(w => w - 1)}>‹ Prev</button>
          <button className="cv-today-btn" onClick={() => setWeekOffset(initialOffset)}>Slots week</button>
          <button className="cv-btn" onClick={() => setWeekOffset(w => w + 1)}>Next ›</button>
        </div>
        <span className="cv-week-label">{weekLabel}</span>
      </div>
      {(ssMeetings.length > 0 || (calEvents && calEvents.length > 0)) && (
        <div style={{ display: 'flex', gap: '1rem', padding: '0.3rem 0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          {ssMeetings.length > 0 && <span><span style={{ color: '#6366f1' }}>■</span> Existing meetings</span>}
          {calEvents && calEvents.length > 0 && <span><span style={{ color: '#6b7280' }}>■</span> Calendar events</span>}
          <span><span style={{ color: '#22c55e' }}>■</span> Proposed slots</span>
        </div>
      )}
      <div className="cv-scroll">
        <div className="cv-grid">
          <div className="cv-time-col">
            <div className="cv-corner" />
            {CAL_HOURS.map(h => <div key={h} className="cv-hour-label">{h}:00</div>)}
          </div>
          {weekDays.map(day => (
            <div key={day.name} className={`cv-day-col${day.isToday ? ' today-col' : ''}`}>
              <div className={`cv-day-header${day.isToday ? ' today' : ''}`}>
                <span className="cv-day-name">{day.name}</span>
                <span className={`cv-day-num${day.isToday ? ' today-num' : ''}`}>{day.label}</span>
              </div>
              <div className="cv-day-body">
                {CAL_HOURS.map(h => <div key={h} className="cv-hour-cell" />)}
                {getCalEventsForDay(day.date).map((ev, j) => (
                  <div key={`ce-${j}`} className="cv-event"
                    style={{ top: `calc(${ev.topPct}% + 1px)`, height: `calc(${ev.heightPct}% - 2px)`, left: '2px', right: '2px', background: '#6b728030', borderLeft: '3px solid #6b7280', color: '#9ca3af', cursor: 'default', zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}
                    title={`${ev.title} @ ${ev.startStr}`}
                  >
                    <span className="cv-ev-title" style={{ fontSize: '0.65rem', opacity: 0.8 }}>{ev.title}</span>
                  </div>
                ))}
                {getSSEventsForDay(day.date).map((ev, j) => (
                  <div key={`ss-${j}`} className="cv-event"
                    style={{ top: `calc(${ev.topPct}% + 1px)`, height: `calc(${ev.heightPct}% - 2px)`, left: '2px', right: '2px', background: '#6366f130', borderLeft: '3px solid #6366f1', color: '#818cf8', cursor: 'default', zIndex: 1, pointerEvents: 'none', overflow: 'hidden' }}
                    title={`📌 ${ev.title} · ${ev.startStr}`}
                  >
                    <span className="cv-ev-title" style={{ fontSize: '0.65rem', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📌 {ev.startStr}</span>
                  </div>
                ))}
                {getSlotsForDay(day.date).map((e, i) => {
                  const color = scoreColor(e.sc);
                  return (
                    <div key={i} className="cv-event"
                      style={{ top: `calc(${e.topPct}% + 1px)`, height: `calc(${e.heightPct}% - 2px)`, left: '2px', right: '2px', background: `${color}1a`, borderLeft: `3px solid ${color}`, color, cursor: 'pointer' }}
                      onClick={() => onBook(e.s)}
                      title={`${e.sc}% fairness${e.s.isPreferred && preferredHours?.length > 0 ? ' ⏰ preferred' : ''}${e.s.aiScored ? ' (AI-scored)' : ''}${e.s.explanation ? ' — ' + e.s.explanation : ''}${e.s.aiSuggestions ? '\n💡 ' + e.s.aiSuggestions : ''}`}
                    >
                      <span className="cv-ev-title">{e.isTop ? '⭐ ' : ''}{e.s.aiScored ? '🧠 ' : ''}{e.startStr}</span>
                      <span className="cv-ev-time">{e.sc}% fair</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {!hasSlots && <div className="cv-empty"><span>📭</span><span>No slots this week — use the arrows to navigate.</span></div>}
    </div>
  );
}

/* ─────────────────────────────────────────────
   SlotList sub-component — compact list view
───────────────────────────────────────────── */
function SlotList({ slots, calEvents = null, ssMeetings = [], onBook }) {
  const scoreColor = sc => sc >= 80 ? '#22c55e' : sc >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div className="slot-list">
      {slots.map((s, i) => {
        const sc = Math.round(s.score);
        const color = scoreColor(sc);
        const dt = new Date(s.startIso);
        const slotStart = new Date(s.startIso), slotEnd = new Date(s.endIso);
        const isNearby = (ev) => {
          if (!ev.start) return false;
          const evEnd = new Date(ev.end || ev.start);
          const evStart = new Date(ev.start);
          return evEnd > new Date(slotStart.getTime() - 2 * 3600000) &&
                 evStart < new Date(slotEnd.getTime() + 2 * 3600000);
        };
        const nearbyGcal  = (calEvents || []).filter(isNearby);
        const nearbySS    = (ssMeetings || []).filter(isNearby);
        const nearbyAll   = [...nearbySS, ...nearbyGcal];
        const stillLoading = calEvents === null && nearbySS.length === 0;
        return (
          <div key={i} className="slot-list-item" onClick={() => onBook(s)} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.3rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="sli-left">
                <span className="sli-date">
                  {i === 0 ? '⭐ ' : ''}
                  {dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <span className="sli-time">
                  {dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  {s.aiScored && <span className="sli-ai">🧠 AI</span>}
                </span>
              </div>
              <div className="sli-right">
                <div className="slot-score-track" style={{ width: '80px' }}>
                  <div className="slot-score-fill" style={{ width: `${sc}%`, background: color }} />
                </div>
                <span className="sli-score" style={{ color }}>{sc}%</span>
              </div>
            </div>
            <div style={{ fontSize: '0.7rem', paddingLeft: '0.25rem' }}>
              {stillLoading
                ? <span style={{ color: '#6b7280' }}>⏳ Loading calendar…</span>
                : nearbyAll.length === 0
                  ? <span style={{ color: '#22c55e' }}>✓ Clear</span>
                  : <span style={{ color: '#9ca3af' }}>📅 {nearbyAll.map(ev => ev.summary || 'Busy').join(', ')}</span>
              }
            </div>
          </div>
        );
      })}
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
  onParticipantClick, isCalendarConnected,
  allMeetings = [],
}) {
  const [slotView, setSlotView] = useState('calendar');
  const [calEvents, setCalEvents] = useState(null);
  const [conflictWarning, setConflictWarning] = useState(null); // { slot, existingMeeting }
  const isOrganizer    = meeting.userRole === 'organizer';
  const isConfirmed    = meeting.status === 'confirmed';
  const hasSlots       = Array.isArray(meeting.slots) && meeting.slots.length > 0;
  const userAccepted   = (meeting.acceptedBy || []).includes(currentUserId);
  const userDeclined   = (meeting.declinedBy || []).includes(currentUserId);
  const needsAccept    = !isOrganizer && isConfirmed && !userAccepted && !userDeclined;
  const participantCount = (meeting.participantUserIds || []).length;
  const participantNames = meeting.participantNames || {};

  // Fetch calendar events once when the slot panel first expands.
  // Use actual slot dates (not stale dateRangeStart/End from meeting creation).
  useEffect(() => {
    if (!isExpanded || !isOrganizer || isConfirmed || calEvents !== null) return;
    const slots = meeting.slots;
    if (!slots || slots.length === 0) { setCalEvents([]); return; }
    const starts = slots.map(s => new Date(s.startIso).getTime()).filter(t => !isNaN(t));
    const ends   = slots.map(s => new Date(s.endIso || s.startIso).getTime()).filter(t => !isNaN(t));
    if (!starts.length) { setCalEvents([]); return; }
    const timeMin = new Date(Math.min(...starts)).toISOString();
    const timeMax = new Date(Math.max(...ends) + 3600000).toISOString(); // +1hr buffer
    apiGet(`/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`)
      .then(data => setCalEvents(Array.isArray(data) ? data : []))
      .catch(() => setCalEvents([]));
  }, [isExpanded, isOrganizer, isConfirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Confirmed Smart Scheduler meetings (other than this one) to overlay on the slot calendar
  const ssMeetings = useMemo(() => {
    return (allMeetings || [])
      .filter(m =>
        m.status === 'confirmed' &&
        m.requestId !== meeting.requestId &&
        m.selectedSlotStart
      )
      .map(m => ({
        summary: m.title,
        start: m.selectedSlotStart,
        end: new Date(
          new Date(m.selectedSlotStart).getTime() + (m.durationMinutes || 60) * 60000
        ).toISOString(),
      }));
  }, [allMeetings, meeting.requestId]);

  // Filter out proposed slots that conflict with already-confirmed SS meetings.
  // Slots were generated at meeting-creation time; by now some times may be taken.
  const visibleSlots = useMemo(() => {
    if (!meeting.slots?.length) return [];
    if (!ssMeetings.length) return meeting.slots;
    const dur = (meeting.durationMinutes || 60) * 60000;
    return meeting.slots.filter(slot => {
      const sStart = new Date(slot.startIso).getTime();
      const sEnd = new Date(slot.endIso).getTime() || (sStart + dur);
      return !ssMeetings.some(m => {
        const mStart = new Date(m.start).getTime();
        const mEnd = new Date(m.end).getTime();
        return sStart < mEnd && sEnd > mStart;
      });
    });
  }, [meeting.slots, ssMeetings, meeting.durationMinutes]);

  const handleSlotSelect = (slot) => {
    const slotStart = new Date(slot.startIso).getTime();
    const slotEnd   = new Date(slot.endIso || slot.startIso).getTime() || (slotStart + (meeting.durationMinutes || 60) * 60000);
    const conflict  = ssMeetings.find(m => {
      const mStart = new Date(m.start).getTime();
      const mEnd   = new Date(m.end).getTime();
      return slotStart < mEnd && slotEnd > mStart;
    });
    if (conflict) {
      setConflictWarning({ slot, existingMeeting: conflict });
    } else {
      onBook(meeting.requestId, slot);
    }
  };

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
            {!isOrganizer && (
              <span className="mc-organizer">
                👤 {participantNames[meeting.creatorUserId]?.name || 'Unknown'}
              </span>
            )}
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
            {isConfirmed && meeting.selectedSlotStart && (() => {
              const rel = fmtRelative(meeting.selectedSlotStart);
              return (
                <span className="mc-confirmed-time">
                  <CalendarDays size={12} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                  {fmtFull(meeting.selectedSlotStart)}
                  {rel && <span style={{ marginLeft: '0.4rem', color: '#22c55e', fontWeight: 600 }}>{rel}</span>}
                </span>
              );
            })()}
            {isOrganizer && isConfirmed && (meeting.participantUserIds || []).length > 0 && (
              <span className="mc-slots-hint">
                {(meeting.acceptedBy || []).length}/{(meeting.participantUserIds || []).length} participants accepted
              </span>
            )}
            {!isConfirmed && hasSlots && isOrganizer && (
              <span className="mc-slots-hint">{visibleSlots.length} slots available — pick one</span>
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
                disabled={busyId === meeting.requestId || !isCalendarConnected}
                title={!isCalendarConnected ? 'Connect Google Calendar to approve meetings' : undefined}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', ...(!isCalendarConnected ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
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

      {/* Slot selection panel — organizer, pending, expanded, not in-flight */}
      {isExpanded && isOrganizer && !isConfirmed && busyId !== meeting.requestId && (
        <div className="mc-panel slots-panel">
          {/* AI strategic summary — one-line verdict */}
          {meeting.aiSummary && (
            <div style={{
              border: '1px solid #8b5cf644',
              background: 'linear-gradient(135deg, #8b5cf60d, #8b5cf604)',
              borderRadius: '10px',
              padding: '0.65rem 0.9rem',
              marginBottom: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#8b5cf6', background: '#8b5cf61a', border: '1px solid #8b5cf644', borderRadius: '10px', padding: '0.15rem 0.5rem', flexShrink: 0 }}>
                🧠 AI Verdict
              </span>
              {typeof meeting.aiMeetingScore === 'number' && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                  <strong style={{ color: '#8b5cf6' }}>{Math.round(meeting.aiMeetingScore)}%</strong>
                </span>
              )}
              <span style={{ fontSize: '0.82rem', flex: 1, minWidth: 0 }}>{meeting.aiSummary}</span>
            </div>
          )}

          {/* Empty-state when slot generation produced no slots */}
          {!hasSlots && (
            <div style={{
              border: '1px solid rgba(245,158,11,0.3)',
              background: 'rgba(245,158,11,0.06)',
              borderRadius: '10px',
              padding: '0.9rem 1rem',
              marginBottom: '0.9rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>⚠️</span>
                <strong style={{ fontSize: '0.88rem' }}>No AI slots available yet</strong>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Slot generation hasn't completed for this meeting. Click <strong>Regenerate</strong> to
                run the scheduler again, or pick a custom time below.
              </div>
              {onReschedule && (
                <button
                  className="btn-score"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={onReschedule}
                >
                  <RefreshCw size={12} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                  Regenerate slots
                </button>
              )}
            </div>
          )}

          {/* AI-generated slots */}
          {hasSlots && (
            <>
              <div className="slots-view-header">
                <span className="panel-title" style={{ margin: 0 }}>AI-Optimised Time Slots — click to confirm</span>
                <div className="slot-view-toggle">
                  <button className={slotView === 'calendar' ? 'svt-btn active' : 'svt-btn'} onClick={() => setSlotView('calendar')}>📅 Calendar</button>
                  <button className={slotView === 'list' ? 'svt-btn active' : 'svt-btn'} onClick={() => setSlotView('list')}>☰ List</button>
                </div>
              </div>
              {hasSlots && visibleSlots.length === 0 && (
                <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', padding: '0.6rem 0.8rem', marginBottom: '0.5rem', fontSize: '0.82rem', color: '#fca5a5' }}>
                  ⚠️ All proposed slots conflict with your existing meetings. Use the custom time picker below to choose a different time.
                </div>
              )}
              {conflictWarning && (
                <div style={{ background: '#7f1d1d22', border: '1px solid #ef4444', borderRadius: '6px', padding: '0.6rem 0.8rem', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
                  <span style={{ color: '#fca5a5' }}>
                    ⚠️ This slot overlaps with <strong>{conflictWarning.existingMeeting.summary}</strong>. Book anyway?
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                    <button onClick={() => { onBook(meeting.requestId, conflictWarning.slot); setConflictWarning(null); }}
                      style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.25rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem' }}>
                      Book anyway
                    </button>
                    <button onClick={() => setConflictWarning(null)}
                      style={{ background: 'transparent', color: '#9ca3af', border: '1px solid #374151', borderRadius: '4px', padding: '0.25rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {slotView === 'calendar' ? (
                <SlotCalendar
                  slots={visibleSlots}
                  preferredHours={meeting.preferredHours}
                  calEvents={calEvents}
                  ssMeetings={ssMeetings}
                  onBook={handleSlotSelect}
                />
              ) : (
                <SlotList
                  slots={visibleSlots}
                  calEvents={calEvents}
                  ssMeetings={ssMeetings}
                  onBook={handleSlotSelect}
                />
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div className="slot-score-row" style={{ flex: 1 }}>
                      <span className="slot-score-label">Fairness</span>
                      <div className="slot-score-track">
                        <div
                          className="slot-score-fill"
                          style={{ width: `${Math.min(100, Math.round(customPicker.scored.score))}%` }}
                        />
                      </div>
                      <span className="slot-score-val">{Math.round(customPicker.scored.score)}%</span>
                    </div>
                    {customPicker.scored.aiScored && (
                      <span title="Scored by AI" style={{ marginLeft: '0.5rem', fontSize: '0.62rem', fontWeight: 700, color: '#8b5cf6', background: '#8b5cf61a', border: '1px solid #8b5cf644', borderRadius: '10px', padding: '0.1rem 0.4rem' }}>
                        🧠 AI
                      </span>
                    )}
                  </div>
                  <div className="slot-explain" style={{ marginBottom: customPicker.scored.aiSuggestions ? '0.4rem' : '0.75rem' }}>
                    "{customPicker.scored.explanation}"
                  </div>
                  {customPicker.scored.aiSuggestions && (
                    <div className="slot-explain" style={{ marginBottom: '0.75rem', color: '#8b5cf6', fontStyle: 'normal' }}>
                      💡 {customPicker.scored.aiSuggestions}
                    </div>
                  )}
                  <button className="btn-book-custom" onClick={onBookCustom}>
                    ✅ Book This Time
                  </button>
                </div>
              )}
            </div>
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
