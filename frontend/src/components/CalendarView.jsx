import React from 'react';
import './CalendarView.css';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17];

export default function CalendarView({ meetings }) {
    const confirmedMeetings = meetings.filter(m => m.status === 'confirmed');

    const getEventForSlot = (day, hour) => {
        return confirmedMeetings.find(m => {
            const date = new Date(m.selectedSlotStart);
            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
            return dayName === day && date.getHours() === hour;
        });
    };

    return (
        <div className="calendar-container">
            <div className="calendar-header">
                <h3>Weekly Availability Overview 🗓️</h3>
                <div className="calendar-controls">
                    <span>March 2026</span>
                </div>
            </div>

            <div className="calendar-grid">
                {/* Time Column Header */}
                <div className="calendar-cell header">Time</div>
                {/* Day Headers */}
                {days.map(day => <div key={day} className="calendar-cell header">{day}</div>)}

                {/* Grid Rows */}
                {hours.map(hour => (
                    <React.Fragment key={hour}>
                        <div className="calendar-cell time-label">{hour}:00</div>
                        {days.map(day => {
                            const event = getEventForSlot(day, hour);
                            return (
                                <div key={`${day}-${hour}`} className="calendar-cell">
                                    {event && (
                                        <div className="event-block" title={event.title}>
                                            {event.title}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </React.Fragment>
                ))}
            </div>

            <div className="calendar-footer">
                <div className="legend-item">
                    <span className="dot" style={{ background: 'var(--accent-color)' }}></span>
                    <span>Confirmed</span>
                </div>
                <div className="legend-item">
                    <span className="dot" style={{ border: '2px dashed var(--accent-color)' }}></span>
                    <span>AI Suggestion</span>
                </div>
            </div>
        </div>
    );
}
