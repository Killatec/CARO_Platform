import React from 'react';
import { AppShell } from './components/layout/AppShell.jsx';
import { EditorPage } from './pages/EditorPage.jsx';
import { RegistryPage } from './pages/RegistryPage.jsx';
import { HistoryPage } from './pages/HistoryPage.jsx';
import { useUIStore } from './stores/useUIStore.js';

function App() {
  const activeTab = useUIStore(state => state.activeTab);

  const pages = { editor: EditorPage, registry: RegistryPage, history: HistoryPage };
  const CurrentPage = pages[activeTab] ?? EditorPage;

  return (
    <AppShell>
      <CurrentPage />
    </AppShell>
  );
}

export default App;
