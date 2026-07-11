// ============================================================
// MARCOM — AI Insight Card (Overview AI Insight layer)
// ============================================================
// Shows pre-generated portfolio briefing (1-2 sentences) from LoopRun.aiInsight.
// Deterministic stats always shown. LLM prose shown when available, honest null
// state ("Insight will appear after the next sweep") when not yet generated.
// ============================================================
import { Sparkles } from 'lucide-react';

export default function AIInsightCard({ insight, healthScore, healthLabel }) {
  return (
    <div className="card-raised p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-lumi-text flex items-center gap-2">
          <Sparkles size={14} className="text-lumi-accent" />
          AI Insight
        </h3>
        <span className="text-xs text-lumi-muted">updated recently</span>
      </div>

      {/* Deterministic stats — always shown when available */}
      {healthScore != null && (
        <p className="text-xs text-lumi-muted mb-2">
          <span className="font-semibold text-lumi-text">{healthScore}/100</span> account health
          {healthLabel && ` · ${healthLabel}`}
        </p>
      )}

      {/* LLM insight — shown when available, honest null state otherwise */}
      {insight ? (
        <p className="text-sm text-lumi-text leading-relaxed">{insight}</p>
      ) : (
        <p className="text-xs text-lumi-muted italic">
          Insight will appear after the next sweep.
        </p>
      )}
    </div>
  );
}
