// ============================================================
// Lumi — Growth + Calendar pages
// ============================================================

import { Icons } from './icons.jsx';
import { SectionLabel } from './primitives.jsx';

// ── Growth ───────────────────────────────────────────────────
export function GrowthPage({ workspace, onNav }) {
  const opportunities = [
    {
      Icon: Icons.BarChart,
      title: 'Budget reallocation',
      tag: 'BUDGET',
      tagColor: 'var(--c-gold-deep)',
      lead: '+23% ROAS opportunity',
      body: 'Move EGP 600/day from Eid Carousel (dying) → PMax Warm (stable 4.8x).',
      cta: 'Open verdict',
      action: () => onNav('campaigns'),
    },
    {
      Icon: Icons.Target,
      title: 'Audience expansion',
      tag: 'AUDIENCE',
      tagColor: 'var(--c-stage-scaling)',
      lead: 'New segment detected',
      body: 'Lookalike 1% on PMax warm purchasers — projected CPA EGP 168 (vs current 248).',
      cta: 'Stage test',
      action: null,
    },
    {
      Icon: Icons.Send,
      title: 'Creative testing',
      tag: 'CREATIVE',
      tagColor: 'var(--c-stage-testing)',
      lead: '3 variants ready',
      body: 'Lumi drafted 3 Eid hooks in your tone. Diagnosed weak hook — replace top variant first.',
      cta: 'Open Content Lab',
      action: () => onNav('content'),
    },
  ];

  const memory = [
    { date: 'May 19', text: 'Eid Carousel killed at EGP 312 CPA. Reallocated to PMax Warm. ROAS recovered to 4.8x in 6 days.' },
    { date: 'May 12', text: 'Tested UGC creators on Reels TOFU. 2 of 3 underperformed; one scaled to 2x.' },
    { date: 'May 04', text: 'Q1 Static Broad killed — 14-day fatigue threshold confirmed for Egypt cold launches.' },
  ];

  return (
    <div data-screen-label="Growth" style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 32px 24px' }}>
      <header style={{ marginBottom: 24 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
          Growth · CMO memory layer
        </div>
        <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
          3 growth signals worth your attention.
        </h1>
      </header>

      {/* Opportunity cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 32 }}>
        {opportunities.map((o) => (
          <div key={o.title} style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 20, boxShadow: 'var(--sh-card)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="font-mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', padding: '2px 7px', borderRadius: 3, background: `${o.tagColor}1a`, color: o.tagColor }}>
                {o.tag}
              </span>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(246,201,69,0.10)', color: 'var(--c-gold-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <o.Icon style={{ fontSize: 16 }} />
              </div>
            </div>
            <div>
              <div className="font-display" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--c-text-base)' }}>{o.title}</div>
              <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-gold-deep)', fontWeight: 600, marginTop: 2 }}>{o.lead}</div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--c-text-soft)', lineHeight: 1.55, margin: 0, flex: 1 }}>{o.body}</p>
            <button
              onClick={o.action}
              disabled={!o.action}
              className={o.action ? 'btn-gold' : 'btn-ghost'}
              style={{ padding: '9px 14px', fontSize: 12, justifyContent: 'center', opacity: o.action ? 1 : 0.5, cursor: o.action ? 'pointer' : 'not-allowed' }}
            >
              {o.cta}
              {o.action && <Icons.ArrowRight style={{ fontSize: 12 }} />}
            </button>
          </div>
        ))}
      </div>

      {/* Memory layer */}
      <SectionLabel accent right={<span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>last 30 days</span>}>
        Decision memory
      </SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--sh-card)' }}>
        {memory.map((m, i) => (
          <div key={m.date} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 18, padding: '16px 18px', borderBottom: i === memory.length - 1 ? 'none' : '1px solid var(--c-surface-border)', alignItems: 'flex-start' }}>
            <div>
              <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{m.date}</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--c-text-soft)', lineHeight: 1.6, fontStyle: 'italic' }}>{m.text}</div>
          </div>
        ))}
      </div>

      {/* Strategic priorities */}
      <div style={{ marginTop: 32 }}>
        <SectionLabel accent>Next 30 days · strategic priorities</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {[
            { title: 'Diversify creative library', detail: '3 UGC creator variants by month-end · Lumi-drafted briefs ready.' },
            { title: 'Scale PMax warm 2×',         detail: 'Currently 4.8x stable. Lift over 4 days, monitor frequency cap.' },
            { title: 'Test Snap influencer mix',   detail: 'Cross-channel signal from KSA workspace suggests +30% CPA improvement.' },
            { title: 'Memory audit — Q1 KILLs',    detail: 'Review 7 dead campaigns. Cluster fatigue patterns for cold-audience model.' },
          ].map((p) => (
            <div key={p.title} style={{ padding: 16, background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, boxShadow: 'var(--sh-card)' }}>
              <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text-base)' }}>{p.title}</div>
              <div style={{ fontSize: 12, color: 'var(--c-text-soft)', marginTop: 4, lineHeight: 1.55 }}>{p.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Calendar ─────────────────────────────────────────────────
export function CalendarPage({ workspace, onNav }) {
  const today = new Date(2026, 4, 24); // May 24, 2026 — locked for demo
  const startDay = new Date(today);
  startDay.setDate(today.getDate() - today.getDay()); // back to Sunday
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(startDay);
    d.setDate(startDay.getDate() + i);
    return d;
  });
  const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Demo posts pinned to specific dates
  const POSTS = {
    [0]:  { platform: 'IG',     tag: 'STORY',     title: 'Eid drop teaser · gold reel',     verdict: 'SCHEDULED' },
    [2]:  { platform: 'TT',     tag: 'UGC',       title: 'Layla try-on · 18s',              verdict: 'DRAFT' },
    [3]:  { platform: 'IG',     tag: 'STATIC',    title: 'New collection · carousel',        verdict: 'NEEDS REVIEW' },
    [5]:  { platform: 'X',      tag: 'TEXT',      title: 'Behind the stitch · thread',       verdict: 'SCHEDULED' },
    [7]:  { platform: 'IG',     tag: 'REEL',      title: 'Friday prep — Eid week',           verdict: 'DRAFT' },
    [9]:  { platform: 'TT',     tag: 'TREND',     title: 'Hand-stitched detail close-up',    verdict: 'SCHEDULED' },
    [10]: { platform: 'LN',     tag: 'POST',      title: 'Brand story · long-form',          verdict: 'DRAFT' },
    [12]: { platform: 'IG',     tag: 'STATIC',    title: '3,400 women — proof post',         verdict: 'SCHEDULED' },
    [14]: { platform: 'IG',     tag: 'REEL',      title: 'Eid countdown · 48h',              verdict: 'NEEDS REVIEW' },
    [16]: { platform: 'TT',     tag: 'UGC',       title: 'Atelier walkthrough · 30s',        verdict: 'DRAFT' },
    [18]: { platform: 'IG',     tag: 'CAROUSEL',  title: 'Final pieces · last call',         verdict: 'SCHEDULED' },
    [21]: { platform: 'X',      tag: 'TEXT',      title: 'Thank you — Eid recap',            verdict: 'DRAFT' },
    [24]: { platform: 'IG',     tag: 'STORY',     title: 'Summer prep — preview',            verdict: 'DRAFT' },
  };

  const platformColor = { IG: 'var(--c-stage-testing)', TT: 'var(--c-text-base)', X: 'var(--c-text-soft)', LN: 'var(--c-stage-scaling)', SN: 'var(--c-hold)' };
  const verdictColor = { SCHEDULED: 'var(--c-scale-text)', DRAFT: 'var(--c-text-muted)', 'NEEDS REVIEW': 'var(--c-hold-text)' };

  const isToday = (d) => d.toDateString() === today.toDateString();
  const monthName = today.toLocaleString('en-US', { month: 'long' });

  return (
    <div data-screen-label="Calendar" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 24px' }}>
      <header style={{ marginBottom: 20, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
            Calendar · 4-week plan
          </div>
          <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
            {monthName} {today.getFullYear()} · 13 posts planned.
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" style={{ padding: '10px 14px', fontSize: 13 }}>
            <Icons.Eye style={{ fontSize: 13 }} />
            View list
          </button>
          <button onClick={() => onNav('content')} className="btn-gold" style={{ padding: '10px 16px', fontSize: 13 }}>
            <Icons.Plus style={{ fontSize: 14 }} />
            New post
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['All platforms','IG','TikTok','X','LinkedIn'].map((p, i) => (
            <button key={p} className="font-mono" style={{
              padding: '6px 12px',
              background: i === 0 ? 'var(--c-lumi-elevated)' : 'var(--c-surface-card)',
              border: '1px solid var(--c-surface-border)',
              color: i === 0 ? 'var(--c-text-base)' : 'var(--c-text-muted)',
              borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
            }}>{p}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: 'var(--c-text-muted)' }} className="font-mono">
          <LegendDot color="var(--c-scale-text)"  label="Scheduled" />
          <LegendDot color="var(--c-hold-text)"   label="Needs review" />
          <LegendDot color="var(--c-text-muted)"  label="Draft" />
        </div>
      </div>

      {/* Calendar grid */}
      <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--sh-card)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'var(--c-surface-elevated)', borderBottom: '1px solid var(--c-surface-border)' }}>
          {dayLabels.map((d) => (
            <div key={d} className="font-mono" style={{ padding: '10px 12px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
              {d}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {days.map((d, i) => {
            const post = POSTS[i];
            const todayCell = isToday(d);
            return (
              <div key={i} style={{
                minHeight: 110,
                padding: 10,
                borderRight: (i + 1) % 7 === 0 ? 'none' : '1px solid var(--c-surface-border)',
                borderBottom: i < 21 ? '1px solid var(--c-surface-border)' : 'none',
                background: todayCell ? 'rgba(246,201,69,0.04)' : 'transparent',
                position: 'relative',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span className={todayCell ? 'font-display' : 'font-mono'} style={{
                    fontSize: 12,
                    fontWeight: todayCell ? 700 : 500,
                    color: todayCell ? 'var(--c-gold-deep)' : 'var(--c-text-muted)',
                    background: todayCell ? 'var(--c-gold)' : 'transparent',
                    color: todayCell ? 'var(--c-text-base)' : 'var(--c-text-muted)',
                    padding: todayCell ? '2px 6px' : 0,
                    borderRadius: todayCell ? 4 : 0,
                  }}>
                    {d.getDate()}
                  </span>
                </div>
                {post && (
                  <div style={{
                    padding: '6px 8px',
                    background: 'var(--c-surface-elevated)',
                    border: '1px solid var(--c-surface-border)',
                    borderLeft: `3px solid ${verdictColor[post.verdict]}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'all 150ms',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--c-surface-card)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'var(--c-surface-elevated)'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                      <span className="font-mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', padding: '1px 4px', borderRadius: 2, background: `${platformColor[post.platform]}1a`, color: platformColor[post.platform] }}>{post.platform}</span>
                      <span className="font-mono" style={{ fontSize: 8, letterSpacing: '0.06em', color: 'var(--c-text-subtle)' }}>{post.tag}</span>
                    </div>
                    <div className="font-display" style={{ fontSize: 11, fontWeight: 500, color: 'var(--c-text-base)', lineHeight: 1.3 }}>
                      {post.title}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ marginTop: 14, display: 'flex', gap: 12, padding: '12px 16px', background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 10 }}>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>
          <strong style={{ color: 'var(--c-text-base)' }}>13 posts</strong> · 6 scheduled · 5 drafts · 2 need review
        </span>
        <span style={{ color: 'var(--c-text-subtle)' }}>·</span>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>
          Posting cadence: <span style={{ color: 'var(--c-gold-deep)' }}>5 – 10 / week</span> (matches onboarding)
        </span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 2, background: color, borderRadius: 2 }} />
      <span>{label}</span>
    </span>
  );
}

