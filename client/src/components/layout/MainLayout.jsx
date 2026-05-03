// ============================================================
// MARCOM / Lumi — MainLayout
// ------------------------------------------------------------
// Three-region shell:
//   ┌──────┬─────────────────────────────────┐
//   │      │                                 │
//   │ Side │   <Outlet />                    │
//   │ bar  │                                 │
//   │      ├─────────────────────────────────┤
//   │      │   ContextBar (44px)             │
//   └──────┴─────────────────────────────────┘
// ============================================================
import { useState } from 'react';
import { Outlet }   from 'react-router-dom';
import Sidebar      from './Sidebar.jsx';
import ContextBar   from './ContextBar.jsx';

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-lumi-bg">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
        <ContextBar />
      </div>
    </div>
  );
}
