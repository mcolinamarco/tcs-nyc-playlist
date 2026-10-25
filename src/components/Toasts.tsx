import { useSession } from '../state/session';

export function Toasts() {
  const toasts = useSession((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => useSession.getState().dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
