import { Link } from 'react-router-dom';
import { Lock, Zap, Target, ArrowRight } from 'lucide-react';
import { useReveal } from './useReveal.js';

// Honest early-access positioning — no fabricated logos, personas, or
// testimonials. Until we have real customers to name, we show real product
// facts (data isolation, fast Meta connect, MENA-native currencies).
export function TrustedBy() {
  const signals = [
    { Icon: Lock, text: 'Your campaign data stays in your workspace. Never shared.' },
    { Icon: Zap, text: 'Connects to Meta Ads in under 2 minutes.' },
    { Icon: Target, text: 'Built specifically for MENA markets — EGP, SAR, AED native.' },
  ];
  const [ref, shown] = useReveal();

  return (
    <section className="px-4 sm:px-6 py-8 pb-2">
      <div ref={ref} className={`max-w-5xl mx-auto text-center ${shown ? 'animate-fade-in' : 'opacity-0'}`}>
        <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-dark-muted mb-3">
          Early access
        </div>
        <h2 className="decision-title text-dark-base">
          Be the first growth team in Egypt to use Lumi.
        </h2>
        <p className="mt-3 text-sm sm:text-base text-dark-soft max-w-2xl mx-auto leading-relaxed">
          Lumi is in early access across Egypt, Saudi Arabia, and UAE. Join the first cohort of
          MENA performance marketers who decide with data — not gut feel.
        </p>

        <div className="mt-8 grid sm:grid-cols-3 gap-4 text-left">
          {signals.map(({ Icon, text }) => (
            <div
              key={text}
              className="flex items-start gap-3 px-4 py-4 bg-surface-card border border-surface-border rounded-xl"
            >
              <Icon className="w-5 h-5 flex-shrink-0 text-lumi-accent mt-0.5" strokeWidth={1.5} />
              <span className="text-sm text-dark-soft leading-relaxed">{text}</span>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <Link
            to="/signup"
            className="btn-gold inline-flex items-center gap-2 px-6 py-3 text-sm rounded-xl shadow-gold-glow hover:shadow-card-hover transition-all"
          >
            Request early access
            <ArrowRight className="w-4 h-4" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </section>
  );
}
