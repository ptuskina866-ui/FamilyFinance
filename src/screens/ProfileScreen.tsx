import { ScreenHeader } from '../components/ScreenHeader';
import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { LogOut, Copy, Check as CheckIcon, Minus, Plus, AlertTriangle, Smartphone, Landmark, ChevronRight } from 'lucide-react';
import { BankSyncModal } from '../components/BankSyncModal';
import { ErrorBoundary } from '../components/ErrorBoundary';

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' Br';

interface ProfileScreenProps {
  onOpenStatement?: () => void;
}

const ProfileScreen: React.FC<ProfileScreenProps> = ({ onOpenStatement }) => {
  const { members, budgetLimit, setBudgetLimit, monthlyExpense } = useApp();
  const { profile, household, signOut, createHouseholdInvite } = useAuth();

  const [editLimit, setEditLimit] = useState(false);
  const [limitVal, setLimitVal]   = useState(budgetLimit.toString());
  const [copied, setCopied]       = useState(false);
  const [bankSyncOpen, setBankSyncOpen] = useState(false);
  const [inviteToken, setInviteToken] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const pct = Math.min(100, Math.round((monthlyExpense / budgetLimit) * 100));
  const over = monthlyExpense > budgetLimit;

  const handleCopy = async () => {
    setInviteLoading(true); setInviteError(null);
    try {
      const token = inviteToken || await createHouseholdInvite();
      setInviteToken(token);
      await navigator.clipboard.writeText(token);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch (error) { setInviteError(error instanceof Error ? error.message : 'Не удалось создать или скопировать приглашение.'); }
    finally { setInviteLoading(false); }
  };

  const handleSaveLimit = () => {
    const v = parseFloat(limitVal);
    if (!isNaN(v) && v >= 100) {
      setBudgetLimit(v);
      setEditLimit(false);
    }
  };

  return (
    <div className="flex flex-col overflow-y-auto no-scrollbar h-full select-none">
      {/* Header */}
      <ScreenHeader title="Профиль" eyebrow="Ваше пространство" actions={<button type="button" onClick={signOut} className="icon-button text-rose-700" aria-label="Выйти" title="Выйти"><LogOut size={18}/></button>}/>

      <div className="screen-body flex flex-col gap-5">
        {/* Profile card */}
        <div className="card px-4 py-4 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl shadow-sm bg-[#f0f0f4]">
              {profile?.avatar || '👤'}
            </div>
            <div>
              <p className="font-bold text-base text-slate-800 leading-tight">{profile?.name || 'Загрузка...'}</p>
              <p className="text-xs text-slate-400 font-semibold mt-1 tracking-normal">{household?.name || 'Моя семья'}</p>
            </div>
          </div>

          {/* Household ID */}
          {household?.id && (
            <div className="bg-slate-50/50 rounded-2xl p-3 border border-slate-100/60">
              <p className="text-[9px] font-bold text-slate-400 tracking-normal mb-2">Приглашение в семью · действует 7 дней</p>
              <div className="flex items-center gap-2">
                <p className="text-[11px] text-slate-600 flex-1 min-w-0 break-all">{inviteToken || 'Одноразовый код для регистрации партнера'}</p>
                <button
                  onClick={handleCopy}
                  disabled={inviteLoading}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all active:scale-95 shadow-sm ${
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
                      <span>{inviteLoading ? 'Создаем…' : 'Пригласить'}</span>
                    </>
                  )}
                </button>
              </div>
              {inviteError && <p role="alert" className="text-xs text-rose-600 mt-2">{inviteError}</p>}
              {inviteToken && <button type="button" className="text-xs mt-2 underline text-slate-500" onClick={() => { setInviteToken(''); setCopied(false); }}>Создать новое приглашение</button>}
            </div>
          )}
        </div>

        {/* Members */}
        <div className="card px-4 py-4 flex flex-col gap-3">
          <p className="text-[11px] text-slate-400 font-bold tracking-normal">Участники семьи</p>
          <div className="flex flex-col gap-2.5">
            {members.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-2">Загрузка...</p>
            ) : (
              members.map(m => (
                <div key={m.id} className="flex items-center gap-3.5 py-0.5">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl shadow-sm bg-[#f0f0f4]">
                    {m.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-slate-800 truncate">
                      {m.name} {m.id === profile?.id ? <span className="text-[11px] text-emerald-600 font-black ml-1">(Вы)</span> : ''}
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-500">Участник</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Budget limit matching Home budget bar design */}
        <div className="card px-4 py-4 flex flex-col gap-4">
          <p className="text-[11px] text-slate-400 font-bold tracking-normal">Месячный лимит расходов</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] text-slate-400 font-bold tracking-normal">Потрачено</p>
              <p className="text-lg font-black text-slate-800 mt-0.5">{fmt(monthlyExpense)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-slate-400 font-bold tracking-normal">Лимит</p>
              {editLimit ? (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <input
                    type="number"
                    value={limitVal}
                    onChange={e => setLimitVal(e.target.value)}
                    className="w-24 text-right text-sm font-bold border border-slate-300 focus:border-[#202124] rounded-xl px-2.5 py-1 text-slate-800 focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveLimit}
                    className="px-3 py-1 bg-slate-950 hover:bg-[#3d4048] text-white font-extrabold text-xs rounded-xl active:scale-95"
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
                backgroundColor: over ? '#F43F5E' : '#202124'
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
          <p className="text-[11px] text-slate-400 font-bold tracking-normal flex items-center gap-2">
            <Landmark className="w-3.5 h-3.5 text-slate-800" />
            Подключение банка
          </p>
          <button type="button"
            onClick={onOpenStatement || (() => setBankSyncOpen(true))}
            className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 hover:border-slate-300 flex items-center justify-between gap-3 text-left transition-all"
          >
            <span className="flex-1 min-w-0">
                <span className="text-xs font-black text-slate-800">Карты и операции</span>
                <span className="block text-[11px] text-slate-500 mt-1">Приорбанк и выписки Альфы</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-slate-500"/>
          </button>
        </div>

        {/* PWA install tips */}
        <div className="card px-4 py-4 flex flex-col gap-3">
          <p className="text-[11px] text-slate-400 font-bold tracking-normal flex items-center gap-2">
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
      <ErrorBoundary fallbackTitle="Ошибка в окне синхронизации банка" onReset={() => setBankSyncOpen(false)}>
        <BankSyncModal 
          isOpen={bankSyncOpen} 
          onClose={() => setBankSyncOpen(false)} 
        />
      </ErrorBoundary>
    </div>
  );
};

export default ProfileScreen;
