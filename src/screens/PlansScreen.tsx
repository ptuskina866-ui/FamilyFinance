import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { DynamicIcon } from '../components/CategoryGrid';
import { CATEGORIES } from '../mockData';
import { CarGoalForecastCard } from '../components/CarGoalForecastCard';
import { BudgetPlanner } from '../components/BudgetPlanner';
import { FundsPlanner } from '../components/FundsPlanner';
import { Target, Plus, Trash2, Archive, X, Check, RefreshCw, Calendar, ArrowUpRight } from 'lucide-react';
import { goalMonthlyNeeded } from '../lib/finance';
import { localDateISO, parseMoneyInput, sumMoney } from '../lib/money';

const GOAL_EMOJIS = ['🎯', '🏖️', '🚗', '🏠', '💍', '✈️', '📱', '🎓', '💰', '🛋️', '🍔', '🎁'];

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Br';

const PlansScreen: React.FC = () => {
  const {
    savingsGoals,
    addGoal,
    deleteGoal,
    updateGoalAmount,
    withdrawGoalAmount,
    availableBalance,
    reservedBalance,
    accountsReady,
    financeLoading,
    transactions,
    recurringTransactions,
    addRecurring,
    deleteRecurring,
    categories
  } = useApp();
  const { profile } = useAuth();

  // Tab: 'goals' or 'recurring'
  const [activeSubTab, setActiveSubTab] = useState<'goals' | 'recurring' | 'budget' | 'funds'>('goals');

  // Modals
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showRecForm, setShowRecForm] = useState(false);

  // Goal Form State
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalEmoji, setGoalEmoji] = useState('🎯');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [goalLoading, setGoalLoading] = useState(false);
  const [goalError, setGoalError] = useState('');

  // Goal Add Funds State
  const [addingToGoalId, setAddingToGoalId] = useState<string | null>(null);
  const [addAmount, setAddAmount] = useState('');
  const [fundMode, setFundMode] = useState<'deposit' | 'release'>('deposit');
  const [fundsLoading, setFundsLoading] = useState(false);
  const [fundsError, setFundsError] = useState('');
  const [archivingGoalId, setArchivingGoalId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const fundsSubmitting = useRef(false);
  const actionSubmitting = useRef(false);
  const goalSubmitting = useRef(false);
  const recSubmitting = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Recurring Form State
  const [recType, setRecType] = useState<'income' | 'expense'>('expense');
  const [recAmount, setRecAmount] = useState('');
  const [recCategoryId, setRecCategoryId] = useState('food-hippo');
  const [recComment, setRecComment] = useState('');
  const [recDay, setRecDay] = useState(1);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState('');

  const activeGoals = savingsGoals.filter(goal => !goal.is_archived && (!goal.purpose || goal.purpose==='goal'));
  const modalOpen = showGoalForm || showRecForm || !!addingToGoalId || !!archivingGoalId;
  const modalPending = goalLoading || recLoading || fundsLoading || !!actionLoadingId;
  useEffect(() => {
    if (!modalOpen) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalRef.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !goalSubmitting.current && !recSubmitting.current && !fundsSubmitting.current && !actionSubmitting.current) {
        setShowGoalForm(false); setShowRecForm(false); setAddingToGoalId(null); setArchivingGoalId(null);
      }
      if (event.key !== 'Tab') return;
      const controls = modalRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), select:not(:disabled)');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previousFocus.current?.focus(); };
  }, [modalOpen]);

  const openGoalFunds = (goalId: string, mode: 'deposit' | 'release') => {
    setFundMode(mode); setAddingToGoalId(goalId); setAddAmount(''); setFundsError('');
  };

  const closeModal = () => {
    if (modalPending || goalSubmitting.current || recSubmitting.current || fundsSubmitting.current || actionSubmitting.current) return;
    setShowGoalForm(false); setShowRecForm(false); setAddingToGoalId(null); setArchivingGoalId(null);
  };

  const expenseCategories = categories.filter(c => !c.id.startsWith('income-') && c.id !== 'salary' && c.id !== 'food');
  const incomeCategories = categories.filter(c => c.id.startsWith('income-') || c.id === 'salary');
  const displayCategories = recType === 'expense' ? expenseCategories : incomeCategories;

  // Handlers
  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (goalSubmitting.current) return;
    const target = parseMoneyInput(goalTarget);
    setGoalError('');
    if (!goalName.trim() || target === null || target <= 0) { setGoalError('Введите название и положительную сумму с точностью до копейки.'); return; }
    if (goalDeadline && goalDeadline < localDateISO()) { setGoalError('Выберите сегодняшний или будущий срок.'); return; }
    goalSubmitting.current = true;
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
    } catch (cause) {
      setGoalError(cause instanceof Error ? cause.message : 'Не удалось создать цель.');
    } finally {
      goalSubmitting.current = false;
      setGoalLoading(false);
    }
  };

  const handleAddGoalFunds = async (goalId: string) => {
    if (fundsSubmitting.current) return;
    const num = parseMoneyInput(addAmount);
    const goal = savingsGoals.find(item => item.id === goalId);
    setFundsError('');
    if (num === null || num <= 0) { setFundsError('Введите положительную сумму с точностью до копейки.'); return; }
    if (!goal || !accountsReady) { setFundsError('Сначала настройте счета на главной странице.'); return; }
    if (fundMode === 'deposit' && num > availableBalance) { setFundsError('Сумма превышает свободный остаток.'); return; }
    if (fundMode === 'release' && num > goal.current_amount) { setFundsError('Нельзя освободить больше, чем отложено на цель.'); return; }
    fundsSubmitting.current = true; setFundsLoading(true);
    try {
      if (fundMode === 'deposit') await updateGoalAmount(goalId, num);
      else await withdrawGoalAmount(goalId, num);
      setAddingToGoalId(null); setAddAmount('');
    } catch (cause) { setFundsError(cause instanceof Error ? cause.message : 'Не удалось сохранить.'); }
    finally { fundsSubmitting.current = false; setFundsLoading(false); }
  };

  const handleCreateRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recSubmitting.current) return;
    const num = parseMoneyInput(recAmount);
    setRecError('');
    if (num === null || num <= 0 || !recCategoryId) { setRecError('Введите положительную сумму с точностью до копейки и выберите категорию.'); return; }
    recSubmitting.current = true;
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
    } catch (cause) { setRecError(cause instanceof Error ? cause.message : 'Не удалось создать регулярный платеж.');
    } finally {
      recSubmitting.current = false;
      setRecLoading(false);
    }
  };

  const daysUntilDeadline = (deadline: string | null) => {
    if (!deadline) return null;
    const diff = Math.round((new Date(`${deadline}T12:00:00`).getTime() - new Date(`${localDateISO()}T12:00:00`).getTime()) / 86400000);
    if (diff < 0) return 'Срок истёк';
    if (diff === 0) return 'Сегодня!';
    return `${diff} дн.`;
  };

  const ordinalDay = (d: number) => `${d}-го числа`;

  const handleArchiveGoal = async () => {
    if (!archivingGoalId || actionSubmitting.current) return;
    actionSubmitting.current = true; setActionLoadingId(archivingGoalId); setActionError('');
    try { await deleteGoal(archivingGoalId); setArchivingGoalId(null); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Не удалось архивировать цель.'); }
    finally { actionSubmitting.current = false; setActionLoadingId(null); }
  };

  const handleDeleteRecurring = async (id: string) => {
    if (actionSubmitting.current) return;
    actionSubmitting.current = true; setActionLoadingId(id); setActionError('');
    try { await deleteRecurring(id); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Не удалось удалить регулярный платеж.'); }
    finally { actionSubmitting.current = false; setActionLoadingId(null); }
  };

  return (
    <div className="flex flex-col h-full select-none">
      {/* Header */}
      <div 
        className="px-5 pb-3 safe-header bg-[#E5F3E8]/95 backdrop-blur-md sticky top-0 z-30 flex justify-between items-center shrink-0"
        style={{ paddingTop: 'max(28px, calc(env(safe-area-inset-top, 0px) + 16px))' }}
      >
        <div className="w-9 h-9" /> {/* Spacer */}
        <h1 className="text-sm font-black text-slate-900 tracking-tight">Планы</h1>
        {(activeSubTab === 'goals' || activeSubTab === 'recurring') ? <button
          onClick={() => { if (activeSubTab === 'goals') { setGoalError(''); setShowGoalForm(true); } else { setRecError(''); setShowRecForm(true); } }}
          aria-label={activeSubTab === 'goals' ? 'Создать цель накопления' : 'Создать регулярный платеж'}
          disabled={financeLoading || !!actionLoadingId}
          className="w-9 h-9 rounded-full bg-slate-950 text-white flex items-center justify-center shadow-sm active:scale-90 transition-all"
        >
          <Plus className="w-5 h-5" strokeWidth={2.5} />
        </button> : <div className="w-9 h-9" />}
      </div>

      {/* Pill Toggle subtabs */}
      <div className="px-5 pt-5 shrink-0">
        <div className="toggle-pill p-1 bg-slate-50 border border-slate-100 rounded-2xl flex gap-1">
          {([{id:'goals',name:'Цели'},{id:'recurring',name:'Платежи'},{id:'budget',name:'Бюджет'},{id:'funds',name:'Фонды'}] as const).map(tab=><button key={tab.id} type="button" onClick={()=>setActiveSubTab(tab.id)} className={`flex-1 min-w-0 py-2.5 text-[11px] font-bold rounded-xl transition-all ${activeSubTab===tab.id?'bg-[#0F172A] text-white shadow-sm':'text-slate-400'}`}>{tab.name}</button>)}
        </div>
      </div>

      {/* Content wrapper */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-3 pb-36">
        {actionError && !archivingGoalId && <p role="alert" className="rounded-2xl bg-rose-50 p-3 mb-3 text-xs text-rose-700 break-words">{actionError}</p>}
        {activeSubTab === 'funds' ? <FundsPlanner /> : activeSubTab === 'budget' ? <BudgetPlanner /> : activeSubTab === 'goals' ? (
          /* ========================================================================= */
          /* GOALS TAB */
          /* ========================================================================= */
          <div className="flex flex-col gap-3">
            {/* Balance Hint */}
            <div className="card px-4 py-3.5 flex flex-col gap-2.5">
              <div className="flex justify-between items-center gap-2">
                <span className="text-[10px] text-slate-500 font-bold">Свободно после резервов</span>
                <span className={`font-black text-sm tracking-tight ${availableBalance >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(availableBalance)}</span>
              </div>
              <div className="flex justify-between items-center gap-2 text-[11px] text-slate-500"><span>Отложено на цели</span><strong className="text-slate-700">{fmt(reservedBalance)}</strong></div>
              <p className="text-[11px] text-slate-500 leading-relaxed">Деньги на цель остаются на ваших счетах. Резерв уменьшает свободный остаток и не считается расходом.</p>
              {!accountsReady && <p className="text-[11px] text-slate-600 font-semibold">Чтобы откладывать и освобождать деньги, настройте счета на главной странице.</p>}
            </div>

            {/* Car Smart Forecast Card */}
            <CarGoalForecastCard
              goals={activeGoals}
              transactions={transactions}
              onQuickAddGoal={() => { setGoalError(''); setShowGoalForm(true); }}
              onSelectGoal={(g) => {
                openGoalFunds(g.id, 'deposit');
              }}
            />

            {activeGoals.length === 0 ? (
              <div className="card p-10 text-center flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center">
                  <Target className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-slate-400 text-xs font-semibold">Нет целей накоплений.<br />Нажмите «+», чтобы поставить первую.</p>
              </div>
            ) : (
              activeGoals.map((goal) => {
                const percent = Math.min(100, goal.target_amount > 0 ? (goal.current_amount / goal.target_amount) * 100 : 0);
                const remaining = Math.max(0, sumMoney([goal.target_amount, -goal.current_amount]));
                const days = daysUntilDeadline(goal.deadline);
                const isCompleted = goal.is_completed || percent >= 100;
                const monthlyNeeded = goalMonthlyNeeded(goal);
                const history = transactions.filter(tx => tx.goalId === goal.id || tx.comment.includes(`[goal_id:${goal.id}]`));

                return (
                  <div
                    key={goal.id}
                    className={`card p-5 flex flex-col gap-4 relative overflow-hidden transition-all duration-200 ${
                      isCompleted ? 'border-emerald-100 bg-emerald-50/10' : ''
                    }`}
                  >
                    {/* Header line */}
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-3xl filter drop-shadow-sm">{goal.emoji}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-slate-800 text-sm leading-tight tracking-tight break-words">{goal.name}</p>
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
                        onClick={() => { setArchivingGoalId(goal.id); setActionError(''); }}
                        disabled={!!actionLoadingId || financeLoading || !accountsReady}
                        aria-label={`Архивировать цель ${goal.name}`}
                        className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-rose-50 border border-slate-100/50 hover:border-rose-100 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-all active:scale-90"
                      >
                        <Archive className="w-3.5 h-3.5" />
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

                    {monthlyNeeded !== null && !isCompleted && <p className="text-[11px] text-slate-500">До выбранного срока: <strong className="text-slate-700">{fmt(monthlyNeeded)} в месяц</strong></p>}
                    <div className="flex flex-col gap-2">
                    {!isCompleted && (
                      <button
                        onClick={() => openGoalFunds(goal.id, 'deposit')}
                        disabled={!accountsReady || financeLoading || availableBalance <= 0}
                        className="w-full py-2.5 bg-white hover:bg-slate-50 border border-slate-200/80 hover:border-slate-300 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Отложить на цель
                      </button>
                    )}
                    {goal.current_amount > 0 && <button type="button" onClick={() => openGoalFunds(goal.id, 'release')} disabled={!accountsReady || financeLoading} className="w-full py-2 text-xs text-slate-500 font-bold flex items-center justify-center gap-1.5 disabled:opacity-40"><ArrowUpRight className="w-3.5 h-3.5" />Вернуть в свободный остаток</button>}
                    </div>
                    <details className="border-t border-slate-100 pt-3 text-[11px]">
                      <summary className="font-bold text-slate-500 cursor-pointer">История резерва · {history.length}</summary>
                      {history.length > 0 ? <div className="flex flex-col gap-2 mt-3 max-h-44 overflow-y-auto">
                        {history.map(tx => {
                          const isDeposit = tx.kind === 'goal_deposit';
                          const isRelease = tx.kind === 'goal_release';
                          const label = isDeposit ? 'Отложено' : isRelease ? 'Освобождено' : tx.type === 'expense' ? 'Ранее записано как расход' : 'Ранее записано как доход';
                          const sign = isDeposit || (!isRelease && tx.type === 'income') ? '+' : '−';
                          return <div key={tx.id} className="flex justify-between items-center gap-3"><span className="text-slate-500">{new Date(`${tx.date}T12:00:00`).toLocaleDateString('ru-RU')} · {label}</span><span className={`font-bold shrink-0 ${isDeposit ? 'text-emerald-700' : 'text-slate-700'}`}>{sign}{fmt(tx.amount)}</span></div>;
                        })}
                      </div> : <p className="text-slate-400 mt-2">Новых записей пока нет. Ранее накопленная сумма сохранена.</p>}
                    </details>
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
                        onClick={() => handleDeleteRecurring(rec.id)}
                        disabled={!!actionLoadingId}
                        aria-label={`Удалить регулярный платеж ${cat?.name || rec.comment}`}
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
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm px-3 pt-4" onClick={closeModal}>
          <div
            ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="goal-form-heading"
            className="w-full max-w-[440px] max-h-[85dvh] overflow-y-auto bg-white rounded-t-[28px] p-5 flex flex-col gap-4 pb-[max(24px,env(safe-area-inset-bottom))] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h2 id="goal-form-heading" className="font-bold text-slate-800 text-base">Новая цель накопления</h2>
              <button onClick={closeModal} disabled={goalLoading} aria-label="Закрыть создание цели" className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500 shrink-0 active:scale-90">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGoal} className="flex flex-col gap-3.5">
              <fieldset disabled={goalLoading} className="flex flex-col gap-3.5 min-w-0">
              {/* Emoji Picker */}
              <div className="flex flex-col gap-1.5">
                <span className="label-xs text-slate-400 font-bold uppercase tracking-wider text-[9px]">Выбрать иконку</span>
                <div className="flex flex-wrap gap-2">
                  {GOAL_EMOJIS.map(em => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setGoalEmoji(em)}
                      aria-label={`Иконка цели ${em}`}
                      aria-pressed={goalEmoji === em}
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
                  aria-label="Название цели"
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
                  inputMode="decimal"
                  aria-label="Целевая сумма в белорусских рублях"
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
                  aria-label="Срок накопления"
                  min={localDateISO()}
                  value={goalDeadline}
                  onChange={e => setGoalDeadline(e.target.value)}
                  className="input-light"
                />
              </div>

              {goalError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700 break-words">{goalError}</p>}
              <button
                type="submit"
                disabled={goalLoading}
                className="w-full mt-2 py-3.5 rounded-2xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs active:scale-95 transition-all shadow-sm disabled:opacity-50"
              >
                {goalLoading ? 'Создание...' : 'Создать цель'}
              </button>
              </fieldset>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* RECURRING CREATE MODAL */}
      {/* ========================================================================= */}
      {showRecForm && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm px-3 pt-4" onClick={closeModal}>
          <div
            ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="rec-form-heading"
            className="w-full max-w-[440px] max-h-[85dvh] overflow-y-auto bg-white rounded-t-[28px] p-5 flex flex-col gap-4 pb-[max(24px,env(safe-area-inset-bottom))] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h2 id="rec-form-heading" className="font-bold text-slate-800 text-base">Новый автоплатеж</h2>
              <button onClick={closeModal} disabled={recLoading} aria-label="Закрыть создание регулярного платежа" className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500 shrink-0 active:scale-90">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRecurring} className="flex flex-col gap-3.5">
              <fieldset disabled={recLoading} className="flex flex-col gap-3.5 min-w-0">
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
                  inputMode="decimal"
                  aria-label="Сумма регулярного платежа в белорусских рублях"
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
                    aria-label="Уменьшить день месяца"
                    className="w-9 h-9 rounded-xl bg-white border border-slate-200/60 text-slate-600 font-bold active:scale-90 flex items-center justify-center shadow-sm"
                  >
                    −
                  </button>
                  <span className="flex-1 text-center font-bold text-slate-800 text-sm">{recDay}</span>
                  <button
                    type="button"
                    onClick={() => setRecDay(Math.min(28, recDay + 1))}
                    aria-label="Увеличить день месяца"
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
                        aria-pressed={active}
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
                  aria-label="Комментарий регулярного платежа"
                  value={recComment}
                  onChange={e => setRecComment(e.target.value)}
                  placeholder="Например: Аренда квартиры или интернет"
                  className="input-light"
                />
              </div>

              {recError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700 break-words">{recError}</p>}
              <button
                type="submit"
                disabled={recLoading}
                className="w-full mt-2 py-3.5 rounded-2xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs active:scale-95 transition-all shadow-sm disabled:opacity-50"
              >
                {recLoading ? 'Сохранение...' : 'Создать регулярный платеж'}
              </button>
              </fieldset>
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
          <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm px-3 pt-4" onClick={closeModal}>
            <div
              ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="funds-heading"
              className="w-full max-w-[440px] max-h-[85dvh] overflow-y-auto bg-white rounded-t-[28px] p-5 flex flex-col gap-4 pb-[max(24px,env(safe-area-inset-bottom))] shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center">
                <h2 id="funds-heading" className="font-bold text-slate-800 text-base">{fundMode === 'deposit' ? 'Отложить на цель' : 'Освободить резерв'}</h2>
                <button onClick={closeModal} disabled={fundsLoading} aria-label="Закрыть окно резерва" className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500 shrink-0 active:scale-90">
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

              <p className="text-[11px] text-slate-500 leading-relaxed">{fundMode === 'deposit' ? `Свободно: ${fmt(availableBalance)}. Деньги остаются на счетах; эта сумма будет зарезервирована для цели.` : `Можно освободить до ${fmt(goal.current_amount)}. Сумма вернётся в свободный остаток без нового дохода.`}</p>
              <form onSubmit={event => { event.preventDefault(); void handleAddGoalFunds(goal.id); }} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-slate-500 font-bold">
                Сумма (Br)
                <input
                  inputMode="decimal"
                  value={addAmount}
                  onChange={e => setAddAmount(e.target.value)}
                  placeholder="0.00"
                  required
                  disabled={fundsLoading}
                  className="input-light text-base font-bold"
                  autoFocus
                />
              </label>
              {fundsError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700 break-words">{fundsError}</p>}

              <button
                type="submit"
                disabled={fundsLoading || !accountsReady || financeLoading}
                className="w-full mt-2 py-3.5 rounded-2xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs active:scale-95 transition-all shadow-sm disabled:opacity-40"
              >
                {fundsLoading ? 'Сохранение…' : fundMode === 'deposit' ? 'Зарезервировать сумму' : 'Вернуть в свободный остаток'}
              </button>
              </form>
            </div>
          </div>
        );
      })()}
      {archivingGoalId && (() => {
        const goal = savingsGoals.find(item => item.id === archivingGoalId);
        if (!goal) return null;
        return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm px-3 pt-4" onClick={closeModal}>
          <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="archive-heading" className="w-full max-w-[440px] max-h-[85dvh] overflow-y-auto bg-white rounded-t-[28px] p-5 pb-[max(24px,env(safe-area-inset-bottom))] shadow-2xl flex flex-col gap-4" onClick={event => event.stopPropagation()}>
            <div className="flex justify-between items-center gap-3"><h2 id="archive-heading" className="text-base font-bold text-slate-800">Архивировать цель</h2><button type="button" onClick={closeModal} disabled={!!actionLoadingId} aria-label="Закрыть архивирование цели" className="w-9 h-9 rounded-full bg-slate-50 flex items-center justify-center shrink-0"><X className="w-4 h-4" /></button></div>
            <p className="text-sm text-slate-700 break-words">{goal.emoji} {goal.name}</p>
            <p className="text-xs text-slate-500 leading-relaxed">Цель исчезнет из активного списка, история операций сохранится. Резерв {fmt(goal.current_amount)} вернётся в свободный остаток. Это не доход и не банковский перевод.</p>
            {actionError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700 break-words">{actionError}</p>}
            <button type="button" onClick={handleArchiveGoal} disabled={!!actionLoadingId} className="w-full py-3.5 rounded-2xl bg-slate-950 text-white text-xs font-bold disabled:opacity-40">{actionLoadingId ? 'Сохранение…' : 'Архивировать и освободить резерв'}</button>
          </div>
        </div>;
      })()}
    </div>
  );
};

export default PlansScreen;
