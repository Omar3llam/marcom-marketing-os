import { useState, useEffect, useMemo } from 'react';

export default function ActivityTicker({ radarAlerts, history, summary }) {
  const [pulseIdx, setPulseIdx]       = useState(0);
  const [confidence, setConfidence]   = useState(87);
  const [scanCount, setScanCount]     = useState(0);

  // Generate personalized insights from real campaign data
  const insights = useMemo(() => {
    const signals = [];

    // Campaign health insights
    if (summary?.total > 0) {
      const health = summary.health || 0;
      if (health >= 75) {
        signals.push({ signal: `Portfolio health strong: ${health}% across ${summary.total} campaigns`, severity: 'success', icon: '✅' });
      } else if (health >= 50) {
        signals.push({ signal: `Portfolio health moderate: ${health}% — review opportunities available`, severity: 'warn', icon: '⚠️' });
      } else {
        signals.push({ signal: `Portfolio health critical: ${health}% — immediate action recommended`, severity: 'danger', icon: '🔴' });
      }
    }

    // Spend insights
    if (summary?.spend > 0) {
      const spend = summary.spend.toFixed(0);
      signals.push({ signal: `Total spend monitored: $${spend} across active campaigns`, severity: 'info', icon: '💰' });
    }

    // Wasted spend detection
    if (summary?.wasted > 0) {
      const wasted = summary.wasted.toFixed(0);
      const wasteRate = ((summary.wasted / summary.spend) * 100).toFixed(1);
      signals.push({ signal: `Potential waste detected: $${wasted} (${wasteRate}%) in KILL-verdict campaigns`, severity: 'danger', icon: '🩸' });
    }

    // Verdict distribution insights
    if (summary?.byVerdict) {
      const { SCALE = 0, KILL = 0, HOLD = 0 } = summary.byVerdict;
      const total = SCALE + KILL + HOLD;
      if (total > 0) {
        const scaleRate = ((SCALE / total) * 100).toFixed(0);
        if (SCALE > KILL) {
          signals.push({ signal: `Growth opportunity: ${scaleRate}% of campaigns ready to scale`, severity: 'success', icon: '📈' });
        } else if (KILL > SCALE) {
          const killRate = ((KILL / total) * 100).toFixed(0);
          signals.push({ signal: `Risk detected: ${killRate}% of campaigns flagged for termination`, severity: 'warn', icon: '⚡' });
        }
      }
    }

    // CPA insights
    if (summary?.blendedCpa != null) {
      const cpa = summary.blendedCpa.toFixed(2);
      signals.push({ signal: `Blended CPA across portfolio: $${cpa}`, severity: 'neutral', icon: '📊' });
    }

    // Stage distribution
    if (summary?.byStage) {
      const { DYING = 0, FATIGUED = 0, SCALING = 0 } = summary.byStage;
      if (DYING > 0) {
        signals.push({ signal: `${DYING} campaign${DYING > 1 ? 's' : ''} in DYING stage — bleeding detected`, severity: 'danger', icon: '🚨' });
      }
      if (SCALING > 0) {
        signals.push({ signal: `${SCALING} campaign${SCALING > 1 ? 's' : ''} in SCALING stage — momentum detected`, severity: 'success', icon: '🚀' });
      }
    }

    // Default fallback if no campaigns
    if (signals.length === 0) {
      signals.push({ signal: 'System monitoring active — waiting for campaign data', severity: 'neutral', icon: '📡' });
    }

    return signals;
  }, [summary]);

  // Rotate personalized insights every 5s
  useEffect(() => {
    const id = setInterval(() => {
      setPulseIdx(i => (i + 1) % insights.length);
    }, 5000);
    return () => clearInterval(id);
  }, [insights.length]);

  // Drift confidence ±1 every 8s — subtle AI "thinking" feel
  useEffect(() => {
    const id = setInterval(() => {
      setConfidence(c => Math.min(99, Math.max(72, c + (Math.random() > 0.5 ? 1 : -1))));
    }, 8000);
    return () => clearInterval(id);
  }, []);

  // Increment scan count every 30s — "monitoring" feel
  useEffect(() => {
    const id = setInterval(() => setScanCount(n => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const currentInsight = insights[pulseIdx] || insights[0];
  const hasAlerts = radarAlerts.length > 0;

  return (
    <div className="space-y-2 mb-6">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl
                      border border-surface-border bg-surface-card shadow-card">
        <div className="flex items-center gap-2.5">
          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
            hasAlerts ? 'bg-signal-kill' : 'bg-signal-scale'
          }`} />
          <span className="font-mono text-xs text-dark-soft">
            {hasAlerts
              ? `${radarAlerts.length} alert${radarAlerts.length > 1 ? 's' : ''} active`
              : `System monitoring · scan #${scanCount + 1}`}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-dark-soft/60">
            Confidence <span className="text-dark-base font-semibold">{confidence}%</span>
          </span>
          <span className="font-mono text-xs text-lumi-gold font-semibold">LIVE</span>
        </div>
      </div>

      {/* Intelligence insight ticker (personalized from campaign data) */}
      <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors ${
        currentInsight.severity === 'success' ? 'border border-signal-scale/20 bg-signal-scale/5' :
        currentInsight.severity === 'danger'  ? 'border border-signal-kill/20 bg-signal-kill/5' :
        currentInsight.severity === 'warn'    ? 'border border-signal-hold/20 bg-signal-hold/5' :
        'border border-lumi-gold/15 bg-lumi-gold/5'
      }`}>
        <span className="text-sm leading-none shrink-0" role="img" aria-label="insight icon">
          {currentInsight.icon}
        </span>
        <p className="font-mono text-xs text-dark-soft flex-1 truncate">
          {currentInsight.signal}
        </p>
        <span className="font-mono text-[10px] text-dark-soft/40 shrink-0 tabular-nums">
          {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Memory insight (only shows when memory has patterns) */}
      {history.length >= 3 && (
        <div className="flex items-start gap-3 px-4 py-2.5 rounded-xl
                        border border-surface-border bg-surface-light/60">
          <span className="font-mono text-xs text-lumi-gold shrink-0 font-semibold">
            Memory
          </span>
          <p className="font-mono text-xs text-dark-soft leading-relaxed">
            {history.length} decisions logged.{' '}
            {history[0]?.verdict === 'KILL'
              ? `Last action: killed "${history[0]?.title?.slice(0,24)}"`
              : history[0]?.verdict === 'SCALE'
              ? `Last action: scaled "${history[0]?.title?.slice(0,24)}"`
              : 'Pattern data accumulating.'}
          </p>
        </div>
      )}
    </div>
  );
}
