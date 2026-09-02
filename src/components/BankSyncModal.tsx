import React, { useState, useRef } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { AlfaBankService, AlfaTransaction, AlfaAccount } from '../services/alfaBankService';
import { DynamicIcon } from './CategoryGrid';
import { 
  X, 
  Smartphone, 
  UploadCloud, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  RotateCw, 
  CreditCard, 
  ShieldCheck, 
  FileText, 
  Check
} from 'lucide-react';

interface BankSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'online' | 'file';
type StepType = 'form' | 'otp' | 'preview' | 'success';

export const BankSyncModal: React.FC<BankSyncModalProps> = ({ isOpen, onClose }) => {
  const { transactions, categories, members, addTransactionsBatch } = useApp();
  const { profile } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>('online');
  const [step, setStep] = useState<StepType>('form');

  // Form states
  const [phone, setPhone] = useState('+375 (29) ');
  const [otpCode, setOtpCode] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Selected member for imported transactions
  const [selectedMemberId, setSelectedMemberId] = useState<string>(profile?.id || members[0]?.id || 'dad');

  // Data states
  const [account, setAccount] = useState<AlfaAccount | null>(null);
  const [parsedList, setParsedList] = useState<AlfaTransaction[]>([]);
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // ── Step 1: Request Login ──
  const handleRequestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      const res = await AlfaBankService.requestLogin(phone);
      if (res.success) {
        setMaskedPhone(res.maskedPhone);
        setStep('otp');
      } else {
        setErrorMsg(res.error || 'Ошибка входа в интернет-банк');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Сбой соединения');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Verify OTP ──
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      const res = await AlfaBankService.verifyOtp(otpCode, phone);
      if (res.success && res.transactions) {
        setAccount(res.account || null);
        const marked = AlfaBankService.markDuplicates(res.transactions, transactions);
        setParsedList(marked);

        // По умолчанию выбираем только не-дубликаты
        const nonDups = new Set(marked.filter(t => !t.isDuplicate).map(t => t.id));
        setSelectedTxIds(nonDups);

        setStep('preview');
      } else {
        setErrorMsg(res.error || 'Неверный код подтверждения');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Ошибка верификации');
    } finally {
      setLoading(false);
    }
  };

  // ── File Upload Handler ──
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg('');
    setLoading(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) throw new Error('Файл пуст');

        const parsed = AlfaBankService.parseStatementFile(text);
        if (parsed.length === 0) {
          setErrorMsg('Не удалось распознать операции. Проверьте формат выписки (CSV или 1C).');
          setLoading(false);
          return;
        }

        const marked = AlfaBankService.markDuplicates(parsed, transactions);
        setParsedList(marked);

        const nonDups = new Set(marked.filter(t => !t.isDuplicate).map(t => t.id));
        setSelectedTxIds(nonDups);

        setStep('preview');
      } catch (err: any) {
        setErrorMsg('Ошибка чтения файла: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    reader.readAsText(file, 'utf-8');
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
    setStep('form');
    setOtpCode('');
    setErrorMsg('');
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
              <h2 className="text-base font-black text-slate-800 tracking-tight">Альфа-Банк Беларусь</h2>
              <p className="text-[11px] text-slate-400 font-medium">Синхронизация и импорт операций</p>
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

          {/* ── Mode Tabs (only in form step) ── */}
          {step === 'form' && (
            <div className="grid grid-cols-2 p-1 bg-slate-100/80 rounded-2xl">
              <button
                type="button"
                onClick={() => { setActiveTab('online'); setErrorMsg(''); }}
                className={`py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'online' 
                    ? 'bg-white text-slate-800 shadow-sm' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Smartphone size={15} />
                Вход в интернет-банк
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('file'); setErrorMsg(''); }}
                className={`py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'file' 
                    ? 'bg-white text-slate-800 shadow-sm' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <UploadCloud size={15} />
                Файл выписки
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 text-xs font-medium flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* ── STEP 1: FORM (Online Auth or File Upload) ── */}
          {step === 'form' && activeTab === 'online' && (
            <form onSubmit={handleRequestLogin} className="flex flex-col gap-4">
              <div className="p-4 rounded-2xl bg-rose-50/60 border border-rose-100/80 flex items-start gap-3">
                <ShieldCheck size={20} className="text-rose-600 shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1 text-[11px] text-slate-600 leading-relaxed">
                  <span className="font-bold text-slate-800">Безопасный коннектор как в Дзен-мани</span>
                  После ввода номера банк отправит вам SMS с кодом подтверждения сессии для выгрузки свежих операций.
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600">Номер телефона в Альфа-Банке</label>
                <input 
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+375 (29) 000-00-00"
                  className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-sm font-bold text-slate-800 focus:outline-none focus:border-rose-500 transition-colors"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-sm font-bold shadow-lg shadow-rose-600/25 transition-all flex items-center justify-center gap-2 mt-2"
              >
                {loading ? (
                  <>
                    <RotateCw size={18} className="animate-spin" />
                    Соединение с банком...
                  </>
                ) : (
                  <>
                    Запросить код в SMS
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          )}

          {step === 'form' && activeTab === 'file' && (
            <div className="flex flex-col gap-4">
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".csv,.txt,.1c"
                className="hidden" 
              />

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 hover:border-rose-400 hover:bg-rose-50/20 rounded-3xl p-8 flex flex-col items-center text-center gap-3 cursor-pointer transition-all group"
              >
                <div className="w-14 h-14 rounded-2xl bg-slate-100 group-hover:bg-rose-100/60 text-slate-500 group-hover:text-rose-600 flex items-center justify-center transition-colors">
                  <UploadCloud size={28} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-black text-slate-800">Нажмите для выбора выписки</span>
                  <span className="text-xs text-slate-400">Форматы InSync CSV, TXT или выписка 1С</span>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center gap-2.5 text-xs text-slate-500">
                <FileText size={16} className="text-slate-400 shrink-0" />
                <span>Выписку можно скачать в приложении InSync: <b>Счет → Выписка → Сохранить файл</b></span>
              </div>
            </div>
          )}

          {/* ── STEP 2: OTP VERIFICATION ── */}
          {step === 'otp' && (
            <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4 animate-fade-in">
              <div className="text-center flex flex-col gap-1">
                <span className="text-sm font-black text-slate-800">Введите SMS-код</span>
                <span className="text-xs text-slate-400">Код подтверждения отправлен на {maskedPhone}</span>
              </div>

              <div className="flex justify-center py-2">
                <input 
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="• • • •"
                  autoFocus
                  className="w-48 text-center tracking-[0.4em] text-2xl font-black py-3 rounded-2xl bg-slate-50 border-2 border-rose-500 text-slate-800 focus:outline-none"
                />
              </div>

              <p className="text-[11px] text-center text-slate-400">
                Для демо-проверки введите любые 4–6 цифр
              </p>

              <div className="flex gap-2.5 mt-2">
                <button
                  type="button"
                  onClick={() => setStep('form')}
                  className="flex-1 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
                >
                  Назад
                </button>
                <button
                  type="submit"
                  disabled={loading || otpCode.length < 4}
                  className="flex-[2] py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-xs font-bold shadow-lg shadow-rose-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RotateCw size={16} className="animate-spin" />
                      Загрузка операций...
                    </>
                  ) : (
                    'Подтвердить и загрузить'
                  )}
                </button>
              </div>
            </form>
          )}

          {/* ── STEP 3: PREVIEW & IMPORT ── */}
          {step === 'preview' && (
            <div className="flex flex-col gap-4 animate-fade-in">
              {/* Account info badge */}
              {account && (
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white flex justify-between items-center shadow-md">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-rose-400">
                      <CreditCard size={18} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold">{account.cardName}</span>
                      <span className="text-[10px] text-slate-400">{account.maskedCard}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-black text-emerald-400">
                      {account.balance.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} {account.currency}
                    </span>
                    <span className="block text-[9px] text-slate-400">баланс счета</span>
                  </div>
                </div>
              )}

              {/* Status & Member selector */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-slate-800">Найдено: {parsedList.length}</span>
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
                  Заново
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

          {/* ── STEP 4: SUCCESS ── */}
          {step === 'success' && (
            <div className="flex flex-col items-center text-center gap-4 py-6 animate-fade-in">
              <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-500 border border-emerald-100 flex items-center justify-center shadow-lg shadow-emerald-500/10">
                <CheckCircle2 size={36} />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-black text-slate-800">Синхронизация завершена!</h3>
                <p className="text-xs text-slate-400">Все выбранные операции добавлены в семейный бюджет</p>
              </div>
              <button
                type="button"
                onClick={() => { resetAll(); onClose(); }}
                className="w-full py-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-md mt-2"
              >
                Отлично, к бюджету
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
