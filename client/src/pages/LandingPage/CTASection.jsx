import { ArrowRight } from 'lucide-react';

export function BottomCTA({ onCta }) {
  return (
    <section id="cta" className="px-4 sm:px-6 py-20">
      <div className="max-w-4xl mx-auto bg-lumi-elevated border border-lumi-border-strong rounded-3xl p-8 sm:p-12 shadow-modal text-center">
        <div className="section-label">The Decision Engine</div>
        <h2 className="mt-2 decision-title sm:text-4xl text-lumi-text">
          Your marketing team just got an AI co-pilot.
        </h2>
        <p className="mt-4 max-w-lg mx-auto text-lumi-muted text-sm sm:text-base">
          Lumi replaces expensive consultants with always-on strategic intelligence.
          Get started. No credit card required.
        </p>
        <button
          type="button"
          onClick={onCta}
          className="mt-6 bg-lumi-accent text-lumi-bg font-display font-semibold hover:bg-lumi-accent-hover shadow-accent-glow px-6 py-3 rounded-xl text-sm inline-flex items-center gap-2"
        >
          Get started <ArrowRight className="w-4 h-4" strokeWidth={2} />
        </button>
        <p className="mt-4 text-xs text-lumi-subtle font-mono">
          Trusted by growth teams across Egypt, Saudi Arabia, and UAE
        </p>
      </div>
    </section>
  );
}
