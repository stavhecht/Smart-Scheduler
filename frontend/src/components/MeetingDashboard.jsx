import { useState, useEffect, useMemo } from 'react';
import { apiPost, apiScoreSlot } from '../apiClient';
import { Mail, CalendarPlus, Trash2, RefreshCw, X, Search, CalendarDays, ClipboardList } from 'lucide-react';
import { useToast } from '../context/ToastContext.jsx';
import DeclineWizard from './DeclineWizard.jsx';
import MeetingCard from './MeetingCard.jsx';
import EditMeetingModal from './EditMeetingModal.jsx';
import './MeetingDashboard.css';
import './CalendarView.css';

/* ─────────────────────────────────────────────
   MeetingDashboard
   Props:
     meetings      – array from /api/meetings (each has userRole field)
     onRefresh     – fn to reload meetings
     currentUserId – authenticated user's ID (profile.id)
───────────────────────────────────────────── */
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

  const handleDecline = async (reason, comment) => {
    if (!declineConfirmId) return;
    const result = await apiPost(`/api/meetings/${declineConfirmId}/decline`, { reason, comment });
    notify(
      result?.reshuffled
        ? 'Meeting declined — all participants declined, slots are being regenerated.'
        : 'Meeting declined.',
      'info',
    );
    onRefresh();
    return result;
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
      <EditMeetingModal
        editModal={editModal}
        setEditModal={setEditModal}
        onSubmit={handleEdit}
      />

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

      {/* ── Decline Wizard (multi-step: confirm → reason → done) ── */}
      {declineConfirmId && (
        <DeclineWizard
          meeting={meetings.find(m => m.requestId === declineConfirmId)}
          onSubmit={handleDecline}
          onClose={() => setDeclineConfirmId(null)}
        />
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
