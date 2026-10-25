import type { PlaylistRef } from '../lib/types';

const LABELS: Record<PlaylistRef['service'], string> = {
  spotify: 'Spotify',
  apple: 'Apple Music',
  demo: 'Demo',
  custom: 'Custom',
};

export function ServiceBadge({ service, title }: { service: PlaylistRef['service']; title?: string }) {
  return (
    <span className={`service-badge ${service}`} title={title ?? LABELS[service]}>
      {service === 'spotify' && (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="12" fill="#1ed760" />
          <path d="M6.5 9.2c3.8-1.1 8-.8 11.2 1M7 12.3c3.2-.9 6.6-.6 9.3.9M7.6 15.2c2.6-.7 5.2-.5 7.4.7" stroke="#0b0d12" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </svg>
      )}
      {service === 'apple' && (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect width="24" height="24" rx="6" fill="#fa2d48" />
          <path d="M15.5 6.5v8.2a2 2 0 1 1-1.3-1.9V8.6l-4.5 1v6.1a2 2 0 1 1-1.3-1.9V8.5z" fill="#fff" />
        </svg>
      )}
      {service !== 'spotify' && service !== 'apple' && <span className="dot" />}
      <span className="label">{LABELS[service]}</span>
    </span>
  );
}
