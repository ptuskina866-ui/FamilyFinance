import { ScreenHeader } from '../components/ScreenHeader';
import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { DynamicIcon } from '../components/CategoryGrid';
import { ChevronLeft, Check, MessageSquare, Calendar } from 'lucide-react';
import { parseMoneyInput, fromMinorUnits, toMinorUnits, localDateISO } from '../lib/money';
import type { TransactionType } from '../types';

interface AddTransactionScreenProps {
  onNavigateHome: () => void;
}

const CATEGORY_GROUPS: Record<string, string> = {
  // Еда и кафе
  'food': 'food',
  'cafes': 'food',
  'food-hippo': 'food',
  'food-euroopt': 'food',
  'food-green': 'food',
  'food-fixprice': 'food',
  'food-groshyk': 'food',
  'food-mayak': 'food',
  'food-santa': 'food',
  'food-sosedi': 'food',

  // Покупки
  'marketplaces': 'shopping',
  'clothes': 'shopping',
  'household': 'shopping',
  'beauty': 'shopping',
  'electronics': 'shopping',
  'gifts': 'shopping',

  // Транспорт
  'transport': 'transport',
  'car': 'transport',
  'scooters': 'transport',

  // Счета и связь
  'housing': 'bills',
  'utilities': 'bills',
  'water': 'bills',
  'mobile': 'bills',
  'internet': 'bills',
  'credit': 'bills',
  'taxes': 'bills',

  // Жизнь и финансы
  'medical': 'life',
  'education': 'life',
  'entertainment': 'life',
  'cash': 'life',
  'transfer': 'life',
  'savings': 'life',
  'pets': 'life',
  'other': 'life'
};

const GROUPS = [
  { id: 'all', name: 'Все' },
  { id: 'food', name: 'Еда и кафе' },
  { id: 'shopping', name: 'Покупки' },
  { id: 'transport', name: 'Транспорт' },
  { id: 'bills', name: 'Счета и связь' },
  { id: 'life', name: 'Жизнь и прочее' }
];

const QUICK_AMOUNTS = [5, 10, 20, 50, 100];

