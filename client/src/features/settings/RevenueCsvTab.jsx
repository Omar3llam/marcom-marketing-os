// ============================================================
// MARCOM / Lumi — Settings · Revenue data (manual actuals upload)
// ------------------------------------------------------------
// Three states: upload → column-mapping → results. Unlocks ROAS for accounts
// with no purchase pixel by uploading campaign revenue. Column mapping is
// REQUIRED (never auto-guess which column is revenue). Unmatched campaigns are
// surfaced honestly. STRATEGIST-only (the upload endpoint enforces it too).
//
// The state-branch views are exported prop-driven for direct unit testing.
// ============================================================
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, RefreshCw, ArrowLeft, Download } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useRevenueCsv } from '@/hooks/useRevenueCsv.js';
import { useRunSweep } from '@/hooks/useRunSweep.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { downloadTemplate, templateCampaignsFor } from './revenueTemplate.js';

const CURRENCIES = ['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'USD', 'EUR', 'GBP'];

// ── State 1 — upload ────────────────────────────────────────────
// The template download is step 1, BEFORE the upload area: pre-filled with the
// user's real campaigns that still need revenue (highest spend first), so the
// flow reads download → fill in revenue → upload. Built in the browser only.
export function UploadState({ onFile, templateCampaigns = [] }) {
  const onInput = (e) => { const f = e.target.files?.[0]; if (f) onFile(f); };
  const n = templateCampaigns.length;
  return (
    <div className="rounded-2xl border border-lumi-border bg-lumi-surface p-6">
      <h3 className="font-display font-semibold text-lumi-text">Upload revenue data</h3>
      <ol className="mt-3 space-y-1 text-sm text-lumi-muted list-decimal list-inside">
        <li>Download the template — or export a campaign report from any platform</li>
        <li>Fill in the revenue for each campaign and upload it back</li>
        <li>Lumi matches your campaigns and unlocks profit-based recommendations</li>
      </ol>
      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-lumi-border bg-lumi-elevated/40 px-4 py-3">
        <p className="text-xs text-lumi-muted">
          {n > 0
            ? `Pre-filled with ${n} campaign${n === 1 ? '' : 's'} that need revenue data`
            : 'Download a blank template'}
        </p>
        <button
          onClick={() => downloadTemplate(templateCampaigns)}
          className="shrink-0 text-xs text-lumi-gold hover:underline flex items-center gap-1"
        >
          <Download size={12} strokeWidth={1.5} />
          Download template CSV
        </button>
      </div>
      <label className="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-lumi-border bg-lumi-elevated/40 px-4 py-8 cursor-pointer hover:border-lumi-accent/50 transition-colors">
        <UploadCloud className="w-6 h-6 text-lumi-accent" strokeWidth={1.5} />
        <span className="text-sm font-medium text-lumi-text">Drop a CSV file here or click to browse</span>
        <span className="text-xs text-lumi-subtle">Required columns: campaign name or ID, and revenue amount</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onInput} />
      </label>
    </div>
  );
}

