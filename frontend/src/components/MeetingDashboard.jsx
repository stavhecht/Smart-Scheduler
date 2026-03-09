import { useState } from 'react';
import './MeetingDashboard.css';
import { apiPost } from '../apiClient';

export default function MeetingDashboard({ meetings, onRefresh }) {
    const [loading, setLoading] = useState(false);
    const [expandedMeetingId, setExpandedMeetingId] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newMeetingData, setNewMeetingData] = useState({
        title: '', durationMinutes: 60, participantIds: ['u2']
    });

    const handleCreateMeeting = (e) => {
        e.preventDefault();
        setLoading(true);
        setShowCreateModal(false);
        apiPost('/api/meetings/create', newMeetingData)
            .then(() => {
                onRefresh();
                setNewMeetingData({ title: '', durationMinutes: 60, participantIds: ['u2'] });
                setLoading(false);
            })
            .catch(err => {
                alert('Error creating meeting request');
                console.error(err);
                setLoading(false);
            });
    };

    const handleBookSlot = (meetingId, slot) => {
        setLoading(true);
        setExpandedMeetingId(null);
        apiPost(`/api/meetings/${meetingId}/book/${encodeURIComponent(slot.startIso)}`)
            .then(() => { onRefresh(); setLoading(false); })
            .catch(err => {
                alert('Failed to book the selected slot');
                console.error(err);
                onRefresh();
                setLoading(false);
            });
    };

    const toggleMeeting = (id) =>
        setExpandedMeetingId(prev => prev === id ? null : id);

    const fmtDate = iso => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const fmtTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    if (loading) {
        return (
            <div className="loading-screen">
                <div className="spinner" />
                <span>Updating schedule…</span>
            </div>
        );
    }

    const pending   = meetings.filter(m => m.status === 'pending');
    const confirmed = meetings.filter(m => m.status === 'confirmed');

    return (
        <div className="meetings-page">
            {/* Page Header */}
            <div className="meetings-page-head">
                <div>
                    <h2>Meeting Requests</h2>
                    <p className="view-subtitle">Manage and schedule meetings with AI-powered fairness scoring.</p>
                </div>
                <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
                    + New Meeting
                </button>
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowCreateModal(false)}>
                    <div className="modal">
                        <div className="modal-header">
                            <h3>Create New Meeting Request</h3>
                            <button className="modal-close" onClick={() => setShowCreateModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleCreateMeeting} className="modal-form">
                            <div className="form-group">
                                <label>Meeting Title</label>
                                <input
                                    autoFocus
                                    type="text"
                                    required
                                    placeholder="e.g. Weekly Team Sync"
                                    value={newMeetingData.title}
                                    onChange={e => setNewMeetingData({ ...newMeetingData, title: e.target.value })}
                                />
                            </div>
                            <div className="form-group">
                                <label>Duration</label>
                                <select
                                    value={newMeetingData.durationMinutes}
                                    onChange={e => setNewMeetingData({ ...newMeetingData, durationMinutes: Number(e.target.value) })}
                                >
                                    <option value={15}>15 min — Quick check-in</option>
                                    <option value={30}>30 min — Standard</option>
                                    <option value={45}>45 min</option>
                                    <option value={60}>60 min — 1 Hour</option>
                                    <option value={90}>90 min — Extended</option>
                                </select>
                            </div>
                            <div className="modal-info">
                                <span>🧠</span>
                                <span>The fairness engine will generate 3 optimized time slots based on all participants' availability and fairness scores.</span>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn-ghost" onClick={() => setShowCreateModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn-success">
                                    ⚖️ Calculate Fairness &amp; Create
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Empty state */}
            {meetings.length === 0 && (
                <div className="meetings-empty">
                    <div className="empty-big-icon">📭</div>
                    <h3>No meetings yet</h3>
                    <p>Create your first meeting request and let the AI find the fairest time for everyone.</p>
                    <button className="btn-primary" onClick={() => setShowCreateModal(true)}>+ New Meeting</button>
                </div>
            )}

            {/* Pending */}
            {pending.length > 0 && (
                <section className="meetings-section">
                    <div className="section-label">
                        <span className="section-dot pending" />
                        Pending — Select a Time Slot
                        <span className="pill warning">{pending.length}</span>
                    </div>
                    <div className="meeting-cards">
                        {pending.map(m => (
                            <MeetingCard
                                key={m.requestId}
                                meeting={m}
                                isExpanded={expandedMeetingId === m.requestId}
                                onToggle={() => toggleMeeting(m.requestId)}
                                onBook={(slot) => handleBookSlot(m.requestId, slot)}
                                fmtDate={fmtDate}
                                fmtTime={fmtTime}
                            />
                        ))}
                    </div>
                </section>
            )}

            {/* Confirmed */}
            {confirmed.length > 0 && (
                <section className="meetings-section">
                    <div className="section-label">
                        <span className="section-dot confirmed" />
                        Confirmed &amp; Scheduled
                        <span className="pill success">{confirmed.length}</span>
                    </div>
                    <div className="meeting-cards">
                        {confirmed.map(m => (
                            <MeetingCard
                                key={m.requestId}
                                meeting={m}
                                isExpanded={false}
                                onToggle={() => {}}
                                onBook={() => {}}
                                fmtDate={fmtDate}
                                fmtTime={fmtTime}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

function MeetingCard({ meeting, isExpanded, onToggle, onBook, fmtDate, fmtTime }) {
    const isConfirmed = meeting.status === 'confirmed';

    return (
        <div className={`meeting-card ${isConfirmed ? 'confirmed' : ''} ${isExpanded ? 'expanded' : ''}`}>
            <div
                className="meeting-card-head"
                onClick={() => !isConfirmed && onToggle()}
                style={{ cursor: isConfirmed ? 'default' : 'pointer' }}
            >
                <div className="meeting-card-left">
                    <span className="meeting-icon">{isConfirmed ? '✅' : '📅'}</span>
                    <div>
                        <div className="meeting-title">{meeting.title}</div>
                        <div className="meeting-meta">
                            <span>{meeting.durationMinutes} min</span>
                            <span className="meta-sep">·</span>
                            <span>{meeting.participantUserIds.length} participants</span>
                            {isConfirmed && meeting.selectedSlotStart && (
                                <>
                                    <span className="meta-sep">·</span>
                                    <span>{fmtDate(meeting.selectedSlotStart)} at {fmtTime(meeting.selectedSlotStart)}</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                <div className="meeting-card-right">
                    <span className={`status-badge ${meeting.status}`}>
                        {isConfirmed ? 'Scheduled' : 'Awaiting Selection'}
                    </span>
                    {!isConfirmed && (
                        <span className={`expand-arrow ${isExpanded ? 'open' : ''}`}>›</span>
                    )}
                </div>
            </div>

            {isExpanded && !isConfirmed && meeting.slots?.length > 0 && (
                <div className="slot-area">
                    <div className="slot-area-title">⚖️ AI-Optimized Time Slots — Click to Book</div>
                    <div className="slots-grid">
                        {meeting.slots.map((slot, idx) => (
                            <div
                                key={idx}
                                className={`slot-card ${idx === 0 ? 'recommended' : ''}`}
                                onClick={() => onBook(slot)}
                            >
                                {idx === 0 && <div className="slot-ribbon">⭐ Recommended</div>}
                                <div className="slot-date">{fmtDate(slot.startIso)}</div>
                                <div className="slot-time-range">{fmtTime(slot.startIso)} – {fmtTime(slot.endIso)}</div>
                                <div className="slot-score-row">
                                    <span className="slot-score-num">{Math.round(slot.score)}%</span>
                                    <div className="slot-score-bar">
                                        <div className="slot-score-fill" style={{ width: `${slot.score}%` }} />
                                    </div>
                                </div>
                                <div className="slot-explanation">"{slot.explanation}"</div>
                                <button className="slot-book-btn">Select This Slot</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
