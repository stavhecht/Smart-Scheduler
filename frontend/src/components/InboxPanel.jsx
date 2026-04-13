import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiMarkMessagesRead } from '../apiClient';
import { Star, Bell, Mail, Inbox, X } from 'lucide-react';
import './ProfileView.css';

/**
 * Shared inbox panel — used by both MessagesView and ProfileView (Inbox tab).
 * Fetches messages on mount, marks them as read, and provides inline replies.
 */
export default function InboxPanel({ onUnreadCountChange }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [replyTo, setReplyTo]   = useState(null);
  const [replying, setReplying] = useState(false);

  useEffect(() => { fetchMessages(); }, []);

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const msgs = await apiGet('/api/profile/messages');
      setMessages(msgs || []);
      const unread = (msgs || []).filter(m => !m.isRead).length;
      if (onUnreadCountChange) onUnreadCountChange(unread);
      // Mark all as read server-side after the count is reported
      if (unread > 0) {
        apiMarkMessagesRead().catch(() => {});
        // Optimistically update local state so the badges clear immediately
        setMessages(prev => prev.map(m => ({ ...m, isRead: true })));
        if (onUnreadCountChange) onUnreadCountChange(0);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReply = async (m) => {
    if (!replyTo?.text?.trim()) return;
    setReplying(true);
    try {
      await apiPost(`/api/profile/${m.fromUserId}/message`, { content: replyTo.text, type: 'general' });
      setReplyTo(null);
    } catch (err) {
      console.error('Reply failed:', err);
    } finally {
      setReplying(false);
    }
  };

  const msgTypeIcon = (type) =>
    type === 'kudos' ? <Star size={14} /> : type === 'nudge' ? <Bell size={14} /> : <Mail size={14} />;

  return (
    <div className="pv-card" style={{ minHeight: '400px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h3 style={{ margin: 0 }}>Inbox</h3>
        <button className="pv-btn ghost tiny" onClick={fetchMessages} disabled={loading}>
          {loading ? '...' : '↻ Refresh'}
        </button>
      </div>

      <div className="inbox-list">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="msg-item" style={{ gap: '0.75rem', alignItems: 'center' }}>
              <div className="skeleton" style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div className="skeleton" style={{ height: 12, width: '45%' }} />
                <div className="skeleton" style={{ height: 11, width: '80%' }} />
              </div>
            </div>
          ))
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Inbox size={40} strokeWidth={1} /></div>
            <p style={{ margin: 0, fontSize: '0.84rem' }}>
              No messages yet. When people nudge you or send kudos, they'll appear here.
            </p>
          </div>
        ) : (
          messages.map(m => (
            <div key={m.messageId} className={`msg-item ${m.isRead ? 'read' : 'unread'}`}>
              <div className="msg-icon">{msgTypeIcon(m.messageType)}</div>
              <div className="msg-body">
                <div className="msg-header">
                  <span className="msg-from">{m.fromDisplayName}</span>
                  <span className="msg-time">
                    {new Date(m.createdAt).toLocaleDateString(undefined, {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="msg-text">{m.content}</p>
                {replyTo?.messageId === m.messageId && (
                  <div className="reply-form" style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                    <input
                      autoFocus
                      className="pv-input-sub"
                      style={{ flex: 1 }}
                      placeholder="Write a reply..."
                      value={replyTo.text}
                      onChange={e => setReplyTo(r => ({ ...r, text: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleReply(m);
                        if (e.key === 'Escape') setReplyTo(null);
                      }}
                    />
                    <button
                      className="pv-btn primary tiny"
                      onClick={() => handleReply(m)}
                      disabled={replying || !replyTo.text?.trim()}
                    >
                      {replying ? '...' : 'Send'}
                    </button>
                    <button className="pv-btn tiny" onClick={() => setReplyTo(null)}><X size={13} /></button>
                  </div>
                )}
              </div>
              <div className="msg-actions">
                <button
                  className="pv-btn tiny"
                  onClick={() => setReplyTo({ messageId: m.messageId, fromUserId: m.fromUserId, text: '' })}
                >
                  Reply
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
