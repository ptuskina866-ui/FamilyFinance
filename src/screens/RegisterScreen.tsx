import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { User, Mail, Lock, Plus, Link, AlertCircle, ChevronLeft } from 'lucide-react';

interface RegisterScreenProps { onNavigateToLogin: () => void; }

const AVATARS = ['👨', '👩', '👦', '👧', '🧑', '👴', '👵', '👤'];
const COLORS  = ['#3B82F6', '#EC4899', '#22C55E', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4'];

const RegisterScreen: React.FC<RegisterScreenProps> = ({ onNavigateToLogin }) => {
  const { signUp } = useAuth();
  const [name,    setName]    = useState('');
  const [email,   setEmail]   = useState('');
  const [password, setPassword] = useState('');
  const [avatar,  setAvatar]  = useState('👤');
  const [color,   setColor]   = useState('#22C55E');
  const [householdAction, setHouseholdAction] = useState<'create'|'join'>('create');
  const [householdName,   setHouseholdName]   = useState('');
  const [householdId,     setHouseholdId]     = useState('');
  const [errorMsg, setErrorMsg] = useState<string|null>(null);
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) { setErrorMsg('Заполните все обязательные поля.'); return; }
    if (householdAction === 'create' && !householdName) { setErrorMsg('Укажите название семьи.'); return; }
    if (householdAction === 'join'   && !householdId)   { setErrorMsg('Укажите Household ID.'); return; }
    try {
      setErrorMsg(null); setLoading(true);
      const target = householdAction === 'create' ? householdName.trim() : householdId.trim();
      await signUp(email, password, name.trim(), avatar, color, householdAction, target);
    } catch (err: any) {
      setErrorMsg(err.message || 'Ошибка регистрации.');
    } finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto no-scrollbar select-none">
      {/* Top bar with safe-area */}
      <div 
        className="px-5 pb-3 safe-header bg-[#E5F3E8]/95 backdrop-blur-md sticky top-0 z-30 flex justify-between items-center shrink-0"
        style={{ paddingTop: 'max(28px, calc(env(safe-area-inset-top, 0px) + 16px))' }}
      >
        <button 
          type="button"
          onClick={onNavigateToLogin}
          className="w-10 h-10 rounded-full bg-white border border-white/80 shadow-sm flex items-center justify-center text-slate-800 active:scale-90 transition-all"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-black text-slate-900 tracking-tight">Регистрация</h1>
        <div className="w-10 h-10" /> {/* Spacer */}
      </div>

      <div className="px-5 pt-3 pb-12 flex flex-col gap-4 max-w-md mx-auto w-full">
        {errorMsg && (
          <div className="flex items-center gap-2 bg-rose-50 border border-rose-100/80 rounded-2xl p-3 text-xs text-rose-600 font-bold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Credentials - Liquid Glass */}
          <div className="card p-5 flex flex-col gap-3.5 shadow-[0_8px_32px_rgba(10,35,15,0.04)]">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Данные аккаунта</p>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  placeholder="email@example.com" 
                  required 
                  className="w-full pl-10 pr-4 py-3 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/90 text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950/10 transition-all shadow-sm" 
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="password" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  placeholder="минимум 6 символов" 
                  required 
                  minLength={6} 
                  className="w-full pl-10 pr-4 py-3 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/90 text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950/10 transition-all shadow-sm" 
                />
              </div>
            </div>
          </div>

          {/* Profile - Liquid Glass */}
          <div className="card p-5 flex flex-col gap-3.5 shadow-[0_8px_32px_rgba(10,35,15,0.04)]">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ваш профиль</p>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ваше имя</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  placeholder="Например: Дмитрий" 
                  required 
                  className="w-full pl-10 pr-4 py-3 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/90 text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950/10 transition-all shadow-sm" 
                />
              </div>
            </div>

            {/* Avatar */}
            <div className="flex flex-col gap-1.5 pt-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Иконка аватара</label>
              <div className="flex gap-2 flex-wrap">
                {AVATARS.map(av => (
                  <button 
                    key={av} 
                    type="button" 
                    onClick={() => setAvatar(av)}
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center text-xl transition-all active:scale-90 ${
                      avatar === av 
                        ? 'bg-slate-950 text-white shadow-md scale-105 ring-2 ring-slate-950/20' 
                        : 'bg-white/80 border border-white/90 shadow-sm hover:bg-white'
                    }`}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>

            {/* Color */}
            <div className="flex flex-col gap-1.5 pt-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Фирменный цвет</label>
              <div className="flex gap-2.5 flex-wrap items-center">
                {COLORS.map(col => (
                  <button 
                    key={col} 
                    type="button" 
                    onClick={() => setColor(col)}
                    className={`w-8 h-8 rounded-full border-2 transition-all active:scale-90 ${
                      color === col ? 'border-slate-950 ring-2 ring-slate-950/20 scale-110 shadow-md' : 'border-white/80 shadow-sm'
                    }`}
                    style={{ backgroundColor: col }} 
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Household - Liquid Glass */}
          <div className="card p-5 flex flex-col gap-3.5 shadow-[0_8px_32px_rgba(10,35,15,0.04)]">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Семейная группа</p>

            <div className="p-1 bg-white/75 backdrop-blur-xl border border-white/90 rounded-2xl flex shadow-sm">
              <button 
                type="button" 
                onClick={() => setHouseholdAction('create')}
                className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all ${
                  householdAction === 'create' 
                    ? 'bg-slate-950 text-white shadow-sm' 
                    : 'text-slate-500 hover:text-slate-900 font-bold'
                }`}
              >
                Создать семью
              </button>
              <button 
                type="button" 
                onClick={() => setHouseholdAction('join')}
                className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all ${
                  householdAction === 'join' 
                    ? 'bg-slate-950 text-white shadow-sm' 
                    : 'text-slate-500 hover:text-slate-900 font-bold'
                }`}
              >
                Войти по ID
              </button>
            </div>

            {householdAction === 'create' ? (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Название семьи</label>
                <div className="relative">
                  <Plus className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text" 
                    value={householdName} 
                    onChange={e => setHouseholdName(e.target.value)} 
                    placeholder="Семья Соколовых" 
                    className="w-full pl-10 pr-4 py-3 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/90 text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950/10 transition-all shadow-sm" 
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Household ID</label>
                <div className="relative">
                  <Link className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text" 
                    value={householdId} 
                    onChange={e => setHouseholdId(e.target.value)} 
                    placeholder="Вставьте UUID код" 
                    className="w-full pl-10 pr-4 py-3 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/90 text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950/10 transition-all shadow-sm" 
                  />
                </div>
              </div>
            )}
          </div>

          <button 
            type="submit" 
            disabled={loading} 
            className="w-full py-4 mt-2 rounded-full bg-slate-950 hover:bg-slate-900 active:scale-[0.98] text-white font-black text-xs shadow-xl shadow-slate-950/25 transition-all disabled:opacity-50"
          >
            {loading ? 'Регистрация...' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500 font-bold mt-2 pb-4">
          Уже есть аккаунт?{' '}
          <button onClick={onNavigateToLogin} className="text-slate-950 font-black hover:underline ml-0.5">
            Войти
          </button>
        </p>
      </div>
    </div>
  );
};

export default RegisterScreen;
