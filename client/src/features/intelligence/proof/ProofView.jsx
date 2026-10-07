// ============================================================
// MARCOM / Lumi — Proof / Calibration (Phase 11A · STAR 2)
// ------------------------------------------------------------
// AccountLift headline and calibration evidence, including discrete decision
// cohorts with server-selected trend membership. Consumes DecisionAccuracySchema
// + the gated AccuracySurfaceSchema via GET /api/lumi/accuracy.
//
// THE HARD GATE: the improvement claim renders ONLY when coverage.verdict ===
// RELIABLE. The backend pre-computes this in `surface` (gated/headline); the
// client renders the gate, never re-derives a calibration number. Below RELIABLE
// → only "Still learning this account (N scored, need M)".
//
// Headline = calibration (ECE), accuracy secondary (Proof Engine §2.4). The
// reliability table is the evidence (a table, not a chart — anti-Looker holds).
// Role: STRATEGIST = table + cohorts; BUYER = summary; CLIENT = narrative.
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

const pct = (n) => Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—';

// Backend cohort classification owns the label. Neutral text carries no
// campaign-verdict meaning and rounded evidence never reclassifies the trend.
const TREND_LABELS = {
  IMPROVING: 'Improving',
  DEGRADING: 'Degrading',
  FLAT: 'Steady',
  INSUFFICIENT_DATA: 'Still learning',
};

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
  const trendLabel = TREND_LABELS[vel?.trend] ?? 'Trend unavailable';
  const reliabilityRows = cal.bins.map(bin => ({ band: bin.band,
    predicted: pct(bin.predicted), observed: pct(bin.observed), count: bin.count }));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
        <ProofSummary surface={surface} />
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm font-mono text-lumi-muted">
          <span className="inline-flex flex-wrap items-center gap-1">Calibration error (ECE) <HelpTip variant="popover" content={HELP.CALIBRATION} />: <strong className="text-lumi-text">{pct(cal.expectedCalibrationError)}</strong></span>
          <span>Brier: <strong className="text-lumi-text">{cal.brierScore == null ? '—' : cal.brierScore.toFixed(2)}</strong></span>
          <span>Direction: <strong className="text-lumi-text">{cal.direction}</strong></span>
          <span>Accuracy (secondary): {pct(cal.accuracy)}</span>
        </div>
      </div>

      {/* Cohort evidence stays discrete: every published period and its exact
          server-selected membership, without a continuous time-series claim. */}
      {isStrategist && vel?.periods?.length > 0 && (
        <section aria-label="Calibration by decision cohort" className="rounded-2xl border border-lumi-border bg-lumi-surface p-4">
          <h3 className="section-label">Calibration by decision cohort</h3>
          <p className="mt-2 text-sm text-lumi-muted">Cohort trend: <strong className="text-lumi-text">{trendLabel}</strong></p>
          <p className="mt-2 text-sm text-lumi-muted">Calibration error for scored decisions grouped by UTC issuance month. Lower is better.</p>
          <p className="mt-1 text-sm text-lumi-muted">The trend uses only cohorts selected by Lumi&apos;s calibration engine.</p>
          <ul className="mt-3 space-y-2">
            {vel.periods.map((p) => (
              <li key={p.label} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-lumi-border pt-2 text-sm">
                <span className="font-mono text-lumi-text">{p.label}</span>
                <span className="text-lumi-muted">Calibration error: <strong className="font-mono text-lumi-text">{pct(p.calibrationError)}</strong></span>
                <span className="font-mono text-lumi-muted">n={p.sampleSize}</span>
                <span className="text-lumi-muted">{p.includedInTrend ? 'Used in trend' : 'Not used in trend'}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-lumi-muted">Cohort values can update as outcomes mature.</p>
        </section>
      )}

      {/* Reliability table — predicted vs observed. The evidence, not a chart. */}
      {isStrategist && cal?.bins?.length > 0 && (
        <section aria-label="Reliability by confidence band" className="rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
          <div className="p-4">
            <h3 className="text-sm font-medium text-lumi-text">Reliability by confidence band</h3>
            <p className="mt-2 text-sm text-lumi-muted">Predicted confidence versus observed success across {cal.sampleSize} scored decisions.</p>
            <p className="mt-1 text-sm text-lumi-text break-words">Scored-decision issuance span: {cal.populationSpan.from} → {cal.populationSpan.to} UTC</p>
            <p className="mt-2 text-sm text-lumi-muted">Lumi said is the mean stated confidence in each band; Actually right is the observed success rate; n is the number of scored decisions.</p>
            <p className="mt-1 text-sm text-lumi-muted">Values can update as outcomes mature or recorded outcomes are corrected.</p>
          </div>
          <section aria-label="Reliability evidence records" className="sm:hidden divide-y divide-lumi-border text-sm">
            {reliabilityRows.map(row => <article key={row.band} aria-label={row.band + ' confidence band'} className="p-4 text-lumi-text">
              <h4 className="font-mono font-medium">{row.band} confidence</h4>
              <dl className="mt-3 space-y-2">
                {[['Lumi said', row.predicted], ['Actually right', row.observed], ['Decisions', row.count]].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt className="text-lumi-muted">{label}</dt><dd className="font-mono">{value}</dd></div>)}
              </dl>
            </article>)}
          </section>
          <table className="hidden sm:table w-full text-sm">
            <caption className="sr-only">Reliability by confidence band</caption>
            <thead>
              <tr className="text-left text-lumi-muted border-b border-lumi-border">
                <th scope="col" className="px-4 py-2.5 font-medium">Confidence band</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Lumi said</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Actually right</th>
                <th scope="col" className="px-4 py-2.5 font-medium">n</th>
              </tr>
            </thead>
            <tbody>
              {reliabilityRows.map((b) => (
                <tr key={b.band} className="border-b border-lumi-border/60">
                  <th scope="row" className="px-4 py-2.5 font-mono font-medium text-left text-lumi-text">{b.band}</th>
                  <td className="px-4 py-2.5 font-mono text-lumi-muted">{b.predicted}</td>
                  <td className="px-4 py-2.5 font-mono text-lumi-text">{b.observed}</td>
                  <td className="px-4 py-2.5 font-mono text-lumi-muted">{b.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
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
        <Link to={appRoutes.connections} className="inline-flex items-center gap-1 text-sm font-medium text-lumi-accent hover:underline">
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
