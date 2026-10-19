import { BrandMark } from '../components/ScreenHeader';
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
      <header className="auth-intro">
        <div className="flex items-center gap-3"><BrandMark/><span className="brand-name">FinApp</span></div>
        <h1 className="auth-title">Деньги под контролем.<br/><span className="text-slate-500">Планы — ближе.</span></h1>
        <p className="auth-copy">Счета, расходы и накопления вашей семьи. Всё в одном спокойном пространстве.</p>
      </header>
      {/* Login form */}
      <div className="px-5 pb-10 flex flex-col gap-4 w-full">
        <div className="card p-6 flex flex-col gap-5">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Вход в аккаунт</h2>

          {errorMsg && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-100/80 rounded-2xl p-3 text-xs text-rose-600 font-bold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1">
              <label htmlFor="login-email" className="text-xs font-medium text-slate-600">Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="login-email" autoComplete="email" type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  required
                  className="input-light pl-10"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="login-password" className="text-xs font-medium text-slate-600">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="login-password" autoComplete="current-password" type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="input-light pl-10"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="auth-button mt-2"
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
