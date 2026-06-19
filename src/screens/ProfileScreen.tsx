import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { LogOut, Copy, Check as CheckIcon, Minus, Plus, AlertTriangle, Smartphone } from 'lucide-react';

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' Br';

const ProfileScreen: React.FC = () => {
  const { members, budgetLimit, setBudgetLimit, monthlyExpense } = useApp();
  const { profile, household, signOut } = useAuth();

  const [editLimit, setEditLimit] = useState(false);
  const [limitVal, setLimitVal]   = useState(budgetLimit.toString());
  const [copied, setCopied]       = useState(false);

  const pct = Math.min(100, Math.round((monthlyExpense / budgetLimit) * 100));
  const over = monthlyExpense > budgetLimit;

  const handleCopy = () => {
    if (household?.id) { navigator.clipboard.writeText(household.id); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const handleSaveLimit = () => {
    const v = parseFloat(limitVal);
    if (!isNaN(v) && v >= 100) { setBudgetLimit(v); setEditLimit(false); }
  };

  return (
    <div className="flex flex-col overflow-y-auto no-scrollbar pb-20 h-full bg-[#F0F4F8]">
      {/* Header */}
      <div className="px-5 pt-14 pb-5 bg-white border-b border-slate-100 flex justify-between items-center">
        <div>
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-0.5">Настройки</p>
          <h1 className="text-2xl font-extrabold text-slate-800">Профиль</h1>
        </div>
        <button onClick={signOut}
          className="w-9 h-9 rounded-full bg-red-50 border border-red-100 flex items-center justify-center text-red-400 hover:text-red-500 active:scale-90 transition-all"
          title="Выйти">
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 pt-4 flex flex-col gap-4">

        {/* Profile card */}
        <div className="card px-4 py-4 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl border-2"
              style={{ background: `${profile?.color}15`, borderColor: `${profile?.color}35` }}>
              {profile?.avatar || '👤'}
            </div>
            <div>
              <p className="font-bold text-lg text-slate-800 leading-tight">{profile?.name || 'Загрузка...'}</p>
              <p className="text-sm text-slate-400 mt-0.5">{household?.name || 'Моя семья'}</p>
            </div>
          </div>

          {/* Household ID */}
          {household?.id && (
            <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">ID семьи (для приглашения)</p>
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-mono text-slate-600 flex-1 truncate">{household.id}</p>
                <button onClick={handleCopy}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-all active:scale-95 ${copied ? 'bg-green-100 text-green-600' : 'bg-white border border-slate-200 text-slate-600'}`}>
                  {copied ? <><CheckIcon className="w-3 h-3" />Скопировано</> : <><Copy className="w-3 h-3" />Копировать</>}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5">Поделитесь этим кодом с партнёром при регистрации</p>
            </div>
          )}
        </div>

        {/* Members */}
        <div className="card px-4 py-4 flex flex-col gap-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Участники семьи</p>
          {members.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-2">Загрузка...</p>
          ) : (
            members.map(m => (
              <div key={m.id} className="flex items-center gap-3 py-1">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl border"
                  style={{ background: `${m.color}15`, borderColor: `${m.color}25` }}>
                  {m.avatar}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm text-slate-700">
                    {m.name} {m.id === profile?.id ? <span className="text-[10px] text-green-600 font-bold">(Вы)</span> : ''}
                  </p>
                </div>
                <span className="w-2 h-2 rounded-full bg-green-400" title="Онлайн" />
              </div>
            ))
          )}
        </div>

        {/* Budget limit */}
        <div className="card px-4 py-4 flex flex-col gap-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Месячный лимит расходов</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">Потрачено</p>
              <p className="text-xl font-extrabold text-slate-800">{fmt(monthlyExpense)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Лимит</p>
              {editLimit ? (
                <div className="flex items-center gap-1.5">
                  <input type="number" value={limitVal} onChange={e => setLimitVal(e.target.value)}
                    className="w-24 text-right text-lg font-bold border border-green-400 rounded-xl px-2 py-0.5 text-slate-800 focus:outline-none" autoFocus />
                  <button onClick={handleSaveLimit} className="px-2.5 py-1.5 bg-green-500 text-white font-bold text-xs rounded-xl active:scale-95">ОК</button>
                </div>
              ) : (
                <button onClick={() => { setLimitVal(budgetLimit.toString()); setEditLimit(true); }}
                  className="text-xl font-extrabold text-green-600 underline decoration-dotted">{fmt(budgetLimit)}</button>
              )}
            </div>
          </div>

          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: over ? '#F43F5E' : '#22C55E' }} />
          </div>

          <div className="flex items-center gap-2 justify-between">
            {over ? (
              <div className="flex items-center gap-1.5 text-red-500 text-xs font-medium">
                <AlertTriangle className="w-4 h-4" />
                <span>Лимит превышен!</span>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Осталось: <strong className="text-slate-700">{fmt(Math.max(0, budgetLimit - monthlyExpense))}</strong></p>
            )}
            <div className="flex gap-2">
              <button onClick={() => setBudgetLimit(Math.max(100, budgetLimit - 100))}
                className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 active:scale-90 transition-all">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setBudgetLimit(budgetLimit + 100)}
                className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 active:scale-90 transition-all">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* PWA install tips */}
        <div className="card px-4 py-4 flex flex-col gap-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 text-green-500" />
            Установка на смартфон (PWA)
          </p>
          <div className="flex flex-col gap-2 text-xs text-slate-500">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="font-semibold text-slate-600 mb-1">🍎 iOS (Safari)</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Нажмите «Поделиться» (квадрат со стрелкой)</li>
                <li>Выберите «На экран Домой»</li>
                <li>Нажмите «Добавить»</li>
              </ol>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="font-semibold text-slate-600 mb-1">🤖 Android (Chrome)</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Нажмите три точки ⋮ справа вверху</li>
                <li>Выберите «Установить приложение»</li>
                <li>Подтвердите установку</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Sign out */}
        <button onClick={signOut}
          className="w-full py-3.5 bg-white border border-red-100 text-red-400 font-bold text-sm rounded-2xl flex items-center justify-center gap-2 active:scale-98 transition-all">
          <LogOut className="w-4 h-4" />
          Выйти из аккаунта
        </button>
      </div>
    </div>
  );
};

export default ProfileScreen;
