import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { DynamicIcon } from '../components/CategoryGrid';
import { CATEGORIES } from '../mockData';
import { Target, Plus, Trash2, X, Check, RefreshCw, Calendar } from 'lucide-react';

const GOAL_EMOJIS = ['🎯', '🏖️', '🚗', '🏠', '💍', '✈️', '📱', '🎓', '💰', '🛋️', '🍔', '🎁'];

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';

const PlansScreen: React.FC = () => {
  const {
    savingsGoals,
    addGoal,
    deleteGoal,
    updateGoalAmount,
    balance,
    recurringTransactions,
    addRecurring,
    deleteRecurring,
    categories
  } = useApp();
  const { profile } = useAuth();

  // Tab: 'goals' or 'recurring'
  const [activeSubTab, setActiveSubTab] = useState<'goals' | 'recurring'>('goals');

  // Modals
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showRecForm, setShowRecForm] = useState(false);

  // Goal Form State
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalEmoji, setGoalEmoji] = useState('🎯');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [goalLoading, setGoalLoading] = useState(false);

  // Goal Add Funds State
  const [addingToGoalId, setAddingToGoalId] = useState<string | null>(null);
  const [addAmount, setAddAmount] = useState('');

  // Recurring Form State
  const [recType, setRecType] = useState<'income' | 'expense'>('expense');
  const [recAmount, setRecAmount] = useState('');
  const [recCategoryId, setRecCategoryId] = useState('food-hippo');
  const [recComment, setRecComment] = useState('');
  const [recDay, setRecDay] = useState(1);
  const [recLoading, setRecLoading] = useState(false);

  const expenseCategories = categories.filter(c => !c.id.startsWith('income-') && c.id !== 'salary' && c.id !== 'food');
  const incomeCategories = categories.filter(c => c.id.startsWith('income-') || c.id === 'salary');
  const displayCategories = recType === 'expense' ? expenseCategories : incomeCategories;

  // Handlers
  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseFloat(goalTarget);
    if (!goalName.trim() || !target || target <= 0) return;
    setGoalLoading(true);
    try {
      await addGoal({
        name: goalName.trim(),
        target_amount: target,
        emoji: goalEmoji,
        deadline: goalDeadline || null
      });
      setShowGoalForm(false);
      setGoalName('');
      setGoalTarget('');
      setGoalEmoji('🎯');
      setGoalDeadline('');
    } finally {
      setGoalLoading(false);
    }
  };

  const handleAddGoalFunds = async (goalId: string) => {
    const num = parseFloat(addAmount);
    if (!num || num <= 0) return;
    await updateGoalAmount(goalId, num);
    setAddingToGoalId(null);
    setAddAmount('');
  };

  const handleCreateRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(recAmount);
    if (!num || num <= 0 || !recCategoryId) return;
    setRecLoading(true);
    try {
      await addRecurring({
        type: recType,
        amount: num,
        category_id: recCategoryId,
        comment: recComment.trim(),
        day_of_month: recDay,
        added_by: profile?.id ?? null,
      });
      setShowRecForm(false);
      setRecAmount('');
      setRecComment('');
      setRecDay(1);
    } finally {
      setRecLoading(false);
    }
  };

  const daysUntilDeadline = (deadline: string | null) => {
    if (!deadline) return null;
    const diff = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
    if (diff < 0) return 'Срок истёк';
    if (diff === 0) return 'Сегодня!';
    return `${diff} дн.`;
  };

  const ordinalDay = (d: number) => `${d}-го числа`;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-5 pt-7 pb-2 safe-header bg-white border-b border-slate-100/60 flex justify-between items-center shrink-0">
        <div className="w-9 h-9" /> {/* Spacer */}
        <h1 className="text-sm font-black text-slate-800 tracking-tight">Планы</h1>
        <button
          onClick={() => activeSubTab === 'goals' ? setShowGoalForm(true) : setShowRecForm(true)}
          className="w-9 h-9 rounded-full bg-[#0F172A] hover:bg-[#1E293B] text-white flex items-center justify-center shadow-sm active:scale-90 transition-all"
        >
          <Plus className="w-5 h-5" strokeWidth={2.5} />
        </button>
      </div>

      {/* Pill Toggle subtabs */}
      <div className="px-5 pt-5 shrink-0">
        <div className="toggle-pill p-1 bg-slate-50 border border-slate-100 rounded-2xl flex">
          <button
            type="button"
            onClick={() => setActiveSubTab('goals')}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeSubTab === 'goals'
                ? 'bg-[#0F172A] text-white shadow-sm'
                : 'text-slate-400'
            }`}
          >
            <Target className="w-4 h-4" />
            Цели накопления
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('recurring')}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeSubTab === 'recurring'
                ? 'bg-[#0F172A] text-white shadow-sm'
                : 'text-slate-400'
            }`}
          >
            <RefreshCw className="w-4 h-4" />
            Автоплатежи
          </button>
        </div>
      </div>

      {/* Content wrapper */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-5 pb-8">
        {activeSubTab === 'goals' ? (
          /* ========================================================================= */
          /* GOALS TAB */
          /* ========================================================================= */
          <div className="flex flex-col gap-3">
            {/* Balance Hint */}
            <div className="card px-4 py-3.5 flex justify-between items-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Доступный баланс семьи</span>
              <span className={`font-black text-sm tracking-tight ${balance >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {fmt(balance)}
              </span>
            </div>

            {savingsGoals.length === 0 ? (
              <div className="card p-10 text-center flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center">
                  <Target className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-slate-400 text-xs font-semibold">Нет целей накоплений.<br />Нажмите «+», чтобы поставить первую.</p>
              </div>
            ) : (
              savingsGoals.map((goal) => {
                const percent = Math.min(100, goal.target_amount > 0 ? (goal.current_amount / goal.target_amount) * 100 : 0);
                const remaining = Math.max(0, goal.target_amount - goal.current_amount);
                const days = daysUntilDeadline(goal.deadline);
                const isCompleted = goal.is_completed || percent >= 100;

                return (
                  <div
                    key={goal.id}
                    className={`card p-5 flex flex-col gap-4 relative overflow-hidden transition-all duration-200 ${
                      isCompleted ? 'border-emerald-100 bg-emerald-50/10' : ''
                    }`}
                  >
                    {/* Header line */}
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl filter drop-shadow-sm">{goal.emoji}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-800 text-sm leading-tight tracking-tight">{goal.name}</p>
                            {isCompleted && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-100 text-emerald-700 flex items-center gap-0.5 uppercase tracking-wider">
                                <Check className="w-2.5 h-2.5" /> Готово
                              </span>
                            )}
                          </div>
                          {days && (
                            <p className={`text-[10px] mt-0.5 font-bold ${
                              days === 'Срок истёк' ? 'text-rose-500' : 'text-slate-400'
                            }`}>
                              ⏳ {days}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteGoal(goal.id)}
                        className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-rose-50 border border-slate-100/50 hover:border-rose-100 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-all active:scale-90"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Progress bar */}
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between text-[11px] font-extrabold">
                        <span className="text-slate-800">{fmt(goal.current_amount)}</span>
                        <span className="text-slate-400">из {fmt(goal.target_amount)}</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{
                            width: `${percent}%`,
                            background: isCompleted ? '#10B981' : '#0F172A',
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                        <span>{percent.toFixed(0)}% выполнено</span>
                        {!isCompleted && (
                          <span>
                            Осталось:{' '}
                            <span className="font-extrabold text-slate-700 tracking-normal normal-case ml-0.5">
                              {fmt(remaining)}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Add funds button */}
                    {!isCompleted && (
                      <button
                        onClick={() => setAddingToGoalId(goal.id)}
                        className="w-full py-2.5 bg-white hover:bg-slate-50 border border-slate-200/80 hover:border-slate-300 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition-all mt-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Пополнить копилку
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* ========================================================================= */
          /* RECURRING TAB */
          /* ========================================================================= */
          <div className="flex flex-col gap-3">
            {/* Info Banner */}
            <div className="card p-4 flex gap-3 bg-green-50/10 border-green-100">
              <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                <RefreshCw className="w-4 h-4 text-green-600 animate-spin-slow" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-700 mb-0.5">Автоматизация финансов</p>
                <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                  Регулярные платежи создаются автоматически каждый месяц в указанный день при открытии приложения.
                </p>
              </div>
            </div>

            {recurringTransactions.length === 0 ? (
              <div className="card p-10 text-center flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-slate-400 text-xs">Нет регулярных платежей.<br />Нажмите «+», чтобы создать первый.</p>
              </div>
            ) : (
              recurringTransactions.map((rec) => {
                const cat = CATEGORIES.find(c => c.id === rec.category_id);
                const isExpense = rec.type === 'expense';
                return (
                  <div key={rec.id} className="card px-4 py-3.5 flex items-center gap-3.5 group active:scale-[0.99] transition-all">
                    <div className="w-11 h-11 rounded-full bg-[#FAF2EA] flex items-center justify-center shrink-0 shadow-sm">
                      <DynamicIcon name={cat?.icon || 'RefreshCw'} className="w-5 h-5" style={{ color: '#5C4033' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-800 text-sm truncate tracking-tight">{cat?.name || 'Другое'}</p>
                      <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                        Каждый месяц, {ordinalDay(rec.day_of_month)}
                      </p>
                      {rec.comment && <p className="text-[10px] text-slate-500 truncate mt-0.5">{rec.comment}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`font-extrabold text-sm tracking-tight ${isExpense ? 'text-rose-500' : 'text-emerald-600'}`}>
                        {isExpense ? '-' : '+'}{fmt(rec.amount)}
                      </span>
                      <button
                        onClick={() => deleteRecurring(rec.id)}
                        className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-rose-50 border border-slate-100/50 hover:border-rose-100 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-all active:scale-90"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* GOAL CREATE MODAL */}
      {/* ========================================================================= */}
      {showGoalForm && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm px-4" onClick={() => setShowGoalForm(false)}>
          <div
            className="w-full max-w-[440px] bg-white rounded-t-[28px] p-5 flex flex-col gap-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] shadow-2xl transition-all"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-slate-800 text-base">Новая цель накопления</h2>
              <button onClick={() => setShowGoalForm(false)} className="w-8 h-8 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 active:scale-90">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGoal} className="flex flex-col gap-3.5">
              {/* Emoji Picker */}
              <div className="flex flex-col gap-1.5">
                <span className="label-xs text-slate-400 font-bold uppercase tracking-wider text-[9px]">Выбрать иконку</span>
                <div className="flex flex-wrap gap-2">
                  {GOAL_EMOJIS.map(em => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setGoalEmoji(em)}
                      className={`w-11 h-11 rounded-full flex items-center justify-center text-xl border transition-all active:scale-90 ${
                        goalEmoji === em ? 'border-2 border-[#0F172A] bg-[#FAF2EA] scale-105 shadow-sm' : 'border-slate-200/60 bg-white'
                      }`}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>

              {/* Goal Name */}
              <div className="flex flex-col gap-1">
                <span className="label-xs text-slate-400 font-bold uppercase tracking-wider text-[9px]">Название цели</span>
                <input
                  type="text"
                  value={goalName}
                  onChange={e => setGoalName(e.target.value)}
                  placeholder="Например: Отпуск на море"
                  required
                  className="input-light"
                />
              </div>

              {/* Target amount */}
              <div className="flex flex-col gap-1">
                <span className="label-xs text-slate-400 font-bold uppercase tracking-wider text-[9px]">Целевая сумма (Br)</span>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={goalTarget}
                  onChange={e => setGoalTarget(e.target.value)}
                  placeholder="0.00"
                  required
                  className="input-light text-base font-bold"
                />
              </div>

              {/* Deadline */}
              <div className="flex flex-col gap-1">
                <span className="label-xs text-slate-400 font-bold uppercase tracking-wider text-[9px]">Срок (необязательно)</span>
                <input
                  type="date"
                  value={goalDeadline}
                  onChange={e => setGoalDeadline(e.target.value)}
                  className="input-light"
                />
              </div>

              <button
                type="submit"
                disabled={goalLoading}
                className="w-full mt-2 py-3.5 rounded-2xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs active:scale-95 transition-all shadow-sm disabled:opacity-50"
              >
                {goalLoading ? 'Создание...' : 'Создать цель'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* RECURRING CREATE MODAL */}
      {/* ========================================================================= */}
      {showRecForm && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm px-4" onClick={() => setShowRecForm(false)}>
          <div
            className="w-full max-w-[440px] bg-white rounded-t-[28px] p-5 flex flex-col gap-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] shadow-2xl transition-all"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-slate-800 text-base">Новый автоплатеж</h2>
              <button onClick={() => setShowRecForm(false)} className="w-8 h-8 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 active:scale-90">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRecurring} className="flex flex-col gap-3.5">
              {/* Type Toggle */}
              <div className="toggle-pill p-1 bg-slate-50 border border-slate-100 rounded-2xl flex">
                <button
                  type="button"
                  onClick={() => { setRecType('expense'); setRecCategoryId('food-hippo'); }}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 ${
                    recType === 'expense' ? 'bg-[#0F172A] text-white shadow-sm' : 'text-slate-400'
                  }`}
                >
                  💸 Расход
                </button>
                <button
                  type="button"
                  onClick={() => { setRecType('income'); setRecCategoryId('salary'); }}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 ${
                    recType === 'income' ? 'bg-[#0F172A] text-white shadow-sm' : 'text-slate-400'
                  }`}
                >
                  💰 Доход
                </button>
              </div>

              {/* Amount */}
              <div className="flex flex-col gap-1">
                <span className="label-xs text-slate-400 font-bold uppercase tracking-wider text-[9px]">Сумма (Br)</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={recAmount}
                  onChange={e => setRecAmount(e.target.value)}
                  placeholder="0.00"
                  required
                  className="input-light text-base font-bold"
                />
              </div>

              {/* Day of month */}
              <div className="flex flex-col gap-1">
                <span className="label-xs text-slate-400 font-bold uppercase tracking-wider text-[9px]">День месяца (1–28)</span>
                <div className="flex items-center gap-3 bg-slate-50/50 border border-slate-100 rounded-2xl px-4 py-2">
                  <button
                    type="button"
                    onClick={() => setRecDay(Math.max(1, recDay - 1))}
                    className="w-9 h-9 rounded-xl bg-white border border-slate-200/60 text-slate-600 font-bold active:scale-90 flex items-center justify-center shadow-sm"
                  >
                    −
                  </button>
                  <span className="flex-1 text-center font-bold text-slate-800 text-sm">{recDay}</span>
                  <button
                    type="button"
                    onClick={() => setRecDay(Math.min(28, recDay + 1))}
                    className="w-9 h-9 rounded-xl bg-white border border-slate-200/60 text-slate-600 font-bold active:scale-90 flex items-center justify-center shadow-sm"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Category Picker horizontal scroll of circular beige buttons */}
              <div className="flex flex-col gap-1.5">
                <span className="label-xs text-slate-400 font-bold uppercase tracking-wider text-[9px]">Категория</span>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 pt-1">
                  {displayCategories.map(c => {
                    const active = recCategoryId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setRecCategoryId(c.id)}
                        className="flex flex-col items-center gap-1.5 focus:outline-none shrink-0 active:scale-95 transition-transform"
                      >
                        <div
                          className={`w-12 h-12 rounded-full flex items-center justify-center shadow-sm transition-all border-2 ${
                            active ? 'border-[#0F172A] scale-105 shadow-md' : 'border-transparent'
                          } bg-[#FAF2EA]`}
                        >
                          <DynamicIcon name={c.icon} className="w-4 h-4" style={{ color: '#5C4033' }} />
                        </div>
                        <span
                          className={`text-[9px] font-bold text-center leading-tight truncate w-14 ${
                            active ? 'text-slate-800' : 'text-slate-400'
                          }`}
                        >
                          {c.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Comment */}
              <div className="flex flex-col gap-1">
                <span className="label-xs text-slate-400 font-bold uppercase tracking-wider text-[9px]">Комментарий (необязательно)</span>
                <input
                  type="text"
                  value={recComment}
                  onChange={e => setRecComment(e.target.value)}
                  placeholder="Например: Аренда квартиры или интернет"
                  className="input-light"
                />
              </div>

              <button
                type="submit"
                disabled={recLoading}
                className="w-full mt-2 py-3.5 rounded-2xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs active:scale-95 transition-all shadow-sm disabled:opacity-50"
              >
                {recLoading ? 'Сохранение...' : 'Создать регулярный платеж'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* GOAL FUNDS ADD MODAL */}
      {/* ========================================================================= */}
      {addingToGoalId && (() => {
        const goal = savingsGoals.find(g => g.id === addingToGoalId);
        if (!goal) return null;
        return (
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm px-4" onClick={() => { setAddingToGoalId(null); setAddAmount(''); }}>
            <div
              className="w-full max-w-[440px] bg-white rounded-t-[28px] p-5 flex flex-col gap-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] shadow-2xl transition-all"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center">
                <h2 className="font-bold text-slate-800 text-base">Пополнить копилку</h2>
                <button onClick={() => { setAddingToGoalId(null); setAddAmount(''); }} className="w-8 h-8 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 active:scale-90">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Goal summary */}
              <div className="flex items-center gap-3 bg-slate-50/50 border border-slate-100/60 p-3.5 rounded-2xl">
                <span className="text-3xl">{goal.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 text-sm truncate">{goal.name}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Накоплено: <strong className="text-slate-600 font-extrabold">{fmt(goal.current_amount)}</strong> из {fmt(goal.target_amount)}
                  </p>
                </div>
              </div>

              {/* Amount input */}
              <div className="flex flex-col gap-1">
                <span className="label-xs text-slate-400 font-bold uppercase tracking-wider text-[9px]">Сумма пополнения (Br)</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={addAmount}
                  onChange={e => setAddAmount(e.target.value)}
                  placeholder="0.00"
                  required
                  className="input-light text-base font-bold"
                  autoFocus
                />
              </div>

              <button
                onClick={async () => {
                  await handleAddGoalFunds(goal.id);
                  setAddingToGoalId(null);
                  setAddAmount('');
                }}
                className="w-full mt-2 py-3.5 rounded-2xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs active:scale-95 transition-all shadow-sm"
              >
                Пополнить копилку
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default PlansScreen;
