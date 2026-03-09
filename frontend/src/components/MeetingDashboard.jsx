import { useState } from 'react';
import './MeetingDashboard.css';
import { apiPost } from '../apiClient';

export default function MeetingDashboard({ meetings, onRefresh }) {
    const [loading, setLoading] = useState(false);
    const [expandedMeetingId, setExpandedMeetingId] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newMeetingData, setNewMeetingData] = useState({ title: '', durationMinutes: 60, participantIds: ['u2'] });


    const handleCreateMeeting = (e) => {
        e.preventDefault();
        setLoading(true);
        setShowCreateModal(false);

        apiPost('/api/meetings/create', newMeetingData)
            .then(() => {
                onRefresh();
                setNewMeetingData({ title: '', durationMinutes: 60, participantIds: [] }); // Reset
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
            .then(() => {
                onRefresh();
                setLoading(false);
            })
            .catch(err => {
                alert('Failed to book the selected slot');
                console.error(err);
                onRefresh();
                setLoading(false);
            });
    };

    const toggleMeeting = (id) => {
        if (expandedMeetingId === id) {
            setExpandedMeetingId(null);
        } else {
            setExpandedMeetingId(id);
        }
    };

    const formatTime = (isoString) => {
        return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (isoString) => {
        return new Date(isoString).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
    };

    if (loading) return <div className="loading">Updating schedule... 🤖</div>;

    return (
        <div className="meeting-dashboard">
            <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2>Smart Schedule Management 🧠</h2>
                <button
                    className="create-btn"
                    onClick={() => setShowCreateModal(true)}
                    style={{
                        background: 'var(--accent-color)', color: '#000', border: 'none', padding: '10px 20px',
                        borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
                    }}
                >
                    + New Meeting
                </button>
            </div>

            {showCreateModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
                }}>
                    <div style={{
                        background: 'var(--bg-secondary)', padding: '2rem', borderRadius: '16px',
                        border: '1px solid var(--accent-color)', width: '400px', maxWidth: '90%'
                    }}>
                        <h3 style={{ marginTop: 0 }}>Create New Request</h3>
                        <form onSubmit={handleCreateMeeting} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Meeting Title:</label>
                                <input
                                    autoFocus
                                    type="text"
                                    required
                                    value={newMeetingData.title}
                                    onChange={e => setNewMeetingData({ ...newMeetingData, title: e.target.value })}
                                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: 'none' }}
                                    placeholder="e.g. Weekly Sync"
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Duration (Minutes):</label>
                                <select
                                    value={newMeetingData.durationMinutes}
                                    onChange={e => setNewMeetingData({ ...newMeetingData, durationMinutes: Number(e.target.value) })}
                                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: 'none' }}
                                >
                                    <option value={15}>15 min (Quick)</option>
                                    <option value={30}>30 min (Standard)</option>
                                    <option value={45}>45 min</option>
                                    <option value={60}>60 min (1 Hour)</option>
                                    <option value={90}>90 min</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                                <button type="submit" style={{ flex: 1, background: 'var(--success)', border: 'none', padding: '10px', borderRadius: '4px', cursor: 'pointer', color: 'white', fontWeight: 'bold' }}>
                                    🚀 Calculate & Create
                                </button>
                                <button type="button" onClick={() => setShowCreateModal(false)} style={{ flex: 1, background: '#555', border: 'none', padding: '10px', borderRadius: '4px', cursor: 'pointer', color: 'white' }}>
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {meetings.length === 0 && !loading && <div className="empty-state">No meeting requests found. Start one!</div>}

            <div className="meetings-grid">
                {meetings.map(meeting => {
                    const isConfirmed = meeting.status === 'confirmed';
                    const isExpanded = expandedMeetingId === meeting.requestId;

                    return (
                        <div key={meeting.requestId} className={`meeting-card ${isConfirmed ? 'confirmed' : ''}`}>
                            <div className="meeting-header" onClick={() => !isConfirmed && toggleMeeting(meeting.requestId)}>
                                <div className="meeting-title-section">
                                    <h3>
                                        {isConfirmed ? '✅' : '📅'} {meeting.title}
                                    </h3>
                                    <div className="meeting-meta">
                                        <span>⏳ {meeting.durationMinutes}m</span>
                                        <span>👥 {meeting.participantUserIds.length} Participants</span>
                                    </div>
                                </div>
                                <div className={`meeting-status ${meeting.status}`}>
                                    {isConfirmed ? 'Scheduled' : 'Pending Selection'}
                                </div>
                            </div>

                             {isExpanded && !isConfirmed && (
                                <div className="meeting-slots">
                                    <h4>Select a Slot (Optimized by Fairness)</h4>
                                    <div className="slot-list">
                                        {meeting.slots.map((slot, idx) => (
                                            <div
                                                key={idx}
                                                className={`time-slot ${idx === 0 ? 'best-match' : ''}`}
                                                onClick={() => handleBookSlot(meeting.requestId, slot)}
                                            >
                                                {idx === 0 && <span className="slot-badge">Recommended ⭐</span>}
                                                <div className="slot-time">
                                                    {formatDate(slot.startIso)} | {formatTime(slot.startIso)} - {formatTime(slot.endIso)}
                                                </div>
                                                <div className="slot-score">
                                                    <span>Fairness Score: {Math.round(slot.score)}%</span>
                                                    <div className="score-bar">
                                                        <div className="score-fill" style={{ width: `${slot.score}%` }}></div>
                                                    </div>
                                                </div>
                                                <div className="slot-explanation">
                                                    "{slot.explanation}"
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
