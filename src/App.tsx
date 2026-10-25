import { useEffect } from 'react';
import { MapView } from './components/MapView';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { SongCard } from './components/SongCard';
import { SourceDialog } from './components/SourceDialog';
import { SearchDialog } from './components/SearchDialog';
import { SaveDialog } from './components/SaveDialog';
import { HelpDialog } from './components/HelpDialog';
import { Toasts } from './components/Toasts';
import { usePlan } from './state/plan';
import { useSession } from './state/session';
import { useUi } from './state/ui';
import { useDemoEnrichment } from './state/derived';
import { usePaletteLoading } from './state/palettes';

export function App() {
  const theme = usePlan((s) => s.theme);
  const tracks = usePlan((s) => s.tracks);
  const server = useSession((s) => s.config.server);
  const dialog = useUi((s) => s.dialog);

  useEffect(() => {
    void useSession.getState().init();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#07090d' : '#f4f5f7');
  }, [theme]);

  useDemoEnrichment();
  usePaletteLoading(tracks, server);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) usePlan.getState().redo();
        else usePlan.getState().undo();
      } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        usePlan.getState().redo();
      } else if (e.key === 'Escape' && !useUi.getState().dialog) {
        usePlan.getState().select(null);
      } else if (e.key === '/' && !typing && !useUi.getState().dialog) {
        e.preventDefault();
        useUi.getState().open('search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Sidebar />
      <main className="stage">
        <MapView />
        <SongCard />
        <Timeline />
      </main>
      {dialog === 'source' && <SourceDialog />}
      {dialog === 'search' && <SearchDialog />}
      {dialog === 'save' && <SaveDialog />}
      {dialog === 'help' && <HelpDialog />}
      <Toasts />
    </div>
  );
}
