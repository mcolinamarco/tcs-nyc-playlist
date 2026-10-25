import { useUi } from '../state/ui';

let audio: HTMLAudioElement | null = null;

/** Plays a 30-second preview, or stops it if it's the one already playing. */
export function togglePreview(url: string | undefined) {
  if (!url) return;
  const current = useUi.getState().previewUrl;
  audio?.pause();
  if (current === url) {
    useUi.getState().setPreviewUrl(null);
    return;
  }
  audio = new Audio(url);
  audio.volume = 0.8;
  audio.onended = () => useUi.getState().setPreviewUrl(null);
  audio.onerror = () => useUi.getState().setPreviewUrl(null);
  void audio.play().catch(() => useUi.getState().setPreviewUrl(null));
  useUi.getState().setPreviewUrl(url);
}

export function stopPreview() {
  audio?.pause();
  useUi.getState().setPreviewUrl(null);
}
