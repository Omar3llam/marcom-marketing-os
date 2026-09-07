// ============================================================
// MARCOM / Lumi — Proof / Calibration (Phase 11A · STAR 2)
// ------------------------------------------------------------
// Surfaces the Phase-X Proof Engine: does Lumi get sharper as it learns this
// account? Consumes DecisionAccuracySchema + the gated AccuracySurfaceSchema via
// GET /api/lumi/accuracy.
//
// THE HARD GATE: the improvement claim renders ONLY when coverage.verdict ===
// RELIABLE. The backend pre-computes this in `surface` (gated/headline); the
// client renders the gate, never re-derives a calibration number. Below RELIABLE
// → only "Still learning this account (N scored, need M)".
//
// Headline = calibration (ECE), accuracy secondary (Proof Engine §2.4). The
// reliability table is the evidence (a table, not a chart — anti-Looker holds).
// Role: STRATEGIST = full table + velocity; BUYER = summary; CLIENT = narrative.
// ============================================================
import { Link } from 'react-router-dom';
import { Gauge } from 'lucide-react';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useAccuracy } from '@/hooks/useAccuracy.js';
import RecordOutcomePanel from './RecordOutcomePanel.jsx';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { appRoutes } from '@/app/routeManifest.js';

const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;

// Backend velocity trend (LIFT_STATUS) → a labelled, colour-coded badge.
const TREND_META = {
  IMPROVING:         { label: 'IMPROVING', cls: 'text-signal-scale' },
  DEGRADING:         { label: 'DEGRADING', cls: 'text-signal-hold' },
  FLAT:              { label: 'STEADY',     cls: 'text-lumi-muted' },
  INSUFFICIENT_DATA: { label: 'STILL LEARNING', cls: 'text-lumi-subtle' },
};

// Compact sparkline of per-period calibration error (lower = better, so a line
// that trends DOWN is improving). Hand-rolled SVG — the codebase's own idiom
// (no charting dependency), and the number row below stays the evidence, so the
// anti-Looker rule holds. Renders nothing below 2 periods (never a fake trend).
function VelocitySparkline({ periods, colorClass }) {
  if (!Array.isArray(periods) || periods.length < 2) return null;
  const values = periods.map((p) => p.calibrationError);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const W = 120, H = 28;
  const coords = values.map((v, i) => [
    (i / (values.length - 1)) * W,
    H - ((v - min) / range) * H,
  ]);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={colorClass} role="img" aria-label="Learning velocity trend">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={line} />
      {coords.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.75" fill="currentColor" />)}
    </svg>
  );
}

// ── The gated one-liner (reused on Home too) ────────────────────
export function ProofSummary({ surface }) {
  if (!surface) return null;
  const reliable = !surface.gated;
  return (
    <div className="flex items-center gap-2.5">
      <Gauge className={`w-4 h-4 flex-shrink-0 ${reliable ? 'text-lumi-accent' : 'text-lumi-subtle'}`} strokeWidth={1.5} />
      <p className={`text-sm ${reliable ? 'text-lumi-text font-medium' : 'text-lumi-muted'}`}>
        {surface.headline}
      </p>
    </div>
  );
}

