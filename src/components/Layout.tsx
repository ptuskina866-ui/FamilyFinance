import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="fixed inset-0 w-full h-full bg-[#E5F3E8] bg-gradient-to-b from-[#DCF0E1] via-[#E7F4EB] to-[#EEF7F1] flex justify-center items-stretch md:items-center overflow-hidden select-none touch-pan-y">
      {/* Liquid Glass Background Light Reflections */}
      <div className="absolute -top-24 -right-20 w-80 h-80 rounded-full bg-[#F4FF96]/40 blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 -left-28 w-96 h-96 rounded-full bg-[#B8ECD0]/50 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 right-10 w-72 h-72 rounded-full bg-[#CEF0DC]/40 blur-3xl pointer-events-none" />

      {/* Main app container */}
      <main className="w-full max-w-[440px] h-full flex flex-col bg-[#E5F3E8]/70 backdrop-blur-xl md:rounded-[38px] md:shadow-[0_24px_70px_rgba(20,50,30,0.12)] md:border md:border-white/60 relative overflow-hidden md:h-[860px]">
        {children}
      </main>
    </div>
  );
};

export default Layout;
