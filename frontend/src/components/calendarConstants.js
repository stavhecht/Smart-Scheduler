export const ROLE_COLOR = {
  organizer:   { bg: 'rgba(56,189,248,0.78)',  border: '#38bdf8', text: '#002a3a' },
  participant: { bg: 'rgba(129,140,248,0.78)', border: '#818cf8', text: '#1a1a40' },
};
export const PENDING_COLOR = { bg: 'rgba(251,191,36,0.18)', border: '#fbbf24', text: '#78350f' };

// Maps Google Calendar colorId values (1–11) to visual styles.
// Text colors are light so they're readable on dark-mode semi-transparent backgrounds.
// Light mode overrides dark text via [data-theme="light"] .cv-event-gcal in CSS.
export const GCAL_COLOR_MAP = {
  '':   { bg: 'rgba(52,211,153,0.20)',  border: '#34d399', text: '#6ee7b7' }, // default green
  '1':  { bg: 'rgba(121,134,203,0.20)', border: '#7986cb', text: '#c7d2fe' }, // Lavender
  '2':  { bg: 'rgba(51,182,121,0.20)',  border: '#33b679', text: '#6ee7b7' }, // Sage
  '3':  { bg: 'rgba(192,86,234,0.20)',  border: '#c056ea', text: '#e9d5ff' }, // Grape
  '4':  { bg: 'rgba(230,124,115,0.20)', border: '#e67c73', text: '#fca5a5' }, // Flamingo
  '5':  { bg: 'rgba(246,191,38,0.20)',  border: '#f6bf26', text: '#fde68a' }, // Banana
  '6':  { bg: 'rgba(244,81,30,0.20)',   border: '#f4511e', text: '#fdba74' }, // Tangerine
  '7':  { bg: 'rgba(3,155,229,0.20)',   border: '#039be5', text: '#7dd3fc' }, // Peacock
  '8':  { bg: 'rgba(99,102,241,0.20)',  border: '#6366f1', text: '#c7d2fe' }, // Blueberry
  '9':  { bg: 'rgba(52,211,153,0.20)',  border: '#34d399', text: '#a7f3d0' }, // Basil
  '10': { bg: 'rgba(239,68,68,0.20)',   border: '#ef4444', text: '#fca5a5' }, // Tomato
  '11': { bg: 'rgba(156,163,175,0.20)', border: '#9ca3af', text: '#e5e7eb' }, // Graphite
};
// ICS calendar gets a distinct purple tint to differentiate from Google events
export const ICS_COLOR = { bg: 'rgba(168,85,247,0.20)', border: '#a855f7', text: '#e9d5ff' };

export function gcalColor(ev) {
  if (ev.source === 'ics') return ICS_COLOR;
  return GCAL_COLOR_MAP[ev.colorId || ''] ?? GCAL_COLOR_MAP[''];
}
