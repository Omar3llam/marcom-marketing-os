// ============================================================
// MARCOM / Lumi — UpgradePrompt (PlanGate route fallback)
// ------------------------------------------------------------
// Shown in place of a feature a FREE/GROWTH workspace isn't entitled to (the
// fallback PlanGate renders at route level). Honest over silent: it names the
// feature + the tier that unlocks it and links to the pricing page, rather than
// bouncing the user with a redirect that looks like a broken click.
//
// There is no in-app checkout (no billing) — "View plans" leaves to the
// marketing pricing section (/#pricing). Shell-dialect tokens only.
// ============================================================
import { Lock } from 'lucide-react';

export default function UpgradePrompt({ feature, requiredPlan = 'GROWTH' }) {
  const title = requiredPlan.charAt(0) + requiredPlan.slice(1).toLowerCase(); // FREE→Free
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-lumi-border bg-lumi-surface p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-lumi-elevated">
          <Lock className="h-5 w-5 text-lumi-accent" strokeWidth={1.5} />
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-lumi-subtle">
          {title} plan
        </p>
        <h1 className="mt-2 decision-title text-lumi-text">{feature} is a {title} feature</h1>
        <p className="mt-2 text-sm leading-6 text-lumi-muted">
          Upgrade to unlock {feature.toLowerCase()}, along with more connectors, unlimited
          campaigns, and advanced analytics.
        </p>
        <a
          href="/#pricing"
          className="mt-5 inline-flex rounded-xl bg-lumi-accent px-4 py-2 font-display text-sm font-semibold text-lumi-bg transition-colors hover:bg-lumi-gold"
        >
          View plans →
        </a>
      </div>
    </div>
  );
}
