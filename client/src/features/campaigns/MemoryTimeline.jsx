// ============================================================
// MARCOM / Lumi — MemoryTimeline  (Campaigns · "Memory")
// ------------------------------------------------------------
// What Lumi has said about this campaign before, and how it turned out.
//
// HISTORICAL CONTEXT, NOT REASONING. It sits outside the Reasoning disclosure
// deliberately: those blocks are the case for TODAY'S verdict, and this is a
// record of earlier ones. A past KILL is not evidence for the current call, and
// filing it under "Reasoning" would invite exactly that reading.
//
// PURE RENDERER, same contract as the three blocks above it: takes a view
// model, emits JSX, owns no vocabulary and no state. Every label — the verdict,
// what the operator did, the outcome — arrives already worded, because the
// distinction between "no outcome recorded" and "outcome unclear" is a domain
// judgement and not a rendering one.
// ============================================================

/**
 * @param {{ viewModel: {count:number, items:Array<{key,verdict,action,at,outcome}>}|null }} props
 *   Null renders nothing. A campaign we have never judged has no memory, and
 *   "Seen 0 times" would claim we looked and found none.
 */
export function MemoryTimeline({ viewModel }) {
  if (!viewModel) return null;

  const { count, items } = viewModel;

  return (
    <div className="mt-4 space-y-1.5">
      <p className="section-label text-lumi-muted">Memory</p>

      {/* The count is the service's true total and can exceed the rows below —
          the list is bounded, the number is not. */}
      <p className="text-sm text-lumi-text">
        Seen {count} time{count === 1 ? '' : 's'}
      </p>

      <div className="space-y-1">
        {items.map((it) => (
          <div key={it.key} className="rounded-lg border border-lumi-border bg-lumi-surface px-3 py-2">
            <p className="text-xs text-lumi-text">
              <span className="font-medium">{it.verdict}</span>
              <span className="text-lumi-subtle"> · {it.action}</span>
              {it.at && <span className="text-lumi-subtle"> · {it.at}</span>}
            </p>
            {/* Rendered only when an outcome was actually recorded. An absent
                line is the honest form of "we do not know yet"; a placeholder
                would read as a measurement. */}
            {it.outcome && <p className="mt-0.5 text-[11px] text-lumi-subtle">{it.outcome}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
