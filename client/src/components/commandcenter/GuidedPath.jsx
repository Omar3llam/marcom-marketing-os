import { useEffect } from 'react';
import { Clock, ArrowRight } from 'lucide-react';

export default function GuidedPath({ onStartFlow }) {
  const isFirstActivation = sessionStorage.getItem('marcom:firstActivation') === '1';

  // Clear flag after reading so it only animates once per session
  useEffect(() => {
    if (isFirstActivation) sessionStorage.removeItem('marcom:firstActivation');
  }, [isFirstActivation]);

  return (
    <div className={`rounded-2xl border overflow-hidden shadow-card py-10 text-center ${
      isFirstActivation
        ? 'border-lumi-gold/40 bg-lumi-gold/5 shadow-gold-glow'
        : 'border-dashed border-surface-border bg-surface-light/40'
    }`}>
      <Clock className={`w-8 h-8 mx-auto ${isFirstActivation ? 'text-lumi-gold' : 'text-dark-soft'}`} strokeWidth={1.5} />
      <p className={`mt-3 text-sm ${isFirstActivation ? 'text-dark-base font-display font-semibold' : 'text-dark-soft'}`}>
        {isFirstActivation ? 'Ready to analyze your first campaign' : 'No decisions yet. Run your first analysis.'}
      </p>
      {isFirstActivation && (
        <button
          onClick={() => onStartFlow('campaign')}
          className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl
                     bg-lumi-gold text-dark-base font-display font-semibold text-sm
                     shadow-gold-glow hover:bg-lumi-deep transition-colors"
        >
          Upload Campaign CSV <ArrowRight className="w-4 h-4" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
