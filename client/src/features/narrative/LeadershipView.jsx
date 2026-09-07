// ============================================================
// MARCOM / Lumi — LeadershipView (Phase 8 · the reporting surface)
// ------------------------------------------------------------
// The home of the reasoned stakeholder report — and the CLIENT seat's primary
// (effectively only) surface. Two zones:
//   A · Generate  — STRATEGIST only (GenerateNarrativeForm hides itself otherwise)
//   B · Reports   — the list of past narratives, scoped to what the role may read:
//        STRATEGIST → all audiences · BUYER → strategist+buyer · CLIENT → leadership
//
// CLIENT scoping is enforced at the SOURCE: we request ?audience=LEADERSHIP for a
// CLIENT so the server never even returns the strategist/buyer reports. Honest
// states throughout: skeleton while loading, a role-appropriate empty message,
// a user-facing error.
// ============================================================
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { appRoutes } from '@/app/routeManifest.js';
import { useNarratives } from '@/hooks/useNarratives.js';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import { cn } from '@/lib/utils.js';
import { GenerateNarrativeForm } from './GenerateNarrativeForm.jsx';
import { NarrativeCard } from './NarrativeCard.jsx';

// Which persisted audiences a role may read. CLIENT is also filtered server-side.
const READABLE_AUDIENCES = {
  STRATEGIST: null, // all
  BUYER:      new Set(['STRATEGIST', 'BUYER']),
  CLIENT:     new Set(['LEADERSHIP']),
};

const EMPTY_COPY = {
  STRATEGIST: 'No reports yet — generate your first weekly narrative above.',
  BUYER:      'No reports shared with you yet.',
  CLIENT:     'No leadership reports available yet.',
};

const audienceBadge = (a) => cn(
  'font-mono text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border',
  a === 'LEADERSHIP' ? 'text-lumi-accent border-lumi-accent/30 bg-lumi-accent-soft/30' : 'text-lumi-subtle border-lumi-border bg-lumi-surface',
);

function ReportRow({ narrative, expanded, onToggle }) {
  const { period, audience, periodEnd, reportConfidence } = narrative;
  const asOf = periodEnd ? new Date(periodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
  const conf = reportConfidence?.label === 'LOW' ? 'learning' : `${reportConfidence?.score ?? '—'}`;

  return (
    <div className="rounded-2xl border border-lumi-border bg-lumi-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-lumi-elevated/40 rounded-2xl transition-colors"
      >
        <span className="font-display text-sm text-lumi-text truncate flex-1 min-w-0">{narrative.headline}</span>
        <span className={audienceBadge(audience)}>{audience}</span>
        <span className="font-mono text-[10px] text-lumi-subtle hidden sm:inline">{period} · {asOf}</span>
        <span className="font-mono text-[10px] text-lumi-muted">conf {conf}</span>
      </button>
      {expanded && (
        <div className="px-2 pb-2">
          <NarrativeCard narrative={narrative} />
        </div>
      )}
    </div>
  );
}

export function LeadershipView() {
  const { role } = useCollabRole();
  const isClient = role === WORKSPACE_ROLE.CLIENT;
  // CLIENT is scoped at the source; other roles fetch all and filter for read.
  const { narratives, isLoading, error, isRestricted, generate, isGenerating } = useNarratives(
    isClient ? { audience: 'LEADERSHIP' } : {},
  );
  const [expandedId, setExpandedId] = useState(null);

  const visible = useMemo(() => {
    const allow = READABLE_AUDIENCES[role] ?? null;
    return allow ? narratives.filter((n) => allow.has(n.audience)) : narratives;
  }, [narratives, role]);

  const onGenerate = async (payload) => {
    const created = await generate(payload);
    if (created?.id) setExpandedId(created.id); // surface the fresh report
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <header className="mb-6">
        <h1 className="decision-title text-lumi-text">Reports</h1>
        <p className="mt-1 text-sm text-lumi-muted">
          Reasoned weekly &amp; monthly narratives — grounded in real decisions, holdouts, and goals. Not a dashboard.
        </p>
      </header>

      {/* ── Zone A · Generate (STRATEGIST only) ── */}
      <div className="mb-8">
        <GenerateNarrativeForm role={role} onGenerate={onGenerate} isGenerating={isGenerating} isRestricted={isRestricted} />
      </div>

      {/* ── Zone B · Reports ── */}
      {isLoading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      ) : error ? (
        <div className="rounded-2xl border border-signal-kill/25 bg-signal-kill-bg p-6 text-center text-sm text-signal-kill">
          <AlertCircle className="w-5 h-5 mx-auto mb-1.5" strokeWidth={1.5} />
          <p>We couldn’t load reports right now.</p>
          <p className="mt-1 text-dark-soft">Reports summarize your live campaign performance for stakeholders.</p>
          <Link to={appRoutes.connections} className="mt-3 inline-flex items-center gap-1 font-medium text-lumi-accent hover:underline">
            Connect Meta →
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-lumi-border p-10 text-center">
          <p className="text-sm text-lumi-subtle">{EMPTY_COPY[role] ?? EMPTY_COPY.CLIENT}</p>
          {role === WORKSPACE_ROLE.STRATEGIST && (
            <>
              <p className="mt-2 text-xs text-lumi-subtle">Lumi also composes a leadership report automatically every Monday.</p>
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => onGenerate({ period: 'WEEKLY', audience: 'LEADERSHIP' })}
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-lumi-accent hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? 'Generating…' : 'Generate this week’s report →'}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((n) => (
            <ReportRow
              key={n.id}
              narrative={n}
              expanded={expandedId === n.id}
              onToggle={() => setExpandedId((cur) => (cur === n.id ? null : n.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default LeadershipView;
