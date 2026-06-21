// ============================================================
// MARCOM / Lumi — Testing OS readout (Phase 4-A · BUYER-primary)
// ------------------------------------------------------------
// Surfaces the closed-loop Testing OS: each experiment's HONEST readout. A
// CONCLUDED test shows the winner Lumi actually called — lift, an honestly
// labeled confidence, and the sample note — all persisted backing-row fields
// (TestExperiment), never a re-derived number. A RUNNING test shows its live
// counts and a Conclude action; an INCONCLUSIVE concluded test shows WHY it
// couldn't be called, not a fake winner.
//
// THE THIN-SAMPLE GATE: Conclude is disabled until the smaller arm clears the
// metric's sample floor — the same frozen floor the backend readout engine
// uses to refuse a call (testReadoutEngine FLOOR). We don't offer an action
// that could only ever return "too thin to call".
//
// Role: BUYER + STRATEGIST operate tests (route-gated). The buyer concludes;
// the resulting verdict rides the existing confirm→execute path — Lumi
// proposes, the human confirms, nothing auto-executes.
// ============================================================
import { FlaskConical } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useTests } from '@/hooks/useTests.js';
import { useConcludeTest } from '@/hooks/useConcludeTest.js';
import { useStartTest } from '@/hooks/useStartTest.js';
import { useCommitAgenda } from '@/hooks/useCommitAgenda.js';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';
import { appRoutes } from '@/app/routeManifest.js';

// ── The thin-sample floor — a mirror of testReadoutEngine FLOOR (frozen). ──
// Below this on the smaller arm the backend refuses to call a winner, so we
// refuse to offer Conclude. Keep in sync with src/services/test-readout.
export const SAMPLE_FLOOR = Object.freeze({ CTR: 1000, CVR: 100, ROAS: 25, CPA: 25 });
const FLOOR_UNIT = Object.freeze({ CTR: 'impressions', CVR: 'clicks', ROAS: 'conversions', CPA: 'conversions' });

/** The watched-metric sample count for a variant (impressions / clicks / conversions). */
function variantSample(v, metric) {
  if (metric === 'CTR') return v.impressions ?? 0;
  if (metric === 'CVR') return v.clicks ?? 0;
  return v.conversions ?? 0; // ROAS / CPA
}

/**
 * Whether a RUNNING test has cleared the sample floor to be conclusible.
 * Unknown metric (no floor) → ready:true (don't fabricate a gate; the backend
 * stays the honest arbiter).
 */
export function thinGate(exp) {
  const floor = SAMPLE_FLOOR[exp?.metric];
  const unit = FLOOR_UNIT[exp?.metric] || 'samples';
  const variants = Array.isArray(exp?.variants) ? exp.variants : [];
  if (!floor) return { ready: true, floor: null, minSample: null, unit };
  if (variants.length < 2) return { ready: false, floor, minSample: 0, unit };
  const minSample = Math.min(...variants.map((v) => variantSample(v, exp.metric)));
  return { ready: minSample >= floor, floor, minSample, unit };
}

