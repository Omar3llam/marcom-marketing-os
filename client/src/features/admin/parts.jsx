// ============================================================
// MARCOM / Lumi — Admin panel shared parts
// ------------------------------------------------------------
// A tiny async hook + presentational helpers shared by the four tabs. Semantic
// tokens only (lumi-* / trend-*) — no raw hex, no gray-*. This is an internal
// operator tool: functional, terse, not a marketing surface.
// ============================================================
import { useCallback, useEffect, useState } from 'react';

/** Run an async fetcher on mount; expose { data, loading, error, reload }. */
export function useAsync(fn) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const reload = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((err) => {
        if (!cancelled) setState({ data: null, loading: false, error: err?.response?.data?.error || err?.message || 'Request failed' });
      });
    return () => { cancelled = true; };
  }, [fn]);

  useEffect(() => reload(), [reload]);

  return { ...state, reload };
}

/** Loading / error / empty gate around tab content. */
export function AsyncBlock({ loading, error, empty, emptyLabel = 'Nothing to show.', children }) {
  if (loading) return <p className="py-8 text-center text-sm text-lumi-muted">Loading…</p>;
  if (error)   return <p className="py-8 text-center text-sm text-trend-danger">{error}</p>;
  if (empty)   return <p className="py-8 text-center text-sm text-lumi-muted">{emptyLabel}</p>;
  return children;
}

/** A bordered section with a header row (optional right-aligned actions). */
export function Card({ title, actions, children }) {
  return (
    <section className="rounded-xl border border-lumi-border bg-lumi-surface p-4">
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-lumi-subtle">{title}</h3>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** Colored status pill: green when ok, red otherwise (amber when `warn`). */
export function Pill({ ok, warn, children }) {
  const tone = warn ? 'text-trend-warning' : ok ? 'text-trend-positive' : 'text-trend-danger';
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-xs ${tone}`}>
      <span aria-hidden>{warn ? '◐' : ok ? '●' : '○'}</span>
      {children}
    </span>
  );
}
