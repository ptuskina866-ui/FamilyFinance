import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="h-[100dvh] md:h-auto min-h-[100dvh] bg-[#E8EEF4] flex justify-center items-center overflow-x-hidden">
      {/* Desktop soft background blobs */}
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-[#EBF5EB] via-[#EEF2FF] to-[#F0FDF4] pointer-events-none hidden md:block opacity-60" />

      {/* Main app container */}
      <main className="w-full max-w-[480px] h-full flex flex-col bg-[#F0F4F8] md:rounded-[28px] md:shadow-[0_8px_40px_rgba(0,0,0,0.12)] relative overflow-hidden md:h-[860px]">
        {children}
      </main>
    </div>
  );
};

export default Layout;
