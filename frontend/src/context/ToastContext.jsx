import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = {
  success: <CheckCircle2 size={15} />,
  error:   <XCircle size={15} />,
  info:    <Info size={15} />,
  warning: <AlertTriangle size={15} />,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const toast = useCallback((msg, type = 'info') => {
    const id = ++counter.current;
    setToasts(prev => [...prev, { id, msg, type, exiting: false }]);

    // Auto-remove after 4s (with 300ms exit animation buffer)
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 300);
    }, 4000);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div className="toast-portal">
          {toasts.map(t => (
            <div key={t.id} className={`toast-item toast-${t.type}${t.exiting ? ' exiting' : ''}`}>
              {ICONS[t.type] || ICONS.info}
              <span style={{ flex: 1 }}>{t.msg}</span>
              <button className="toast-item-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
