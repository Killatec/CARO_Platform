import React from 'react';
import { useUIStore } from '../../stores/useUIStore.js';

/**
 * Sidebar - navigation links
 */
export function Sidebar() {
  const activeTab = useUIStore(state => state.activeTab);
  const setActiveTab = useUIStore(state => state.setActiveTab);

  const navItems = [
    { id: 'editor', label: 'Editor', icon: '📝' },
    { id: 'registry', label: 'Registry', icon: '📋' }
  ];

  return (
    <aside className="w-48 bg-gray-100 border-r border-gray-200 py-4">
      <nav>
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-full px-4 py-3 text-left flex items-center gap-2 transition-colors ${
              activeTab === item.id
                ? 'bg-blue-100 text-blue-900 border-r-4 border-blue-600 font-semibold'
                : 'text-gray-700 hover:bg-gray-200'
            }`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
