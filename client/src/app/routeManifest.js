export const appRoutes = {
  overview: '/app/overview',
  campaigns: '/app/campaigns',
  intelligence: '/app/intelligence',
  blendedTruth: '/app/intelligence/blended-truth',
  insights: '/app/intelligence/insights',
  proof: '/app/intelligence/proof',
  decisions: '/app/decisions',
  contentLab: '/app/content',
  copilot: '/app/copilot',
  settings: '/app/settings',
  settingsGeneral: '/app/settings/general',
  settingsIntegrations: '/app/settings/integrations',
  settingsTeam: '/app/settings/team',
  settingsBilling: '/app/settings/billing',
  settingsWorkspace: '/app/settings/workspace',
  settingsSecurity: '/app/settings/security',
};

export const settingsSections = [
  { key: 'general', label: 'General', path: appRoutes.settingsGeneral },
  { key: 'integrations', label: 'Integrations', path: appRoutes.settingsIntegrations },
  { key: 'team', label: 'Team & Roles', path: appRoutes.settingsTeam },
  { key: 'billing', label: 'Billing', path: appRoutes.settingsBilling },
  { key: 'workspace', label: 'Workspace', path: appRoutes.settingsWorkspace },
  { key: 'security', label: 'Security', path: appRoutes.settingsSecurity },
];

export const legacyAppRedirects = [
  { from: 'home', to: appRoutes.overview },
  { from: 'feed', to: appRoutes.decisions },
  { from: 'truth', to: appRoutes.blendedTruth },
  { from: 'proof', to: appRoutes.proof },
  { from: 'connections', to: appRoutes.settingsIntegrations },
  { from: 'growth', to: appRoutes.insights },
];
