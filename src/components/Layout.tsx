import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="fixed inset-0 w-full h-full bg-[#E5F3E8] bg-gradient-to-b from-[#DCF0E1] via-[#E7F4EB] to-[#EEF7F1] flex justify-center items-stretch md:items-center overflow-hidden select-none touch-pan-y">
      {/* Desktop ambient glow */}
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#D2EED9] via-[#E8F6ED] to-[#F3FAF5] pointer-events-none hidden md:block" />

      {/* Main app container */}
      <main className="w-full max-w-[440px] h-full flex flex-col bg-[#E5F3E8] md:rounded-[38px] md:shadow-[0_24px_70px_rgba(20,50,30,0.12)] md:border md:border-white/60 relative overflow-hidden md:h-[860px]">
        {children}
      </main>
    </div>
  );
};

export default Layout;
