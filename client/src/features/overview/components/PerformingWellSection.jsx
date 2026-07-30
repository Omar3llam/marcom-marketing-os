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

export default function PerformingWellSection({ count = 0, spend = null, currency = null }) {
  return (
    <section className="mb-6 border-t border-lumi-border pt-4">
      <p className="font-display text-sm font-semibold text-signal-scale">Doing well</p>
      <p className="mt-1 text-xs text-lumi-muted">
        {count} campaign{count === 1 ? '' : 's'} performing well
      </p>
      {spend != null && (
        <p className="text-xs text-lumi-muted">
          Protected spend: {formatCurrency(spend, currency || 'USD')}
        </p>
      )}
    </section>
  );
}
