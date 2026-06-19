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
    <div className="flex flex-col h-full bg-[#F0F4F8] overflow-y-auto no-scrollbar">
      {/* Green top banner */}
      <div className="px-6 pt-14 pb-10 text-center relative overflow-hidden"
        style={{ background: 'linear-gradient(145deg,#16A34A 0%,#22C55E 60%,#4ADE80 100%)' }}>
        <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full bg-white/10 pointer-events-none" />
        <div className="w-16 h-16 rounded-3xl bg-white/20 flex items-center justify-center text-4xl mx-auto mb-4 relative z-10">
          👛
        </div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight relative z-10">Семейный Бюджет</h1>
        <p className="text-green-100 text-sm mt-2 relative z-10">Совместный учёт финансов семьи в реальном времени</p>
      </div>

      {/* Login form */}
      <div className="px-5 pt-6 pb-8 flex flex-col gap-4">
        <div className="card p-5 flex flex-col gap-4">
          <h2 className="text-lg font-bold text-slate-800">Вход в аккаунт</h2>

          {errorMsg && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-2xl p-3 text-xs text-red-500">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="label-xs">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" required
                  className="input-light pl-10" />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="label-xs">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required
                  className="input-light pl-10" />
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 mt-2">
              {loading ? 'Вход...' : <><LogIn className="w-4 h-4" /> Войти</>}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-500">
          Нет аккаунта?{' '}
          <button onClick={onNavigateToRegister} className="text-green-600 font-semibold hover:text-green-700">
            Зарегистрироваться
          </button>
        </p>
      </div>
    </div>
  );
};

export default LoginScreen;
