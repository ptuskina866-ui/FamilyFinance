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
    <div className="flex flex-col h-full bg-white overflow-y-auto no-scrollbar">
      {/* Top bar */}
      <div className="px-5 pt-7 pb-2 bg-white border-b border-slate-100/60 flex justify-between items-center shrink-0">
        <button onClick={onNavigateToLogin}
          className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100/60 flex items-center justify-center active:scale-90 transition-all">
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h1 className="text-sm font-black text-slate-800 tracking-tight">Регистрация</h1>
        <div className="w-9 h-9" /> {/* Spacer */}
      </div>

      <div className="px-5 pt-4 pb-8 flex flex-col gap-4">
        {errorMsg && (
          <div className="flex items-center gap-2 bg-rose-50 border border-rose-100/40 rounded-2xl p-3 text-xs text-rose-500">
            <AlertCircle className="w-4 h-4 shrink-0" /><span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Credentials */}
          <div className="card p-4 flex flex-col gap-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Аккаунт</p>

            <div className="flex flex-col gap-1">
              <label className="label-xs">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" required className="input-light pl-10" />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="label-xs">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="мин. 6 символов" required minLength={6} className="input-light pl-10" />
              </div>
            </div>
          </div>

          {/* Profile */}
          <div className="card p-4 flex flex-col gap-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Профиль</p>

            <div className="flex flex-col gap-1">
              <label className="label-xs">Ваше имя</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Например: Дмитрий" required className="input-light pl-10" />
              </div>
            </div>

            {/* Avatar */}
            <div className="flex flex-col gap-1.5">
              <label className="label-xs">Иконка</label>
              <div className="flex gap-2 flex-wrap">
                {AVATARS.map(av => (
                  <button key={av} type="button" onClick={() => setAvatar(av)}
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xl border-2 transition-all active:scale-90 ${avatar === av ? 'border-[#0F172A] bg-slate-50' : 'border-transparent bg-slate-100'}`}>
                    {av}
                  </button>
                ))}
              </div>
            </div>

            {/* Color */}
            <div className="flex flex-col gap-1.5">
              <label className="label-xs">Цвет</label>
              <div className="flex gap-2.5 flex-wrap">
                {COLORS.map(col => (
                  <button key={col} type="button" onClick={() => setColor(col)}
                    className={`w-8 h-8 rounded-full border-4 transition-all active:scale-90 ${color === col ? 'border-slate-800 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: col }} />
                ))}
              </div>
            </div>
          </div>

          {/* Household */}
          <div className="card p-4 flex flex-col gap-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Семейная группа</p>

            <div className="toggle-pill p-1 bg-slate-50 border border-slate-100 rounded-2xl flex">
              <button type="button" onClick={() => setHouseholdAction('create')}
                className="flex-1 py-2.5 text-xs font-bold rounded-xl transition-all"
                style={householdAction === 'create' ? { background: '#0F172A', color: '#fff', boxShadow: '0 4px 12px rgba(15,23,42,0.15)' } : { color: '#64748B' }}>
                Создать семью
              </button>
              <button type="button" onClick={() => setHouseholdAction('join')}
                className="flex-1 py-2.5 text-xs font-bold rounded-xl transition-all"
                style={householdAction === 'join' ? { background: '#0F172A', color: '#fff', boxShadow: '0 4px 12px rgba(15,23,42,0.15)' } : { color: '#64748B' }}>
                Войти по ID
              </button>
            </div>

            {householdAction === 'create' ? (
              <div className="flex flex-col gap-1">
                <label className="label-xs">Название семьи</label>
                <div className="relative">
                  <Plus className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type="text" value={householdName} onChange={e => setHouseholdName(e.target.value)} placeholder="Семья Соколовых" className="input-light pl-10" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="label-xs">Household ID</label>
                <div className="relative">
                  <Link className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type="text" value={householdId} onChange={e => setHouseholdId(e.target.value)} placeholder="Вставьте UUID" className="input-light pl-10" />
                </div>
              </div>
            )}
          </div>

          <button type="submit" disabled={loading} className="w-full py-3.5 mt-2 rounded-2xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs active:scale-95 transition-all shadow-sm disabled:opacity-50">
            {loading ? 'Регистрация...' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 font-semibold mt-1">
          Уже есть аккаунт?{' '}
          <button onClick={onNavigateToLogin} className="text-[#0F172A] font-extrabold hover:underline">Войти</button>
        </p>
      </div>
    </div>
  );
};

export default RegisterScreen;
