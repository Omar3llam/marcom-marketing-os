// ============================================================
// MARCOM / Lumi — useInbox (Phase 8 · the role-routed inbox)
// ------------------------------------------------------------
// GET /api/lumi/inbox → the inbox composed LIVE for the caller's role (no table,
// no worker). The server already does the role+severity routing, so this hook
// just validates and NORMALIZES the three sources (radar verdicts · the latest
// narrative · a strategist's pending approvals) into one flat `items` list the
// panel renders. Pull-only: fetch on open, no "mark as read", no persisted badge.
//
// Each item carries a `type` discriminator + a `to` route (never a dead end) +
// an optional `at` timestamp (rendered relative, omitted when the source row
// has none — we never fabricate "2m ago").
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api.js';
import { appRoutes } from '@/app/routeManifest.js';
import { InboxResponseSchema } from '@/contracts/schemas';

// Fold the server's role-routed envelope into a single ordered list. Order:
// approvals (need a decision) → radar verdicts (server pre-sorted by severity)
// → the latest narrative (FYI). Each item links somewhere actionable.
export function toItems(inbox) {
  const items = [];

  for (const a of inbox.pendingApprovals ?? []) {
    items.push({
      type: 'approval', id: a.id,
      title: `Approval needed: ${a.subjectType ?? 'plan'}`,
      detail: a.planId ? `Plan ${a.planId}` : a.subjectId,
      at: a.createdAt ?? null,
      to: appRoutes.insights, // the Growth Strategy board owns plan approvals
    });
  }

  for (const al of inbox.alerts ?? []) {
    if (al.kind !== 'RADAR') continue; // narrative handled below via latestNarrative
    items.push({
      type: 'radar', id: al.id ?? `${al.headline}`,
      title: al.headline ?? 'Radar verdict',
      verdict: al.verdict ?? null, severity: al.severity ?? null,
      at: null, // the routed radar alert carries no timestamp — don't invent one
      to: appRoutes.overview,
    });
  }

  if (inbox.latestNarrative) {
    const n = inbox.latestNarrative;
    items.push({
      type: 'narrative', id: n.id,
      title: `New ${n.period ? `${n.period.toLowerCase()} ` : ''}report available`,
      detail: n.headline,
      at: n.createdAt ?? null,
      to: appRoutes.leadership,
    });
  }

  return items;
}

export function useInbox() {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);
  const attemptRef = useRef(0);

  const load = useCallback(async () => {
    if (!aliveRef.current) return;
    const attempt = ++attemptRef.current;
    setItems([]);
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/inbox');
      if (!aliveRef.current || attempt !== attemptRef.current) return;
      const parsed = InboxResponseSchema.safeParse(res.data);
      if (parsed.success) setItems(toItems(parsed.data));
      else { setItems([]); setError(new Error('Inbox response failed contract validation')); }
    } catch (err) {
      if (!aliveRef.current || attempt !== attemptRef.current) return;
      setError(err);
      setItems([]);
    } finally {
      if (aliveRef.current && attempt === attemptRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const attempts = attemptRef;
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; ++attempts.current; };
  }, [load]);

  return { items, isLoading, error, refetch: load };
}
