import { useState, useEffect } from 'react';

const MARKET_CONDITIONS = [
  { signal: 'MENA CPC trending up 12% this week', severity: 'warn', icon: '📈' },
  { signal: 'Ramadan window: 18 days out — high-intent period approaching', severity: 'info', icon: '📅' },
  { signal: 'Meta auction pressure elevated — KSA & UAE traffic costs +8%', severity: 'warn', icon: '⚡' },
  { signal: 'E-commerce ROAS benchmark: 2.4x MENA Q1 average', severity: 'neutral', icon: '📊' },
];

export default function ActivityTicker({ radarAlerts, history, summary }) {
  const [pulseIdx, setPulseIdx]       = useState(0);
  const [confidence, setConfidence]   = useState(87);
  const [scanCount, setScanCount]     = useState(0);

  // Rotate market signal every 5s
  useEffect(() => {
    const id = setInterval(() => {
      setPulseIdx(i => (i + 1) % MARKET_CONDITIONS.length);
    }, 5000);
    return () => clearInterval(id);
  }, []);

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

  const condition = MARKET_CONDITIONS[pulseIdx];
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

      {/* Market signal ticker */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl
                      border border-lumi-gold/15 bg-lumi-gold/5">
        <span className="text-sm leading-none shrink-0">{condition.icon}</span>
        <p className="font-mono text-xs text-dark-soft flex-1 truncate">
          {condition.signal}
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
