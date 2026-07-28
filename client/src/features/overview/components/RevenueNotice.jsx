// ============================================================
// MARCOM / Lumi — RevenueNotice (Home · a revenue-data story)
// ------------------------------------------------------------
// Lifted verbatim out of AlertsPanel when the decision feed replaced it. These
// two stories are NOT alerts — a campaign here is not performing badly, its
// revenue is unmeasurable — so they outlive the panel that used to carry them.
//
// The distinction they exist to protect:
//   needs — revenue was NEVER uploaded. A tracking gap the operator can close.
//   stale — revenue WAS uploaded, but now lags the spend it would be divided by,
//           so the engine stopped scoring it rather than publish a drifted ROAS.
//
// Conflating them tells someone who already uploaded revenue to upload revenue.
// That is why the two CTAs say different things, and why they never merge.
// ============================================================
import { Link } from 'react-router-dom';
import { CircleDollarSign, Clock } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';

const NOTICE = {
  needs: {
    title: 'Revenue data needed',
    Icon: CircleDollarSign,
    cta: 'Connect sales data to unlock profit-based recommendations →',
  },
  stale: {
    title: 'Revenue data outdated',
    Icon: Clock,
    cta: 'Re-upload revenue to refresh ROAS →',
  },
};

// Named campaigns are capped; the remainder is COUNTED rather than dropped, so
// "3 campaigns" never stands in for 12.
const NAMED_LIMIT = 3;

export default function RevenueNotice({ type, campaigns = [] }) {
  const cfg = NOTICE[type];
  if (!cfg || campaigns.length === 0) return null;
  const { Icon } = cfg;

  return (
    <div className="card-raised p-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-lumi-text">
        <Icon size={12} className="text-signal-watch" />
        {cfg.title}
      </p>

      <div className="space-y-1">
        {campaigns.slice(0, NAMED_LIMIT).map((c) => (
          <p key={c.entityId} className="truncate text-xs text-lumi-muted">
            · {c.name || 'Unnamed campaign'}
          </p>
        ))}
      </div>

      {campaigns.length > NAMED_LIMIT && (
        <p className="mt-1 text-xs text-lumi-subtle">
          +{campaigns.length - NAMED_LIMIT} more
        </p>
      )}

      <Link to={appRoutes.settingsRevenue} className="mt-2 block text-xs text-lumi-accent hover:underline">
        {cfg.cta}
      </Link>
    </div>
  );
}
