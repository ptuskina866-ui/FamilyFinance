import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { TransactionType } from '../types';
import { MessageSquare, Check, ChevronLeft } from 'lucide-react';
import { CATEGORIES } from '../mockData';
import { DynamicIcon } from '../components/CategoryGrid';

interface AddTransactionScreenProps {
  onNavigateHome: () => void;
}

const AddTransactionScreen: React.FC<AddTransactionScreenProps> = ({ onNavigateHome }) => {
  const { members, addTransaction } = useApp();
  const { profile } = useAuth();

  const [txType, setTxType] = useState<TransactionType>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('food');
  const [selectedMemberId, setSelectedMemberId] = useState(profile?.id || '');
  const [comment, setComment] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedMemberId && profile?.id) setSelectedMemberId(profile.id);
    else if (!selectedMemberId && members.length > 0) setSelectedMemberId(members[0].id);
    
    // Autofocus amount field on mount
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }, [profile?.id, members, selectedMemberId]);

  const isIncome = txType === 'income';
  const filteredCategories = CATEGORIES.filter(c =>
    isIncome ? c.id === 'salary' || c.id === 'income-other' : c.id !== 'salary' && c.id !== 'income-other'
  );

  const handleTypeChange = (type: TransactionType) => {
    setTxType(type);
    setSelectedCategoryId(type === 'income' ? 'salary' : 'food');
  };

  const handleSave = () => {
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      alert('Введите сумму больше нуля');
      return;
    }
    addTransaction({
      type: txType,
      amount,
      categoryId: selectedCategoryId,
      date: new Date().toISOString().split('T')[0],
      comment: comment.trim(),
      addedBy: selectedMemberId
    });
    onNavigateHome();
  };

  const accentColor = isIncome ? '#22C55E' : '#F43F5E';
  const accentBg    = isIncome ? '#F0FDF4' : '#FFF1F2';

  return (
    <div className="flex flex-col h-full bg-[#F0F4F8]">
      {/* Header - Seamless blend with background */}
      <div className="px-4 pt-12 pb-3 flex items-center gap-3">
        <button
          onClick={onNavigateHome}
          className="w-9 h-9 rounded-full bg-white border border-slate-200/60 flex items-center justify-center active:scale-90 transition-all shadow-sm"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h1 className="text-lg font-bold text-slate-800">Новая операция</h1>
      </div>

      {/* Form content */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 flex flex-col gap-4 pb-6">
        {/* Type toggle */}
        <div className="toggle-pill">
          {(['expense', 'income'] as TransactionType[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => handleTypeChange(t)}
              className="flex-1 py-2.5 text-xs font-bold rounded-[10px] transition-all duration-200"
              style={txType === t ? { background: accentColor, color: '#fff', boxShadow: `0 3px 10px ${accentColor}30` } : { color: '#64748B' }}
            >
              {t === 'expense' ? '💸 Расход' : '💰 Доход'}
            </button>
          ))}
        </div>

        {/* Amount display / Input */}
        <div className="rounded-2xl flex flex-col items-center py-4 px-4 shadow-sm border border-slate-100/60" style={{ background: accentBg }}>
          <span className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: accentColor }}>Сумма операции</span>
          <div className="flex items-baseline justify-center gap-1.5 w-full">
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={e => {
                const val = e.target.value.replace(',', '.');
                // Allow only decimal numbers with up to 2 decimal places
                if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
                  setAmountStr(val);
                }
              }}
              placeholder="0.00"
              className="text-4xl font-extrabold tracking-tight text-center bg-transparent focus:outline-none w-44 border-b-2 border-dashed focus:border-solid transition-all"
              style={{
                color: accentColor,
                borderColor: `${accentColor}30`
              }}
            />
            <span className="text-lg font-bold text-slate-400">Br</span>
          </div>
        </div>

        {/* Categories */}
        <div className="flex flex-col gap-2">
          <p className="label-xs">Категория</p>
          <div className="grid grid-cols-4 gap-2">
            {filteredCategories.map(cat => {
              const active = selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-2xl transition-all active:scale-95 shadow-sm"
                  style={{
                    background: active ? `${cat.accentColor}12` : '#FFFFFF',
                    border: active ? `2px solid ${cat.accentColor}` : '1px solid rgba(226, 232, 240, 0.8)',
                  }}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${cat.accentColor}15` }}>
                    <DynamicIcon name={cat.icon} className="w-5 h-5" style={{ color: cat.accentColor }} />
                  </div>
                  <span className="text-[10px] font-bold text-center leading-tight" style={{ color: active ? cat.accentColor : '#64748B' }}>
                    {cat.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Member selector */}
        {members.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="label-xs">Кто добавляет</p>
            <div className="flex gap-2 flex-wrap">
              {members.map(m => {
                const active = selectedMemberId === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMemberId(m.id)}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-bold border transition-all active:scale-95 shadow-sm"
                    style={active
                      ? { background: `${m.color}12`, border: `2px solid ${m.color}`, color: m.color }
                      : { background: '#fff', border: '1px solid rgba(226, 232, 240, 0.8)', color: '#64748B' }}
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
        <div className="flex flex-col gap-2">
          <p className="label-xs">Комментарий</p>
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

        {/* Save Button */}
        <button
          onClick={handleSave}
          className="btn-primary w-full flex items-center justify-center gap-2 mt-4"
          style={{ background: accentColor, boxShadow: `0 6px 20px ${accentColor}30` }}
        >
          <Check className="w-5 h-5" strokeWidth={3} />
          <span>Сохранить операцию</span>
        </button>
      </div>
    </div>
  );
};

export default AddTransactionScreen;
