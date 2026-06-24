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
import { Gauge } from 'lucide-react';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useAccuracy } from '@/hooks/useAccuracy.js';
import IntelligenceSubNav from '../IntelligenceSubNav.jsx';
import RecordOutcomePanel from './RecordOutcomePanel.jsx';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';

const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;

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

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
        <ProofSummary surface={surface} />
        <div className="mt-3 flex gap-6 text-xs font-mono text-lumi-subtle">
          <span>Calibration error (ECE): <strong className="text-lumi-text">{pct(cal.expectedCalibrationError)}</strong></span>
          <span>Brier: <strong className="text-lumi-text">{(cal.brierScore ?? 0).toFixed(2)}</strong></span>
          <span>Direction: <strong className="text-lumi-text">{cal.direction}</strong></span>
          <span>Accuracy (secondary): {pct(cal.accuracy)}</span>
        </div>
      </div>

      {/* Learning-velocity periods — the flagship curve, as a row of numbers. */}
      {isStrategist && vel?.periods?.length > 0 && (
        <div className="rounded-2xl border border-lumi-border bg-lumi-surface p-4">
          <div className="section-label mb-2">Learning velocity ({vel.trend})</div>
          <div className="flex gap-5 font-mono text-sm">
            {vel.periods.map((p) => (
              <span key={p.label} className="text-lumi-muted">
                {p.label}: <strong className="text-lumi-text">{pct(p.calibrationError)}</strong> err
              </span>
            ))}
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

// ── Page wrapper: fetch + three states ──────────────────────────
export default function Proof() {
  const { role } = useCollabRole();
  const { data, surface, loading, error, refetch } = useAccuracy();

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="decision-title text-lumi-text mb-1">Proof of Learning</h1>
      <p className="text-sm text-lumi-muted mb-6">Is Lumi getting more calibrated on this account over time?</p>

      <IntelligenceSubNav />

      {loading && <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>}
      {!loading && error && (
        <EmptyPanel Icon={Gauge} text="Couldn't load the proof surface right now. Try again shortly." />
      )}
      {!loading && !error && (
        <div className="space-y-4">
          <ProofView data={data} surface={surface} role={role} />
          {/* Closing the loop by hand — recording a real outcome refreshes the surface. */}
          <RecordOutcomePanel onRecorded={refetch} />
        </div>
      )}
    </div>
  );
}
