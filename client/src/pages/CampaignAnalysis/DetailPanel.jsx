// ============================================================
// MARCOM / Lumi — Campaign Detail Panel (right slide)
// ============================================================
// 460px panel, slides from right, ESC to close
// Campaign diagnosis + Fix Content / Adjust Budget CTAs
// ============================================================
import { useEffect } from 'react';
import { X, Send, BarChart, Brain, Database, ArrowRight } from 'lucide-react';
import { StagePill } from '@/components/ui/DecisionPill.jsx';
import HealthBar from './HealthBar.jsx';

export default function DetailPanel({ alert, workspace, onClose, onFixContent, onAdjustBudget }) {
  // ESC to close
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const health = alert.verdict === 'KILL' ? 28 : alert.verdict === 'HOLD' ? 56 : 82;

  // Extract metrics from alert
  const getMetric = (key) => {
    const m = alert.metrics?.find((metric) => metric.metric?.toLowerCase() === key.toLowerCase());
    return m?.value || '—';
  };

  const metrics = {
    spend: getMetric('spend') || getMetric('amount spent'),
    ctr: getMetric('ctr'),
    roas: getMetric('roas'),
    freq: getMetric('frequency') || getMetric('freq'),
  };

  const diagnosis = alert.analysis?.root_cause || 'Performance degradation detected. Review metrics and consider adjustments.';
  const memory = alert.analysis?.memory || 'No historical decision memory available for this campaign.';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/25 animate-fade-in"
        style={{ animation: 'fadeIn 280ms ease-out' }}
      />

      {/* Panel */}
      <aside
        className="fixed top-0 right-0 bottom-0 z-50 w-[460px] max-w-[90vw] bg-surface-card border-l border-surface-border shadow-2xl flex flex-col"
        style={{ animation: 'slideInRight 280ms cubic-bezier(0.16,1,0.3,1)' }}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-surface-border">
          <div className="flex items-start justify-between gap-3.5 mb-3.5">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] tracking-[0.1em] uppercase text-dark-muted mb-1.5">
                Campaign · {alert.time}
              </div>
              <h2 className="font-display font-bold text-lg tracking-tight text-dark-base leading-snug">
                {alert.campaign}
              </h2>
              <div className="font-mono text-[11px] text-dark-muted mt-1">{alert.adset}</div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-dark-muted hover:text-dark-base transition-colors"
              aria-label="Close panel"
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="flex items-center gap-3.5">
            <StagePill stage={alert.stage} />
            <span className="text-dark-subtle">·</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-dark-muted">
                Health
              </span>
              <HealthBar health={health} />
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {/* Performance */}
          <Section title="Performance" hint="last 14 days">
            <div className="grid grid-cols-4 gap-2.5">
              <Metric label="Spend" value={`${workspace?.currency || 'USD'} ${metrics.spend}`} />
              <Metric label="CTR" value={metrics.ctr} />
              <Metric label="ROAS" value={metrics.roas} />
              <Metric label="Frequency" value={metrics.freq} />
            </div>
          </Section>

          {/* AI Diagnosis */}
          <Section title="AI Diagnosis" Icon={Brain}>
            <div className="px-4 py-3.5 bg-lumi-accent/[0.06] border border-lumi-accent/25 rounded-lg">
              <p className="text-[13px] text-dark-soft leading-relaxed">{diagnosis}</p>
            </div>
          </Section>

          {/* Recommended action */}
          <Section title="Recommended action">
            <div className="flex flex-col gap-2">
              <button
                onClick={onFixContent}
                className="w-full flex items-center gap-2.5 px-3.5 py-3 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-[13px] shadow-accent-glow"
              >
                <Send className="w-3.5 h-3.5" strokeWidth={1.5} />
                Fix content in Content Lab
                <ArrowRight className="w-3.5 h-3.5 ml-auto" strokeWidth={1.5} />
              </button>
              <button
                onClick={onAdjustBudget}
                className="w-full flex items-center gap-2.5 px-3.5 py-[11px] bg-surface-elevated hover:bg-surface-card border border-surface-border hover:border-lumi-accent/40 text-dark-base rounded-lg transition-all font-display font-medium text-[13px]"
              >
                <BarChart className="w-3.5 h-3.5" strokeWidth={1.5} />
                Adjust budget · review verdict
                <ArrowRight className="w-3.5 h-3.5 ml-auto" strokeWidth={1.5} />
              </button>
            </div>
          </Section>

          {/* Decision memory */}
          <Section title="Decision memory" Icon={Database}>
            <div className="px-3.5 py-3 bg-surface-elevated border border-surface-border rounded-lg text-xs text-dark-soft italic leading-relaxed">
              &ldquo;{memory}&rdquo;
            </div>
          </Section>
        </div>
      </aside>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(40px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}

function Section({ title, Icon, hint, children }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-[13px] h-[13px] text-lumi-accent" strokeWidth={1.5} />}
          <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-dark-base font-semibold">
            {title}
          </span>
        </div>
        {hint && <span className="font-mono text-[10px] text-dark-subtle">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="px-3 py-2.5 bg-surface-elevated rounded-lg">
      <div className="font-mono text-[9px] tracking-[0.08em] uppercase text-dark-muted">
        {label}
      </div>
      <div className="font-mono tabular-nums text-sm font-bold text-dark-base mt-0.5">
        {value}
      </div>
    </div>
  );
}
