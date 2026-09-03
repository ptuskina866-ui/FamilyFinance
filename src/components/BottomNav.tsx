import React from 'react';
import { Home, Plus, PieChart, Target, User } from 'lucide-react';
import { TabType } from '../App';

interface BottomNavProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onChangeTab }) => {
  const tabs = [
    { id: 'home' as TabType, icon: Home, label: 'Главная' },
    { id: 'analytics' as TabType, icon: PieChart, label: 'Аналитика' },
    { id: 'add' as TabType, icon: Plus, label: 'Добавить', isCenter: true },
    { id: 'plans' as TabType, icon: Target, label: 'Планы' },
    { id: 'profile' as TabType, icon: User, label: 'Профиль' },
  ];

  return (
    <div className="shrink-0 w-full pointer-events-none relative z-50 flex justify-center pb-[max(6px,calc(env(safe-area-inset-bottom,0px)-8px))] pt-0.5">
      {/* Floating Island Capsule */}
      <nav className="pointer-events-auto bg-white/95 backdrop-blur-xl border border-white/80 rounded-full px-2.5 py-1.5 flex items-center gap-1.5 shadow-[0_14px_38px_rgba(10,35,15,0.14)]">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;

          if (tab.isCenter) {
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeTab(tab.id)}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 ${
                  active
                    ? 'bg-slate-950 text-white shadow-md shadow-slate-950/30 ring-2 ring-slate-900/20'
                    : 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm'
                }`}
                title={tab.label}
              >
                <Plus className="w-5 h-5 text-white" strokeWidth={2.8} />
              </button>
            );
          }

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeTab(tab.id)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 ${
                active
                  ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
                  : 'text-slate-400 hover:text-slate-800 hover:bg-slate-100/60'
              }`}
              title={tab.label}
            >
              <Icon className="w-4 h-4" strokeWidth={active ? 2.5 : 2} />
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default BottomNav;
