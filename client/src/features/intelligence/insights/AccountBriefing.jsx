// ============================================================
// MARCOM / Lumi — AccountBriefing  ("What Lumi knows about this account")
// ------------------------------------------------------------
// Surfaces GET /api/lumi/briefing (Phase 5 Memory Moat) — the workspace's
// learned, truth-weighted AccountPatterns. Every field traces to an
// AccountPattern row: statement, status (EMERGING/ESTABLISHED/…), accuracy
// ("was Lumi right?", null until outcomes are known → "—"), confidence.
// Validated against BriefingSchema in useAccountBriefing; nothing inferred.
// ============================================================
import { Brain, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils.js';

const statusTone = {
  ESTABLISHED: 'text-signal-scale bg-signal-scale-bg border-signal-scale/25',
  EMERGING:    'text-stage-testing bg-stage-testing/10 border-stage-testing/25',
  CONFLICTED:  'text-signal-kill bg-signal-kill-bg border-signal-kill/25',
  SUPERSEDED:  'text-lumi-subtle bg-lumi-elevated border-lumi-border',
};

export function AccountBriefing({ briefing, loading = false, error = null }) {
  const patterns = briefing?.patterns ?? [];
  const conflicts = briefing?.conflicts ?? [];
  const promotable = briefing?.promotableCount ?? 0;

  return (
    <section className="mt-10">
      <div className="section-label">What Lumi Knows About This Account</div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        Truth-weighted patterns learned from this workspace — confidence reflects how often Lumi was right, not how often it guessed.
      </p>

      {loading ? (
        <div className="rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">Loading learnings…</div>
      ) : error ? (
        <div className="rounded-2xl border border-signal-kill/25 bg-signal-kill-bg p-6 text-center text-sm text-signal-kill">
          <AlertCircle className="w-5 h-5 mx-auto mb-1.5" strokeWidth={1.5} /> Couldn’t load account learnings.
        </div>
      ) : patterns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-8 text-center">
          <Brain className="w-10 h-10 mx-auto text-lumi-subtle" strokeWidth={1.5} />
          <p className="mt-3 font-display text-lumi-text">No established patterns yet.</p>
          <p className="mt-1 text-lumi-muted text-sm">Lumi promotes a learning here once it has enough confirmed outcomes to trust it.</p>
        </div>
      ) : (
        <>
          {(promotable > 0 || conflicts.length > 0) && (
            <div className="flex flex-wrap gap-2 mb-3 font-mono text-xs">
              {promotable > 0 && <span className="px-2 py-0.5 rounded bg-signal-scale-bg text-signal-scale border border-signal-scale/25">{promotable} promotable to a rule</span>}
              {conflicts.length > 0 && <span className="px-2 py-0.5 rounded bg-signal-kill-bg text-signal-kill border border-signal-kill/25">{conflicts.length} need review</span>}
            </div>
          )}
          <ul className="grid gap-3">
            {patterns.map((p) => {
              const acc = Number.isFinite(p.accuracy) ? Math.round(p.accuracy * 100) : null;
              const conf = Number.isFinite(p.confidence) ? Math.round(p.confidence * 100) : null;
              return (
                <li key={p.id} className="bg-lumi-surface border border-lumi-border rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-body text-sm text-lumi-text leading-relaxed flex-1">{p.statement}</p>
                    <span className={cn('font-mono text-xs uppercase tracking-wide px-2 py-0.5 rounded border flex-shrink-0', statusTone[p.status] || statusTone.SUPERSEDED)}>
                      {p.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-lumi-subtle">
                    {p.kind && <span>{p.kind.replace(/_/g, ' ')}</span>}
                    <span>right {acc == null ? '—' : `${acc}%`}</span>
                    {conf != null && <span>confidence {conf}%</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
