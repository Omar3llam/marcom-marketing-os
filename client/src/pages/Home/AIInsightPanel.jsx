import { Brain, Zap, ArrowRight } from 'lucide-react';
import Panel from '@/components/ui/Panel.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';

export default function AIInsightPanel({ workspace, topAlert, onAct }) {
  if (!topAlert || !topAlert.alertData) {
    return (
      <Panel
        title="AI Insight"
        Icon={Brain}
        iconTone="gold"
        meta="no alerts"
      >
        <EmptyPanel text="No actionable insights right now. All campaigns look healthy!" Icon={Brain} />
      </Panel>
    );
  }

  const { campaign, alertData } = topAlert;
  const rootCause = alertData.analysis?.root_cause || 'Performance degradation detected';
  const actionPlan = alertData.action_plan || 'Review campaign metrics and consider adjustments.';

  return (
    <Panel
      title="AI Insight"
      Icon={Brain}
      iconTone="gold"
      meta="updated recently"
    >
      <div className="font-mono text-[10px] tracking-[0.08em] uppercase text-lumi-accent mb-2">
        Top recommendation
      </div>
      <p className="text-[13px] text-dark-soft leading-relaxed mb-3.5">
        Your <strong className="text-dark-base">{campaign}</strong> campaign: {rootCause}.
        {' '}{actionPlan}
      </p>
      <button
        onClick={onAct}
        aria-label="Review AI recommendation verdict"
        className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 bg-lumi-accent hover:bg-lumi-accent/90
                   text-white rounded-lg transition-all duration-150 font-display font-semibold text-[13px] shadow-accent-glow
                   focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
      >
        <Zap className="w-3.5 h-3.5" strokeWidth={1.5} />
        Review verdict
        <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
      </button>
    </Panel>
  );
}
