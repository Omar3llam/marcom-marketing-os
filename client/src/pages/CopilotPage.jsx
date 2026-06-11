import { Bot, ClipboardCheck, Lock, Radar, Sparkles } from 'lucide-react';
import { EvidencePanel, MetricTile, PageHeader } from '@/design-system/patterns';

export default function CopilotPage() {
  return (
    <div className="min-h-full bg-lumi-bg p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          eyebrow="AI Copilot"
          title="Reserved for the Marketing OS copilot"
          description="This route is intentionally reserved in the primary navigation so the assistant can grow across campaigns, intelligence, proof, decisions, and content without another sidebar restructure."
        />

        <section className="rounded-xl border border-lumi-border bg-lumi-surface p-5 shadow-card">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-lumi-accent/30 bg-lumi-accent-soft text-lumi-accent">
              <Bot className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-semibold text-lumi-text">
                  Copilot foundation
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-lumi-border bg-lumi-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-lumi-muted">
                  <Lock className="h-3 w-3" strokeWidth={1.5} />
                  Reserved
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-lumi-muted">
                Full Copilot workflows should be implemented after Overview, Campaigns,
                Intelligence, Decisions, Settings, and Content Lab have stable feature boundaries.
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-3">
          <MetricTile
            label="Campaign context"
            value="Ready"
            detail="Read portfolio state and active diagnoses."
            icon={Radar}
            tone="intelligence"
          />
          <MetricTile
            label="Evidence memory"
            value="Planned"
            detail="Reason over insights, proof, and outcomes."
            icon={Sparkles}
          />
          <MetricTile
            label="Decision support"
            value="Reserved"
            detail="Prepare recommendations and next actions."
            icon={ClipboardCheck}
          />
        </div>

        <EvidencePanel
          title="Copilot dependencies"
          evidence={[
            { label: 'Campaigns', description: 'Portfolio context must be stable before Copilot can answer operational questions.', value: 'Core' },
            { label: 'Intelligence', description: 'Blended Truth, Insights, and Proof provide the evidence layer.', value: 'Core' },
            { label: 'Decisions', description: 'Approvals and execution history define what the assistant can recommend next.', value: 'Core' },
          ]}
        />
      </div>
    </div>
  );
}
