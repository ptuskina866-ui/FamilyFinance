import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="h-[100dvh] md:h-auto min-h-[100dvh] bg-[#F8FAFC] md:bg-slate-100 flex justify-center items-stretch md:items-center overflow-x-hidden">
      {/* Desktop soft background blobs */}
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#EBF5EB] via-[#EEF2FF] to-[#F0FDF4] pointer-events-none hidden md:block opacity-60" />

      {/* Main app container */}
      <main className="w-full max-w-[480px] h-full flex flex-col bg-white md:rounded-[32px] md:shadow-[0_16px_48px_rgba(15,23,42,0.08)] relative overflow-hidden md:h-[860px]">
        {children}
      </main>
    </div>
  );
};

export default Layout;
