// ============================================================
// MARCOM / Lumi — Home · Budget Pacing Widget (UI-2)
// ------------------------------------------------------------
// Burn-rate projection from the real portfolio contract
// (GET /api/lumi/portfolio → monthlyBudgetMinor, pacing, channels).
//
// THE HONEST STATE HIERARCHY (the whole point of this widget):
//   loading            → skeleton
//   channels < 2       → "connect a second channel" — a single-channel burn
//                        rate against a total budget understates spend, so we
//                        refuse to show a misleading number.
//   monthlyBudget null → "set a budget in Settings"
//   pacing null        → "not enough data to project pacing yet"
//   else               → real pacing (projected vs budget · run rate · early)
//
// Strategist-band metric → gated to STRATEGIST/BUYER (a CLIENT gets the
// narrative lens elsewhere, not the raw budget figures). Money is integer
// minor units; divide by 100 before formatting.
// ============================================================
import { Gauge } from 'lucide-react';
import { usePortfolio } from '@/hooks/usePortfolio.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { roleAllowed } from '@/components/auth/RoleGate.jsx';
import { formatCurrencyWhole } from '@/lib/currencyFormatter.js';

function Shell({ children }) {
  return (
    <div className="mb-6 rounded-xl border border-lumi-border bg-lumi-elevated px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Gauge className="w-3.5 h-3.5 text-lumi-accent" strokeWidth={1.5} />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dark-muted">
          Budget pacing
        </span>
      </div>
      {children}
    </div>
  );
}

const Note = ({ children }) => <p className="font-mono text-xs text-dark-soft">{children}</p>;

const STATUS = {
  ON_TRACK: { label: 'On track',     tone: 'text-signal-scale' },
  OVER:     { label: 'Over budget',  tone: 'text-signal-kill' },
  UNDER:    { label: 'Under budget', tone: 'text-signal-hold' },
};

export default function PacingWidget() {
  const { role } = useCollabRole();
  const { data, loading, error } = usePortfolio();
  const { workspace } = useWorkspace();

  // Budget burn-rate is a strategist-band figure — never surface it to a CLIENT.
  if (!roleAllowed(role, ['STRATEGIST', 'BUYER'])) return null;

  if (loading) {
    return <div className="mb-6 h-[68px] rounded-xl border border-lumi-border bg-lumi-elevated animate-pulse" aria-hidden="true" />;
  }
  if (error) {
    return <Shell><Note>Couldn&apos;t load pacing right now.</Note></Shell>;
  }

  const channels = data?.channels ?? [];
  const budgetMinor = data?.monthlyBudgetMinor ?? null;
  const pacing = data?.pacing ?? null;

  // ── Honest gates, in order. Each tells the truth instead of a fake number. ──
  if (channels.length < 2) {
    return <Shell><Note>Connect a second channel to see pacing — a single-channel burn rate against a total budget understates spend.</Note></Shell>;
  }
  if (budgetMinor == null) {
    return <Shell><Note>Set a monthly budget in Settings to see burn rate.</Note></Shell>;
  }
  if (!pacing) {
    return <Shell><Note>Not enough data to project pacing yet.</Note></Shell>;
  }

  // ── Real pacing. ──
  const currency = workspace?.currency || 'USD';
  const projected = formatCurrencyWhole(pacing.projectedSpendMinor / 100, currency);
  const budget = formatCurrencyWhole(budgetMinor / 100, currency);
  const runRate = formatCurrencyWhole(pacing.runRateMinor / 100, currency);
  const statusCfg = STATUS[pacing.status] || { label: pacing.status, tone: 'text-dark-base' };
  const daysEarly = pacing.daysEarly != null ? Math.round(pacing.daysEarly) : null;

  return (
    <Shell>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className={`font-display font-bold text-sm ${statusCfg.tone}`}>{statusCfg.label}</span>
        <span className="font-mono text-xs text-dark-soft">
          Projected <span className="text-dark-base font-semibold tabular-nums">{projected}</span> of {budget}
        </span>
        <span className="font-mono text-xs text-dark-soft">
          Run rate <span className="text-dark-base font-semibold tabular-nums">{runRate}</span>/day
        </span>
        {daysEarly != null && daysEarly > 0 && (
          <span className="font-mono text-xs text-signal-kill">
            budget exhausts ~{daysEarly} day{daysEarly === 1 ? '' : 's'} early
          </span>
        )}
      </div>
    </Shell>
  );
}
