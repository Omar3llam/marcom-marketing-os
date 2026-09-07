export const appRoutes = {
  overview: '/app/overview',
  // B7 R-N2 — reclaimed, not invented. This URL existed as a redirect to
  // Overview ("Legacy Command Center surface removed"), so existing bookmarks
  // and deep links resolve to the destination they were always named for.
  decisions: '/app/decisions',
  campaigns: '/app/campaigns',
  // FE-04 — reclaimed, like `decisions` before it. This URL was a redirect into
  // a Settings tab labelled "Channels", so the surface existed and the address
  // pointed away from it. Nine production CTAs — the first-run interrupt and
  // the Sidebar's "Connect a channel" among them — now land here instead of in
  // Settings.
  connections: '/app/connections',
  intelligence: '/app/intelligence',
  blendedTruth: '/app/intelligence/blended-truth',
  insights: '/app/intelligence/insights',
  // FE-02 — the ACROSS axis. B7 locked four axes and three had destinations;
  // this one's two readings lived as tabs under a fourth thing ("Intelligence —
  // truth, insights, proof"), so the object a person would call "what Lumi has
  // learned" had no address at all. Unlike `decisions` this is NOT a reclaim:
  // /app/memory has never resolved to anything.
  memory: '/app/memory',
  // Kept so App.jsx can keep the old address alive. It no longer renders a
  // page — it redirects to `memory`, of which it is now the second reading.
  proof: '/app/intelligence/proof',
  testing: '/app/testing',
  measure: '/app/measure',
  leadership: '/app/leadership',
  contentLab: '/app/content',
  publishing: '/app/publishing',
  copilot: '/app/copilot',
  settings: '/app/settings',
  settingsGeneral: '/app/settings/general',
  // FE-04 — this is now a REDIRECT SOURCE, not a destination. Kept because the
  // address is bookmarked and is where Meta's OAuth callback can return.
  settingsIntegrations: '/app/settings/integrations',
  settingsTeam: '/app/settings/team',
  settingsRevenue: '/app/settings/revenue',
  settingsWorkspace: '/app/settings/workspace',
  settingsSecurity: '/app/settings/security',
};

// The Intelligence surfaces, rendered as a shared sub-nav strip on each
// (mirrors `settingsSections`). `roles` gates a tab to those collabRoles.
//
// FE-02 — "Proof of Learning" is no longer listed. It was never a peer of these
// two: it is the SECOND READING of the object Memory now owns (B7 Ruling 2 —
// one surface, read two ways), and leaving a tab here would give one object two
// destinations, which is the divergence that ruling exists to prevent.
export const intelligenceSections = [
  { key: 'blended-truth', label: 'Blended Truth',    path: appRoutes.blendedTruth, roles: ['STRATEGIST', 'BUYER'] },
  { key: 'insights',      label: 'Growth Strategy',  path: appRoutes.insights,     roles: ['STRATEGIST', 'BUYER'] },
];

// FE-04 — "Channels" is no longer listed here. It is a destination now, and a
// tab that only redirects away is a trap: it offers a place to stand that does
// not exist. `settingsIntegrations` is KEPT in appRoutes above because the
// address is bookmarked and linked from outside the app; App.jsx redirects it.
export const settingsSections = [
  { key: 'general', label: 'General', path: appRoutes.settingsGeneral },
  { key: 'team', label: 'Team & Roles', path: appRoutes.settingsTeam },
  { key: 'revenue', label: 'Revenue data', path: appRoutes.settingsRevenue },
  { key: 'workspace', label: 'Workspace', path: appRoutes.settingsWorkspace },
  { key: 'security', label: 'Security', path: appRoutes.settingsSecurity },
];

// ⚠️ This array has NO importer. It documents App.jsx's redirect table by hand
// rather than driving it, so the two can drift silently — it is kept accurate
// here, and reported as a finding rather than deleted inside this slice.
export const legacyAppRedirects = [
  { from: 'home', to: appRoutes.overview },
  { from: 'feed', to: appRoutes.overview },
  { from: 'truth', to: appRoutes.blendedTruth },
  // FE-02 — straight to the destination, not through `proof`, which is itself
  // now a redirect. Two hops for a bookmark is a redirect chain waiting to rot.
  { from: 'proof', to: appRoutes.memory },
  // FE-04 — this entry ran the OTHER way until now (`connections` → the
  // Settings tab). The direction is reversed because the destination moved,
  // not because a new redirect was added.
  { from: 'settings/integrations', to: appRoutes.connections },
  { from: 'growth', to: appRoutes.insights },
];
