import React, { lazy, Suspense, useState } from 'react';
import { AppProvider, useApp } from './AppContext';
import { AuthProvider, useAuth } from './AuthContext';
import Layout from './components/Layout';
import BottomNav from './components/BottomNav';
import HomeScreen from './screens/HomeScreen';
import AddTransactionScreen from './screens/AddTransactionScreen';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import { ErrorBoundary } from './components/ErrorBoundary';

const AnalyticsScreen = lazy(() => import('./screens/AnalyticsScreen'));
const ProfileScreen = lazy(() => import('./screens/ProfileScreen'));
const PlansScreen = lazy(() => import('./screens/PlansScreen'));
const BankStatementScreen = lazy(() => import('./screens/BankStatementScreen').then(module => ({ default: module.BankStatementScreen })));
const screenLoading = <p className="m-auto p-4 text-sm text-slate-500" role="status">Открываем раздел…</p>;

export type TabType = 'home' | 'add' | 'analytics' | 'plans' | 'profile';

export const AppContent: React.FC<{ notice?: React.ReactNode }> = ({ notice }) => {
  const { user, profile, loading, refreshProfile } = useAuth();
  const { financeError, plansError, refreshFinance } = useApp();
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [showStatement, setShowStatement] = useState(false);

  if (loading) {
    return (
      <Layout>
        {notice}
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin"></div>
          <span className="text-xs text-slate-500 tracking-wider uppercase font-semibold">Загрузка...</span>
        </div>
      </Layout>
    );
  }

  if (!user) {
    return (
      <Layout>
        {notice}
        <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
          {authView === 'login' ? (
            <LoginScreen onNavigateToRegister={() => setAuthView('register')} />
          ) : (
            <RegisterScreen onNavigateToLogin={() => setAuthView('login')} />
          )}
        </div>
      </Layout>
    );
  }

  if (!profile?.household_id) {
    return <Layout>
      {notice}
      <div className="m-auto p-5 flex flex-col gap-4">
        <p role="alert">Не удалось открыть профиль семьи.</p>
        <button type="button" className="auth-button" onClick={() => void refreshProfile()}>Повторить загрузку профиля</button>
      </div>
    </Layout>;
  }

  const dataNotice = (financeError || plansError) && refreshFinance ? (
    <div className="mx-4 mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 flex flex-wrap gap-2 items-center">
      <span role="status" className="flex-1 min-w-0">{financeError || plansError}</span>
      <button type="button" className="font-bold py-2" onClick={refreshFinance}>Обновить</button>
    </div>
  ) : null;

  // Full-screen dedicated Bank Statement import page
  if (showStatement) {
    return (
      <Layout>
        {notice}
        {dataNotice}
        <Suspense fallback={screenLoading}><BankStatementScreen onBack={() => setShowStatement(false)} /></Suspense>
      </Layout>
    );
  }

  const renderScreen = () => {
    switch (activeTab) {
      case 'home':      return <HomeScreen onOpenStatement={() => setShowStatement(true)} onNavigateTab={(t) => setActiveTab(t as TabType)} />;
      case 'add':       return <AddTransactionScreen onNavigateHome={() => setActiveTab('home')} />;
      case 'analytics': return <AnalyticsScreen />;
      case 'plans':     return <PlansScreen />;
      case 'profile':   return <ProfileScreen onOpenStatement={() => setShowStatement(true)} />;
      default:          return <HomeScreen onOpenStatement={() => setShowStatement(true)} onNavigateTab={(t) => setActiveTab(t as TabType)} />;
    }
  };

  return (
    <Layout>
      {notice}
      {dataNotice}
      <div className="flex-1 flex flex-col min-h-0 relative">
        <Suspense fallback={screenLoading}>{renderScreen()}</Suspense>
      </div>
      <BottomNav activeTab={activeTab} onChangeTab={setActiveTab} />
    </Layout>
  );
};

const DemoApp = import.meta.env.DEV ? lazy(() => import('./demo/DemoApp')) : null;

const App: React.FC = () => {
  if (DemoApp && new URLSearchParams(window.location.search).get('demo') === '1') {
    return <ErrorBoundary><Suspense fallback={<Layout><p className="m-auto text-xs text-slate-500">Загрузка демо…</p></Layout>}><DemoApp /></Suspense></ErrorBoundary>;
  }
  return (
  <ErrorBoundary>
    <AuthProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </AuthProvider>
  </ErrorBoundary>
  );
};

export default App;
