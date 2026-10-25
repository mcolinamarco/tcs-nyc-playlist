import { create } from 'zustand';

export type Dialog = 'source' | 'search' | 'save' | 'help';

interface UiState {
  dialog: Dialog | null;
  /** Ask the map to bring a song's stretch into view. */
  focus: { uid: string; n: number } | null;
  previewUrl: string | null;
  open(d: Dialog): void;
  close(): void;
  requestFocus(uid: string): void;
  setPreviewUrl(url: string | null): void;
}

export const useUi = create<UiState>()((set, get) => ({
  dialog: null,
  focus: null,
  previewUrl: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
  requestFocus: (uid) => set({ focus: { uid, n: (get().focus?.n ?? 0) + 1 } }),
  setPreviewUrl: (previewUrl) => set({ previewUrl }),
}));
