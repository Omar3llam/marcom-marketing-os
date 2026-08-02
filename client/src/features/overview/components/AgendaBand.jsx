// ============================================================
// MARCOM / Lumi — AgendaBand (Phase 9 · one altitude of the home)
// ------------------------------------------------------------
// One band of the unified home: the buyer band ("Today's decisions") or the
// strategist band ("Portfolio health"). The backend already orders items by
// severity and owns their content — the band only frames them and shows an
// HONEST per-band empty state. An empty band is SHOWN, not hidden: hiding a band
// would imply that altitude doesn't exist.
// ============================================================
import { ListChecks, LineChart } from 'lucide-react';
import Panel from '@/components/ui/Panel.jsx';
import EmptyPanel from '@/components/ui/EmptyPanel.jsx';
import AgendaItem from './AgendaItem.jsx';

// The backend names its own bands (AgentHomeService.buildStrategistBand →
// "How the portfolio is tracking to goal") and the contract carries the string
// (AgendaBandViewSchema.title). These are the FALLBACKS only.
//
// The hardcoded strategist title used to win, and it read "Portfolio health" —
// a hair away from the "Account health" KPI card, which is a different number on
// a different substrate (the deterministic health score, not the sweep's
// portfolio agenda). Two near-identical names for two unrelated things is how a
// page contradicts itself quietly. The server's longer label says which question
// it answers, so it is used when present.
const BAND = {
  BUYER: {
    title: "Today's decisions", icon: ListChecks, tone: 'kill',
    empty: 'No urgent decisions — radar monitoring active.',
  },
  STRATEGIST: {
    title: 'How the portfolio is tracking to goal', icon: LineChart, tone: 'gold',
    empty: 'Portfolio on track — no adjustments needed.',
  },
};

export default function AgendaBand({ band, data }) {
  const cfg = BAND[band] ?? BAND.BUYER;
  const items = data?.items ?? [];
  const meta = items.length > 0 ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'clear';

  return (
    <Panel title={data?.title || cfg.title} Icon={cfg.icon} iconTone={cfg.tone} meta={meta}>
      {items.length === 0 ? (
        <EmptyPanel text={cfg.empty} Icon={cfg.icon} />
      ) : (
        <div className="space-y-2">
          {items.map((item) => <AgendaItem key={item.id} item={item} />)}
        </div>
      )}
    </Panel>
  );
}