// ── State 2 — column mapping ────────────────────────────────────
export function MappingState({ columns, preview, mapping, setMapping, currency, setCurrency, onConfirm, onBack, isUploading }) {
  const ColSelect = ({ field, label }) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-lumi-muted">{label}</span>
      <select
        value={mapping[field] ?? ''}
        onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
        className="font-mono text-xs bg-lumi-surface border border-lumi-border rounded px-2 py-1.5 text-lumi-text min-w-[12rem]"
      >
        <option value="">Select a column…</option>
        {columns.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );

  const ready = mapping.identifier && mapping.revenue;

  return (
    <div className="rounded-2xl border border-lumi-border bg-lumi-surface p-6">
      <h3 className="font-display font-semibold text-lumi-text">Map the columns</h3>
      <p className="mt-1 text-sm text-lumi-muted">We found {columns.length} column{columns.length === 1 ? '' : 's'} in your file.</p>

      <div className="mt-4 space-y-3">
        <ColSelect field="identifier" label="Campaign identifier" />
        <ColSelect field="revenue" label="Revenue amount" />
        {/* Optional — deliberately NOT in the `ready` gate. Mapping it unlocks
            Blended CPA for an account with no purchase pixel; leaving it unmapped
            behaves exactly as before (conversions land 0). */}
        <ColSelect field="conversions" label="Conversions (optional)" />
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-lumi-muted">Currency</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="font-mono text-xs bg-lumi-surface border border-lumi-border rounded px-2 py-1.5 text-lumi-text min-w-[12rem]"
          >
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      {ready && preview.length > 0 && (
        <div className="mt-5 rounded-xl border border-lumi-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-lumi-subtle border-b border-lumi-border">
                <th className="px-3 py-2 font-medium">Campaign</th>
                <th className="px-3 py-2 font-medium text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i} className="border-b border-lumi-border/60">
                  <td className="px-3 py-2 font-mono text-lumi-muted truncate">{r[mapping.identifier] || '—'}</td>
                  <td className="px-3 py-2 font-mono text-right text-lumi-text">{r[mapping.revenue] || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        <button
          onClick={onConfirm}
          disabled={!ready || isUploading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-lumi-accent text-white font-display font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? 'Uploading…' : 'Confirm & upload'}
        </button>
        <button onClick={onBack} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-lumi-border text-sm text-lumi-muted hover:text-lumi-text">
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.5} /> Back
        </button>
      </div>
    </div>
  );
}

// ── State 3 — results ───────────────────────────────────────────
export function ResultsState({ result, onRunSweep, sweeping, onDone }) {
  const unmatched = result.unmatched ?? [];
  const errors = result.errors ?? [];
  return (
    <div className="rounded-2xl border border-lumi-border bg-lumi-surface p-6">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-5 h-5 text-signal-scale" strokeWidth={1.5} />
        <h3 className="font-display font-semibold text-lumi-text">
          {result.updated} campaign{result.updated === 1 ? '' : 's'} matched and updated
        </h3>
      </div>

      {(unmatched.length > 0 || errors.length > 0) && (
        <div className="mt-4 rounded-xl border border-lumi-border bg-lumi-elevated/40 p-4">
          <div className="flex items-center gap-2 text-sm text-lumi-text">
            <AlertTriangle className="w-4 h-4 text-signal-hold" strokeWidth={1.5} />
            {unmatched.length + errors.length} row{unmatched.length + errors.length === 1 ? '' : 's'} not applied:
          </div>
          <ul className="mt-2 space-y-1 text-xs text-lumi-muted">
            {unmatched.map((u, i) => <li key={`u${i}`} className="font-mono">• {u.identifier || '(blank)'} — {u.reason}</li>)}
            {errors.map((e, i) => <li key={`e${i}`} className="font-mono">• {e.identifier} — {e.reason}</li>)}
          </ul>
        </div>
      )}

      <p className="mt-4 text-sm text-lumi-muted">ROAS verdicts update on the next sweep — then your campaigns are scored on revenue, not just engagement.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={onRunSweep}
          disabled={sweeping}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-lumi-accent text-white font-display font-semibold text-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${sweeping ? 'animate-spin' : ''}`} strokeWidth={1.5} />
          {sweeping ? 'Sweeping…' : 'Run sweep now'}
        </button>
        <Link to={appRoutes.campaigns} className="px-3 py-2 rounded-lg text-sm font-medium text-lumi-gold hover:underline">
          View updated verdicts →
        </Link>
        <button onClick={onDone} className="px-3 py-2 rounded-lg border border-lumi-border text-sm text-lumi-muted hover:text-lumi-text">Done</button>
      </div>
    </div>
  );
}

// ── Container ───────────────────────────────────────────────────
export default function RevenueCsvTab() {
  const { role } = useCollabRole();
  const { workspace } = useWorkspace();
  const { parse, upload, isUploading, result, error, reset } = useRevenueCsv();
  const { runSweep, sweeping } = useRunSweep();
  // Existing connector hook (existing endpoint) — the only source of the user's
  // real campaign names for the pre-filled template. Loading/empty degrade to a
  // blank template; the CSV itself is always built client-side.
  const { campaigns: connectorCampaigns } = useConnectorCampaigns();
  const templateCampaigns = useMemo(() => templateCampaignsFor(connectorCampaigns), [connectorCampaigns]);

  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({ identifier: '', revenue: '', conversions: '' });
  const [currency, setCurrency] = useState(workspace?.currency || 'USD');

  // STRATEGIST-only: revenue is a portfolio-truth input (the endpoint enforces it too).
  //
  // Phase 5.12 — the `role &&` short-circuit is gone. Since 5.11 `role` is null
  // whenever the seat was not READ, and `null && …` is falsy, so an unresolved
  // seat SKIPPED this refusal and rendered the upload form: the guard failed
  // OPEN on exactly the input it exists to stop. Nothing reached it, because
  // MainLayout holds the shell on an unread seat and the section gate in
  // SettingsView now holds this tab as well — but a guard that is correct only
  // because two other guards fired first is not a guard.
  //
  // It is kept rather than deleted, as deliberate redundancy: the audience is
  // declared once in the route manifest, and this is the component refusing on
  // its own account if it is ever mounted from somewhere else.
  if (role !== WORKSPACE_ROLE.STRATEGIST) {
    return (
      <div className="rounded-2xl border border-lumi-border bg-lumi-surface p-6 flex items-center gap-3">
        <FileText className="w-5 h-5 text-lumi-subtle" strokeWidth={1.5} />
        <p className="text-sm text-lumi-muted">Only a strategist can add revenue data for this workspace.</p>
      </div>
    );
  }

  const onFile = async (file) => {
    try {
      const p = await parse(file);
      if (!p.columns.length) { toast.error('Could not read any columns from that file.'); return; }
      setParsed(p);
      setMapping({ identifier: '', revenue: '', conversions: '' });
    } catch {
      toast.error('Could not parse that CSV file.');
    }
  };

  const onConfirm = async () => {
    const rows = parsed.rows
      .map((r) => ({
        campaignIdentifier: r[mapping.identifier],
        revenueAmount: r[mapping.revenue],
        // Omitted entirely when the optional column is unmapped — the backend
        // then lands 0, exactly as it did before this column existed.
        ...(mapping.conversions ? { conversions: r[mapping.conversions] } : {}),
        currency,
      }))
      .filter((r) => String(r.campaignIdentifier ?? '').trim() !== '');
    if (!rows.length) { toast.error('No rows with a campaign identifier to upload.'); return; }
    try {
      const res = await upload(rows);
      toast.success(`${res.updated} campaign${res.updated === 1 ? '' : 's'} updated.`);
    } catch {
      toast.error(error || 'Upload failed.');
    }
  };

  const onRunSweep = async () => {
    const ok = await runSweep();
    if (ok) toast.success('Sweep started — verdicts will update shortly.');
  };

  const restart = () => { setParsed(null); setMapping({ identifier: '', revenue: '', conversions: '' }); reset(); };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="decision-title text-lumi-text">Revenue data</h2>
        <p className="text-sm text-lumi-muted">Add campaign revenue so recommendations are based on profit, not just engagement — no purchase pixel needed.</p>
      </div>

      {result
        ? <ResultsState result={result} onRunSweep={onRunSweep} sweeping={sweeping} onDone={restart} />
        : parsed
          ? <MappingState
              columns={parsed.columns} preview={parsed.preview}
              mapping={mapping} setMapping={setMapping}
              currency={currency} setCurrency={setCurrency}
              onConfirm={onConfirm} onBack={restart} isUploading={isUploading}
            />
          : <UploadState onFile={onFile} templateCampaigns={templateCampaigns} />}
    </div>
  );
}
