import React, { useState, useRef } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { AlfaBankService, AlfaTransaction } from '../services/alfaBankService';
import { DynamicIcon } from './CategoryGrid';
import { 
  X, 
  UploadCloud, 
  CheckCircle2, 
  AlertCircle, 
  RotateCw, 
  FileText, 
  Check
} from 'lucide-react';

interface BankSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type StepType = 'upload' | 'preview' | 'success';

export const BankSyncModal: React.FC<BankSyncModalProps> = ({ isOpen, onClose }) => {
  const { transactions, categories, members, addTransactionsBatch } = useApp();
  const { profile } = useAuth();

  const [step, setStep] = useState<StepType>('upload');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');

  // Selected member for imported transactions
  const [selectedMemberId, setSelectedMemberId] = useState<string>(profile?.id || members[0]?.id || 'dad');

  // Data states
  const [parsedList, setParsedList] = useState<AlfaTransaction[]>([]);
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // ── File Upload Handler (PDF, CSV, TXT, 1C) ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg('');
    setLoading(true);
    setFileName(file.name);

    try {
      let parsed: AlfaTransaction[] = [];

      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        // Парсинг официального PDF документа
        parsed = await AlfaBankService.parsePdfFile(file);
      } else {
        // Парсинг текстовых выписок (CSV / TXT / 1C)
        const text = await file.text();
        if (!text) throw new Error('Файл пуст');
        parsed = AlfaBankService.parseStatementFile(text);
      }

      if (parsed.length === 0) {
        throw new Error('В файле не найдено строк с операциями. Убедитесь, что это выписка за период с движениями средств.');
      }

      // Проверка на дубликаты
      const marked = AlfaBankService.markDuplicates(parsed, transactions);
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
      // Сбрасываем input, чтобы можно было выбрать тот же файл повторно
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

  // ── Change category for single tx ──
  const handleChangeCategory = (txId: string, newCatId: string) => {
    setParsedList(prev => prev.map(t => t.id === txId ? { ...t, categoryId: newCatId } : t));
  };

  // ── Save selected to DB ──
  const handleSaveToDatabase = async () => {
    const itemsToSave = parsedList.filter(t => selectedTxIds.has(t.id));
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
        comment: t.merchant || t.comment,
        addedBy: selectedMemberId,
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
    setParsedList([]);
    setSelectedTxIds(new Set());
  };

  const getCategoryInfo = (catId: string) => {
    return categories.find(c => c.id === catId) || categories[0];
  };

  const duplicateCount = parsedList.filter(t => t.isDuplicate).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* ── Modal Header ── */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600 font-black text-base shadow-sm">
              А
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800 tracking-tight">Импорт выписки Альфа-Банка</h2>
              <p className="text-[11px] text-slate-400 font-medium">Беларусь · InSync PDF / CSV</p>
            </div>
          </div>
          <button 
            onClick={() => { resetAll(); onClose(); }}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Modal Body ── */}
        <div className="p-6 overflow-y-auto no-scrollbar flex flex-col gap-5">

          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 text-xs font-medium flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* ── STEP 1: UPLOAD ── */}
          {step === 'upload' && (
            <div className="flex flex-col gap-4">
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".pdf,.csv,.txt,.1c"
                className="hidden" 
              />

              <div 
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className="border-2 border-dashed border-rose-200 hover:border-rose-500 bg-rose-50/20 hover:bg-rose-50/40 rounded-3xl p-8 flex flex-col items-center text-center gap-3 cursor-pointer transition-all group"
              >
                <div className="w-16 h-16 rounded-2xl bg-white shadow-sm border border-rose-100 text-rose-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  {loading ? (
                    <RotateCw size={28} className="animate-spin text-rose-600" />
                  ) : (
                    <UploadCloud size={32} />
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-sm font-black text-slate-800">
                    {loading ? 'Чтение PDF выписки...' : 'Перетащите PDF выписку сюда'}
                  </span>
                  <span className="text-xs text-slate-500">
                    или нажмите для выбора файла на телефоне/компьютере
                  </span>
                </div>

                <div className="flex items-center gap-1.5 px-3 py-1 bg-rose-100/60 rounded-full text-rose-700 text-[10px] font-bold mt-1">
                  <span>📄 Поддерживается официальный PDF из InSync</span>
                </div>
              </div>

              {/* Tips for InSync */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <FileText size={15} className="text-slate-500" />
                  <span>Как скачать выписку в приложении InSync:</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-[11px] font-medium text-slate-500">
                  <li>Откройте карту или счет в приложении <b>InSync</b></li>
                  <li>Нажмите <b>«Выписка»</b></li>
                  <li>Выберите период (например, <b>«За месяц»</b>)</li>
                  <li>Нажмите <b>«Сформировать / Скачать в PDF»</b></li>
                </ol>
              </div>
            </div>
          )}

          {/* ── STEP 2: PREVIEW & CONFIRM ── */}
          {step === 'preview' && (
            <div className="flex flex-col gap-4 animate-fade-in">
              {/* File Info badge */}
              <div className="p-3 rounded-2xl bg-slate-100 flex justify-between items-center text-xs">
                <div className="flex items-center gap-2 truncate">
                  <FileText size={16} className="text-rose-600 shrink-0" />
                  <span className="font-bold text-slate-800 truncate">{fileName || 'Выписка Альфа-Банка'}</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 font-bold shrink-0">
                  {parsedList.length} операций
                </span>
              </div>

              {/* Status & Member selector */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-slate-800">К импорту: {selectedTxIds.size}</span>
                  {duplicateCount > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">
                      {duplicateCount} дублей скрыто
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 font-bold">Для кого:</span>
                  <select
                    value={selectedMemberId}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                    className="text-xs font-bold bg-slate-100 rounded-xl px-2.5 py-1 border border-slate-200 text-slate-700 focus:outline-none"
                  >
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Transactions List */}
              <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto no-scrollbar pr-1">
                {parsedList.map((tx) => {
                  const isSelected = selectedTxIds.has(tx.id);
                  const cat = getCategoryInfo(tx.categoryId);

                  return (
                    <div
                      key={tx.id}
                      className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                        tx.isDuplicate 
                          ? 'bg-slate-50/50 border-slate-100 opacity-60' 
                          : isSelected 
                            ? 'bg-white border-rose-200 shadow-sm ring-1 ring-rose-500/20' 
                            : 'bg-white border-slate-100'
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        type="button"
                        onClick={() => toggleSelectTx(tx.id)}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                          isSelected ? 'bg-rose-500 text-white' : 'border border-slate-300 bg-white'
                        }`}
                      >
                        {isSelected && <Check size={14} className="stroke-[3]" />}
                      </button>

                      {/* Details */}
                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-black text-slate-800 truncate">{tx.merchant}</span>
                          <span className={`text-xs font-black shrink-0 ${tx.type === 'income' ? 'text-emerald-500' : 'text-slate-800'}`}>
                            {tx.type === 'income' ? '+' : '-'}{tx.amount.toFixed(2)} Br
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2 mt-1">
                          <span className="text-[10px] text-slate-400">{tx.date}</span>
                          
                          {/* Inline Category Switcher */}
                          <div className="flex items-center gap-1">
                            <div className={`w-4 h-4 rounded-md ${cat.bgColor} ${cat.color} flex items-center justify-center shrink-0`}>
                              <DynamicIcon name={cat.icon} className="w-2.5 h-2.5" />
                            </div>
                            <select
                              value={tx.categoryId}
                              onChange={(e) => handleChangeCategory(tx.id, e.target.value)}
                              className="text-[10px] font-bold bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-0.5 text-slate-600 focus:outline-none max-w-[120px] truncate"
                            >
                              {categories.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {tx.isDuplicate && (
                          <span className="text-[9px] text-amber-600 font-bold mt-1">
                            ⚠️ Похожая операция уже есть в истории
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={resetAll}
                  className="py-3 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
                >
                  Другой файл
                </button>
                <button
                  type="button"
                  onClick={handleSaveToDatabase}
                  disabled={loading || selectedTxIds.size === 0}
                  className="flex-1 py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-xs font-bold shadow-lg shadow-rose-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RotateCw size={16} className="animate-spin" />
                      Сохранение...
                    </>
                  ) : (
                    `Импортировать ${selectedTxIds.size} операций`
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: SUCCESS ── */}
          {step === 'success' && (
            <div className="flex flex-col items-center text-center gap-4 py-6 animate-fade-in">
              <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-500 border border-emerald-100 flex items-center justify-center shadow-lg shadow-emerald-500/10">
                <CheckCircle2 size={36} />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-black text-slate-800">Выписка успешно загружена!</h3>
                <p className="text-xs text-slate-400">Все операции добавлены в бюджет и обновят графики</p>
              </div>
              <button
                type="button"
                onClick={() => { resetAll(); onClose(); }}
                className="w-full py-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-md mt-2"
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
