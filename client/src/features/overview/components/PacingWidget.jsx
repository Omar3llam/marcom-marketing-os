// ============================================================
// MARCOM / Lumi — Overview · Budget Pacing Widget (UI-2)
// ------------------------------------------------------------
// Burn-rate projection from the real portfolio contract
// (GET /api/lumi/portfolio → monthlyBudgetMinor, pacing, channels).
//
// THE HONEST STATE HIERARCHY (the whole point of this widget):
//   loading            → skeleton
//   channels < 2       → "connect a second channel" — a single-channel burn
//                        rate against a total budget understates spend, so we
//                        refuse to show a misleading number.
//   monthlyBudget null → "set a budget via Reallocate Capital (Blended Truth)" —
//                        the budget is the latest committed AllocationPlan's
//                        total, NOT a Settings field (there is none).
//   pacing null        → "not enough data to project pacing yet"
//   else               → real pacing (projected vs budget · run rate · early)
//
// Strategist-band metric → gated to STRATEGIST/BUYER (a CLIENT gets the
// narrative lens elsewhere, not the raw budget figures).
//
// MONEY. This header used to instruct: "Money is integer minor units; divide by
// 100 before formatting." That is true of most currencies and false of ones this
// product already declares — `lib/money.ts` records KWD/BHD/OMR/JOD at THREE
// minor digits and JPY at ZERO — so the literal overstated a Gulf-dinar account
// tenfold and understated a yen account by a hundred, on the surface whose only
// job is saying whether the budget is burning too fast. PARITY-01 removed the
// same literal from the account aggregate and never swept here.
//
//   Never assume a 2-digit currency exponent. Minor-unit conversion must come
//   from the canonical currency table.
//
// `fromMinor` reads that table; `formatCurrencyWhole` only formats the major
// number it is handed, so the conversion is the part that had to change.
// ============================================================
import { Gauge } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePortfolio } from '@/hooks/usePortfolio.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { roleAllowed } from '@/components/auth/RoleGate.jsx';
import { formatCurrencyWhole } from '@/lib/currencyFormatter.js';
import { fromMinor } from '@/lib/money';
import { appRoutes } from '@/app/routeManifest.js';

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
    return (
      <Shell>
        <Note>
          Set a monthly budget in{' '}
          <Link to={appRoutes.blendedTruth} className="text-lumi-accent hover:underline">Reallocate Capital</Link>
          {' '}— committing an allocation there sets the budget burn rate is measured against.
        </Note>
      </Shell>
    );
  }
  // The server refused the comparison: the spend it holds does not cover this
  // month to date. Said as that — never as "not enough data", which reads as
  // "wait a little", and never as a hidden card, which reads as nothing at all.
  // Any refusal renders this, including a reason this build cannot name.
  const spendPeriod = data?.spendPeriod ?? null;
  if (!pacing && spendPeriod?.status === 'NOT_MEASURABLE') {
    const held = spendPeriod.window;
    return (
      <Shell>
        <Note>
          Lumi hasn’t measured spend for this month to date, so it won’t compare your budget with it.
          {held ? ` The spend it holds covers ${held.start} – ${held.end}.` : ''}
        </Note>
      </Shell>
    );
  }
  if (!pacing) {
    return <Shell><Note>Not enough data to project pacing yet.</Note></Shell>;
  }

  // ── Real pacing. ──
  const currency = workspace?.currency || 'USD';
  const major = (amountMinor) => formatCurrencyWhole(fromMinor(amountMinor, currency), currency);
  const projected = major(pacing.projectedSpendMinor);
  const budget = major(budgetMinor);
  const runRate = major(pacing.runRateMinor);
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
