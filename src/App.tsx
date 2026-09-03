import React, { useState } from 'react';
import { AppProvider } from './AppContext';
import { AuthProvider, useAuth } from './AuthContext';
import Layout from './components/Layout';
import BottomNav from './components/BottomNav';
import HomeScreen from './screens/HomeScreen';
import AddTransactionScreen from './screens/AddTransactionScreen';
import AnalyticsScreen from './screens/AnalyticsScreen';
import ProfileScreen from './screens/ProfileScreen';
import PlansScreen from './screens/PlansScreen';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import { BankStatementScreen } from './screens/BankStatementScreen';
import { ErrorBoundary } from './components/ErrorBoundary';

export type TabType = 'home' | 'add' | 'analytics' | 'plans' | 'profile';

const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [showStatement, setShowStatement] = useState(false);

  if (loading) {
    return (
      <Layout>
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

  // Full-screen dedicated Bank Statement import page
  if (showStatement) {
    return (
      <Layout>
        <BankStatementScreen onBack={() => setShowStatement(false)} />
      </Layout>
    );
  }

  const renderScreen = () => {
    switch (activeTab) {
      case 'home':      return <HomeScreen onOpenStatement={() => setShowStatement(true)} />;
      case 'add':       return <AddTransactionScreen onNavigateHome={() => setActiveTab('home')} />;
      case 'analytics': return <AnalyticsScreen />;
      case 'plans':     return <PlansScreen />;
      case 'profile':   return <ProfileScreen onOpenStatement={() => setShowStatement(true)} />;
      default:          return <HomeScreen onOpenStatement={() => setShowStatement(true)} />;
    }
  };

  return (
    <Layout>
      <div className="flex-1 flex flex-col min-h-0 relative">
        {renderScreen()}
      </div>
      <BottomNav activeTab={activeTab} onChangeTab={setActiveTab} />
    </Layout>
  );
};

const App: React.FC = () => (
  <ErrorBoundary>
    <AuthProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </AuthProvider>
  </ErrorBoundary>
);

export default App;
