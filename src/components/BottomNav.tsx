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
        <div className={`flex items-center justify-center w-10 h-7 rounded-full transition-all duration-200 ${active ? 'bg-[#FAF2EA]' : ''}`}>
          <Icon
            className={`w-5 h-5 transition-colors duration-200 ${active ? 'text-[#0F172A]' : 'text-slate-400'}`}
            strokeWidth={active ? 2.5 : 2}
          />
        </div>
        <span className={`text-[10px] font-bold leading-none transition-colors duration-200 ${active ? 'text-[#0F172A]' : 'text-slate-400'}`}>
          {label}
        </span>
      </button>
    );
  };

  return (
    <nav
      className="absolute bottom-0 left-0 right-0 bg-white/85 border-t border-slate-100/60 backdrop-blur-lg flex items-center px-2 z-50"
      style={{ 
        height: 'calc(64px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -8px 30px rgba(15, 23, 42, 0.03)' 
      }}
    >
      {leftTabs.map(t => <Tab key={t.id} {...t} />)}

      {/* Center FAB */}
      <div className="flex flex-col items-center justify-center flex-1">
        <button
          onClick={() => onChangeTab('add')}
          className="w-11 h-11 rounded-full bg-[#0F172A] hover:bg-[#1E293B] active:scale-90 flex items-center justify-center transition-all duration-200 shadow-md shadow-slate-950/10"
          aria-label="Добавить"
        >
          <Plus className="w-5 h-5 text-white" strokeWidth={3} />
        </button>
      </div>

      {rightTabs.map(t => <Tab key={t.id} {...t} />)}
    </nav>
  );
};

export default BottomNav;
