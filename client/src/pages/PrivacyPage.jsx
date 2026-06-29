// ============================================================
// MARCOM / Lumi — Privacy Policy (public, static)
// ------------------------------------------------------------
// A plain-language summary of how we handle data — NOT formal legal advice or
// a full GDPR document. Honest and minimal; closes the trust gap of having no
// policy at all.
// ============================================================
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const LAST_UPDATED = 'June 29, 2026';

function Section({ title, children }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-dark-base mb-3">{title}</h2>
      <div className="text-sm [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_p]:leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-surface-light text-dark-base">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-dark-muted hover:text-dark-base transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" strokeWidth={1.5} /> Back to home
        </Link>
        <h1 className="font-display text-4xl font-bold tracking-tight mb-2">Privacy Policy</h1>
        <p className="text-sm text-dark-muted font-mono mb-10">MARCOM AI / Lumi · Last updated {LAST_UPDATED}</p>

        <div className="space-y-8 text-dark-soft">
          <Section title="1. What we collect">
            <ul>
              <li>Email address (for authentication)</li>
              <li>Ad-campaign data you connect via Meta / Google OAuth</li>
              <li>Usage data (which features you use)</li>
            </ul>
          </Section>
          <Section title="2. What we don't collect">
            <ul>
              <li>We never sell your data</li>
              <li>We never share campaign data with other workspaces</li>
              <li>Ad-platform credentials are encrypted at rest</li>
            </ul>
          </Section>
          <Section title="3. Data storage">
            <ul>
              <li>Data is stored on managed servers in the United States (Render / Neon)</li>
              <li>You can delete your workspace and all associated data at any time from Settings → Security</li>
            </ul>
          </Section>
          <Section title="4. Contact">
            <p>Questions about privacy? <a className="text-lumi-accent hover:underline" href="mailto:privacy@marcom.ai">privacy@marcom.ai</a></p>
          </Section>

          <p className="text-xs text-dark-muted">
            This is a plain-language summary of how we handle your data — not a substitute for formal legal advice.
          </p>
        </div>
      </div>
    </div>
  );
}
