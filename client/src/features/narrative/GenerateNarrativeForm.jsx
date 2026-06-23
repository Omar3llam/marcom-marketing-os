// ============================================================
// MARCOM / Lumi — GenerateNarrativeForm (Phase 8 · author a report)
// ------------------------------------------------------------
// Authoring is a STRATEGIST action. For any other role this renders NOTHING
// (hidden, not a teasing disabled button) — the backend is the source of truth
// (403 RoleForbidden), this just mirrors it so a BUYER/CLIENT never sees a
// control they can't use.
//
// Picks period (WEEKLY/MONTHLY) + audience (STRATEGIST/BUYER/LEADERSHIP) and
// calls onGenerate({ period, audience }). The shortcut buttons author the most
// common report — a weekly/monthly leadership narrative — in one click.
// ============================================================
import { useState } from 'react';
import { WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { cn } from '@/lib/utils.js';

const PERIODS = ['WEEKLY', 'MONTHLY'];
const AUDIENCES = ['STRATEGIST', 'BUYER', 'LEADERSHIP'];

const seg = (active) => cn(
  'rounded-md px-2.5 py-1 text-xs font-display transition-colors',
  active ? 'bg-lumi-accent text-lumi-bg font-semibold' : 'text-lumi-muted hover:text-lumi-text',
);

export function GenerateNarrativeForm({ role, onGenerate, isGenerating = false, isRestricted = false }) {
  const [period, setPeriod] = useState('WEEKLY');
  const [audience, setAudience] = useState('LEADERSHIP');

  // Hidden for non-strategists — never a disabled tease.
  if (role !== WORKSPACE_ROLE.STRATEGIST) return null;

  const submit = (e) => {
    e.preventDefault();
    if (isGenerating) return;
    onGenerate({ period, audience });
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-lumi-border bg-lumi-elevated p-5">
      <div className="flex flex-wrap items-end gap-5">
        <div>
          <div className="section-label mb-1.5">Period</div>
          <div className="inline-flex rounded-lg border border-lumi-border bg-lumi-surface p-0.5">
            {PERIODS.map((p) => (
              <button key={p} type="button" className={seg(period === p)} onClick={() => setPeriod(p)}>{p}</button>
            ))}
          </div>
        </div>

        <div>
          <div className="section-label mb-1.5">Audience</div>
          <div className="inline-flex rounded-lg border border-lumi-border bg-lumi-surface p-0.5">
            {AUDIENCES.map((a) => (
              <button key={a} type="button" className={seg(audience === a)} onClick={() => setAudience(a)}>{a}</button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={isGenerating}
          className="rounded-lg bg-lumi-accent px-3.5 py-2 text-xs font-semibold text-lumi-bg hover:bg-lumi-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? 'Authoring…' : 'Generate report'}
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => onGenerate({ period: 'WEEKLY', audience: 'LEADERSHIP' })}
            className="rounded-lg border border-lumi-border bg-lumi-surface px-3 py-2 text-xs font-medium text-lumi-text hover:border-lumi-border-strong disabled:opacity-40"
          >
            Weekly leadership
          </button>
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => onGenerate({ period: 'MONTHLY', audience: 'LEADERSHIP' })}
            className="rounded-lg border border-lumi-border bg-lumi-surface px-3 py-2 text-xs font-medium text-lumi-text hover:border-lumi-border-strong disabled:opacity-40"
          >
            Monthly leadership
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-lumi-subtle">
        Lumi composes the report from real rows only — every figure is bound to a decision, holdout, plan or goal. A quiet period reports “no material changes”, never an invented story.
      </p>
      {isRestricted && (
        <p className="mt-2 text-xs text-signal-kill">Authoring a report requires the STRATEGIST role.</p>
      )}
    </form>
  );
}
