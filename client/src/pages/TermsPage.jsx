// ============================================================
// MARCOM / Lumi — Terms of Service (public, static)
// ------------------------------------------------------------
// Plain-language terms — NOT formal legal advice. Minimal and honest; pairs
// with the Privacy Policy to close the landing-page trust gap.
// ============================================================
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const LAST_UPDATED = 'June 29, 2026';

function Section({ title, children }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-dark-base mb-3">{title}</h2>
      <div className="text-sm [&_p]:leading-relaxed">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-surface-light text-dark-base">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-dark-muted hover:text-dark-base transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" strokeWidth={1.5} /> Back to home
        </Link>
        <h1 className="font-display text-4xl font-bold tracking-tight mb-2">Terms of Service</h1>
        <p className="text-sm text-dark-muted font-mono mb-10">MARCOM AI / Lumi · Last updated {LAST_UPDATED}</p>

        <div className="space-y-8 text-dark-soft">
          <Section title="1. Service">
            <p>Lumi is a marketing-intelligence platform that turns your ad-campaign exports into KILL / HOLD / SCALE verdicts and tracks their outcomes.</p>
          </Section>
          <Section title="2. Your data">
            <p>You own your data. You can export or delete it at any time. We process it only to provide the service.</p>
          </Section>
          <Section title="3. Acceptable use">
            <p>No automated scraping, no reselling the service, and no attempts to access another workspace's data or circumvent workspace isolation.</p>
          </Section>
          <Section title="4. Termination">
            <p>You can cancel at any time from Settings. We may suspend accounts that violate acceptable use.</p>
          </Section>
          <Section title="5. Contact">
            <p>Questions about these terms? <a className="text-lumi-accent hover:underline" href="mailto:legal@marcom.ai">legal@marcom.ai</a></p>
          </Section>

          <p className="text-xs text-dark-muted">
            This is a plain-language summary — not a substitute for formal legal advice.
          </p>
        </div>
      </div>
    </div>
  );
}