// ── Pure, prop-driven view (unit-tested directly) ───────────────
export function ProofView({ data, surface, role = WORKSPACE_ROLE.STRATEGIST }) {
  const reliable = surface && !surface.gated && data?.coverage?.verdict === 'RELIABLE';
  const isStrategist = role === WORKSPACE_ROLE.STRATEGIST;

  // CLIENT (narrative only) and any non-RELIABLE account: the gated line ONLY.
  // No reliability table, no calibration number leaks through.
  if (!reliable || role === WORKSPACE_ROLE.CLIENT) {
    return (
      <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
        <ProofSummary surface={surface} />
      </div>
    );
  }

  const cal = data.calibration;
  const vel = data.velocity;
  const trendMeta = TREND_META[vel?.trend] ?? TREND_META.INSUFFICIENT_DATA;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
        <ProofSummary surface={surface} />
        <div className="mt-3 flex gap-6 text-xs font-mono text-lumi-subtle">
          <span className="inline-flex items-center gap-1">Calibration error (ECE) <HelpTip variant="popover" content={HELP.CALIBRATION} />: <strong className="text-lumi-text">{pct(cal.expectedCalibrationError)}</strong></span>
          <span>Brier: <strong className="text-lumi-text">{cal.brierScore == null ? '—' : cal.brierScore.toFixed(2)}</strong></span>
          <span>Direction: <strong className="text-lumi-text">{cal.direction}</strong></span>
          <span>Accuracy (secondary): {pct(cal.accuracy)}</span>
        </div>
      </div>

      {/* Learning-velocity periods — the flagship curve as a compact sparkline
          PLUS the row of numbers (the numbers stay the evidence; anti-Looker holds). */}
      {isStrategist && vel?.periods?.length > 0 && (
        <div className="rounded-2xl border border-lumi-border bg-lumi-surface p-4">
          <div className="section-label mb-2 flex items-center gap-2">
            Learning velocity
            <span className={`font-mono text-[10px] uppercase tracking-wide ${trendMeta.cls}`}>{trendMeta.label}</span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <VelocitySparkline periods={vel.periods} colorClass={trendMeta.cls} />
            <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-sm">
              {vel.periods.map((p) => (
                <span key={p.label} className="text-lumi-muted">
                  {p.label}: <strong className="text-lumi-text">{pct(p.calibrationError)}</strong> err
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Reliability table — predicted vs observed. The evidence, not a chart. */}
      {isStrategist && cal?.bins?.length > 0 && (
        <div className="rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-lumi-subtle border-b border-lumi-border">
                <th className="px-4 py-2.5 font-medium">Confidence band</th>
                <th className="px-4 py-2.5 font-medium">Lumi said</th>
                <th className="px-4 py-2.5 font-medium">Actually right</th>
                <th className="px-4 py-2.5 font-medium">n</th>
              </tr>
            </thead>
            <tbody>
              {cal.bins.map((b) => (
                <tr key={b.band} className="border-b border-lumi-border/60">
                  <td className="px-4 py-2.5 font-mono text-lumi-muted">{b.band}</td>
                  <td className="px-4 py-2.5 font-mono text-lumi-muted">{pct(b.predicted)}</td>
                  <td className="px-4 py-2.5 font-mono text-lumi-text">{pct(b.observed)}</td>
                  <td className="px-4 py-2.5 font-mono text-lumi-subtle">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── The reading: fetch + three states, and NO page chrome ───────
//
// FE-02 — this used to be `export default function Proof()`, a page with its own
// <h1> and Intelligence sub-nav strip at /app/intelligence/proof. It is not a
// page any more: B7 Ruling 2 says Memory is ONE surface read TWO ways, and this
// is the second reading — *is what Lumi learned any good?* — of the object the
// first reading states. Two addresses for one object is precisely the
// divergence that ruling forbids, so /app/intelligence/proof now redirects to
// /app/memory and this composes into it.
//
// Deliberately unchanged: the fetch, the gate, the three states and the role
// narrowing. Moving a reading must not quietly re-specify it — a CLIENT still
// gets the narrative line and nothing else, exactly as at the old address.
export function ProofReading() {
  const { role } = useCollabRole();
  const { data, surface, loading, error, refetch } = useAccuracy();

  if (loading) return <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>;

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3">
        <EmptyPanel Icon={Gauge} text="We couldn't load Proof of Learning right now. It tracks how calibrated Lumi gets on your account as decisions accumulate." />
        <Link to={appRoutes.settingsIntegrations} className="inline-flex items-center gap-1 text-sm font-medium text-lumi-accent hover:underline">
          Connect Meta →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ProofView data={data} surface={surface} role={role} />
      {/* Closing the loop by hand — recording a real outcome refreshes the surface. */}
      <RecordOutcomePanel onRecorded={refetch} />
    </div>
  );
}
