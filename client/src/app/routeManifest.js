export const appRoutes = {
  overview: '/app/overview',
  campaigns: '/app/campaigns',
  intelligence: '/app/intelligence',
  blendedTruth: '/app/intelligence/blended-truth',
  insights: '/app/intelligence/insights',
  proof: '/app/intelligence/proof',
  testing: '/app/testing',
  measure: '/app/measure',
  leadership: '/app/leadership',
  contentLab: '/app/content',
  publishing: '/app/publishing',
  copilot: '/app/copilot',
  settings: '/app/settings',
  settingsGeneral: '/app/settings/general',
  settingsIntegrations: '/app/settings/integrations',
  settingsTeam: '/app/settings/team',
  settingsRevenue: '/app/settings/revenue',
  settingsWorkspace: '/app/settings/workspace',
  settingsSecurity: '/app/settings/security',
};

// The three Intelligence surfaces, rendered as a shared sub-nav strip on each
// (mirrors `settingsSections`). `roles` gates a tab to those collabRoles — Proof
// is ungated (all roles; the view itself narrows by role). The Sidebar's
// "Intelligence" item only lands on Blended Truth; this strip is how Growth
// Strategy + Proof become reachable without a deep-link.
export const intelligenceSections = [
  { key: 'blended-truth', label: 'Blended Truth',    path: appRoutes.blendedTruth, roles: ['STRATEGIST', 'BUYER'] },
  { key: 'insights',      label: 'Growth Strategy',  path: appRoutes.insights,     roles: ['STRATEGIST', 'BUYER'] },
  { key: 'proof',         label: 'Proof of Learning', path: appRoutes.proof },
];

export const settingsSections = [
  { key: 'general', label: 'General', path: appRoutes.settingsGeneral },
  { key: 'integrations', label: 'Channels', path: appRoutes.settingsIntegrations },
  { key: 'team', label: 'Team & Roles', path: appRoutes.settingsTeam },
  { key: 'revenue', label: 'Revenue data', path: appRoutes.settingsRevenue },
  { key: 'workspace', label: 'Workspace', path: appRoutes.settingsWorkspace },
  { key: 'security', label: 'Security', path: appRoutes.settingsSecurity },
];

export const legacyAppRedirects = [
  { from: 'home', to: appRoutes.overview },
  { from: 'feed', to: appRoutes.overview },
  { from: 'truth', to: appRoutes.blendedTruth },
  { from: 'proof', to: appRoutes.proof },
  { from: 'connections', to: appRoutes.settingsIntegrations },
  { from: 'growth', to: appRoutes.insights },
];
