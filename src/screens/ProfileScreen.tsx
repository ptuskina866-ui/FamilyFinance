import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { LogOut, Copy, Check as CheckIcon, Minus, Plus, AlertTriangle, Smartphone, Landmark, RotateCw } from 'lucide-react';
import { BankSyncModal } from '../components/BankSyncModal';

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' Br';

const ProfileScreen: React.FC = () => {
  const { members, budgetLimit, setBudgetLimit, monthlyExpense } = useApp();
  const { profile, household, signOut } = useAuth();

  const [editLimit, setEditLimit] = useState(false);
  const [limitVal, setLimitVal]   = useState(budgetLimit.toString());
  const [copied, setCopied]       = useState(false);
  const [bankSyncOpen, setBankSyncOpen] = useState(false);

  const pct = Math.min(100, Math.round((monthlyExpense / budgetLimit) * 100));
  const over = monthlyExpense > budgetLimit;

  const handleCopy = () => {
    if (household?.id) {
      navigator.clipboard.writeText(household.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSaveLimit = () => {
    const v = parseFloat(limitVal);
    if (!isNaN(v) && v >= 100) {
      setBudgetLimit(v);
      setEditLimit(false);
    }
  };

  return (
    <div className="flex flex-col overflow-y-auto no-scrollbar h-full bg-white">
      {/* Header */}
      <div className="px-5 pt-7 pb-2 safe-header bg-white border-b border-slate-100/60 flex justify-between items-center">
        <div className="w-9 h-9" /> {/* Spacer */}
        <h1 className="text-sm font-black text-slate-800 tracking-tight">Профиль</h1>
        <button
          onClick={signOut}
          className="w-9 h-9 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-100/50 flex items-center justify-center text-rose-500 active:scale-90 transition-all"
          title="Выйти"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      <div className="px-5 pt-5 pb-36 flex flex-col gap-5">
        {/* Profile card */}
        <div className="card px-4 py-4 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl shadow-sm bg-[#FAF2EA]">
              {profile?.avatar || '👤'}
            </div>
            <div>
              <p className="font-bold text-base text-slate-800 leading-tight">{profile?.name || 'Загрузка...'}</p>
              <p className="text-xs text-slate-400 font-semibold mt-1 uppercase tracking-wider">{household?.name || 'Моя семья'}</p>
            </div>
          </div>

          {/* Household ID */}
          {household?.id && (
            <div className="bg-slate-50/50 rounded-2xl p-3 border border-slate-100/60">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">ID семьи (для приглашения партнера)</p>
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-mono text-slate-600 flex-1 truncate">{household.id}</p>
                <button
                  onClick={handleCopy}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all active:scale-95 shadow-sm ${
                    copied ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-white border border-slate-200 text-slate-600'
                  }`}
                >
                  {copied ? (
                    <>
                      <CheckIcon className="w-3 h-3" />
                      <span>Скопировано</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Копировать</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Members */}
        <div className="card px-4 py-4 flex flex-col gap-3">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Участники семьи</p>
          <div className="flex flex-col gap-2.5">
            {members.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-2">Загрузка...</p>
            ) : (
              members.map(m => (
                <div key={m.id} className="flex items-center gap-3.5 py-0.5">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl shadow-sm bg-[#FAF2EA]">
                    {m.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-slate-800 truncate">
                      {m.name} {m.id === profile?.id ? <span className="text-[10px] text-emerald-600 font-black ml-1">(Вы)</span> : ''}
                    </p>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/20" title="Онлайн" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Budget limit matching Home budget bar design */}
        <div className="card px-4 py-4 flex flex-col gap-4">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Месячный лимит расходов</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Потрачено</p>
              <p className="text-lg font-black text-slate-800 mt-0.5">{fmt(monthlyExpense)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Лимит</p>
              {editLimit ? (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <input
                    type="number"
                    value={limitVal}
                    onChange={e => setLimitVal(e.target.value)}
                    className="w-24 text-right text-sm font-bold border border-slate-300 focus:border-[#0F172A] rounded-xl px-2.5 py-1 text-slate-800 focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveLimit}
                    className="px-3 py-1 bg-[#0F172A] hover:bg-[#1E293B] text-white font-extrabold text-xs rounded-xl active:scale-95"
                  >
                    ОК
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setLimitVal(budgetLimit.toString()); setEditLimit(true); }}
                  className="text-lg font-black text-slate-800 hover:text-slate-600 underline decoration-dotted mt-0.5"
                >
                  {fmt(budgetLimit)}
                </button>
              )}
            </div>
          </div>

          {/* Thin budget progress bar matching HomeScreen */}
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                backgroundColor: over ? '#F43F5E' : '#0F172A'
              }}
            />
          </div>

          <div className="flex items-center gap-2 justify-between">
            {over ? (
              <div className="flex items-center gap-1.5 text-rose-500 text-xs font-bold">
                <AlertTriangle className="w-4 h-4" />
                <span>Лимит превышен!</span>
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-medium">Осталось: <strong className="text-slate-700">{fmt(Math.max(0, budgetLimit - monthlyExpense))}</strong></p>
            )}
            <div className="flex gap-1.5">
              <button
                onClick={() => setBudgetLimit(Math.max(100, budgetLimit - 100))}
                className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200/60 flex items-center justify-center text-slate-600 active:scale-90 transition-all"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setBudgetLimit(budgetLimit + 100)}
                className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200/60 flex items-center justify-center text-slate-600 active:scale-90 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Bank Integrations */}
        <div className="card px-4 py-4 flex flex-col gap-3">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-2">
            <Landmark className="w-3.5 h-3.5 text-slate-800" />
            Банковские интеграции
          </p>
          <div 
            onClick={() => setBankSyncOpen(true)}
            className="p-3.5 rounded-2xl bg-gradient-to-r from-rose-50/60 to-white border border-rose-100 hover:border-rose-300 flex items-center justify-between gap-3 cursor-pointer group transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-rose-600 text-white flex items-center justify-center font-black text-base shadow-sm shadow-rose-600/20">
                А
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black text-slate-800">Альфа-Банк Беларусь</span>
                <span className="text-[10px] text-slate-400">Импорт официальной выписки в PDF</span>
              </div>
            </div>
            <button
              type="button"
              className="px-3 py-1.5 rounded-xl bg-white border border-rose-200 text-rose-600 text-xs font-bold group-hover:bg-rose-600 group-hover:text-white transition-all shadow-sm flex items-center gap-1"
            >
              <RotateCw size={12} className="group-hover:rotate-180 transition-transform duration-500" />
              Синхронизировать
            </button>
          </div>
        </div>

        {/* PWA install tips */}
        <div className="card px-4 py-4 flex flex-col gap-3">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 text-slate-800" />
            Установка на смартфон (PWA)
          </p>
          <div className="flex flex-col gap-2.5 text-xs text-slate-500">
            <div className="bg-slate-50/50 rounded-2xl p-3.5 border border-slate-100/60">
              <p className="font-bold text-slate-700 mb-1">🍎 iOS (Safari)</p>
              <ol className="list-decimal list-inside space-y-1 font-medium text-slate-500">
                <li>Нажмите «Поделиться» (квадрат со стрелкой)</li>
                <li>Выберите «На экран Домой»</li>
                <li>Нажмите «Добавить»</li>
              </ol>
            </div>
            <div className="bg-slate-50/50 rounded-2xl p-3.5 border border-slate-100/60">
              <p className="font-bold text-slate-700 mb-1">🤖 Android (Chrome)</p>
              <ol className="list-decimal list-inside space-y-1 font-medium text-slate-500">
                <li>Нажмите три точки ⋮ справа вверху</li>
                <li>Выберите «Установить приложение»</li>
                <li>Подтвердите установку</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Sign out button styled premium */}
        <button
          onClick={signOut}
          className="w-full py-3.5 bg-white hover:bg-rose-50 border border-rose-100 text-rose-500 font-bold text-xs rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm shadow-rose-500/5"
        >
          <LogOut className="w-4 h-4" />
          <span>Выйти из аккаунта</span>
        </button>
      </div>

      {/* ── Bank Sync Modal ── */}
      <BankSyncModal 
        isOpen={bankSyncOpen} 
        onClose={() => setBankSyncOpen(false)} 
      />
    </div>
  );
};

export default ProfileScreen;
