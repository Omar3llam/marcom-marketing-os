import { ArrowRight } from 'lucide-react';

export function BottomCTA({ onCta }) {
  return (
    <section id="cta" className="px-4 sm:px-6 py-20">
      <div className="max-w-4xl mx-auto bg-lumi-elevated border border-lumi-border-strong rounded-3xl p-8 sm:p-12 shadow-modal text-center">
        <div className="section-label">Get started</div>
        <h2 className="mt-2 decision-title sm:text-4xl text-lumi-text">
          Get your first verdict in under 2 minutes.
        </h2>
        <p className="mt-4 max-w-lg mx-auto text-lumi-muted text-sm sm:text-base">
          Connect Meta, and Lumi scores every campaign before your next sync — with a
          confidence score on every call.
        </p>
        <button
          type="button"
          onClick={onCta}
          className="mt-6 bg-lumi-accent text-lumi-bg font-display font-semibold hover:bg-lumi-gold shadow-accent-glow px-6 py-3 rounded-xl text-sm inline-flex items-center gap-2"
        >
          Start watching — it&apos;s free <ArrowRight className="w-4 h-4" strokeWidth={2} />
        </button>
        <p className="mt-4 text-xs text-lumi-subtle font-mono">
          No credit card. No setup fees. Free forever on the Free plan.
        </p>
      </div>
    </section>
  );
}
