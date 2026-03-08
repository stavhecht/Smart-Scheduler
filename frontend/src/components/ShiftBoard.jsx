import { useState, useEffect } from 'react';
import './ShiftBoard.css';

export default function ShiftBoard({ userScore }) {
    const [shifts, setShifts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/shifts')
            .then(res => {
                if (!res.ok) throw new Error(`Server status: ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (Array.isArray(data)) {
                    setShifts(data);
                } else {
                    setShifts([]);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setShifts([]);
                setLoading(false);
            });
    }, []);

    const handleBookShift = (shiftId) => {
        // עדכון אופטימי מהיר בממשק
        setShifts(prev => prev.map(s => s.id === shiftId ? { ...s, is_taken: true } : s));

        fetch(`/api/shifts/${shiftId}/book`, { method: 'POST' })
            .then(res => {
                if (!res.ok) throw new Error('Booking request failed');
                return res.json();
            })
            .then(data => {
                console.log("Shift booked:", data);
            })
            .catch(err => {
                console.error("Booking error:", err);
                alert("שגיאה בהרשמה למשמרת. וודא שהשרת מעודכן.");
                // ביטול השינוי במקרה של כישלון
                setShifts(prev => prev.map(s => s.id === shiftId ? { ...s, is_taken: false } : s));
            });
    };

    if (loading) return <div>טוען משמרות...</div>;


    if (shifts.length === 0) {
        return (
            <div className="shift-board">
                <h2>לוח משמרות 📅</h2>
                <div style={{ padding: '20px', background: 'var(--bg-secondary)', borderRadius: '8px', color: 'var(--text-secondary)' }}>
                    <p>לא נמצאו משמרות כרגע.</p>
                    <p style={{ fontSize: '0.8em', marginTop: '10px' }}>
                        (אם ה-Backend לא מעודכן, הוא לא יחזיר משמרות או שגיאה)
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="shift-board">
            <h2>לוח משמרות ושיבוצים 🗓️</h2>
            <div className="shifts-grid">
                {shifts.map(shift => {
                    const isLocked = userScore < shift.required_score;
                    const startTime = new Date(shift.start).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
                    const endTime = new Date(shift.end).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

                    return (
                        <div key={shift.id} className={`shift-card ${isLocked ? 'locked' : ''}`}>
                            <div className="shift-header">
                                <span className="shift-title">{shift.title}</span>
                                <span className="shift-icon">{shift.type === 'morning' ? '☀️' : shift.type === 'night' ? '🌙' : '🌇'}</span>
                            </div>

                            <div className="shift-time">
                                {startTime} - {endTime}
                            </div>

                            {shift.required_score > 0 && (
                                <div className="shift-req">
                                    ציון נדרש: {shift.required_score}
                                </div>
                            )}

                            <button
                                className={`take-btn ${shift.is_taken ? 'taken' : ''}`}
                                disabled={isLocked || shift.is_taken}
                                onClick={() => handleBookShift(shift.id)}
                            >
                                {shift.is_taken ? 'רשום בהצלחה ✅' : (isLocked ? 'אין לך מספיק נקודות 🔒' : 'הרשם למשמרת')}
                            </button>
                        </div>
                    )
                })}
            </div>
        </div>
    );
}
