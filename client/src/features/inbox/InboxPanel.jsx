// ============================================================
// MARCOM / Lumi — InboxPanel (Phase 8 · the role-routed inbox)
// ------------------------------------------------------------
// Lives in the sidebar notification bell. The server composes the inbox LIVE
// for the caller's role, so this just renders the normalized items — three
// kinds, each with a clear CTA (never a dead end):
//   • approval  (strategist) → Growth Strategy board
//   • radar     (buyer/strategist) → Overview, with the verdict pill
//   • narrative (all roles)  → Reports
//
// Pull-only: it fetches on open (mounted only when the bell is open), shows what
// it gets, and has no "mark as read"/badge persistence. Honest states: loading,
// a user-facing error, and a neutral empty state when no items are returned.
// ============================================================
import { X, ClipboardCheck, Radar, FileText, AlertCircle } from 'lucide-react';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { useInbox } from '@/hooks/useInbox.js';
import { isNoWorkspaceError, isRetryableReadError } from '@/design-system/states/readStatus.js';

const ICON = { approval: ClipboardCheck, radar: Radar, narrative: FileText };

// Relative time — only when the source row actually has a timestamp. We never
// fabricate "2m ago" for a row that carries no time.
function relTime(at) {
  if (!at) return null;
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return null;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return `${d}d ago`;
}

function InboxItem({ item, onSelect }) {
  const Icon = ICON[item.type] || FileText;
  const when = relTime(item.at);
  return (
    <button
      onClick={() => onSelect(item.to)}
      className="w-full p-2.5 mb-1.5 last:mb-0 rounded-lg hover:bg-surface-elevated transition-colors text-left border border-transparent hover:border-surface-border"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <Icon className="w-3.5 h-3.5 flex-shrink-0 text-dark-muted" strokeWidth={1.5} />
          <span className="font-display font-semibold text-xs text-dark-base line-clamp-1">{item.title}</span>
        </span>
        {item.type === 'radar' && item.verdict && <VerdictPill verdict={item.verdict} size="sm" showIcon={false} />}
      </div>
      {item.detail && <p className="font-mono text-[10px] text-dark-muted line-clamp-2 pl-5">{item.detail}</p>}
      {when && <span className="font-mono text-[9px] text-dark-subtle mt-1 block pl-5">{when}</span>}
    </button>
  );
}

export function InboxPanel({ onNavigate, onClose }) {
  const { items, isLoading, error, refetch } = useInbox();
  const select = (to) => { onNavigate?.(to); onClose?.(); };

  return (
    <div className="w-72 bg-surface-card border border-surface-border rounded-xl shadow-panel overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-border">
        <span className="font-display font-semibold text-sm text-dark-base">Inbox</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-surface-elevated transition-colors" aria-label="Close">
          <X className="w-3.5 h-3.5 text-dark-muted" strokeWidth={1.5} />
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {isLoading ? (
          <div className="px-4 py-8 text-center text-xs text-dark-subtle">Loading your inbox…</div>
        ) : isNoWorkspaceError(error) ? (
          <div className="px-4 py-8 text-center text-xs text-dark-subtle">
            No workspace is attached to this account. Your inbox is not configured.
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center text-xs text-signal-kill">
            <AlertCircle className="w-4 h-4 mx-auto mb-1.5" strokeWidth={1.5} /> Couldn’t load your inbox.
            {isRetryableReadError(error) && <button type="button" className="block mx-auto mt-2" onClick={refetch}>Retry inbox</button>}
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-dark-subtle">No items to show right now.</div>
        ) : (
          <div className="p-2">
            {items.map((item) => <InboxItem key={`${item.type}-${item.id}`} item={item} onSelect={select} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export default InboxPanel;