const AddTransactionScreen: React.FC<AddTransactionScreenProps> = ({ onNavigateHome }) => {
  const { categories = [], addTransaction, members = [], availableBalance = 0, accounts, accountBalances, accountsReady, schemaReady, financeLoading } = useApp();
  const { profile } = useAuth();

  const [txType, setTxType] = useState<TransactionType>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [comment, setComment] = useState('');
  const [txDate, setTxDate] = useState<string>(localDateISO());
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState('all');

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!accounts.some(a => a.id === accountId && !a.is_archived)) setAccountId(accounts.find(a => !a.is_archived)?.id || '');
  }, [accounts, accountId]);

  // Set default category and member
  useEffect(() => {
    const isIncome = txType === 'income';
    const defaultCat = categories.find(c => 
      isIncome 
        ? c.id === 'salary' || c.id.startsWith('income-') 
        : c.id === 'food' || (!c.id.startsWith('income-') && c.id !== 'salary')
    );
    if (defaultCat) {
      setSelectedCategoryId(defaultCat.id);
    }
    if (profile?.id) {
      setSelectedMemberId(profile.id);
    } else if (members.length > 0) {
      setSelectedMemberId(members[0].id);
    }
  }, [txType, categories, profile, members]);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleTypeChange = (type: TransactionType) => {
    setTxType(type);
    setSelectedGroup('all');
  };

  const handleQuickAdd = (delta: number) => {
    const current = parseMoneyInput(amountStr) || 0;
    setAmountStr(fromMinorUnits(toMinorUnits(current) + toMinorUnits(delta)).toFixed(2));
  };

  const handleSave = async () => {
    if (saving) return;
    const amount = parseMoneyInput(amountStr);
    if (amount === null || amount <= 0) return;
    if (!selectedCategoryId) return;

    setSaving(true); setError(null);
    try { await addTransaction({
      type: txType,
      amount,
      categoryId: selectedCategoryId,
      date: txDate || localDateISO(),
      comment: comment.trim(),
      addedBy: selectedMemberId || profile?.id || '',
      accountId: accountId || null
    });
    onNavigateHome();
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить операцию.'); }
    finally { setSaving(false); }
  };

  const isIncome = txType === 'income';

  // Filter categories by type (expenses vs incomes)
  const filteredCategories = categories.filter(c =>
    isIncome
      ? c.id === 'salary' || c.id.startsWith('income-')
      : !c.id.startsWith('income-') && c.id !== 'salary'
  );

  const displayCategories = filteredCategories.filter(cat => {
    if (selectedGroup === 'all') return true;
    const group = CATEGORY_GROUPS[cat.id] || 'life';
    return group === selectedGroup;
  });

  return (
    <div className="flex flex-col overflow-y-auto no-scrollbar h-full select-none">
      {/* ── Top Header ── */}
      <ScreenHeader title="Новая операция" eyebrow="Быстрая запись" actions={<button type="button" onClick={onNavigateHome} className="icon-button" aria-label="Назад к обзору"><ChevronLeft size={20}/></button>}/>

      {/* ── Scrollable Body ── */}
      <div className="screen-body flex flex-col gap-4">
        {error && <p role="alert" className="card p-3 text-xs text-rose-600">{error}</p>}
        {accountsReady && <label className="card p-3 flex flex-col gap-1 text-xs font-bold text-slate-500">Счет операции
          <select aria-label="Счет операции" value={accountId} onChange={e => setAccountId(e.target.value)} className="w-full rounded-xl bg-slate-50 p-2 text-slate-800">
            {accounts.filter(a => !a.is_archived).map(a => <option key={a.id} value={a.id}>{a.name} · {(accountBalances[a.id] || 0).toFixed(2)} Br</option>)}
          </select>
        </label>}
        {schemaReady && !accountsReady && <p className="card p-3 text-xs text-amber-800">Подключите счета на главной, затем добавьте операцию.</p>}

        {/* ── Amount Hero Section ── */}
        <div className="card p-6 flex flex-col items-center justify-center gap-2 text-center bg-white border border-white/80 shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {isIncome ? 'Поступление' : 'Сумма расхода'}
          </span>

          <div className="flex items-baseline justify-center gap-1.5 w-full">
            <input
              ref={inputRef}
              aria-label="Сумма новой операции"
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={e => {
                const val = e.target.value.replace(',', '.');
                if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
                  setAmountStr(val);
                }
              }}
              placeholder="0.00"
              className="text-5xl font-black tracking-tight text-center bg-transparent focus:outline-none w-full min-w-0 text-slate-950 placeholder:text-slate-300"
            />
            <span className="text-lg shrink-0 font-bold text-slate-500">Br</span>
          </div>

          <span className="text-[11px] font-bold text-slate-400">
            Свободно: <strong className="text-slate-700">{availableBalance.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} Br</strong>
          </span>

          {/* Quick Amount Chips */}
          <div className="flex items-center gap-1.5 mt-2 overflow-x-auto no-scrollbar w-full">
            {QUICK_AMOUNTS.map(amt => (
              <button
                key={amt}
                type="button"
                onClick={() => handleQuickAdd(amt)}
                className="px-2.5 py-2.5 shrink-0 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 active:scale-95 transition-all"
              >
                +{amt}
              </button>
            ))}
          </div>
        </div>

        {/* ── Type Selector Pills ── */}
        <div className="p-1 rounded-2xl bg-white border border-white/80 shadow-sm flex gap-1">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all duration-200 ${
              txType === 'expense' 
                ? 'bg-slate-950 text-white shadow-sm' 
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Расход
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all duration-200 ${
              txType === 'income' 
                ? 'bg-emerald-600 text-white shadow-sm' 
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Доход
          </button>
        </div>

        {/* Categories Selector */}
        <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Категория</h2>
            <span className="text-[10px] font-bold text-slate-500">
              Выбрано: {categories.find(c => c.id === selectedCategoryId)?.name || 'Не выбрано'}
            </span>
          </div>

          {/* Group Tabs (for expenses) */}
          {txType === 'expense' && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {GROUPS.map(group => {
                const active = selectedGroup === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setSelectedGroup(group.id)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold whitespace-nowrap transition-all active:scale-95 border ${
                      active
                        ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                        : 'bg-slate-50 border-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {group.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Categories Grid */}
          <div className="grid grid-cols-4 gap-y-3.5 gap-x-2 pt-1 max-h-[300px] overflow-y-auto no-scrollbar">
            {displayCategories.map(cat => {
              const active = selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className="flex flex-col items-center text-center gap-1.5 focus:outline-none active:scale-95 transition-transform"
                >
                  <div
                    className={`w-13 h-13 rounded-2xl flex items-center justify-center transition-all border ${
                      active 
                        ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-slate-900/15 scale-105' 
                        : `${cat.bgColor || 'bg-slate-50'} ${cat.color || 'text-slate-700'} border-slate-100 hover:scale-105`
                    }`}
                    style={{ width: '52px', height: '52px' }}
                  >
                    <DynamicIcon name={cat.icon || 'HelpCircle'} className="w-5 h-5" />
                  </div>
                  <span
                    className={`text-[10px] font-bold text-center leading-tight truncate w-full px-0.5 ${
                      active ? 'text-slate-900 font-extrabold' : 'text-slate-600'
                    }`}
                  >
                    {cat.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Details Card (Member, Date, Comment) */}
        <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex flex-col gap-4">
          
          {/* Member Selector */}
          {members.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Кто добавляет</span>
              <div className="flex gap-2 flex-wrap">
                {members.map(m => {
                  const active = selectedMemberId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMemberId(m.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all active:scale-95 ${
                        active 
                          ? 'border-slate-900 text-white bg-slate-900 shadow-sm' 
                          : 'border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100'
                      }`}
                    >
                      <span>{m.avatar}</span>
                      <span>{m.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Date Picker */}
          <div className="flex flex-col gap-1.5 w-full min-w-0">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Дата операции</span>
            <div className="relative flex items-center w-full min-w-0 max-w-full overflow-hidden rounded-2xl bg-slate-50 border border-slate-200 focus-within:border-slate-900 focus-within:ring-2 focus-within:ring-slate-900/10">
              <Calendar className="absolute left-3.5 w-4 h-4 text-slate-400 pointer-events-none shrink-0" />
              <input
                type="date"
                value={txDate}
                onChange={e => setTxDate(e.target.value)}
                className="w-full min-w-0 max-w-full pl-10 pr-4 py-2.5 bg-transparent text-xs font-bold text-slate-800 focus:outline-none appearance-none block"
              />
            </div>
          </div>

          {/* Comment */}
          <div className="flex flex-col gap-1.5 w-full min-w-0">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Комментарий</span>
            <div className="relative flex items-center w-full min-w-0 max-w-full overflow-hidden rounded-2xl bg-slate-50 border border-slate-200 focus-within:border-slate-900 focus-within:ring-2 focus-within:ring-slate-900/10">
              <MessageSquare className="absolute left-3.5 w-4 h-4 text-slate-400 pointer-events-none shrink-0" />
              <input
                type="text"
                value={comment}
                aria-label="Комментарий новой операции"
                onChange={e => setComment(e.target.value)}
                placeholder="Например: Продукты в Евроопте"
                className="w-full min-w-0 max-w-full pl-10 pr-4 py-2.5 bg-transparent text-xs font-medium text-slate-800 focus:outline-none block"
              />
            </div>
          </div>
        </div>

        {/* Save Button (like Send on reference screen) */}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || financeLoading || (schemaReady && !accountsReady) || !amountStr || (parseMoneyInput(amountStr) || 0) <= 0 || !selectedCategoryId}
          className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-white font-black text-sm active:scale-95 transition-all shadow-xl disabled:opacity-40 disabled:pointer-events-none ${
            isIncome 
              ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20' 
              : 'bg-slate-950 hover:bg-slate-900 shadow-slate-950/25'
          }`}
        >
          <Check className="w-5 h-5" strokeWidth={3} />
          <span>{saving ? 'Сохраняем…' : `Сохранить ${isIncome ? 'доход' : 'расход'} · ${parseMoneyInput(amountStr) || 0} Br`}</span>
        </button>

      </div>
    </div>
  );
};

export default AddTransactionScreen;
