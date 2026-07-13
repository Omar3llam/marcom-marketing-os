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
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useTests } from '@/hooks/useTests.js';
import { useConcludeTest } from '@/hooks/useConcludeTest.js';
import { useStartTest } from '@/hooks/useStartTest.js';
import { useRecordMetrics } from '@/hooks/useRecordMetrics.js';
import { useCommitAgenda } from '@/hooks/useCommitAgenda.js';
import { usePromoteToHoldout } from '@/hooks/usePromoteToHoldout.js';
import { toMinor, fromMinor } from '@/lib/money';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';
import { appRoutes } from '@/app/routeManifest.js';

// ── The thin-sample floor — a mirror of testReadoutEngine FLOOR (frozen). ──
// Below this on the smaller arm the backend refuses to call a winner, so we
// refuse to offer Conclude. Keep in sync with src/services/test-readout.
export const SAMPLE_FLOOR = Object.freeze({ CTR: 1000, CVR: 100, ROAS: 25, CPA: 25 });
const FLOOR_UNIT = Object.freeze({ CTR: 'impressions', CVR: 'clicks', ROAS: 'conversions', CPA: 'conversions' });

/** The watched-metric sample count for a variant (impressions / clicks / conversions).
 *  Returns null when the count is unrecorded — the display renders "—", never a
 *  fabricated 0 that reads as a real (zero) sample. Calculation callers (thinGate)
 *  coalesce null → 0 explicitly, where 0 correctly means "below the floor". */
