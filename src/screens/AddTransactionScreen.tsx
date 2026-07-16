import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { DynamicIcon } from '../components/CategoryGrid';
import { ChevronLeft, Check, MessageSquare } from 'lucide-react';

interface AddTransactionScreenProps {
  onNavigateHome: () => void;
}

type TransactionType = 'expense' | 'income';

const CATEGORY_GROUPS: Record<string, string> = {
  // Продукты
  'food': 'products',
  'food-hippo': 'products',
  'food-euroopt': 'products',
  'food-green': 'products',
  'food-fixprice': 'products',
  'food-groshyk': 'products',
  'food-mayak': 'products',
  'food-santa': 'products',
  // Жилье и счета
  'housing': 'bills',
  'utilities': 'bills',
  'water': 'bills',
  'mobile': 'bills',
  'internet': 'bills',
  'credit': 'bills',
  'taxes': 'bills',
  // Транспорт
  'car': 'transport',
  'scooters': 'transport',
  'transport': 'transport',
};

const GROUPS = [
  { id: 'all', name: 'Все' },
  { id: 'products', name: 'Продукты' },
  { id: 'bills', name: 'Жилье и счета' },
  { id: 'transport', name: 'Транспорт' },
  { id: 'life', name: 'Жизнь и досуг' }
];

const AddTransactionScreen: React.FC<AddTransactionScreenProps> = ({ onNavigateHome }) => {
  const { categories, addTransaction, members } = useApp();
  const { profile } = useAuth();

  const [txType, setTxType] = useState<TransactionType>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [comment, setComment] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');

  const inputRef = useRef<HTMLInputElement>(null);

  // Set default category and member
  useEffect(() => {
    const isIncome = txType === 'income';
    const firstCat = categories.find(c => 
      isIncome 
        ? c.id === 'salary' || c.id.startsWith('income-') 
        : !c.id.startsWith('income-') && c.id !== 'salary' && c.id !== 'food'
    );
    if (firstCat) {
      setSelectedCategoryId(firstCat.id);
    }
    if (profile) {
      setSelectedMemberId(profile.id);
    }
  }, [txType, categories, profile]);

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

  const handleSave = async () => {
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) return;
    if (!selectedCategoryId) return;

    await addTransaction({
      type: txType,
      amount,
      categoryId: selectedCategoryId,
      date: new Date().toISOString().split('T')[0],
      comment: comment.trim(),
      addedBy: selectedMemberId
    });
    onNavigateHome();
  };

  const isIncome = txType === 'income';

  // Filter categories
  const filteredCategories = categories.filter(c =>
    isIncome
      ? c.id === 'salary' || c.id.startsWith('income-')
      : !c.id.startsWith('income-') && c.id !== 'salary' && c.id !== 'food'
  );

  const displayCategories = filteredCategories.filter(cat => {
    if (selectedGroup === 'all') return true;
    const group = CATEGORY_GROUPS[cat.id] || 'life';
    return group === selectedGroup;
  });

  return (
    <div className="flex flex-col h-full bg-[#FFFFFF] overflow-y-auto no-scrollbar pb-24">
      {/* ── Header ── */}
      <div className="px-5 pt-7 pb-2 safe-header flex justify-between items-center bg-white border-b border-slate-100/60 sticky top-0 z-30">
        <button
          onClick={onNavigateHome}
          className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 active:scale-95 transition-transform"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-black text-slate-800 tracking-tight">Новая операция</h1>
        <div className="w-9 h-9" /> {/* Spacer */}
      </div>

      {/* ── Scrollable Form content ── */}
      <div className="px-5 pt-5 flex flex-col gap-6">
        {/* Type toggle */}
        <div className="toggle-pill p-1 bg-slate-50 border border-slate-100 rounded-2xl flex">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 ${
              txType === 'expense' ? 'bg-[#0F172A] text-white shadow-sm' : 'text-slate-400'
            }`}
          >
            💸 Расход
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 ${
              txType === 'income' ? 'bg-[#0F172A] text-white shadow-sm' : 'text-slate-400'
            }`}
          >
            💰 Доход
          </button>
        </div>

        {/* Amount Box */}
        <div className="card py-5 px-4 flex flex-col items-center">
          <span className="text-[9px] font-bold uppercase tracking-wider mb-2 text-slate-400">Сумма операции</span>
          <div className="flex items-baseline justify-center gap-1.5 w-full">
            <input
              ref={inputRef}
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
              className="text-5xl font-black tracking-tight text-center bg-transparent focus:outline-none w-48 border-b-2 border-dashed focus:border-solid transition-all text-slate-800 border-slate-200 focus:border-[#0F172A]"
            />
            <span className="text-xl font-extrabold text-slate-400">Br</span>
          </div>
        </div>

        {/* Categories selector matching mockup */}
        <div className="flex flex-col gap-3">
          <h2 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Категория</h2>

          {/* Group Tabs - Show only for expenses, as incomes have very few categories */}
          {txType === 'expense' && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5">
              {GROUPS.map(group => {
                const active = selectedGroup === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setSelectedGroup(group.id)}
                    className={`px-3.5 py-1.5 rounded-full text-[10px] font-extrabold whitespace-nowrap transition-all active:scale-95 border ${
                      active
                        ? 'bg-[#0F172A] border-[#0F172A] text-white shadow-sm'
                        : 'bg-[#FAF2EA] border-transparent text-[#5C4033] hover:text-[#3E2A20]'
                    }`}
                  >
                    {group.name}
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-4 gap-y-4 gap-x-2">
            {displayCategories.map(cat => {
              const active = selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className="flex flex-col items-center text-center gap-1.5 focus:outline-none active:scale-95 transition-transform"
                >
                  {/* Circle icon with black border when active */}
                  <div
                    className={`w-14 h-14 rounded-full flex items-center justify-center shadow-sm transition-all border-2 ${
                      active ? 'border-[#0F172A] scale-105 shadow-md' : 'border-transparent'
                    } bg-[#FAF2EA]`}
                  >
                    <DynamicIcon name={cat.icon} className="w-5 h-5" style={{ color: '#5C4033' }} />
                  </div>
                  <span
                    className={`text-[10px] font-bold text-center leading-tight truncate w-full px-0.5 ${
                      active ? 'text-slate-800' : 'text-slate-500'
                    }`}
                  >
                    {cat.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Member selector */}
        {members.length > 0 && (
          <div className="flex flex-col gap-3">
            <h2 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Кто добавляет</h2>
            <div className="flex gap-2 flex-wrap">
              {members.map(m => {
                const active = selectedMemberId === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMemberId(m.id)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-bold border transition-all active:scale-95 shadow-sm ${
                      active ? 'border-[#0F172A] text-slate-800 bg-slate-50/50' : 'border-slate-100 text-slate-400 bg-white'
                    }`}
                  >
                    <span className="text-sm">{m.avatar}</span>
                    <span>{m.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Comment */}
        <div className="flex flex-col gap-3">
          <h2 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Комментарий</h2>
          <div className="relative">
            <MessageSquare className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Например: Продукты в Евроопте"
              className="input-light pl-10"
            />
          </div>
        </div>

        {/* Save Button in Black */}
        <button
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-2 mt-4 py-3.5 rounded-2xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs active:scale-95 transition-all shadow-sm disabled:opacity-50"
        >
          <Check className="w-5 h-5" strokeWidth={3} />
          <span>Сохранить операцию</span>
        </button>
      </div>
    </div>
  );
};

export default AddTransactionScreen;
