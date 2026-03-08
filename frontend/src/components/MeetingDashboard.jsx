import { useState, useEffect } from 'react';
import './MeetingDashboard.css';

export default function MeetingDashboard() {
    const [meetings, setMeetings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedMeetingId, setExpandedMeetingId] = useState(null);

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newMeetingData, setNewMeetingData] = useState({ title: '', durationMinutes: 60, participantIds: ['u2'] });

    useEffect(() => {
        fetchMeetings();
    }, []);

    const fetchMeetings = () => {
        fetch('https://aeox6n4cja.execute-api.us-east-1.amazonaws.com/api/meetings')
            .then(res => {
                if (!res.ok) throw new Error('API Error');
                return res.json();
            })
            .then(data => {
                setMeetings(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    };

    const handleCreateMeeting = (e) => {
        e.preventDefault();
        setLoading(true);
        setShowCreateModal(false);

        fetch('https://aeox6n4cja.execute-api.us-east-1.amazonaws.com/api/meetings/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newMeetingData)
        })
            .then(res => {
                if (!res.ok) throw new Error('Creating failed');
                return res.json();
            })
            .then(() => {
                fetchMeetings();
                setNewMeetingData({ title: '', durationMinutes: 60, participantIds: ['u2'] }); // Reset
            })
            .catch(err => {
                alert("שגיאה ביצירת פגישה");
                console.error(err);
                setLoading(false);
            });
    };

    const handleBookSlot = (meetingId, slot) => {
        // Optimistic UI Update
        const updatedMeetings = meetings.map(m => {
            if (m.requestId === meetingId) {
                return { ...m, status: 'confirmed' };
            }
            return m;
        });
        setMeetings(updatedMeetings);
        setExpandedMeetingId(null); // Close accordion

        // API Call
        fetch(`https://aeox6n4cja.execute-api.us-east-1.amazonaws.com/api/meetings/${meetingId}/book/${encodeURIComponent(slot.startIso)}`, { method: 'POST' })
            .then(res => {
                if (!res.ok) throw new Error('Booking failed');
                // Refresh to get latest state from server
                fetchMeetings();
            })
            .catch(err => {
                alert("שגיאה בקביעת הפגישה");
                fetchMeetings(); // Revert
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
        return new Date(isoString).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (isoString) => {
        return new Date(isoString).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
    };

    if (loading) return <div className="loading">מחשב הצעות הוגנות... 🤖</div>;

    return (
        <div className="meeting-dashboard">
            <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2>ניהול לו"ז חכם 🧠</h2>
                <button
                    className="create-btn"
                    onClick={() => setShowCreateModal(true)}
                    style={{
                        background: 'var(--accent-color)', color: '#000', border: 'none', padding: '10px 20px',
                        borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
                    }}
                >
                    + פגישה חדשה
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
                        <h3 style={{ marginTop: 0 }}>יצירת בקשה חדשה</h3>
                        <form onSubmit={handleCreateMeeting} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>נושא הפגישה:</label>
                                <input
                                    autoFocus
                                    type="text"
                                    required
                                    value={newMeetingData.title}
                                    onChange={e => setNewMeetingData({ ...newMeetingData, title: e.target.value })}
                                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: 'none' }}
                                    placeholder="לדוגמה: ישיבת צוות"
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>משך זמן (דקות):</label>
                                <select
                                    value={newMeetingData.durationMinutes}
                                    onChange={e => setNewMeetingData({ ...newMeetingData, durationMinutes: Number(e.target.value) })}
                                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: 'none' }}
                                >
                                    <option value={15}>15 דק' (קצר)</option>
                                    <option value={30}>30 דק' (רגיל)</option>
                                    <option value={45}>45 דק'</option>
                                    <option value={60}>60 דק' (שעה)</option>
                                    <option value={90}>90 דק'</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                                <button type="submit" style={{ flex: 1, background: 'var(--success)', border: 'none', padding: '10px', borderRadius: '4px', cursor: 'pointer', color: 'white', fontWeight: 'bold' }}>
                                    🚀 חשב הוגנות וצור
                                </button>
                                <button type="button" onClick={() => setShowCreateModal(false)} style={{ flex: 1, background: '#555', border: 'none', padding: '10px', borderRadius: '4px', cursor: 'pointer', color: 'white' }}>
                                    ביטול
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {meetings.length === 0 && !loading && <div className="empty-state">אין בקשות לפגישות כרגע. צור אחת!</div>}

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
                                        <span>⏳ {meeting.durationMinutes} דק'</span>
                                        <span>👥 {meeting.participantUserIds.length} משתתפים</span>
                                    </div>
                                </div>
                                <div className={`meeting-status ${meeting.status}`}>
                                    {isConfirmed ? 'נקבע' : 'ממתין לשיבוץ'}
                                </div>
                            </div>

                            {isExpanded && !isConfirmed && (
                                <div className="meeting-slots">
                                    <h4>בחר מועד (ממויין לפי הוגנות)</h4>
                                    <div className="slot-list">
                                        {meeting.slots.map((slot, idx) => (
                                            <div
                                                key={idx}
                                                className={`time-slot ${idx === 0 ? 'best-match' : ''}`}
                                                onClick={() => handleBookSlot(meeting.requestId, slot)}
                                            >
                                                {idx === 0 && <span className="slot-badge">מומלץ ⭐</span>}
                                                <div className="slot-time">
                                                    {formatDate(slot.startIso)} | {formatTime(slot.startIso)} - {formatTime(slot.endIso)}
                                                </div>
                                                <div className="slot-score">
                                                    <span>דירוג: {slot.score}</span>
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
