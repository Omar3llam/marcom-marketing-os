// ============================================================
// MARCOM / Lumi — DecisionBreadcrumb
// ------------------------------------------------------------
// Sticky 48px strip shown on every non-COMMAND_CENTER state.
// Left: ← Command Center · separator · current view label.
// Right: mode pill · agent pills (Claude/ChatGPT, compact).
// ============================================================
import { ArrowLeft } from 'lucide-react';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { cn } from '@/lib/utils.js';

const MODE_LABEL = {
  campaign: 'Campaign Analysis',
  strategy: 'Strategy Brief',
  content:  'Score Content',
};

const VIEW_LABEL = {
  INPUT:   (mode)            => MODE_LABEL[mode] || 'Input',
  THEATER: ()                => 'Analyzing…',
  ERROR:   ()                => 'Error',
};

export default function DecisionBreadcrumb({ view, mode, verdict, agents, onBack }) {
  return (
    <nav
      aria-label="Decision breadcrumb"
      className="sticky top-0 z-30 h-12 px-6 flex items-center justify-between border-b border-lumi-border bg-lumi-surface/80 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-display text-lumi-muted hover:text-lumi-text transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.5} />
          Command Center
        </button>
        <span className="text-lumi-subtle">/</span>
        {view === 'SUCCESS' && verdict ? (
          <VerdictPill verdict={verdict} />
        ) : (
          <span className="text-sm font-display text-lumi-text truncate">
            {VIEW_LABEL[view]?.(mode) || view}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {mode && (
          <span className="font-mono text-xs px-2 py-0.5 rounded bg-lumi-elevated border border-lumi-border text-lumi-muted">
            {mode.toUpperCase()}
          </span>
        )}
        {Array.isArray(agents) && agents.length > 0 && agents.map((a) => (
          <AgentChip key={a} agent={a} />
        ))}
      </div>
    </nav>
  );
}

function AgentChip({ agent }) {
  const cls = agent === 'claude'
    ? 'text-orange-400  bg-orange-500/10  border-orange-500/25'
    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25';
  const label = agent === 'claude' ? 'Claude' : 'ChatGPT';
  return (
    <span className={cn('font-mono text-xs px-2 py-0.5 rounded border', cls)}>
      {label}
    </span>
  );
}
