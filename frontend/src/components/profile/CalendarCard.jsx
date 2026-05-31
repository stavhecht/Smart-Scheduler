/* ── Calendar card (full card version) ── */
export default function CalendarCard({ brand, name, status, onConnect, onDisconnect }) {
  const isConnected = !!status?.connected;
  return (
    <div className="pv-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <div className={`cal-provider-icon ${brand === 'google' ? 'google-icon' : 'ms-icon'}`}>
        {brand === 'google' ? 'G' : 'M'}
      </div>
      <div className="cal-provider-info">
        <span className="cal-provider-name">{name}</span>
        <span className={isConnected ? 'cal-status-connected' : 'cal-status-disconnected'}>
          {isConnected ? status.email : 'Not connected'}
        </span>
      </div>
      {isConnected ? (
        <button className="cal-btn cal-btn-disconnect" onClick={onDisconnect}>Disconnect</button>
      ) : (
        <button className="cal-btn cal-btn-connect" onClick={() => onConnect(brand)}>Connect</button>
      )}
    </div>
  );
}
