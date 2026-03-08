import React from 'react';
import './CalendarView.css';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17];

export default function CalendarView({ meetings }) {
    const confirmedMeetings = meetings.filter(m => m.status === 'confirmed');

    // Calculate the start of the current week (Monday)
    const today = new Date();
    const currentDay = today.getDay(); // 0 is Sunday
    const diff = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1); 
    const monday = new Date(today.setDate(diff));

    const weekDays = Array.from({ length: 5 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return {
            name: d.toLocaleDateString('en-US', { weekday: 'short' }),
            label: d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
            fullDate: d.toDateString()
        };
    });

    const getEventForSlot = (dayName, hour) => {
        return confirmedMeetings.find(m => {
            const date = new Date(m.selectedSlotStart);
            return date.toLocaleDateString('en-US', { weekday: 'short' }) === dayName && 
                   date.getHours() === hour;
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
                {weekDays.map(day => (
                    <div key={day.name} className="calendar-cell header">
                        {day.name} <br />
                        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{day.label}</span>
                    </div>
                ))}

                {/* Grid Rows */}
                {hours.map(hour => (
                    <React.Fragment key={hour}>
                        <div className="calendar-cell time-label">{hour}:00</div>
                        {weekDays.map(day => {
                            const event = getEventForSlot(day.name, hour);
                            return (
                                <div key={`${day.name}-${hour}`} className="calendar-cell">
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
