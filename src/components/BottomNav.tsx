import React from 'react';
import { Home, Plus, PieChart, Target, User } from 'lucide-react';
import { TabType } from '../App';

interface BottomNavProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onChangeTab }) => {
  const tabs = [
    { id: 'home' as TabType, icon: Home, label: 'Обзор' },
    { id: 'analytics' as TabType, icon: PieChart, label: 'Аналитика' },
    { id: 'add' as TabType, icon: Plus, label: 'Добавить', isCenter: true },
    { id: 'plans' as TabType, icon: Target, label: 'Планы' },
    { id: 'profile' as TabType, icon: User, label: 'Профиль' },
  ];

  return (
    <div className="app-nav-wrap">
      <nav aria-label="Основная навигация" className="app-nav dock-glass">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeTab(tab.id)}
              className={`nav-item ${active ? 'is-active' : ''} ${tab.isCenter ? 'nav-add' : ''}`}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
            >
              <span className="nav-icon"><Icon size={20} strokeWidth={active ? 2.3 : 1.8} /></span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default BottomNav;
