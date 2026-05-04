// ============================================================
// MARCOM / Lumi — TheatreView (FSM state C)
// ------------------------------------------------------------
// 4-step animated terminal panel. Step state is driven by the
// FSM (theatreStep), step labels swap based on the active mode.
// ============================================================
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';

const STEPS = {
  campaign: [
    'Parsing campaign data…',
    'Injecting business context…',
    'Running dual-agent analysis…',
    'Synthesizing final verdict…',
  ],
  strategy: [
    'Compiling brief inputs…',
    'Loading brand context lock…',
    'Generating strategy outline…',
    'Finalizing executive brief…',
  ],
  content: [
    'Reading content payload…',
    'Loading platform calibration…',
    'Scoring against MARCOM framework…',
    'Drafting rewrite suggestions…',
  ],
};

const AGENT_HINT = {
  campaign: ['claude', 'openai'],
  strategy: ['claude'],
  content:  ['claude'],
};

export default function TheatreView({ mode, currentStep, onCancel }) {
  const steps  = STEPS[mode] || STEPS.campaign;
  const agents = AGENT_HINT[mode] || ['claude'];

  return (
    <div className="max-w-lg mx-auto p-6 lg:p-8 min-h-[60vh] flex flex-col items-center justify-center animate-fade-in">
      <div className="w-full bg-lumi-surface/80 backdrop-blur-sm border border-lumi-border rounded-2xl p-7 shadow-panel">
        <div className="text-center">
          <div className="section-label">Lumi Analysis Engine</div>
          <div className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-lumi-muted">
            {agents.includes('claude') && <AgentDot name="Claude" color="orange" active />}
            {agents.includes('openai') && <AgentDot name="ChatGPT" color="emerald" active={currentStep >= 2} />}
          </div>
        </div>

        <ol className="mt-6 space-y-3" aria-live="polite">
          {steps.map((label, i) => {
            const status = i < currentStep ? 'done' : i === currentStep ? 'active' : 'pending';
            return (
              <li key={i} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  {status === 'done'    && <Check className="w-3.5 h-3.5 text-signal-scale" strokeWidth={2} />}
                  {status === 'active'  && <ChevronRight className="w-3.5 h-3.5 text-lumi-accent animate-pulse" strokeWidth={2} />}
                  {status === 'pending' && <span className="w-3.5 h-3.5 inline-flex items-center justify-center text-lumi-subtle">·</span>}
                  <span className={cn(
                    'font-mono text-sm',
                    status === 'done'    && 'text-lumi-subtle line-through',
                    status === 'active'  && 'text-lumi-text',
                    status === 'pending' && 'text-lumi-subtle',
                  )}>
                    {label}
                    {status === 'active' && (
                      <span aria-hidden="true" className="inline-block w-2 h-3 bg-lumi-accent ml-1 align-middle animate-blink" />
                    )}
                  </span>
                </div>
                {status === 'active' && (
                  <div className="h-1 w-full overflow-hidden rounded-full bg-lumi-border">
                    <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-lumi-accent to-stage-scaling animate-progress-sweep" />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="mt-4 text-xs font-mono text-lumi-subtle hover:text-trend-danger transition-colors"
      >
        ▽ Stop &amp; Cancel
      </button>
    </div>
  );
}

function AgentDot({ name, color, active }) {
  const cls = color === 'orange'
    ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
    : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded border',
      cls,
      active ? 'animate-pulse-slow' : 'opacity-50',
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', color === 'orange' ? 'bg-orange-400' : 'bg-emerald-400')} />
      {name}
    </span>
  );
}
