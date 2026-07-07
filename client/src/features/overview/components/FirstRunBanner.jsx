// ============================================================
// MARCOM / Lumi — Home · First-Run Banner (guided activation)
// ------------------------------------------------------------
// The one-time "connect a channel to get started" hero, shown on a brand-new
// user's first Overview visit while the account has no data. It wires the
// previously-DEAD `marcom:firstActivation` flag — written at onboarding
// completion (OnboardingPage) but never read anywhere until now.
//
// Pure + prop-driven: the show / dismiss / retire logic lives in OverviewView
// (which owns the flag), this component only renders. Copy is deliberately
// multi-channel (never Meta-exclusive) — Lumi ingests Meta AND Google.
// ============================================================
import { Link } from 'react-router-dom';
import { Plug, X, ArrowRight } from 'lucide-react';

export default function FirstRunBanner({ step = 1, title, description, primaryAction, onCtaClick, onDismiss }) {
  return (
    <div className="relative mb-6 rounded-2xl border border-lumi-accent/40 bg-lumi-accent-soft/30 p-5 sm:p-6 shadow-accent-glow">
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-lumi-muted hover:text-lumi-text hover:bg-lumi-elevated transition-colors focus:outline-none focus:ring-2 focus:ring-lumi-accent"
        >
          <X className="w-4 h-4" strokeWidth={1.5} />
        </button>
      )}
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 flex-shrink-0 rounded-xl bg-lumi-accent/15 text-lumi-accent flex items-center justify-center">
          <Plug className="w-5 h-5" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] tracking-[0.08em] uppercase text-lumi-accent mb-1">
            Step {step} · Get started
          </div>
          <h2 className="font-display font-bold text-lg text-dark-base mb-1.5">{title}</h2>
          <p className="text-sm text-dark-soft leading-relaxed mb-4 max-w-[560px]">{description}</p>
          {primaryAction && (
            <Link
              to={primaryAction.href}
              onClick={onCtaClick}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-sm shadow-accent-glow focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
            >
              {primaryAction.label}
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
