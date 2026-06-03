// ============================================================
// MARCOM / Lumi — Onboarding Step 0: Welcome
// ============================================================

import { Sparkles, Layout, Eye, Globe, Zap } from 'lucide-react';
import { Eyebrow, BigHeader, Lede } from '../shared.jsx';

export function WelcomeStep() {
  const valueProps = [
    { Icon: Layout, title: 'Identity', body: 'Who you are, where you operate.' },
    { Icon: Eye, title: 'Audience', body: 'Who you sell to.' },
    { Icon: Globe, title: 'Voice', body: 'Language, dialect, tone.' },
    { Icon: Zap, title: 'Toolkit', body: 'Channels, content, objective.' },
  ];

  return (
    <div>
      <Eyebrow>Welcome to Marcom AI</Eyebrow>
      <BigHeader>Let&apos;s get Lumi watching your campaigns.</BigHeader>
      <Lede>
        Nine quick questions — about two minutes. Once you&apos;re done, Lumi knows your market, your audience,
        your voice, and what success looks like. Every verdict, every piece of content scored, every social
        post planned will be grounded in that context.
      </Lede>

      <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {valueProps.map((card) => (
          <div
            key={card.title}
            className="p-4 bg-surface-card border border-surface-border rounded-xl hover:border-lumi-accent/40 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-lumi-accent/10 text-lumi-accent flex items-center justify-center mb-3">
              <card.Icon className="w-4 h-4" strokeWidth={1.5} />
            </div>
            <div className="font-display text-sm font-bold text-dark-base mb-1">
              {card.title}
            </div>
            <div className="text-xs text-dark-soft leading-relaxed">
              {card.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