// ── Small presentational atoms (semantic tokens only) ───────────
const STATUS_STYLE = {
  RUNNING:   'text-lumi-accent',
  CONCLUDED: 'text-signal-scale',
  PROPOSED:  'text-lumi-muted',
  ABANDONED: 'text-lumi-subtle',
};
function StatusPill({ status }) {
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.08em] ${STATUS_STYLE[status] || 'text-lumi-subtle'}`}>
      {status}
    </span>
  );
}

const CONF_STYLE = {
  HIGH:         'text-signal-scale bg-signal-scale-bg',
  MODERATE:     'text-lumi-accent bg-lumi-accent-soft',
  LOW:          'text-lumi-muted bg-lumi-surface',
  INCONCLUSIVE: 'text-lumi-subtle bg-lumi-surface',
};
function ConfidenceBadge({ label }) {
  if (!label) return null;
  return (
    <span className={`rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${CONF_STYLE[label] || CONF_STYLE.INCONCLUSIVE}`}>
      {label} confidence
    </span>
  );
}

// Status ordering: actionable first, then the readouts, then upcoming.
const ORDER = { RUNNING: 0, CONCLUDED: 1, PROPOSED: 2, ABANDONED: 3 };

// ── One experiment card ─────────────────────────────────────────
function ExperimentCard({ exp, canOperate, onConclude, concludingId, onStart, startingId }) {
  return (
    <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-xs text-lumi-subtle">
          {exp.dimension} · {exp.metric}
        </div>
        <StatusPill status={exp.status} />
      </div>
      {exp.hypothesis && <p className="mt-1.5 text-sm text-lumi-text">{exp.hypothesis}</p>}

      {exp.status === 'CONCLUDED' && (
        <div className="mt-3 space-y-2">
          {exp.winnerLabel ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-lumi-text">
                Winner: <strong>{exp.winnerLabel}</strong>
              </span>
              {exp.lift != null && (
                <span className="font-mono text-sm text-signal-scale">+{exp.lift}% {exp.metric}</span>
              )}
              <ConfidenceBadge label={exp.confidenceLabel} />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-lumi-muted">No winner called.</span>
              <ConfidenceBadge label={exp.confidenceLabel} />
            </div>
          )}
          {exp.sampleNote && <p className="text-xs font-mono text-lumi-subtle">{exp.sampleNote}</p>}
          {exp.decisionId && (
            <Link to={appRoutes.decisions} className="inline-block text-xs font-medium text-lumi-accent hover:underline">
              Lumi proposed an action — review in Decisions →
            </Link>
          )}
        </div>
      )}

      {exp.status === 'RUNNING' && (
        <RunningBody exp={exp} canOperate={canOperate} onConclude={onConclude} concludingId={concludingId} />
      )}

      {exp.status === 'PROPOSED' && (
        <ProposedBody exp={exp} canOperate={canOperate} onStart={onStart} startingId={startingId} />
      )}
      {exp.status === 'ABANDONED' && (
        <p className="mt-3 text-xs text-lumi-subtle">Abandoned.</p>
      )}
    </div>
  );
}

// ── PROPOSED body: the gated Start action (PROPOSED → RUNNING) ───
// Completes the lifecycle PR #108 opened: commit mints PROPOSED; this starts it.
function ProposedBody({ exp, canOperate, onStart, startingId }) {
  const isStarting = startingId === exp.id;
  if (!canOperate) {
    return <p className="mt-3 text-xs text-lumi-subtle">Proposed — not started yet.</p>;
  }
  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={isStarting}
        onClick={() => onStart?.(exp.id)}
        className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg transition-colors hover:bg-lumi-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isStarting ? 'Starting…' : 'Start test'}
      </button>
      <p className="mt-1.5 text-xs text-lumi-subtle">
        Moves this experiment to RUNNING so Lumi can track the arms and call a winner.
      </p>
    </div>
  );
}

// ── RUNNING body: live counts + the gated Conclude action ───────
function RunningBody({ exp, canOperate, onConclude, concludingId }) {
  const variants = Array.isArray(exp.variants) ? exp.variants : [];
  const gate = thinGate(exp);
  const isConcluding = concludingId === exp.id;
  const unit = gate.unit;

  return (
    <div className="mt-3 space-y-3">
      <div className="space-y-1">
        {variants.map((v) => (
          <div key={v.id} className="flex items-center justify-between text-xs">
            <span className="text-lumi-muted">
              {v.label}{v.isControl ? ' (control)' : ''}
            </span>
            <span className="font-mono text-lumi-subtle">
              {variantSample(v, exp.metric).toLocaleString('en-US')} {unit}
            </span>
          </div>
        ))}
      </div>

      {canOperate && (
        <div>
          <button
            type="button"
            disabled={!gate.ready || isConcluding}
            onClick={() => onConclude?.(exp.id)}
            className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg transition-colors hover:bg-lumi-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isConcluding ? 'Concluding…' : 'Conclude test'}
          </button>
          {!gate.ready && gate.floor != null && (
            <p className="mt-1.5 text-xs text-lumi-subtle">
              Needs {Math.max(gate.floor - gate.minSample, 0).toLocaleString('en-US')} more {unit} on the smaller
              arm before it can be called ({gate.minSample.toLocaleString('en-US')}/{gate.floor.toLocaleString('en-US')}).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pure, prop-driven view (unit-tested directly) ───────────────
export function TestingView({
  experiments = [], agenda = [], role = WORKSPACE_ROLE.BUYER,
  onConclude, concludingId, concludeError,
  onStart, startingId, startError,
  onCommit, committing = false, commitError,
}) {
  const canOperate = role === WORKSPACE_ROLE.BUYER || role === WORKSPACE_ROLE.STRATEGIST;

  if (experiments.length === 0) {
    return (
      <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
        <EmptyPanel Icon={FlaskConical} text="No experiments yet — Lumi proposes a weekly testing agenda you can commit." />
        {agenda.length > 0 && (
          <div className="mt-2">
            <div className="section-label mb-2">This week’s proposed agenda</div>
            <ul className="space-y-1">
              {agenda
                .map((a, i) => ({ key: a?.id || i, text: a?.hypothesis || a?.rationale }))
                .filter((a) => a.text)
                .slice(0, 5)
                .map((a) => (
                  <li key={a.key} className="text-xs text-lumi-muted">• {a.text}</li>
                ))}
              {agenda.length > 5 && (
                <li className="text-xs text-lumi-subtle">+{agenda.length - 5} more</li>
              )}
            </ul>

            {/* Commit turns the read-only agenda into real PROPOSED experiments.
                Operator-tier only (same gate the endpoint enforces); a commit
                refetches so the new rows replace this agenda with their cards. */}
            {canOperate && (
              <div className="mt-4">
                <button
                  type="button"
                  disabled={committing}
                  onClick={() => onCommit?.(agenda)}
                  className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg transition-colors hover:bg-lumi-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {committing ? 'Committing…' : 'Commit agenda'}
                </button>
                <p className="mt-1.5 text-xs text-lumi-subtle">
                  Creates {agenda.length} proposed experiment{agenda.length === 1 ? '' : 's'} you can start and track.
                </p>
                {commitError && (
                  <p className="mt-1.5 text-xs text-signal-kill">
                    {commitError.message || 'Couldn’t commit the agenda right now. Try again shortly.'}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const ordered = [...experiments].sort(
    (a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9),
  );

  return (
    <div className="space-y-4">
      {concludeError && (
        <p className="text-xs text-signal-kill">Couldn’t conclude that test right now. Try again shortly.</p>
      )}
      {startError && (
        <p className="text-xs text-signal-kill">
          {startError.message || 'Couldn’t start that test right now. Try again shortly.'}
        </p>
      )}
      {ordered.map((exp) => (
        <ExperimentCard
          key={exp.id}
          exp={exp}
          canOperate={canOperate}
          onConclude={onConclude}
          concludingId={concludingId}
          onStart={onStart}
          startingId={startingId}
        />
      ))}
    </div>
  );
}

// ── Page wrapper: fetch + three states ──────────────────────────
export default function Testing() {
  const { role } = useCollabRole();
  const { experiments, agenda, loading, error, refetch } = useTests();
  const { conclude, concludingId, error: concludeError } = useConcludeTest();
  const { start, startingId, error: startError } = useStartTest();
  const { commit, committing, error: commitError } = useCommitAgenda();

  const onConclude = async (testId) => {
    const result = await conclude(testId);
    if (result) await refetch();
  };

  const onStart = async (testId) => {
    const result = await start(testId);
    if (result) await refetch();
  };

  const onCommit = async (picks) => {
    const result = await commit(picks);
    if (result) await refetch();
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="decision-title text-lumi-text mb-1">Testing OS</h1>
      <p className="text-sm text-lumi-muted mb-6">Honest readouts from your experiments — the winner Lumi will call, and when it won’t.</p>

      {loading && <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>}
      {!loading && error && (
        <EmptyPanel Icon={FlaskConical} text="Couldn’t load your experiments right now. Try again shortly." />
      )}
      {!loading && !error && (
        <TestingView
          experiments={experiments}
          agenda={agenda}
          role={role}
          onConclude={onConclude}
          concludingId={concludingId}
          concludeError={concludeError}
          onStart={onStart}
          startingId={startingId}
          startError={startError}
          onCommit={onCommit}
          committing={committing}
          commitError={commitError}
        />
      )}
    </div>
  );
}
