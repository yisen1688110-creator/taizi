import { useEffect } from 'react';

export default function Modal({
  open,
  title,
  children,
  actions = [],
  onClose,
  closeOnBackdrop = true,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal" onClick={(e)=>{ if (e.target === e.currentTarget && closeOnBackdrop) onClose?.(); }}>
      <div className="modal-card">
        {title && (<h2 className="title" style={{ marginTop: 0 }}>{title}</h2>)}
        <div style={{ marginTop: 8 }}>{children}</div>
        <div className="sub-actions" style={{ justifyContent:'flex-end', gap:10, marginTop:16 }}>
          {actions?.map((act, i) => (
            <button
              key={i}
              className={`btn ${act.primary ? 'primary' : ''}`}
              onClick={act.onClick}
              disabled={act.disabled}
            >{act.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}