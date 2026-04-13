import { useState, useEffect, useRef, useMemo } from 'react';

const RECENT_KEY = 'cp_recent';
const MAX_RECENT = 5;

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}
function saveRecent(item) {
  const prev = loadRecent().filter(r => r.id !== item.id);
  localStorage.setItem(RECENT_KEY, JSON.stringify([item, ...prev].slice(0, MAX_RECENT)));
}

export default function CommandPalette({ onClose, onNavigate, onNewMeeting, signOut, meetings = [], users = [] }) {
  const [query, setQuery]          = useState('');
  const [selectedIdx, setSelected] = useState(0);
  const [recentIds, setRecentIds]  = useState(() => loadRecent());
  const inputRef                   = useRef(null);

  // Build actions with callbacks
  const actions = useMemo(() => [
    { id: 'cmd:new',       label: 'New Meeting',     shortcut: 'N', type: 'action', action: () => { onClose(); onNewMeeting?.(); } },
    { id: 'cmd:dashboard', label: 'Go to Dashboard', shortcut: '1', type: 'action', action: () => { onClose(); onNavigate('dashboard'); } },
    { id: 'cmd:calendar',  label: 'Go to Calendar',  shortcut: '2', type: 'action', action: () => { onClose(); onNavigate('calendar'); } },
    { id: 'cmd:meetings',  label: 'Go to Meetings',  shortcut: '3', type: 'action', action: () => { onClose(); onNavigate('meetings'); } },
    { id: 'cmd:people',    label: 'Go to People',    shortcut: '4', type: 'action', action: () => { onClose(); onNavigate('people'); } },
    { id: 'cmd:profile',   label: 'Go to Profile',   shortcut: '5', type: 'action', action: () => { onClose(); onNavigate('profile'); } },
    { id: 'cmd:signout',   label: 'Sign Out',        shortcut: '',  type: 'action', action: () => { onClose(); signOut?.(); } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const meetingItems = useMemo(() => meetings.slice(0, 30).map(m => ({
    id: `mtg:${m.requestId}`,
    label: m.title || 'Untitled meeting',
    type: 'meeting',
    meta: m.status === 'confirmed'
      ? (m.selectedSlotStart ? new Date(m.selectedSlotStart).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Confirmed')
      : m.status,
    action: () => { saveRecent({ id: `mtg:${m.requestId}`, label: m.title, type: 'meeting' }); onClose(); onNavigate('meetings'); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [meetings]);

  const peopleItems = useMemo(() => users.slice(0, 50).map(u => ({
    id: `usr:${u.userId}`,
    label: u.displayName || u.name || u.email || u.userId,
    type: 'person',
    meta: u.role || '',
    action: () => { saveRecent({ id: `usr:${u.userId}`, label: u.displayName || u.name, type: 'person' }); onClose(); onNavigate('people'); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [users]);

  const allById = useMemo(() => {
    const map = {};
    [...actions, ...meetingItems, ...peopleItems].forEach(i => { map[i.id] = i; });
    return map;
  }, [actions, meetingItems, peopleItems]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const recentItems = recentIds.map(r => allById[r.id]).filter(Boolean);
      return [
        { label: 'Recent',   items: recentItems },
        { label: 'Actions',  items: actions.slice(0, 4) },
      ];
    }
    return [
      { label: 'Actions',  items: actions.filter(c => c.label.toLowerCase().includes(q)) },
      { label: 'Meetings', items: meetingItems.filter(i => i.label.toLowerCase().includes(q)) },
      { label: 'People',   items: peopleItems.filter(i => i.label.toLowerCase().includes(q)) },
    ];
  }, [query, recentIds, allById, actions, meetingItems, peopleItems]);

  const flatItems = useMemo(() => sections.flatMap(s => s.items), [sections]);

  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const run = (item) => {
    if (!item) return;
    saveRecent(item);
    setRecentIds(loadRecent());
    item.action();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape')    { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => Math.min(i + 1, flatItems.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter')     { e.preventDefault(); run(flatItems[selectedIdx]); }
  };

  const typeIcon = t => t === 'meeting' ? '📅' : t === 'person' ? '👤' : '⌘';

  // Precompute start indices for each section before rendering
  const sectionsWithIdx = [];
  let absStart = 0;
  for (const s of sections) {
    sectionsWithIdx.push({ ...s, start: absStart });
    absStart += s.items.length;
  }

  return (
    <div className="palette-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette-box">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search commands, meetings, people…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list">
          {flatItems.length === 0 ? (
            <div className="palette-empty">No results for "{query}"</div>
          ) : (
            sectionsWithIdx.map(({ label, items, start }) =>
              items.length === 0 ? null : (
                <div key={label}>
                  <div className="palette-section">{label}</div>
                  {items.map((item, i) => {
                    const idx = start + i;
                    return (
                      <div
                        key={item.id}
                        className={`palette-item${idx === selectedIdx ? ' selected' : ''}`}
                        onMouseEnter={() => setSelected(idx)}
                        onClick={() => run(item)}
                      >
                        <span className="palette-item-icon">{typeIcon(item.type)}</span>
                        <span className="palette-item-label">{item.label}</span>
                        {item.meta && <span className="palette-item-meta">{item.meta}</span>}
                        {item.shortcut && <span className="palette-shortcut">{item.shortcut}</span>}
                      </div>
                    );
                  })}
                </div>
              )
            )
          )}
        </div>
        <div className="palette-footer">
          ↑↓ navigate · Enter select · Esc close
        </div>
      </div>
    </div>
  );
}
