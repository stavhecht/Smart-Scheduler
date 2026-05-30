export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateEmails = (str) => {
  const list = str.split(',').map(s => s.trim()).filter(Boolean);
  return { list, invalid: list.filter(e => !EMAIL_REGEX.test(e)) };
};

export const fmtRelative = (iso) => {
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

export const getInitials = (name) => name
  ? name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
  : '?';
