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

const BAND = {
  BUYER: {
    title: "Today's decisions", icon: ListChecks, tone: 'kill',
    empty: 'No urgent decisions — radar monitoring active.',
  },
  STRATEGIST: {
    title: 'Portfolio health', icon: LineChart, tone: 'gold',
    empty: 'Portfolio on track — no adjustments needed.',
  },
};

export default function AgendaBand({ band, data }) {
  const cfg = BAND[band] ?? BAND.BUYER;
  const items = data?.items ?? [];
  const meta = items.length > 0 ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'clear';

  return (
    <Panel title={cfg.title} Icon={cfg.icon} iconTone={cfg.tone} meta={meta}>
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
