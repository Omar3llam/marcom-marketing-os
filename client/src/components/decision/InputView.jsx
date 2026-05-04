// ============================================================
// MARCOM / Lumi — InputView (FSM state B)
// ------------------------------------------------------------
// Per-mode input shell:
//   campaign → drag/drop CSV + campaign select
//   strategy → 3-step wizard (objective / audience / budget)
//   content  → platform select + textarea
// All three converge on `onSubmit(payload)` which flips the FSM
// to THEATER state.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import {
  Upload, ArrowRight, ArrowLeft, CheckCircle2, X,
} from 'lucide-react';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';
import { api } from '@/lib/api.js';
import { toast } from 'sonner';
import { cn } from '@/lib/utils.js';

const TITLES = {
  campaign: 'Campaign Analysis',
  strategy: 'Strategy Brief',
  content:  'Score Content',
};

export default function InputView({ mode, onSubmit, onCancel }) {
  return (
    <div className="max-w-2xl mx-auto p-6 lg:p-8 animate-fade-in">
      <header className="mb-6">
        <span className="section-label">Mode {mode === 'campaign' ? '3' : mode === 'strategy' ? '2' : '4'}</span>
        <h1 className="mt-1 font-display font-bold text-2xl text-lumi-text">{TITLES[mode]}</h1>
      </header>

      {mode === 'campaign' && <CampaignInput onSubmit={onSubmit} onCancel={onCancel} />}
      {mode === 'strategy' && <StrategyInput onSubmit={onSubmit} onCancel={onCancel} />}
      {mode === 'content'  && <ContentInput  onSubmit={onSubmit} onCancel={onCancel} />}
    </div>
  );
}

