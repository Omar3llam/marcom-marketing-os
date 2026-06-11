import { Bot, Lock, Sparkles } from 'lucide-react';

export default function CopilotPage() {
  return (
    <div className="min-h-full bg-lumi-bg p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div>
          <div className="section-label">AI Copilot</div>
          <h1 className="decision-title mt-2 text-lumi-text">
            Reserved for the Marketing OS copilot
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-lumi-muted">
            This route is intentionally reserved in the primary navigation so the assistant can
            grow across campaigns, intelligence, proof, decisions, and content without another
            sidebar restructure.
          </p>
        </div>

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
          {[
            ['Campaign context', 'Read portfolio state and active diagnoses.'],
            ['Evidence memory', 'Reason over insights, proof, and outcomes.'],
            ['Decision support', 'Prepare recommendations and next actions.'],
          ].map(([title, copy]) => (
            <div key={title} className="rounded-xl border border-lumi-border bg-lumi-elevated p-4">
              <Sparkles className="mb-3 h-4 w-4 text-lumi-accent" strokeWidth={1.5} />
              <h3 className="font-display text-sm font-semibold text-lumi-text">{title}</h3>
              <p className="mt-1 text-xs leading-5 text-lumi-muted">{copy}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
