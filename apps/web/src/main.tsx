import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { useProjectStore } from './store/project';
import { loadWorkspace, startAutosave } from './store/persist';
import './index.css';

async function bootstrap() {
  // 前回の作業を IndexedDB から戻す（F9-02）。なければサンプル商事で始める
  const saved = await loadWorkspace();
  if (saved) useProjectStore.getState().replace(saved.project, saved.scenarioId);
  useProjectStore.temporal.getState().clear();
  startAutosave();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
