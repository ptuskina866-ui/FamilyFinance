import React, { useState, useRef, useMemo } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { AlfaBankService, AlfaTransaction, StatementMetadata } from '../services/alfaBankService';
import { DynamicIcon } from './CategoryGrid';
import { 
  X, 
  UploadCloud, 
  CheckCircle2, 
  AlertCircle, 
  RotateCw, 
  FileText, 
  Check,
  Search,
  Calendar,
  CreditCard,
  ArrowDownLeft,
  ArrowUpRight,
  Filter,
  CheckSquare,
  Square
} from 'lucide-react';

interface BankSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type StepType = 'upload' | 'preview' | 'success';
type TabFilter = 'all' | 'expense' | 'income' | 'duplicates';

export const BankSyncModal: React.FC<BankSyncModalProps> = ({ isOpen, onClose }) => {
  const { transactions = [], categories = [], members = [], addTransactionsBatch } = useApp();
  const { profile } = useAuth();

  const [step, setStep] = useState<StepType>('upload');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');

  // Statement metadata (period, card, totals)
  const [metadata, setMetadata] = useState<StatementMetadata>({});

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabFilter>('all');

  // Selected member for imported transactions
  const defaultMemberId = profile?.id || (members && members.length > 0 ? members[0]?.id : 'dad');
  const [selectedMemberId, setSelectedMemberId] = useState<string>(defaultMemberId);

  // Data states
  const [parsedList, setParsedList] = useState<AlfaTransaction[]>([]);
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // ── File Upload Handler ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg('');
    setLoading(true);
    setFileName(file.name);

    try {
      let rawTxs: AlfaTransaction[] = [];
      let meta: StatementMetadata = {};

      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        const result = await AlfaBankService.parsePdfFile(file);
        rawTxs = result.transactions || [];
        meta = result.metadata || {};
      } else {
        const text = await file.text();
        if (!text) throw new Error('Файл пуст');
        rawTxs = AlfaBankService.parseStatementFile(text);
      }

      if (!rawTxs || rawTxs.length === 0) {
        throw new Error('В выписке не найдено операций с движением средств за выбранный период.');
      }

      setMetadata(meta);

      // Проверка на дубликаты среди уже сохраненных в бюджете
      const marked = AlfaBankService.markDuplicates(rawTxs, transactions || []);
      setParsedList(marked);

      // По умолчанию выбираем только новые операции (не дубликаты)
      const nonDups = new Set(marked.filter(t => !t.isDuplicate).map(t => t.id));
      setSelectedTxIds(nonDups);

      setStep('preview');
    } catch (err: any) {
      console.error('File parsing error:', err);
      setErrorMsg(err.message || 'Ошибка обработки файла выписки');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Drag and Drop handlers ──
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const fakeEvent = {
        target: { files: e.dataTransfer.files }
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      handleFileUpload(fakeEvent);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // ── Toggle transaction selection ──
  const toggleSelectTx = (id: string) => {
    const next = new Set(selectedTxIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTxIds(next);
  };

  // ── Filtered transactions calculation ──
  const filteredList = useMemo(() => {
    return (parsedList || []).filter(tx => {
      if (!tx) return false;
      // Filter by tab
      if (activeTab === 'expense' && tx.type !== 'expense') return false;
      if (activeTab === 'income' && tx.type !== 'income') return false;
      if (activeTab === 'duplicates' && !tx.isDuplicate) return false;

      // Filter by search query
      if (searchQuery && searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchMerchant = (tx.merchant || '').toLowerCase().includes(query);
        const matchComment = (tx.comment || '').toLowerCase().includes(query);
        const matchAmount = (tx.amount ?? '').toString().includes(query);
        if (!matchMerchant && !matchComment && !matchAmount) return false;
      }

      return true;
    });
  }, [parsedList, activeTab, searchQuery]);

  // ── Select All / Deselect All for current filter ──
  const handleSelectAllFiltered = () => {
    const allFilteredSelected = filteredList.length > 0 && filteredList.every(t => selectedTxIds.has(t.id));
    const next = new Set(selectedTxIds);

    if (allFilteredSelected) {
      filteredList.forEach(t => next.delete(t.id));
    } else {
      filteredList.forEach(t => next.add(t.id));
    }
    setSelectedTxIds(next);
  };

  // ── Change category for single tx ──
  const handleChangeCategory = (txId: string, newCatId: string) => {
    setParsedList(prev => prev.map(t => t.id === txId ? { ...t, categoryId: newCatId } : t));
  };

  // ── Save selected to DB ──
  const handleSaveToDatabase = async () => {
    const itemsToSave = (parsedList || []).filter(t => selectedTxIds.has(t.id));
    if (itemsToSave.length === 0) {
      alert('Выберите хотя бы одну операцию для импорта');
      return;
    }

    setLoading(true);
    try {
      const records = itemsToSave.map(t => ({
        type: t.type,
        amount: t.amount,
        categoryId: t.categoryId,
        comment: t.merchant || t.comment || 'Импорт выписки',
        addedBy: selectedMemberId || 'dad',
        date: t.date
      }));

      await addTransactionsBatch(records);
      setStep('success');
    } catch (err: any) {
      alert('Ошибка при сохранении: ' + (err.message || 'Неизвестная ошибка'));
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    setStep('upload');
    setErrorMsg('');
    setFileName('');
    setMetadata({});
    setSearchQuery('');
    setActiveTab('all');
    setParsedList([]);
    setSelectedTxIds(new Set());
  };

  const getCategoryInfo = (catId: string) => {
    if (!categories || categories.length === 0) {
      return { id: catId, name: 'Категория', icon: 'HelpCircle', color: 'text-slate-600', bgColor: 'bg-slate-100', borderColor: 'border-slate-200' };
    }
    return categories.find(c => c.id === catId) || categories.find(c => c.id === 'food') || categories[0];
  };

  // Summary counts
  const expenseCount = (parsedList || []).filter(t => t.type === 'expense').length;
  const incomeCount = (parsedList || []).filter(t => t.type === 'income').length;
  const duplicateCount = (parsedList || []).filter(t => t.isDuplicate).length;

  // Selected totals
  const selectedSum = useMemo(() => {
    return (parsedList || [])
      .filter(t => selectedTxIds && selectedTxIds.has(t.id))
      .reduce((acc, t) => acc + (t.type === 'expense' ? t.amount : -t.amount), 0);
  }, [parsedList, selectedTxIds]);

  const areAllFilteredSelected = filteredList.length > 0 && filteredList.every(t => selectedTxIds && selectedTxIds.has(t.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/80 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] w-full max-w-xl shadow-2xl border border-slate-100 flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* ── Premium Modal Header ── */}
        <div className="px-6 py-4 border-b border-slate-100/80 flex justify-between items-center bg-gradient-to-r from-rose-50/50 via-white to-slate-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center font-black text-lg shadow-md shadow-rose-600/20">
              А
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-slate-800 tracking-tight">Альфа-Банк Выписка</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100/70 text-rose-700 font-bold">
                  InSync PDF
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Беларусь · Официальный импорт операций</p>
            </div>
          </div>
          <button 
            type="button"
            onClick={() => { resetAll(); onClose(); }}
            className="w-9 h-9 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors active:scale-95"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Modal Body ── */}
        <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col p-5 sm:p-6 gap-4 min-h-0">

          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 text-xs font-medium flex items-center gap-2.5">
              <AlertCircle size={18} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              STEP 1: UPLOAD SCREEN
          ══════════════════════════════════════════════════ */}
          {step === 'upload' && (
            <div className="flex flex-col gap-5">
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".pdf,.csv,.txt,.1c"
                className="hidden" 
              />

              {/* Drag-and-drop Card */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className="border-2 border-dashed border-rose-200 hover:border-rose-500 bg-rose-50/20 hover:bg-rose-50/40 rounded-[2rem] p-8 sm:p-10 flex flex-col items-center text-center gap-3 cursor-pointer transition-all duration-200 group shadow-sm hover:shadow-md"
              >
                <div className="w-16 h-16 rounded-2xl bg-white shadow-md border border-rose-100 text-rose-600 flex items-center justify-center group-hover:scale-105 group-hover:shadow-rose-600/10 transition-all duration-200">
                  {loading ? (
                    <RotateCw size={30} className="animate-spin text-rose-600" />
                  ) : (
                    <UploadCloud size={32} />
                  )}
                </div>

                <div className="flex flex-col gap-1 max-w-xs">
                  <span className="text-base font-black text-slate-800">
                    {loading ? 'Анализ PDF документа...' : 'Выберите или перетащите PDF выписку'}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    Поддерживаются любые периоды (месяц, квартал, год)
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2">
                  <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100 flex items-center gap-1">
                    <CheckCircle2 size={12} /> Авто-категория «Еда»
                  </span>
                  <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">
                    Анти-дубликаты
                  </span>
                  <span className="px-3 py-1 rounded-full bg-purple-50 text-purple-700 text-[10px] font-bold border border-purple-100">
                    Чистые названия
                  </span>
                </div>
              </div>

              {/* Instructions Card */}
              <div className="p-5 rounded-3xl bg-slate-50 border border-slate-100 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <FileText size={16} className="text-rose-600" />
                  <span>Как скачать выписку в приложении InSync:</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-medium text-slate-500">
                  <div className="p-2.5 rounded-2xl bg-white border border-slate-100 flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 font-bold text-slate-700 flex items-center justify-center shrink-0 text-[10px]">1</span>
                    <span>Откройте карту или счет в InSync</span>
                  </div>
                  <div className="p-2.5 rounded-2xl bg-white border border-slate-100 flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 font-bold text-slate-700 flex items-center justify-center shrink-0 text-[10px]">2</span>
                    <span>Нажмите кнопку <b>«Выписка»</b></span>
                  </div>
                  <div className="p-2.5 rounded-2xl bg-white border border-slate-100 flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 font-bold text-slate-700 flex items-center justify-center shrink-0 text-[10px]">3</span>
                    <span>Выберите желаемый период</span>
                  </div>
                  <div className="p-2.5 rounded-2xl bg-white border border-slate-100 flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 font-bold text-slate-700 flex items-center justify-center shrink-0 text-[10px]">4</span>
                    <span>Нажмите <b>«Скачать в PDF»</b></span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              STEP 2: PREVIEW & INTERACTIVE REVIEW SCREEN
          ══════════════════════════════════════════════════ */}
          {step === 'preview' && (
            <div className="flex flex-col gap-3.5">

              {/* ── Summary Card (Metadata) ── */}
              <div className="p-4 rounded-3xl bg-slate-900 text-white shadow-xl shadow-slate-900/10 flex flex-col gap-3 relative overflow-hidden shrink-0">
                <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-rose-600/20 rounded-full blur-2xl pointer-events-none" />

                {/* Period & Card Header */}
                <div className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-1.5 text-slate-300 font-medium truncate max-w-[240px]">
                    <Calendar size={13} className="text-rose-400 shrink-0" />
                    <span className="truncate">{metadata?.period || fileName || 'Период выписки'}</span>
                  </div>
                  {metadata?.card && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 text-[10px] text-slate-300 font-bold">
                      <CreditCard size={11} />
                      <span className="truncate max-w-[140px]">{metadata.card.replace(/Classic\(.*/, '')}</span>
                    </div>
                  )}
                </div>

                {/* Financial Summary Chips */}
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/10">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-medium">Расход</span>
                    <span className="text-sm font-black text-rose-400 flex items-center gap-0.5">
                      <ArrowDownLeft size={13} className="shrink-0" />
                      {metadata?.totalExpense ? metadata.totalExpense.toFixed(2) : expenseCount} Br
                    </span>
                  </div>

                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-medium">Приход</span>
                    <span className="text-sm font-black text-emerald-400 flex items-center gap-0.5">
                      <ArrowUpRight size={13} className="shrink-0" />
                      {metadata?.totalIncome ? metadata.totalIncome.toFixed(2) : incomeCount} Br
                    </span>
                  </div>

                  <div className="flex flex-col text-right">
                    <span className="text-[10px] text-slate-400 font-medium">Операций</span>
                    <span className="text-sm font-black text-white">
                      {parsedList.length} шт
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Filter Tabs & Search Bar ── */}
              <div className="flex flex-col gap-2 shrink-0">
                {/* Search input */}
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Поиск по магазину, чеку или сумме..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 rounded-2xl bg-slate-100/80 border border-slate-200/60 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-medium"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Filter Pills */}
                <div className="flex items-center justify-between gap-1 overflow-x-auto no-scrollbar py-0.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab('all')}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                        activeTab === 'all'
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Все ({parsedList.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('expense')}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                        activeTab === 'expense'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Расходы ({expenseCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('income')}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                        activeTab === 'income'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Доходы ({incomeCount})
                    </button>
                    {duplicateCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('duplicates')}
                        className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${
                          activeTab === 'duplicates'
                            ? 'bg-amber-500 text-white shadow-sm'
                            : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                        }`}
                      >
                        Дубли ({duplicateCount})
                      </button>
                    )}
                  </div>

                  {/* Select All Toggle */}
                  <button
                    type="button"
                    onClick={handleSelectAllFiltered}
                    className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
                  >
                    {areAllFilteredSelected ? (
                      <>
                        <CheckSquare size={13} className="text-rose-600" />
                        <span>Снять все</span>
                      </>
                    ) : (
                      <>
                        <Square size={13} />
                        <span>Выбрать все</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* ── Transaction List ── */}
              <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto no-scrollbar pr-1">
                {filteredList.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center text-center gap-2 text-slate-400">
                    <Filter size={28} className="opacity-40" />
                    <p className="text-xs font-medium">Нет операций по заданным критериям</p>
                  </div>
                ) : (
                  filteredList.map((tx) => {
                    const isSelected = selectedTxIds.has(tx.id);
                    const cat = getCategoryInfo(tx.categoryId);

                    return (
                      <div
                        key={tx.id}
                        onClick={() => toggleSelectTx(tx.id)}
                        className={`p-3 rounded-2xl border transition-all duration-200 flex items-center justify-between gap-3 cursor-pointer select-none group ${
                          tx.isDuplicate 
                            ? 'bg-slate-50/60 border-slate-200/60 opacity-60' 
                            : isSelected 
                              ? 'bg-white border-rose-300 shadow-sm ring-1 ring-rose-500/20' 
                              : 'bg-white border-slate-200/70 hover:border-slate-300 hover:bg-slate-50/50'
                        }`}
                      >
                        {/* Checkbox */}
                        <div
                          className={`w-6 h-6 rounded-xl flex items-center justify-center transition-all shrink-0 ${
                            isSelected 
                              ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/30 scale-100' 
                              : 'border-2 border-slate-300 bg-white group-hover:border-slate-400'
                          }`}
                        >
                          {isSelected && <Check size={14} className="stroke-[3]" />}
                        </div>

                        {/* Category Icon Badge */}
                        <div className={`w-10 h-10 rounded-2xl ${cat?.bgColor || 'bg-slate-100'} ${cat?.color || 'text-slate-600'} flex items-center justify-center shrink-0 shadow-sm border ${cat?.borderColor || 'border-slate-200'}`}>
                          <DynamicIcon name={cat?.icon || 'HelpCircle'} className="w-4 h-4" />
                        </div>

                        {/* Details */}
                        <div className="flex flex-col flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black text-slate-800 truncate" title={tx.merchant}>
                              {tx.merchant}
                            </span>
                            <span className={`text-xs font-black shrink-0 ${
                              tx.type === 'income' ? 'text-emerald-500' : 'text-slate-900'
                            }`}>
                              {tx.type === 'income' ? '+' : '-'}{tx.amount.toFixed(2)} Br
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2 mt-1">
                            <span className="text-[10px] text-slate-400 font-medium">{tx.date}</span>
                            
                            {/* Inline Category Switcher */}
                            <select
                              value={tx.categoryId}
                              onChange={(e) => handleChangeCategory(tx.id, e.target.value)}
                              className="text-[10px] font-bold bg-slate-100/90 hover:bg-slate-200/80 border border-slate-200 rounded-xl px-2 py-0.5 text-slate-700 focus:outline-none max-w-[130px] truncate cursor-pointer transition-colors"
                            >
                              {(categories || []).map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>

                          {tx.isDuplicate && (
                            <span className="text-[9px] text-amber-600 font-bold mt-1 flex items-center gap-1">
                              ⚠️ Операция уже есть в вашей истории
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* ── Sticky Bottom Action Bar ── */}
              <div className="pt-3 border-t border-slate-100 flex flex-col gap-3 shrink-0">
                {/* Member selector */}
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-bold text-slate-500">Записать расходы на:</span>
                  <div className="flex items-center gap-1">
                    {(members || []).map(m => {
                      const isMemberSelected = selectedMemberId === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedMemberId(m.id)}
                          className={`px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                            isMemberSelected
                              ? 'bg-slate-900 text-white shadow-sm scale-105'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          <span>{m.avatar}</span>
                          <span>{m.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Primary Actions */}
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={resetAll}
                    className="py-3.5 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
                  >
                    Другой файл
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveToDatabase}
                    disabled={loading || selectedTxIds.size === 0}
                    className="flex-1 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 active:scale-[0.98] text-white text-xs font-bold shadow-xl shadow-rose-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {loading ? (
                      <>
                        <RotateCw size={16} className="animate-spin" />
                        Сохранение...
                      </>
                    ) : (
                      `Импортировать ${selectedTxIds.size} операций · ${Math.abs(selectedSum).toFixed(2)} Br`
                    )}
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* ══════════════════════════════════════════════════
              STEP 3: SUCCESS STATE
          ══════════════════════════════════════════════════ */}
          {step === 'success' && (
            <div className="flex flex-col items-center text-center gap-4 py-8">
              <div className="w-20 h-20 rounded-3xl bg-emerald-50 text-emerald-500 border border-emerald-100 flex items-center justify-center shadow-xl shadow-emerald-500/10">
                <CheckCircle2 size={42} />
              </div>
              <div className="flex flex-col gap-1.5 max-w-xs">
                <h3 className="text-lg font-black text-slate-800">Выписка успешно импортирована!</h3>
                <p className="text-xs text-slate-400 font-medium leading-relaxed">
                  Все операции разнесены по категориям, сохранены в базу и обновят баланс семьи.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { resetAll(); onClose(); }}
                className="w-full py-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-md mt-2"
              >
                Вернуться к бюджету
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
