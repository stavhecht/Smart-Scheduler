import InboxPanel from './InboxPanel';

export default function MessagesView({ onUnreadCountChange }) {
  return <InboxPanel onUnreadCountChange={onUnreadCountChange} />;
}
