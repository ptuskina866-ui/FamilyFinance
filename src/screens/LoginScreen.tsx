import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { Mail, Lock, LogIn, AlertCircle } from 'lucide-react';

interface LoginScreenProps { onNavigateToRegister: () => void; }

const LoginScreen: React.FC<LoginScreenProps> = ({ onNavigateToRegister }) => {
  const { signIn } = useAuth();
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setErrorMsg('Заполните все поля.'); return; }
    try {
      setErrorMsg(null); setLoading(true);
      await signIn(email, password);
    } catch (err: any) {
      setErrorMsg(err.message || 'Неверный email или пароль.');
    } finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto no-scrollbar select-none">
      {/* Premium Minimal Header */}
      <div 
        className="px-6 pb-6 text-center flex flex-col items-center shrink-0"
        style={{ paddingTop: 'max(36px, calc(env(safe-area-inset-top, 0px) + 24px))' }}
      >
        <div className="w-16 h-16 rounded-3xl bg-slate-950 text-white flex items-center justify-center text-3xl shadow-xl shadow-slate-950/20 mb-3.5 active:scale-95 transition-transform">
          👛
        </div>
        <h1 className="text-2xl font-black text-slate-950 tracking-tight">Семейный Бюджет</h1>
        <p className="text-slate-500 text-xs mt-1 max-w-[260px] mx-auto font-medium leading-relaxed">
          Совместный учёт финансов семьи в реальном времени
        </p>
      </div>

      {/* Login form */}
      <div className="px-5 pb-12 flex flex-col gap-4 max-w-md mx-auto w-full">
        <div className="card p-6 flex flex-col gap-4 shadow-[0_12px_40px_rgba(10,35,15,0.05)]">
          <h2 className="text-sm font-black text-slate-900 tracking-tight">Вход в аккаунт</h2>

          {errorMsg && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-100/80 rounded-2xl p-3 text-xs text-rose-600 font-bold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
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
                  placeholder="••••••••" 
                  required
                  className="w-full pl-10 pr-4 py-3 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/90 text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950/10 transition-all shadow-sm" 
                />
              </div>
            </div>

            <button 
              type="submit" 
              disabled={loading} 
              className="w-full flex items-center justify-center gap-2 mt-2 py-3.5 rounded-full bg-slate-950 hover:bg-slate-900 active:scale-[0.98] text-white font-black text-xs transition-all shadow-xl shadow-slate-950/20 disabled:opacity-50"
            >
              {loading ? 'Вход...' : <><LogIn className="w-4 h-4" /> Войти</>}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 font-bold mt-2">
          Нет аккаунта?{' '}
          <button onClick={onNavigateToRegister} className="text-slate-950 font-black hover:underline ml-0.5">
            Зарегистрироваться
          </button>
        </p>
      </div>
    </div>
  );
};

export default LoginScreen;
