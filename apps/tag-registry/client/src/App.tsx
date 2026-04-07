import React from 'react';
import { AppShell } from './components/layout/AppShell.jsx';
import { EditorPage } from './pages/EditorPage.jsx';
import { RegistryPage } from './pages/RegistryPage.jsx';
import { HistoryPage } from './pages/HistoryPage.jsx';
import { useUIStore } from './stores/useUIStore.js';
import type { ActiveTab } from './stores/useUIStore.js';

const pages: Record<ActiveTab, React.ComponentType> = {
  editor: EditorPage,
  registry: RegistryPage,
  history: HistoryPage,
};

function App(): React.ReactElement {
  const activeTab = useUIStore(state => state.activeTab);
  const CurrentPage = pages[activeTab] ?? EditorPage;

  return (
    <AppShell>
      <CurrentPage />
    </AppShell>
  );
}

export default App;
