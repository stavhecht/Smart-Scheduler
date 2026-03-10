import './ProfileView.css';

/* ─────────────────────────────────────────────
   ProfileView
   Props:
     profile               – user profile object
     meetings              – array of all user meetings
     calendarStatus        – { google: {connected, email}, microsoft: {connected, email} }
     onCalendarConnect     – fn(provider) → initiates OAuth flow
     onCalendarDisconnect  – fn(provider) → disconnects calendar
───────────────────────────────────────────── */
export default function ProfileView({ profile, meetings, calendarStatus, onCalendarConnect, onCalendarDisconnect }) {
  const score      = Math.round(profile.fairness_score ?? 100);
  const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';

  // Meeting stats
  const total       = meetings.length;
  const confirmed   = meetings.filter(m => m.status === 'confirmed').length;
  const pending     = meetings.filter(m => m.status === 'pending').length;
  const organized   = meetings.filter(m => m.userRole === 'organizer').length;
  const invited     = meetings.filter(m => m.userRole === 'participant').length;
  const thisWeek    = profile.details?.meetings_this_week ?? 0;
  const conflicts   = profile.details?.cancellations_last_month ?? 0;
  const focusScore  = profile.details?.suffering_score ?? 0;

  // Circular progress
  const R          = 52;
  const C          = 2 * Math.PI * R;
  const dashOffset = C - (score / 100) * C;

  // Initials from name
  const initials = profile.name
    ? profile.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '??';

  const googleConnected    = calendarStatus?.google?.connected;
  const googleEmail        = calendarStatus?.google?.email || '';
  const microsoftConnected = calendarStatus?.microsoft?.connected;
  const microsoftEmail     = calendarStatus?.microsoft?.email || '';

  return (
    <div className="pv-wrap">

      {/* ── Hero card ── */}
      <div className="pv-hero">
        <div className="pv-avatar">{initials}</div>

        <div className="pv-info">
          <h2 className="pv-name">{profile.name}</h2>
          <span className="pv-role-chip">{profile.role}</span>
          <div className="pv-meta">
            {profile.email && <span>📧 {profile.email}</span>}
            <span>🌍 Asia/Jerusalem (UTC+2)</span>
            <span>⏰ 09:00 – 18:00</span>
          </div>
        </div>

        {/* Fairness gauge */}
        <div className="pv-gauge">
          <svg width="130" height="130" viewBox="0 0 130 130">
            {/* Track */}
            <circle
              cx="65" cy="65" r={R}
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="10"
            />
            {/* Fill */}
            <circle
              cx="65" cy="65" r={R}
              fill="none"
              stroke={scoreColor}
              strokeWidth="10"
              strokeDasharray={C}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 65 65)"
              style={{ transition: 'stroke-dashoffset 1s ease' }}
            />
            {/* Score label */}
            <text x="65" y="60" textAnchor="middle" fill="white" fontSize="26" fontWeight="800">
              {score}
            </text>
            <text x="65" y="78" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="10">
              FAIRNESS
            </text>
          </svg>
        </div>
      </div>

      {/* ── Stats grid ── */}
      <div className="pv-stats">
        {[
          { icon: '📅', val: total,      label: 'Total Meetings'  },
          { icon: '✅', val: confirmed,  label: 'Confirmed'       },
          { icon: '⏳', val: pending,    label: 'Pending'         },
          { icon: '🎯', val: organized,  label: 'Organized'       },
          { icon: '📨', val: invited,    label: 'Invited'         },
          { icon: '📊', val: thisWeek,   label: 'This Week'       },
        ].map(({ icon, val, label }) => (
          <div className="pv-stat" key={label}>
            <span className="pv-stat-icon">{icon}</span>
            <span className="pv-stat-val">{val}</span>
            <span className="pv-stat-label">{label}</span>
          </div>
        ))}
      </div>

      {/* ── Two-column detail cards ── */}
      <div className="pv-detail-grid">

        {/* Fairness analysis */}
        <div className="pv-card">
          <h3>⚖️ Fairness Analysis</h3>

          <div className="fa-bar-row">
            <span>Overall Score</span>
            <div className="fa-track">
              <div className="fa-fill" style={{ width: `${score}%`, background: scoreColor }} />
            </div>
            <span style={{ color: scoreColor, fontWeight: 700 }}>{score}/100</span>
          </div>

          <p className="fa-insight">
            {score >= 80
              ? '🌟 Excellent standing! Your high fairness score grants priority in slot selection. You consistently accommodate others\' scheduling needs.'
              : score >= 60
              ? '📈 Good standing. Accepting less convenient slots will improve your score and grant priority access in future meetings.'
              : '⚠️ Below average. Try accepting meetings at inconvenient times to raise your fairness score — it benefits everyone.'}
          </p>

          <div className="fa-metrics">
            <div className="fa-metric">
              <span className="fa-m-label">Meetings this week</span>
              <span className="fa-m-val">{thisWeek}</span>
            </div>
            <div className="fa-metric">
              <span className="fa-m-label">Conflicts last month</span>
              <span className="fa-m-val">{conflicts}</span>
            </div>
            <div className="fa-metric">
              <span className="fa-m-label">Focus score</span>
              <span className="fa-m-val">{focusScore}</span>
            </div>
          </div>
        </div>

        {/* Account settings */}
        <div className="pv-card">
          <h3>⚙️ Account Settings</h3>
          <div className="settings-list">
            <SettingRow
              label="Working Hours"
              desc="09:00 – 18:00 (Asia/Jerusalem)"
              action="Edit"
            />
            <SettingRow
              label="Timezone"
              desc="Asia/Jerusalem (UTC+2 / +3 DST)"
              action="Change"
            />
            <SettingRow
              label="Email Notifications"
              desc="Meeting invites & confirmations"
              toggle
              defaultOn
            />
          </div>
        </div>
      </div>

      {/* ── Calendar Integration card ── */}
      <div className="pv-card">
        <h3>🗓️ Calendar Integration</h3>
        <p className="cal-intro">
          Connect your calendar so Smart Scheduler can read your availability and automatically add confirmed meetings.
        </p>
        <div className="cal-providers">

          {/* Google Calendar */}
          <div className="cal-provider-row">
            <div className="cal-provider-icon google-icon">G</div>
            <div className="cal-provider-info">
              <span className="cal-provider-name">Google Calendar</span>
              {googleConnected
                ? <span className="cal-status-connected">✓ Connected{googleEmail ? ` · ${googleEmail}` : ''}</span>
                : <span className="cal-status-disconnected">Not connected</span>
              }
            </div>
            {googleConnected ? (
              <button
                className="cal-btn cal-btn-disconnect"
                onClick={() => onCalendarDisconnect?.('google')}
              >
                Disconnect
              </button>
            ) : (
              <button
                className="cal-btn cal-btn-connect"
                onClick={() => onCalendarConnect?.('google')}
              >
                Connect
              </button>
            )}
          </div>

          {/* Microsoft Outlook */}
          <div className="cal-provider-row">
            <div className="cal-provider-icon ms-icon">M</div>
            <div className="cal-provider-info">
              <span className="cal-provider-name">Microsoft Outlook</span>
              {microsoftConnected
                ? <span className="cal-status-connected">✓ Connected{microsoftEmail ? ` · ${microsoftEmail}` : ''}</span>
                : <span className="cal-status-disconnected">Not connected</span>
              }
            </div>
            {microsoftConnected ? (
              <button
                className="cal-btn cal-btn-disconnect"
                onClick={() => onCalendarDisconnect?.('microsoft')}
              >
                Disconnect
              </button>
            ) : (
              <button
                className="cal-btn cal-btn-connect"
                onClick={() => onCalendarConnect?.('microsoft')}
              >
                Connect
              </button>
            )}
          </div>
        </div>

        <p className="cal-note">
          💡 After connecting, the AI will use your real calendar availability when generating meeting slots.
          Confirmed meetings will be added to your calendar automatically.
        </p>
      </div>

      {/* ── Activity timeline ── */}
      {confirmed > 0 && (
        <div className="pv-card">
          <h3>📅 Recent Confirmed Meetings</h3>
          <div className="timeline">
            {meetings
              .filter(m => m.status === 'confirmed' && m.selectedSlotStart)
              .slice(0, 5)
              .map(m => (
                <div className="tl-item" key={m.requestId}>
                  <div className={`tl-dot ${m.userRole}`} />
                  <div className="tl-body">
                    <span className="tl-title">{m.title}</span>
                    <span className="tl-meta">
                      {new Date(m.selectedSlotStart).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                      {' · '}
                      {m.durationMinutes}m
                    </span>
                  </div>
                  <span className={`tl-role ${m.userRole}`}>
                    {m.userRole === 'organizer' ? 'Organized' : 'Attended'}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingRow({ label, desc, action, toggle, defaultOn, disabled }) {
  return (
    <div className="sr">
      <div className="sr-info">
        <span className="sr-label">{label}</span>
        <span className="sr-desc">{desc}</span>
      </div>
      {toggle ? (
        <div className={`toggle ${defaultOn ? 'on' : ''}`} />
      ) : (
        <button
          className={`sr-btn ${disabled ? 'disabled' : ''}`}
          disabled={disabled}
        >
          {action}
        </button>
      )}
    </div>
  );
}
