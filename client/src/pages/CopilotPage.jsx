import { Bot, ClipboardCheck, Mail, Radar, Sparkles } from 'lucide-react';
import { MetricTile, PageHeader } from '@/design-system/patterns';

export default function CopilotPage() {
  return (
    <div className="min-h-full bg-lumi-bg p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          eyebrow="AI Copilot"
          title="Lumi Copilot"
          description="Your always-on marketing co-pilot for evidence-backed campaign answers, decision support, and next actions from one conversation."
        />

        <section className="rounded-xl border border-lumi-border bg-lumi-surface p-5 shadow-card">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-lumi-accent/30 bg-lumi-accent-soft text-lumi-accent">
              <Bot className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-semibold text-lumi-text">
                  Coming soon
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-lumi-border bg-lumi-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-lumi-muted">
                  <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                  Early access
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-lumi-muted">
                Ask questions about campaign performance, get answers grounded in your data,
                and turn strong recommendations into decisions without switching surfaces.
              </p>
              <a
                href="mailto:sales@marcom.ai?subject=Lumi%20Copilot%20waitlist"
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-lumi-accent/30 bg-lumi-accent-soft px-3 py-2 text-sm font-display font-semibold text-lumi-accent transition-colors hover:border-lumi-accent"
              >
                <Mail className="h-4 w-4" strokeWidth={1.5} />
                Join the waitlist
              </a>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-lumi-subtle">
                Coming soon
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-3">
          <MetricTile
            label="Campaign context"
            value="Ready"
            detail="Use connected campaign context."
            icon={Radar}
            tone="intelligence"
          />
          <MetricTile
            label="Evidence memory"
            value="Soon"
            detail="Ground answers in proof and outcomes."
            icon={Sparkles}
          />
          <MetricTile
            label="Decision support"
            value="Soon"
            detail="Move from answer to action."
            icon={ClipboardCheck}
          />
        </div>
      </div>
    </div>
  );
}
