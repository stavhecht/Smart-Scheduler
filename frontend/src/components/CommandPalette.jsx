import { useState, useEffect, useRef } from 'react';

export default function CommandPalette({ onClose, onNavigate, onNewMeeting, signOut }) {
  const [query, setQuery]           = useState('');
  const [selectedIdx, setSelected]  = useState(0);
  const inputRef                    = useRef(null);

  const COMMANDS = [
    { label: 'New Meeting',       shortcut: 'N',  action: () => { onClose(); onNewMeeting?.(); } },
    { label: 'Go to Dashboard',   shortcut: '1',  action: () => { onClose(); onNavigate('dashboard'); } },
    { label: 'Go to Calendar',    shortcut: '2',  action: () => { onClose(); onNavigate('calendar'); } },
    { label: 'Go to Meetings',    shortcut: '3',  action: () => { onClose(); onNavigate('meetings'); } },
    { label: 'Go to People',      shortcut: '4',  action: () => { onClose(); onNavigate('people'); } },
    { label: 'Go to Profile',     shortcut: '5',  action: () => { onClose(); onNavigate('profile'); } },
    { label: 'Sign Out',          shortcut: '',   action: () => { onClose(); signOut?.(); } },
  ];

  const filtered = COMMANDS.filter(c =>
    c.label.toLowerCase().includes(query.toLowerCase())
  );

  // Clamp selectedIdx when filter changes
  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = (cmd) => {
    if (cmd) cmd.action();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(filtered[selectedIdx]);
    }
  };

  return (
    <div className="palette-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette-box">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search commands…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">No commands match "{query}"</div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.label}
                className={`palette-item${i === selectedIdx ? ' selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => run(cmd)}
              >
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <span className="palette-shortcut">{cmd.shortcut}</span>
                )}
              </div>
            ))
          )}
        </div>
        <div className="palette-footer">
          ↑↓ navigate · Enter select · Esc close
        </div>
      </div>
    </div>
  );
}
