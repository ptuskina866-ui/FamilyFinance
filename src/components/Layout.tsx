import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="app-backdrop">
      <main className="app-shell">
        {children}
      </main>
    </div>
  );
};

export default Layout;
