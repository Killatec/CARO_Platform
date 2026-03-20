import React from 'react';
import { AppShell } from './components/layout/AppShell.jsx';
import { EditorPage } from './pages/EditorPage.jsx';
import { RegistryPage } from './pages/RegistryPage.jsx';
import { useUIStore } from './stores/useUIStore.js';

function App() {
  const activeTab = useUIStore(state => state.activeTab);

  const CurrentPage = activeTab === 'registry' ? RegistryPage : EditorPage;

  return (
    <AppShell>
      <CurrentPage />
    </AppShell>
  );
}

export default App;
