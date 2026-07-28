// ============================================================
// MARCOM / Admin — Workspace drill-down body
// ------------------------------------------------------------
// Three columns an operator reads together: who is in the workspace, whether
// its data is actually arriving, and whether the agentic loop is running.
//
// Presentational only — the fetch lives in WorkspacesTab. Every value is either
// real or an em dash: a connector with no health record shows "—", never a
// plausible-looking zero or "just now".
// ============================================================

const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-lumi-muted">{label}</span>
      <span className="truncate text-lumi-text">{value}</span>
    </div>
  );
}

function Column({ title, children }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-lumi-subtle">{title}</p>
      {children}
    </div>
  );
}

// HEALTHY / DEGRADED / STALLED map onto the product's signal tokens.
const LOOP_TONE = {
  HEALTHY: 'text-signal-scale',
  DEGRADED: 'text-signal-hold',
  STALLED: 'text-signal-kill',
};

function Members({ users, counts }) {
  const shown = users?.length ?? 0;
  const total = counts?.users ?? shown;

  return (
    <Column title={`Members (${total})`}>
      <div className="space-y-1">
        {shown === 0 && <p className="text-lumi-muted">No members.</p>}
        {users?.map((u) => (
          <div key={u.id} className="flex justify-between gap-2">
            <span className="truncate text-lumi-text">{u.email}</span>
            <span className="flex-shrink-0 font-mono text-lumi-muted">{u.collabRole ?? 'STRATEGIST'}</span>
          </div>
        ))}
        {/* The list is capped server-side — say so rather than implying it is all of them. */}
        {total > shown && (
          <p className="pt-1 text-lumi-subtle">Showing {shown} of {total}.</p>
        )}
      </div>

      <div className="mt-3 space-y-1 border-t border-lumi-border pt-3">
        <Row label="Campaigns" value={counts?.campaignEntities ?? '—'} />
        <Row label="Accounts" value={counts?.accounts ?? '—'} />
        <Row label="Decisions" value={counts?.decisions ?? '—'} />
        <Row label="Snapshots" value={counts?.metricSnapshots ?? '—'} />
      </div>
    </Column>
  );
}

function Connectors({ connectors }) {
  if (!connectors?.ok) {
    return (
      <Column title="Connectors">
        <p className="text-lumi-muted">{connectors?.error ?? 'Connector status unavailable'}</p>
      </Column>
    );
  }

  const list = connectors.connections ?? [];
  return (
    <Column title="Connectors">
      {list.length === 0 && <p className="text-lumi-muted">No connectors.</p>}
      {list.map((c) => (
        <div key={c.platform} className="mb-3 border-b border-lumi-border pb-3 last:mb-0 last:border-0 last:pb-0">
          <p className="mb-1 flex items-center gap-2 font-semibold text-lumi-text">
            {c.platform}
            {c.isActive === false && (
              <span className="font-mono text-[10px] uppercase text-lumi-subtle">inactive</span>
            )}
          </p>
          {/* Last SUCCESS, not last attempt — a failed sync must not read as fresh. */}
          <Row label="Last success" value={fmt(c.lastSuccessfulSync)} />
          <Row label="Last attempt" value={fmt(c.lastAttemptedSync)} />
          <Row label="Records" value={c.recordsImported ?? '—'} />
          {c.lastError && <p className="mt-1 break-words text-signal-kill">{c.lastError}</p>}
          {/* Amber, not red: the sync WORKED, it just did not read everything.
              Rendering it as an error would misstate the state; hiding it would
              present partial figures as complete. */}
          {c.lastWarning && <p className="mt-1 break-words text-signal-hold">{c.lastWarning}</p>}
        </div>
      ))}
    </Column>
  );
}

function Sweeps({ loopRuns }) {
  const list = loopRuns ?? [];
  return (
    <Column title={`Recent sweeps (${list.length})`}>
      {list.length === 0 && <p className="text-lumi-muted">No sweeps yet.</p>}
      {list.map((r) => (
        <div key={r.id} className="mb-2 border-b border-lumi-border pb-2 last:mb-0 last:border-0 last:pb-0">
          <div className="flex justify-between gap-2">
            <span className={`font-mono ${LOOP_TONE[r.loopHealth] ?? 'text-lumi-muted'}`}>
              {r.trigger} · {r.loopHealth}
            </span>
            <span className="flex-shrink-0 text-lumi-muted">{fmt(r.startedAt)}</span>
          </div>
          {/* A sweep that never closed is the thing an operator is looking for. */}
          {r.closed === false && <p className="text-lumi-subtle">Loop did not close.</p>}
          {r.summary && <p className="mt-0.5 text-lumi-muted">{r.summary}</p>}
        </div>
      ))}
    </Column>
  );
}

export function WorkspaceDetail({ detail }) {
  const { workspace, loopRuns, connectors } = detail ?? {};
  if (!workspace) return null;

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-lumi-muted">
        <span>Currency {workspace.currency}</span>
        <span>Spend tier {workspace.spendTier ?? '—'}</span>
        <span>Objective {workspace.objective ?? '—'}</span>
        <span>Channels {workspace.adChannels?.length ? workspace.adChannels.join(', ') : '—'}</span>
        <span>Measurement {workspace.measurementTier}</span>
        <span>Network consent {workspace.networkConsent ? 'on' : 'off'}</span>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Members users={workspace.users} counts={workspace._count} />
        <Connectors connectors={connectors} />
        <Sweeps loopRuns={loopRuns} />
      </div>
    </div>
  );
}
