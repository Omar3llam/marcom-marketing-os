// ============================================================
// MARCOM / Lumi — Campaigns Page (upgraded)
// ============================================================
// Filter chips + table + right-slide detail panel
// Click any row → opens panel with diagnosis + action CTAs
// ============================================================
import { useState, useMemo } from 'react';
import { Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import FilterChips from './FilterChips.jsx';
import CampaignsTable from './CampaignsTable.jsx';
import DetailPanel from './DetailPanel.jsx';
import EmptyState from './EmptyState.jsx';

export default function CampaignAnalysis() {
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const { campaigns, loading } = useCampaignFeed();
  const [filterVerdict, setFilterVerdict] = useState('All');
  const [selectedAlert, setSelectedAlert] = useState(null);

  // Flatten campaigns → alerts array
  const alerts = useMemo(() => {
    const rows = [];
    for (const campaign of campaigns) {
      for (const alert of campaign.alerts || []) {
        rows.push({
          id: alert.action_id || `${campaign.campaign_id}-${rows.length}`,
          campaignId: campaign.campaign_id,
          campaign: campaign.campaign_name || 'Unknown Campaign',
          adset: alert.ad_set_name || 'Unknown Ad Set',
          verdict: alert.analysis?.verdict || 'HOLD',
          stage: alert.stage || 'STABLE',
          priority: alert.priority || 'MEDIUM',
          signal: alert.analysis?.root_cause || 'No diagnosis',
          bleed: alert.bleed || '—',
          time: alert.timestamp ? new Date(alert.timestamp).toLocaleDateString() : 'Recent',
          metrics: alert.metrics || [],
          analysis: alert.analysis || {},
          actionPlan: alert.action_plan || {},
          rawAlert: alert,
        });
      }
    }
    return rows;
  }, [campaigns]);

  // Filter by verdict
  const filteredAlerts = useMemo(() => {
    if (filterVerdict === 'All') return alerts;
    return alerts.filter((a) => a.verdict === filterVerdict);
  }, [alerts, filterVerdict]);

  const highPriorityCount = alerts.filter((a) => a.priority === 'HIGH').length;

  const handleUpload = () => {
    navigate('/app/campaigns'); // TODO: open upload modal
  };

  const handleFixContent = (alert) => {
    navigate('/app/content', { state: { campaign: alert.campaign, context: alert.analysis } });
  };

  const handleAdjustBudget = (alert) => {
    // TODO: implement execution flow
    console.log('Adjust budget for:', alert.campaign);
  };

  if (!loading && alerts.length === 0) {
    return <EmptyState onUpload={handleUpload} />;
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 relative">
      {/* Header */}
      <header className="mb-5">
        <div className="font-mono text-[11px] tracking-[0.08em] uppercase text-dark-muted mb-2">
          Campaigns · {workspace?.name || 'Workspace'}
        </div>
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h1 className="font-display font-bold text-[30px] tracking-tight text-dark-base">
            {alerts.length} active campaign{alerts.length === 1 ? '' : 's'} · {highPriorityCount} need attention.
          </h1>
          <button
            onClick={handleUpload}
            className="flex items-center gap-2 px-4 py-2.5 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-sm shadow-accent-glow"
          >
            <Upload className="w-3.5 h-3.5" strokeWidth={1.5} />
            Upload new data
          </button>
        </div>
      </header>

      {/* Filter chips */}
      <FilterChips
        filterVerdict={filterVerdict}
        setFilterVerdict={setFilterVerdict}
        counts={{
          all: alerts.length,
          kill: alerts.filter((a) => a.verdict === 'KILL').length,
          hold: alerts.filter((a) => a.verdict === 'HOLD').length,
          scale: alerts.filter((a) => a.verdict === 'SCALE').length,
        }}
      />

      {/* Table */}
      <CampaignsTable
        alerts={filteredAlerts}
        selectedId={selectedAlert?.id}
        onSelectAlert={setSelectedAlert}
        loading={loading}
      />

      {/* Detail panel */}
      {selectedAlert && (
        <DetailPanel
          alert={selectedAlert}
          workspace={workspace}
          onClose={() => setSelectedAlert(null)}
          onFixContent={() => handleFixContent(selectedAlert)}
          onAdjustBudget={() => handleAdjustBudget(selectedAlert)}
        />
      )}
    </div>
  );
}
