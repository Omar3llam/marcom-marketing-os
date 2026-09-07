// ============================================================
// MARCOM / Admin — Tab 6 · AI Usage
// ------------------------------------------------------------
// What the AI gateway spent, and an ESTIMATE of what it cost.
//
// The estimate is ours: our token counts against a hardcoded, dated pricing
// table. The provider invoices are the truth. Three rules keep that visible
// rather than buried:
//
//   · an unpriced or unmetered figure renders "—", never $0.00
//   · a cost that covers fewer calls than were made says so explicitly
//   · the disclaimer and the pricing date sit next to the number, not in a
//     footnote below the fold
// ============================================================
import { useState, useCallback } from 'react';
import { fetchAiUsage } from './api.js';
import { useAsync, AsyncBlock } from './parts.jsx';

const PERIODS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

const num = (n) => (n == null ? '—' : n.toLocaleString());
// Four decimals: per-provider totals are routinely fractions of a cent, and
// rounding them to 2dp would show "$0.00" for real spend.
const usd = (n) => (n == null ? '—' : `$${n.toFixed(4)}`);
const usdBig = (n) => (n == null ? '—' : `$${n.toFixed(2)}`);

function Row({ label, value, tone = 'text-lumi-text' }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-lumi-muted">{label}</span>
      <span className={`tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

function ProviderCard({ p }) {
  // The cost sums only the calls that reported a token split AND had a known
  // model. Below the call count, it is a floor — saying so is the difference
  // between an estimate and a wrong total.
  const partial = p.pricedCalls < p.calls;

  return (
    <div className="rounded-xl border border-lumi-border p-4 text-xs">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-lumi-accent">
        {p.provider}
      </p>
      <Row label="Calls" value={num(p.calls)} />
      <Row label="Input tokens" value={num(p.inputTokens)} />
      <Row label="Output tokens" value={num(p.outputTokens)} />
      <Row
        label="Est. cost"
        value={usd(p.estimatedCost)}
        tone={p.estimatedCost == null ? 'text-lumi-subtle' : 'text-lumi-text'}
      />

      {p.estimatedCost == null && (
        <p className="mt-2 text-[10px] text-lumi-subtle">
          Not priced — no token split reported, or the model is not in the pricing table.
        </p>
      )}
      {p.estimatedCost != null && partial && (
        <p className="mt-2 text-[10px] text-lumi-subtle">
          Covers {num(p.pricedCalls)} of {num(p.calls)} calls — a floor, not a total.
        </p>
      )}

      {/* Price varies by MODEL, not provider, so the split is the explanation
          for the number above rather than extra detail. */}
      {p.models?.length > 1 && (
        <div className="mt-3 space-y-0.5 border-t border-lumi-border pt-2 text-[10px]">
          {p.models.map((m) => (
            <div key={m.model ?? 'unknown'} className="flex justify-between gap-2">
              <span className="truncate font-mono text-lumi-subtle">{m.model ?? 'unknown model'}</span>
              <span className="flex-shrink-0 tabular-nums text-lumi-muted">
                {num(m.calls)} · {usd(m.estimatedCost)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Daily totals as bar heights. Deliberately unlabelled per-bar: it is a shape,
// and the numbers that matter are stated exactly above.
function DailyBars({ byDay }) {
  const totals = new Map();
  for (const d of byDay ?? []) {
    totals.set(d.day, (totals.get(d.day) ?? 0) + (d.tokens ?? 0));
  }
  const points = [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (points.length < 2) return null;

  const peak = Math.max(...points.map(([, v]) => v));
  if (peak <= 0) return null;

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-lumi-subtle">
        Tokens per day
      </p>
      <div className="flex h-16 items-end gap-0.5">
        {points.map(([day, v]) => (
          <div
            key={day}
            title={`${day}: ${v.toLocaleString()} tokens`}
            style={{ height: `${Math.max(2, (v / peak) * 100)}%` }}
            className="flex-1 rounded-sm bg-lumi-accent/50"
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-lumi-subtle">
        <span>{points[0][0]}</span>
        <span>{points[points.length - 1][0]}</span>
      </div>
    </div>
  );
}

export function CostTab() {
  const [days, setDays] = useState(30);

  const fetcher = useCallback(() => fetchAiUsage(days), [days]);
  const { data, loading, error } = useAsync(fetcher);

  const totals = data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-lumi-text">AI usage — estimated cost</h2>
          <p className="mt-0.5 max-w-xl text-[10px] text-lumi-muted">
            {data?.disclaimer ??
              'Estimated from our own token counts against a hardcoded pricing table. Provider invoices are the source of truth.'}
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Reporting period"
          className="flex-shrink-0 rounded-md border border-lumi-border bg-lumi-surface px-2 py-1.5 text-xs text-lumi-text"
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <AsyncBlock
        loading={loading}
        error={error}
        empty={!data?.byProvider?.length}
        emptyLabel="No AI calls recorded in this period."
      >
        {data && (
          <div className="space-y-6">
            <div className="rounded-xl border border-lumi-border bg-lumi-elevated p-4">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-lumi-subtle">
                Total estimated · {days}d
              </p>
              <p className="text-4xl font-semibold tabular-nums text-lumi-text">
                {usdBig(totals?.estimatedCost)}
              </p>
              <p className="mt-2 text-[10px] text-lumi-muted">
                {totals?.estimatedCost == null
                  ? 'Nothing in this period could be priced — no token split was reported.'
                  : `Derived from ${num(totals.pricedCalls)} of ${num(totals.calls)} calls. Pricing as of ${data.pricingAsOf}.`}
              </p>
            </div>

            <DailyBars byDay={data.byDay} />

            <div className="grid gap-4 md:grid-cols-2">
              {data.byProvider.map((p) => <ProviderCard key={p.provider} p={p} />)}
            </div>

            {data.byWorkspace?.length > 0 && (
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-lumi-subtle">
                  Top workspaces by tokens
                </p>
                <div className="overflow-x-auto rounded-xl border border-lumi-border">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-lumi-border bg-lumi-surface font-mono text-[10px] uppercase tracking-[0.1em] text-lumi-subtle">
                      <tr>
                        <th className="px-3 py-2">Workspace</th>
                        <th className="px-3 py-2 text-right">Calls</th>
                        <th className="px-3 py-2 text-right">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byWorkspace.map((w) => (
                        <tr key={w.workspaceId} className="border-b border-lumi-border/50 last:border-0">
                          <td className="px-3 py-1.5 font-mono text-lumi-muted" title={w.workspaceId}>
                            {w.workspaceId?.slice(0, 8)}…
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-lumi-text">{num(w.calls)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-lumi-text">{num(w.tokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* A real count, not "some calls". Unattributed spend is excluded
                from the workspace table above, so its size is load-bearing. */}
            {totals?.unattributedCalls > 0 && (
              <p className="text-[10px] text-lumi-subtle">
                {num(totals.unattributedCalls)} of {num(totals.calls)} calls carry no workspace and are
                absent from the table above. They are still counted in the totals.
              </p>
            )}
          </div>
        )}
      </AsyncBlock>
    </div>
  );
}
