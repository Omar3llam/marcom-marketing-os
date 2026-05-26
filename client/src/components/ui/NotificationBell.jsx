// ============================================================
// MARCOM UI Primitive — NotificationBell
// ============================================================
// Bell icon with optional alert badge and popover.
// Used in Sidebar header for high-priority notifications.
//
// Props:
//   alertCount: number (shows badge if > 0)
//   open: boolean (controls popover visibility)
//   onToggle: () => void (toggle popover)
//   children: React.ReactNode (popover content)
// ============================================================
import { Bell } from 'lucide-react';

export default function NotificationBell({ alertCount, open, onToggle, children }) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        aria-label="Notifications"
        className={`p-1.5 rounded-lg border-none transition-colors duration-150 flex items-center justify-center ${
          open ? 'bg-lumi-elevated' : 'bg-transparent hover:bg-lumi-elevated'
        } ${alertCount > 0 ? 'text-signal-kill' : 'text-lumi-muted'}`}
      >
        <Bell className="w-4 h-4" strokeWidth={1.5} />
        {alertCount > 0 && (
          <span
            className="absolute top-1 right-1 w-2 h-2 rounded-full bg-signal-kill"
            style={{
              boxShadow: '0 0 6px var(--c-kill)',
              animation: 'pulse 1.6s ease-in-out infinite',
            }}
          />
        )}
      </button>

      {/* Popover */}
      {open && children && (
        <div className="absolute top-full left-0 mt-2 z-50">
          {children}
        </div>
      )}
    </div>
  );
}
