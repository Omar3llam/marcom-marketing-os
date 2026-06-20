// ============================================================
// MARCOM — Overview · Copilot teaser
// ============================================================
// Lumi Copilot is not built yet (a static "coming soon" placeholder). It was
// demoted out of the primary sidebar so a non-functional feature no longer holds
// a top-level nav slot equal to Campaigns/Decisions. Its content — the
// coming-soon message + waitlist CTA — is preserved here verbatim from the former
// CopilotPage. The /app/copilot route stays reachable by direct URL; reverting
// this demotion is just restoring the one sidebar entry.
//
// Reuses the shared Panel primitive (same card the other Overview panels use) —
// no new UI pattern introduced.
// ============================================================
import { Bot, Mail } from 'lucide-react';
import Panel from '@/components/ui/Panel.jsx';

export default function CopilotTeaser() {
  return (
    <Panel title="Lumi Copilot" Icon={Bot} iconTone="gold" meta="Coming soon · early access">
      <p className="text-sm leading-6 text-dark-soft">
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
    </Panel>
  );
}