// ── CAMPAIGN ────────────────────────────────────────────────
function CampaignInput({ onSubmit, onCancel }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [campaignId, setCampaignId] = useState('');
  const { campaigns, refetch } = useCampaignFeed();

  const pick = (f) => {
    setError(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') return setError('Please upload a .csv file');
    if (f.size > 10 * 1024 * 1024) return setError('File too large (max 10MB)');
    setFile(f);
  };

  const submit = async () => {
    setError(null);
    if (file && !busy) {
      setBusy(true);
      const form = new FormData();
      form.append('campaignData', file);
      try {
        const { data } = await api.post('/api/campaigns/upload-csv', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        toast.success(`Processed ${data.processed} of ${data.uploaded} rows.`);
        await refetch();
        // After upload — pick the most recent CampaignState id (best-effort)
        // The user may also pick from the dropdown that appears after fetch.
        const next = await api.get('/api/lumi/feed').catch(() => null);
        const firstId = next?.data?.campaigns?.[0]?.campaign_id;
        if (!firstId) {
          setError('Upload succeeded but no campaign was created. Try a different CSV.');
          return;
        }
        onSubmit({ campaignId: firstId, source: 'csv-upload' });
      } catch (err) {
        const detail = err.response?.data?.error || err.message || 'Upload failed';
        setError(detail);
      } finally {
        setBusy(false);
      }
      return;
    }

    // No file — pick existing campaign from feed
    if (!campaignId) {
      setError('Pick a campaign from the dropdown, or upload a new CSV.');
      return;
    }
    onSubmit({ campaignId, source: 'feed' });
  };

  return (
    <>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors',
          dragOver
            ? 'border-lumi-accent bg-lumi-accent-soft'
            : 'border-lumi-border bg-lumi-elevated hover:border-lumi-border-strong',
        )}
      >
        <Upload className="w-12 h-12 mx-auto text-lumi-muted" strokeWidth={1.5} />
        <p className="mt-4 font-display font-medium text-lumi-text">
          Drop your Meta Ads CSV or Google Ads CSV here
        </p>
        <p className="mt-1 text-lumi-muted text-sm">or click to browse</p>
        <p className="mt-2 font-mono text-xs text-lumi-subtle">Accepts .csv files up to 10MB</p>
        <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      {file && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-lumi-border bg-lumi-elevated p-3">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-signal-scale" strokeWidth={1.5} />
            <span className="font-display text-sm text-lumi-text truncate">{file.name}</span>
            <span className="font-mono text-xs text-lumi-subtle">{(file.size / 1024).toFixed(1)} KB</span>
          </div>
          <button type="button" aria-label="Remove file" onClick={() => setFile(null)} className="text-lumi-subtle hover:text-lumi-text p-1">
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Existing campaign picker */}
      {campaigns.length > 0 && (
        <div className="mt-6">
          <label className="section-label block mb-2">Or pick an existing campaign</label>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="w-full rounded-xl bg-lumi-elevated border border-lumi-border text-lumi-text font-display text-sm px-3 py-2 focus:border-lumi-accent/60 focus:outline-none"
          >
            <option value="">Select…</option>
            {campaigns.map((c) => (
              <option key={c.campaign_id} value={c.campaign_id}>
                {c.campaign_id} · {c.stage}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 font-mono text-xs text-trend-danger">{error}</p>
      )}

      <Footer onSubmit={submit} onCancel={onCancel} disabled={busy || (!file && !campaignId)} busy={busy} ctaLabel={busy ? 'Uploading…' : 'Analyze with Lumi'} />
    </>
  );
}

// ── STRATEGY ────────────────────────────────────────────────
function StrategyInput({ onSubmit, onCancel }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ objective: '', audience: '', budget: '', timeline: '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const stepValid = step === 0 ? !!form.objective
                  : step === 1 ? form.audience.length >= 10
                  : !!form.budget && !!form.timeline;
  const isLast = step === 2;

  return (
    <>
      <ProgressDots count={3} active={step} />

      {step === 0 && (
        <Field label="What's the campaign objective?">
          <select className={SELECT_CLS} value={form.objective} onChange={(e) => set('objective', e.target.value)}>
            <option value="">Select…</option>
            {['Generate Leads', 'Build Awareness', 'Drive Sales', 'Grow Following', 'Launch Product'].map((o) =>
              <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      )}

      {step === 1 && (
        <Field label="Describe your target audience">
          <textarea
            className={cn(SELECT_CLS, 'min-h-[140px]')}
            value={form.audience}
            onChange={(e) => set('audience', e.target.value)}
            placeholder="e.g. Egyptian B2B marketing managers at SaaS companies, ages 28-45, value efficiency over flash."
          />
          <span className="font-mono text-xs text-lumi-subtle mt-1 block">{form.audience.length} chars</span>
        </Field>
      )}

      {step === 2 && (
        <>
          <Field label="Monthly budget (USD)">
            <div className="relative">
              <span className="absolute left-3 top-2 font-mono text-lumi-muted">$</span>
              <input
                type="number" min="0"
                className={cn(SELECT_CLS, 'pl-7')}
                value={form.budget}
                onChange={(e) => set('budget', e.target.value)}
                placeholder="5000"
              />
            </div>
          </Field>
          <Field label="Timeline">
            <select className={SELECT_CLS} value={form.timeline} onChange={(e) => set('timeline', e.target.value)}>
              <option value="">Select…</option>
              {['1 week', '2 weeks', '1 month', 'Ongoing'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </>
      )}

      <div className="mt-6 flex justify-between gap-2">
        <button
          type="button"
          onClick={() => (step === 0 ? onCancel() : setStep((s) => s - 1))}
          className="inline-flex items-center gap-1 text-sm text-lumi-muted hover:text-lumi-text px-3 py-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.5} />
          {step === 0 ? 'Back to Command Center' : 'Back'}
        </button>
        <button
          type="button"
          disabled={!stepValid}
          onClick={() => isLast ? onSubmit(form) : setStep((s) => s + 1)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-display font-semibold',
            'bg-lumi-accent text-lumi-bg shadow-accent-glow hover:bg-lumi-accent-hover',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {isLast ? 'Generate Strategy' : 'Continue'} <ArrowRight className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
    </>
  );
}

// ── CONTENT ─────────────────────────────────────────────────
function ContentInput({ onSubmit, onCancel }) {
  const [platform, setPlatform] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState(null);

  const valid = !!platform && text.length >= 20;

  return (
    <>
      <Field label="Platform">
        <select className={SELECT_CLS} value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="">Select…</option>
          {['Meta', 'Google', 'LinkedIn', 'TikTok', 'Email'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Paste your ad copy, caption, or landing page text">
        <textarea
          className={cn(SELECT_CLS, 'min-h-[160px] font-body')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Drop your full creative copy here. Min 20 characters."
        />
        <span className="font-mono text-xs text-lumi-subtle mt-1 block">{text.length} chars</span>
      </Field>
      {error && <p role="alert" className="mt-2 font-mono text-xs text-trend-danger">{error}</p>}

      <Footer
        onSubmit={() => valid ? onSubmit({ platform, text }) : setError('Pick a platform and paste at least 20 characters.')}
        onCancel={onCancel}
        disabled={!valid}
        ctaLabel="Analyze with Lumi"
      />
    </>
  );
}

// ── Shared bits ─────────────────────────────────────────────
const SELECT_CLS = 'w-full rounded-xl bg-lumi-elevated border border-lumi-border text-lumi-text font-display text-sm px-3 py-2 focus:border-lumi-accent/60 focus:outline-none placeholder:text-lumi-subtle';

function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <span className="section-label block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function ProgressDots({ count, active }) {
  return (
    <div className="flex items-center gap-1.5 mb-6" aria-label={`Step ${active + 1} of ${count}`}>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all duration-200',
            i === active ? 'w-8 bg-lumi-accent shadow-accent-glow' : i < active ? 'w-6 bg-lumi-accent/40' : 'w-4 bg-lumi-border',
          )}
        />
      ))}
    </div>
  );
}

function Footer({ onSubmit, onCancel, disabled, busy, ctaLabel }) {
  return (
    <div className="mt-6 flex justify-between gap-2">
      <button type="button" onClick={onCancel}
        className="inline-flex items-center gap-1 text-sm text-lumi-muted hover:text-lumi-text px-3 py-2">
        <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.5} /> Back to Command Center
      </button>
      <button type="button" onClick={onSubmit} disabled={disabled}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-display font-semibold',
          'bg-lumi-accent text-lumi-bg shadow-accent-glow hover:bg-lumi-accent-hover',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}>
        {ctaLabel || 'Analyze with Lumi'} <ArrowRight className="w-4 h-4" strokeWidth={2} />
      </button>
    </div>
  );
}