function variantSample(v, metric) {
  if (metric === 'CTR') return v.impressions ?? null;
  if (metric === 'CVR') return v.clicks ?? null;
  return v.conversions ?? null; // ROAS / CPA
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
  // An unrecorded arm (variantSample null) counts as 0 here — genuinely below the
  // floor, so the gate stays closed. This 0 is calculation identity, not display.
  const minSample = Math.min(...variants.map((v) => variantSample(v, exp.metric) ?? 0));
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
function ExperimentCard({ exp, role, canOperate, onConclude, concludingId, onStart, startingId, onRecord, recordingId, recordError, onPromote, promotingId, promoteError }) {
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
            <Link to={appRoutes.overview} className="inline-block text-xs font-medium text-lumi-accent hover:underline">
              Lumi proposed an action — review on Overview →
            </Link>
          )}
          {canOperate && (
            <PromoteControl
              exp={exp}
              role={role}
              onPromote={onPromote}
              promotingId={promotingId}
              promoteError={promoteError}
            />
          )}
        </div>
      )}

      {exp.status === 'RUNNING' && (
        <RunningBody
          exp={exp}
          canOperate={canOperate}
          onConclude={onConclude}
          concludingId={concludingId}
          onRecord={onRecord}
          recordingId={recordingId}
          recordError={recordError}
        />
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

// ── RUNNING body: live counts + record-metrics + the gated Conclude ─────
function RunningBody({ exp, canOperate, onConclude, concludingId, onRecord, recordingId, recordError }) {
  const variants = Array.isArray(exp.variants) ? exp.variants : [];
  const gate = thinGate(exp);
  const isConcluding = concludingId === exp.id;
  const unit = gate.unit;

  return (
    <div className="mt-3 space-y-3">
      <div className="space-y-1">
        {variants.map((v) => {
          // Unrecorded count (null) → "—", never a fabricated 0 that reads as a
          // real zero-sample arm. A genuine recorded 0 still shows "0".
          const s = variantSample(v, exp.metric);
          return (
            <div key={v.id} className="flex items-center justify-between text-xs">
              <span className="text-lumi-muted">
                {v.label}{v.isControl ? ' (control)' : ''}
              </span>
              <span className="font-mono text-lumi-subtle">
                {s == null ? '—' : s.toLocaleString('en-US')} {unit}
              </span>
            </div>
          );
        })}
      </div>

      {/* Record observed counts — the manual entry that moves a thin/zeroed
          test past the readout floor. Operator-tier; the same numbers the
          (separate, already-wired) Meta refresh would otherwise supply. */}
      {canOperate && (
        <MetricsForm exp={exp} onRecord={onRecord} recordingId={recordingId} recordError={recordError} />
      )}

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

// ── Record observed per-variant counts (manual entry) ───────────
// Fields are EXACTLY what POST /tests/:id/metrics accepts — impressions,
// clicks, conversions (raw ints) + spend/revenue (entered in major units,
// converted to integer minor units on submit). No invented fields. A fresh
// open re-seeds from the current counts so the operator edits, not retypes.
const NUM_INPUT =
  'font-mono text-xs bg-lumi-elevated border border-lumi-border rounded-md px-2 py-1 text-lumi-text w-full';

function MetricsForm({ exp, onRecord, recordingId, recordError }) {
  const currency = exp.currency || 'USD';
  const variants = Array.isArray(exp.variants) ? exp.variants : [];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [saved, setSaved] = useState(null);
  const isRecording = recordingId === exp.id;

  // No arms yet → nothing to record against (don't offer a dead form).
  if (variants.length === 0) return null;

  const openForm = () => {
    const next = {};
    for (const v of variants) {
      // Missing metric → EMPTY input, never a pre-filled "0". A pre-filled zero
      // is a value the user could submit as if real; an empty field asks them to
      // enter the actual number (honest-empty over fabricated-zero).
      next[v.id] = {
        impressions: v.impressions == null ? '' : String(v.impressions),
        clicks: v.clicks == null ? '' : String(v.clicks),
        conversions: v.conversions == null ? '' : String(v.conversions),
        spend: v.spendMinor == null ? '' : String(fromMinor(v.spendMinor, currency)),
        revenue: v.revenueMinor == null ? '' : String(fromMinor(v.revenueMinor, currency)),
      };
    }
    setDraft(next);
    setSaved(null);
    setOpen(true);
  };

  const setField = (vid, field, value) =>
    setDraft((d) => ({ ...d, [vid]: { ...(d[vid] || {}), [field]: value } }));

  const toCount = (s) => { const n = parseInt(s, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
  const toAmount = (s) => { const n = Number(s); return Number.isFinite(n) && n > 0 ? n : 0; };

  const submit = async () => {
    const rows = variants.map((v) => {
      const f = draft[v.id] || {};
      return {
        variantId: v.id,
        impressions: toCount(f.impressions),
        clicks: toCount(f.clicks),
        conversions: toCount(f.conversions),
        spendMinor: toMinor(toAmount(f.spend), currency),
        revenueMinor: toMinor(toAmount(f.revenue), currency),
      };
    });
    const result = await onRecord?.(exp.id, rows);
    if (result) {
      setSaved(result.updated ?? rows.length);
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={openForm}
          className="rounded-lg border border-lumi-border bg-lumi-elevated px-3 py-1.5 text-xs font-semibold text-lumi-text transition-colors hover:bg-lumi-surface"
        >
          Record metrics
        </button>
        {saved != null && (
          <p className="mt-1.5 text-xs text-signal-scale">
            Recorded — updated {saved} variant{saved === 1 ? '' : 's'}. Counts and the conclude gate refreshed.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-lumi-border bg-lumi-surface p-3 space-y-3">
      <p className="text-xs text-lumi-subtle">
        Enter the observed counts for each arm. Money in {currency}; leave a field at 0 if there’s nothing to record.
      </p>
      {variants.map((v) => {
        const f = draft[v.id] || {};
        return (
          <div key={v.id} className="space-y-1.5">
            <div className="text-xs text-lumi-muted">{v.label}{v.isControl ? ' (control)' : ''}</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                ['impressions', 'Impressions'],
                ['clicks', 'Clicks'],
                ['conversions', 'Conversions'],
                ['spend', `Spend (${currency})`],
                ['revenue', `Revenue (${currency})`],
              ].map(([field, label]) => (
                <label key={field} className="block">
                  <span className="block text-[10px] uppercase tracking-wide text-lumi-subtle mb-0.5">{label}</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    aria-label={`${v.label} ${label}`}
                    value={f[field] ?? ''}
                    onChange={(e) => setField(v.id, field, e.target.value)}
                    className={NUM_INPUT}
                  />
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isRecording}
          onClick={submit}
          className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg transition-colors hover:bg-lumi-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isRecording ? 'Recording…' : 'Save metrics'}
        </button>
        <button
          type="button"
          disabled={isRecording}
          onClick={() => setOpen(false)}
          className="rounded-lg border border-lumi-border px-3 py-1.5 text-xs font-semibold text-lumi-muted transition-colors hover:bg-lumi-elevated disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
      {recordError && (
        <p className="text-xs text-signal-kill">
          {recordError.message || 'Couldn’t record metrics right now. Try again shortly.'}
        </p>
      )}
    </div>
  );
}

// ── CONCLUDED → promote into a holdout (the Phase-7C bridge) ─────
// A correlational A/B winner can seed a CAUSAL holdout. The backend derives the
// baseline conversion rate from the control arm and seeds the MDE from the
// observed lift — the operator only supplies the daily-eligible volume the test
// can't know. Designing a holdout is a STRATEGIST + Enterprise act: a BUYER sees
// the affordance (awareness) but is told it needs a strategist; the Enterprise
// tier-lock is surfaced honestly from the backend 403 (the client holds no tier
// signal of its own). Mirrors MetricsForm: re-openable, inline success/error.
function PromoteControl({ exp, role, onPromote, promotingId, promoteError }) {
  const isStrategist = role === WORKSPACE_ROLE.STRATEGIST;
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(null);
  const [daily, setDaily] = useState('');
  const [mde, setMde] = useState('');
  const [channel, setChannel] = useState('');
  const isPromoting = promotingId === exp.id;

  const dailyN = /^\d+$/.test(daily.trim()) ? Number(daily) : NaN;
  const mdeN = mde.trim() === '' ? null : Number(mde);
  const mdeOk = mdeN == null || (Number.isFinite(mdeN) && mdeN > 0 && mdeN < 100);
  const valid = dailyN > 0 && mdeOk;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    const payload = { dailyEligible: dailyN };
    if (mdeN != null) payload.mde = mdeN / 100;        // % → fraction (backend wants 0–1)
    if (channel.trim()) payload.channel = channel.trim().toUpperCase();
    const result = await onPromote?.(exp.id, payload);
    if (result) { setSaved(result); setOpen(false); }  // success: collapse + confirm
  };

  const SUB_BTN = 'rounded-lg border border-lumi-border bg-lumi-elevated px-3 py-1.5 text-xs font-semibold text-lumi-text transition-colors hover:bg-lumi-surface';

  if (!open) {
    return (
      <div className="pt-1">
        <button type="button" onClick={() => { setSaved(null); setOpen(true); }} className={SUB_BTN}>
          Promote to holdout
        </button>
        {saved && (
          <p className="mt-1.5 text-xs text-signal-scale">
            Holdout designed —{' '}
            <Link to={appRoutes.measure} className="font-medium underline hover:text-signal-scale">view in Measurement →</Link>
          </p>
        )}
      </div>
    );
  }

  // BUYER: aware of the affordance, but not entitled to design a holdout.
  if (!isStrategist) {
    return (
      <div className="pt-1">
        <button type="button" onClick={() => setOpen(false)} className={SUB_BTN}>Promote to holdout</button>
        <p className="mt-1.5 text-xs text-lumi-subtle">Holdout design requires STRATEGIST role.</p>
      </div>
    );
  }

  // STRATEGIST: the design form. baselineCvr is NOT asked — it's derived backend-side.
  const LABEL = 'block text-[10px] uppercase tracking-wide text-lumi-subtle mb-0.5';
  return (
    <form onSubmit={submit} className="rounded-xl border border-lumi-border bg-lumi-surface p-3 space-y-2">
      <p className="text-xs text-lumi-subtle">
        Design a causal holdout from this test. The baseline conversion rate comes from the control arm; enter the audience volume.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block">
          <span className={LABEL}>Daily eligible users</span>
          <input type="number" min="1" inputMode="numeric" aria-label="Daily eligible users"
            value={daily} onChange={(e) => setDaily(e.target.value)} className={NUM_INPUT} />
        </label>
        <label className="block">
          <span className={LABEL}>Min. detectable lift %</span>
          <input type="number" min="0" inputMode="decimal" aria-label="Minimum detectable lift percent"
            placeholder="seeded from test lift" value={mde} onChange={(e) => setMde(e.target.value)} className={NUM_INPUT} />
        </label>
        <label className="block">
          <span className={LABEL}>Channel</span>
          <input type="text" aria-label="Channel" placeholder="META"
            value={channel} onChange={(e) => setChannel(e.target.value)} className={NUM_INPUT} />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={!valid || isPromoting}
          className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg transition-colors hover:bg-lumi-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
          {isPromoting ? 'Promoting…' : 'Design holdout'}
        </button>
        <button type="button" disabled={isPromoting} onClick={() => setOpen(false)}
          className="rounded-lg border border-lumi-border px-3 py-1.5 text-xs font-semibold text-lumi-muted transition-colors hover:bg-lumi-elevated disabled:opacity-40">
          Cancel
        </button>
      </div>
      {promoteError && (
        <p className="text-xs text-signal-kill">
          {promoteError.message || 'Couldn’t promote this test to a holdout right now. Try again shortly.'}
        </p>
      )}
    </form>
  );
}

// ── Pure, prop-driven view (unit-tested directly) ───────────────
export function TestingView({
  experiments = [], agenda = [], role = WORKSPACE_ROLE.BUYER,
  onConclude, concludingId, concludeError,
  onStart, startingId, startError,
  onRecord, recordingId, recordError,
  onCommit, committing = false, commitError,
  onPromote, promotingId, promoteError,
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
          role={role}
          canOperate={canOperate}
          onConclude={onConclude}
          concludingId={concludingId}
          onStart={onStart}
          startingId={startingId}
          onRecord={onRecord}
          recordingId={recordingId}
          recordError={recordError}
          onPromote={onPromote}
          promotingId={promotingId}
          promoteError={promoteError}
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
  const { record, recordingId, error: recordError } = useRecordMetrics();
  const { commit, committing, error: commitError } = useCommitAgenda();
  const { promote, promotingId, error: promoteError } = usePromoteToHoldout();

  const onConclude = async (testId) => {
    const result = await conclude(testId);
    if (result) await refetch();
  };

  const onStart = async (testId) => {
    const result = await start(testId);
    if (result) await refetch();
  };

  const onRecord = async (testId, variants) => {
    const result = await record(testId, variants);
    if (result) await refetch();
    return result; // the form shows its confirmation on a truthy result
  };

  const onCommit = async (picks) => {
    const result = await commit(picks);
    if (result) await refetch();
  };

  // The bridge: a created holdout doesn't change THIS test's row, so no refetch
  // is needed — the form shows its own success + link into Measurement. Returns
  // the created holdout (truthy) so the form can collapse and confirm.
  const onPromote = async (testId, payload) => promote(testId, payload);

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
          onRecord={onRecord}
          recordingId={recordingId}
          recordError={recordError}
          onCommit={onCommit}
          committing={committing}
          commitError={commitError}
          onPromote={onPromote}
          promotingId={promotingId}
          promoteError={promoteError}
        />
      )}
    </div>
  );
}
