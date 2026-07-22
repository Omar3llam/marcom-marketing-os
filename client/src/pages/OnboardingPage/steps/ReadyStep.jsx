import { CheckCircle2, ArrowRight } from 'lucide-react';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { PRIMARY_BTN } from './onboardingStyles.js';

// Honest summary for every outcome: a synced account with verdicts, a synced
// account with campaigns but no revenue (no verdicts yet), and a cold account
// with nothing to show. Counts come straight from the connector hooks — no
// fabricated numbers.
function Row({ ok, children }) {
  return (
    <div className="flex items-center gap-2.5">
      <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${ok ? 'text-signal-scale' : 'text-lumi-muted'}`} strokeWidth={2} />
      <span className="text-sm text-lumi-text">{children}</span>
    </div>
  );
}

export function ReadyStep({ onEnterApp }) {
  const { verdicts } = useConnectorVerdicts();
  const { campaigns } = useConnectorCampaigns();

  const total  = campaigns?.length ?? 0;
  const scored = verdicts?.length ?? 0;
  const kills  = verdicts?.filter((v) => v.verdict === 'KILL').length ?? 0;
  const scales = verdicts?.filter((v) => v.verdict === 'SCALE').length ?? 0;

  return (
    <div>
      <h1 className="decision-title text-lumi-text mb-1">Your workspace is ready.</h1>
      <p className="text-sm text-lumi-muted mb-6">Here&apos;s what Lumi found.</p>

      <div className="space-y-2.5 mb-8">
        <Row ok>Meta connected</Row>
        <Row ok={total > 0}>
          {total > 0 ? `${total} campaign${total === 1 ? '' : 's'} analyzed` : 'No campaigns found yet'}
        </Row>
        <Row ok={scored > 0}>
          {scored > 0
            ? `${scored} verdict${scored === 1 ? '' : 's'} ready`
              + (kills > 0 || scales > 0 ? ` · ${kills} to pause · ${scales} to scale` : '')
            : 'Verdicts will appear once campaigns sync'}
        </Row>
      </div>

      <button type="button" onClick={onEnterApp} className={PRIMARY_BTN}>
        Open Campaigns <ArrowRight className="w-4 h-4" strokeWidth={2} />
      </button>
    </div>
  );
}
