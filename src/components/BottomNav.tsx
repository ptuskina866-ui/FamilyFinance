import React from 'react';
import { Home, Plus, PieChart, CalendarDays, User } from 'lucide-react';
import { TabType } from '../App';

interface BottomNavProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onChangeTab }) => {
  const leftTabs = [
    { id: 'home' as TabType, label: 'Главная', icon: Home },
    { id: 'analytics' as TabType, label: 'Аналитика', icon: PieChart },
  ];
  const rightTabs = [
    { id: 'plans' as TabType, label: 'Планы', icon: CalendarDays },
    { id: 'profile' as TabType, label: 'Профиль', icon: User },
  ];

  const Tab = ({ id, label, icon: Icon }: { id: TabType; label: string; icon: React.ComponentType<any> }) => {
    const active = activeTab === id;
    return (
      <button
        onClick={() => onChangeTab(id)}
        className="flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-all duration-200 active:scale-90"
      >
        <div className={`flex items-center justify-center w-10 h-7 rounded-full transition-all duration-200 ${active ? 'bg-green-50' : ''}`}>
          <Icon
            className={`w-5 h-5 transition-colors duration-200 ${active ? 'text-green-600' : 'text-slate-400'}`}
            strokeWidth={active ? 2.5 : 2}
          />
        </div>
        <span className={`text-[10px] font-semibold leading-none transition-colors duration-200 ${active ? 'text-green-600' : 'text-slate-400'}`}>
          {label}
        </span>
      </button>
    );
  };

  return (
    <nav
      className="absolute bottom-0 left-0 right-0 bg-white border-t border-slate-100 flex items-center px-2 z-50 safe-mb"
      style={{ height: 64, boxShadow: '0 -4px 20px rgba(0,0,0,0.04)' }}
    >
      {leftTabs.map(t => <Tab key={t.id} {...t} />)}

      {/* Center FAB */}
      <div className="flex flex-col items-center justify-center flex-1">
        <button
          onClick={() => onChangeTab('add')}
          className="w-13 h-13 rounded-full bg-green-500 hover:bg-green-600 active:scale-90 flex items-center justify-center transition-all duration-200 -mt-5 shadow-lg shadow-green-500/35"
          aria-label="Добавить"
        >
          <Plus className="w-6 h-6 text-white" strokeWidth={3} />
        </button>
      </div>

      {rightTabs.map(t => <Tab key={t.id} {...t} />)}
    </nav>
  );
};

export default BottomNav;
