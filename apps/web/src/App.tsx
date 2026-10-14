import { useEffect } from 'react';
import { DialogHost } from '@/components/dialogs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MainScreen } from '@/features/MainScreen';
import { CompareScreen } from '@/features/compare/CompareScreen';
import { Header } from '@/features/header/Header';
import { IoScreen } from '@/features/io/IoScreen';
import { MasterScreen } from '@/features/master/MasterScreen';
import { PostingsScreen } from '@/features/postings/PostingsScreen';
import { redo, undo } from '@/store/project';
import { useEngineSync } from '@/store/run';
import { useUiStore } from '@/store/ui';

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function App() {
  useEngineSync();
  const screen = useUiStore((s) => s.screen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-muted/40 text-foreground">
        <Header />
        <main className="min-h-0 flex-1">
          {screen === 'main' && <MainScreen />}
          {screen === 'master' && <MasterScreen />}
          {screen === 'postings' && <PostingsScreen />}
          {screen === 'compare' && <CompareScreen />}
          {screen === 'io' && <IoScreen />}
        </main>
      </div>
      <DialogHost />
    </TooltipProvider>
  );
}
