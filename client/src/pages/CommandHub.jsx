// ============================================================
// MARCOM / Lumi — CommandHub  (/app/feed)
// ------------------------------------------------------------
// OS launchpad. Greeting + 3 mode cards + recent activity strip
// + quick stats. No chat, no message bubbles, no dashboard
// widgets — three action paths and a status read.
// ============================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';
import {
  BarChart3, Target, ScanSearch, Sparkles, ArrowRight, Circle, CloudUpload,
} from 'lucide-react';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';
import { VerdictPill }     from '@/components/ui/DecisionPill.jsx';
import { cn }              from '@/lib/utils.js';

export default function CommandHub() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { campaigns, summary, loading } = useCampaignFeed();

  const greetingName = user?.firstName || user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'there';

  return (
    <div className="flex flex-col h-full p-6 lg:p-12 animate-fade-in">
      {/* ── HEADER ──────────────────────────────────────────── */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-10">
        <div>
          <h1 className="font-display font-bold text-2xl text-lumi-text">
            {greeting()}, {greetingName}.
          </h1>
          <p className="mt-1 text-lumi-muted font-body text-sm">
            Context is locked. Select your mode.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 bg-signal-scale/10 border border-signal-scale/25 px-2.5 py-1 rounded-full self-start sm:self-auto">
          <Circle className="w-2 h-2 fill-signal-scale text-signal-scale" strokeWidth={0} />
          <span className="text-xs font-display font-semibold text-signal-scale tracking-wide">
            Context: Locked
          </span>
        </div>
      </header>

      {/* ── MODE CARDS ──────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ModeCard
          mode="MODE 3"
          title="Analyze Campaign Data"
          body="Upload your Meta or Google Ads CSV. Get SCALE/HOLD/KILL verdicts with financial impact analysis and wasted-spend breakdown."
          cta="Upload CSV & Analyze"
          icon={BarChart3}
          accent="accent"
          onClick={() => navigate('/app/campaigns')}
        />
        <ModeCard
          mode="MODE 2"
          title="Generate Campaign Brief"
          body="Brief Lumi on your goal. Get a structured campaign strategy tied to your commercial reality. No generic templates."
          cta="Start strategy session"
          icon={Target}
          accent="cyan"
          onClick={() => navigate('/app/growth')}
        />
        <ModeCard
          mode="MODE 4"
          title="Score Content"
          body="Paste any ad, post, or landing page copy. Lumi runs the 10-step MARCOM framework and returns structured scores with rewrites."
          cta="Submit content"
          icon={ScanSearch}
          accent="amber"
          onClick={() => navigate('/app/tools/score')}
        />
      </section>

      {/* ── RECENT ACTIVITY ─────────────────────────────────── */}
      <section className="mt-12 flex-1 min-h-0">
        <div className="section-label mb-3">Recent Activity</div>
        <RecentActivity loading={loading} campaigns={campaigns} />
      </section>

      {/* ── QUICK STATS BAR ─────────────────────────────────── */}
      <QuickStats summary={summary} loading={loading} />
    </div>
  );
}

// ── ModeCard ───────────────────────────────────────────────
const ACCENT = {
  accent: { icon: 'text-lumi-accent  bg-lumi-accent-soft',  badge: 'text-lumi-accent  bg-lumi-accent-soft',  cta: 'text-lumi-accent' },
  cyan:   { icon: 'text-stage-scaling bg-stage-scaling/10', badge: 'text-stage-scaling bg-stage-scaling/10', cta: 'text-stage-scaling' },
  amber:  { icon: 'text-signal-hold  bg-signal-hold-bg',    badge: 'text-signal-hold  bg-signal-hold-bg',    cta: 'text-signal-hold' },
};

function ModeCard({ mode, title, body, cta, icon: Icon, accent, onClick }) {
  const c = ACCENT[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex flex-col items-start text-left bg-lumi-surface border border-lumi-border rounded-2xl p-6 lg:p-8',
        'hover:border-lumi-accent/40 hover:shadow-accent-glow transition-all duration-200',
        'focus-visible:border-lumi-accent/60 min-h-[44px]',
      )}
    >
      <span className={cn('text-xs font-mono px-2 py-1 rounded-lg', c.badge)}>{mode}</span>
      <div className={cn('mt-4 w-12 h-12 rounded-xl p-2.5 flex items-center justify-center', c.icon)}>
        <Icon className="w-7 h-7" strokeWidth={1.5} />
      </div>
      <h3 className="mt-4 font-display font-bold text-lg text-lumi-text">{title}</h3>
      <p className="mt-2 text-lumi-muted text-sm leading-relaxed">{body}</p>
      <span className={cn('mt-6 font-display font-medium text-sm inline-flex items-center gap-1 group-hover:underline', c.cta)}>
        {cta} <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
      </span>
    </button>
  );
}

// ── Recent activity (no fake data — empty state by default) ─
function RecentActivity({ loading, campaigns }) {
  if (loading) {
    return (
      <div className="grid gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 rounded-xl border border-lumi-border bg-lumi-surface animate-shimmer" />
        ))}
      </div>
    );
  }

  // Flatten alerts, take the 5 most recent — derived from real feed only.
  const recent = campaigns.flatMap((c) =>
    (c.alerts ?? []).map((a) => ({
      id: a.action_id,
      campaign:  c.campaign_id,
      verdict:   a.analysis?.verdict || 'HOLD',
      summary:   a.analysis?.root_cause || a.action_plan?.action || '—',
    })),
  ).slice(0, 5);

  if (recent.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-10 text-center">
        <Sparkles className="w-8 h-8 mx-auto text-lumi-accent" strokeWidth={1.5} />
        <p className="mt-3 text-lumi-text font-display">Context locked. Now add your campaign data.</p>
        <p className="mt-1 text-lumi-muted text-sm">
          Upload your first CSV from Meta Ads Manager or Google Ads.
        </p>
      </div>
    );
  }

  return (
    <ul className="rounded-2xl border border-lumi-border bg-lumi-surface divide-y divide-lumi-border/60 overflow-hidden">
      {recent.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-lumi-elevated/40 transition-colors">
          <div className="min-w-0 flex-1">
            <div className="font-display text-sm text-lumi-text truncate">{r.campaign}</div>
            <div className="text-xs text-lumi-muted truncate">{r.summary}</div>
          </div>
          <VerdictPill verdict={r.verdict} />
        </li>
      ))}
    </ul>
  );
}

// ── Quick stats strip ──────────────────────────────────────
function QuickStats({ summary, loading }) {
  const items = [
    { label: 'Active campaigns', value: summary.total },
    { label: 'Pending decisions', value: summary.pending },
    { label: 'Total analyzed',    value: summary.total },
    { label: 'Health',            value: summary.total > 0 ? `${summary.health}/100` : '—' },
  ];

  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-lumi-border pt-4">
      {items.map((it, i) => (
        <div key={it.label} className={cn('flex items-baseline gap-2', i > 0 && 'sm:border-l sm:border-lumi-border sm:pl-6')}>
          <span className="font-mono text-sm text-lumi-text font-medium tabular-nums">
            {loading ? '—' : it.value}
          </span>
          <span className="text-xs text-lumi-muted">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
