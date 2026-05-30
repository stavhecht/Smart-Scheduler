export const STATUS_PRESETS = [
  "🎯 Focused", "🤝 Open to connect", "🔴 Busy",
  "✈️ Travelling", "🌱 Learning", "💡 Thinking", "🎉 Available",
];

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const TIMEZONES = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver',
  'America/Chicago', 'America/New_York', 'America/Sao_Paulo', 'Atlantic/Reykjavik',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Helsinki',
  'Asia/Jerusalem', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
  'Pacific/Auckland',
];

export function extractPrefs(p) {
  return {
    timezone: p.timezone || 'Asia/Jerusalem',
    workingHours: p.workingHours || { start: '09:00', end: '18:00' },
    workingDays: p.workingDays || [0, 1, 2, 3, 4],
    lunchBreak: p.lunchBreak || { start: '12:00', duration: 60 },
    notificationPrefs: p.notificationPrefs || { invites: true, reminders: true, digest: false },
    showFairnessScore: p.showFairnessScore ?? true,
  };
}

export function getStatusDotColor(msg) {
  if (!msg) return '#3d4e68';
  const m = msg.toLowerCase();
  if (m.includes('available') || m.includes('open') || m.includes('learning') || m.includes('thinking')) return '#34d399';
  if (m.includes('busy') || m.includes('travelling') || m.includes('focused')) return '#fbbf24';
  return '#6b7a94';
}

export function computeCompleteness(p) {
  let score = 0;
  if (p.name || p.displayName) score += 20;
  if (p.bio) score += 20;
  if (p.role) score += 15;
  if (p.department) score += 15;
  if ((p.skills || []).length > 0) score += 15;
  if (p.statusMessage || p.status_message) score += 15;
  return score;
}

export function parseHour(timeStr) {
  if (!timeStr) return 0;
  return parseInt(timeStr.split(':')[0], 10) || 0;
}
