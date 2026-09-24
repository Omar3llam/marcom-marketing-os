// ============================================================
// MARCOM / Lumi — PerformingWellSection (Home · the band with nothing to do)
// ------------------------------------------------------------
// HOLD and SCALE: a count and the spend it protects, deliberately with NO cards.
// There is nothing to decide here, and the whole point of the band is that these
// campaigns need no attention — rendering three cards would contradict the
// message they carry.
//
// Protected spend stays absent when NOT ONE healthy campaign reported a spend.
// "nothing measured" is not "zero protected", so the line is omitted rather than
// printed as 0.
// ============================================================
import { formatCurrency } from '@/lib/money';
import { isKnownCurrency, isKnownMinorAmount } from '@/lib/monetaryCurrency.js';

export default function PerformingWellSection({ count = 0, spend = null, currency = null, spendStatus = 'EMPTY' }) {
  const showSpend = spendStatus === 'VALID' && isKnownMinorAmount(spend) && isKnownCurrency(currency);
  return (
    <section className="mb-6 border-t border-lumi-border pt-4">
      <p className="font-display text-sm font-semibold text-signal-scale">Doing well</p>
      <p className="mt-1 text-xs text-lumi-muted">
        {count} campaign{count === 1 ? '' : 's'} performing well
      </p>
      {showSpend && (
        <p className="text-xs text-lumi-muted">
          Protected spend: {formatCurrency(spend, currency)}
        </p>
      )}
      {['MIXED', 'UNAVAILABLE'].includes(spendStatus) && (
        <p className="text-xs text-lumi-muted">
          {spendStatus === 'MIXED' ? 'Mixed currencies — protected spend unavailable' : 'Protected spend unavailable'}
        </p>
      )}
    </section>
  );
}
