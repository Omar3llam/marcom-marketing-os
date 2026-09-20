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
//
// R-15 (Phase 5.12) — the SECTION AUDIENCE, declared here rather than inside
// each tab so that one list answers every question a permission has to answer:
// which nav entries appear, which section a URL is allowed to render, and which
// controls inside it may act. A tab that resolves its own role answers the
// middle question and not the first, which is how /app/settings/team came to
// render from a URL parameter with no check at all.
//
// TWO FIELDS, NOT ONE. "May I look at this" and "may I change it" are different
// permissions, and the backend already treats them as different: the team
// roster read is open to any member, while every team mutation carries
// requireCollabRole('STRATEGIST'). Collapsing them into a single `roles` field
// forced one answer onto two questions, and the answer it forced was the
// stricter one — which took a read-only roster away from BUYER and CLIENT that
// the API grants them. A surface may be narrower than its backend deliberately;
// it may not be narrower by accident, because one field had to mean two things.
//
//   viewAudience   — may this seat OPEN the section. Gated in SettingsView, so
//                    the nav and the URL cannot disagree.
//   manageAudience — may this seat ACT inside it. Read by the section itself,
//                    because only the section knows which controls are the
//                    mutations. It is the frontend's account of a rule the
//                    backend enforces; it never replaces that enforcement.
//
// An ABSENT field is unconstrained on that axis — not "unknown", and not an
// oversight. `general` and `security` act on the caller's OWN identity (display
// name, notification prefs, password reset, account deletion) and the backend
// gates neither by collabRole, so a restriction here would invent a rule the
// product does not have.
//
// `workspace` is deliberately left unconstrained on BOTH axes and is an OPEN
// RULING: the backend serves the read to any member (GET /api/user/workspace)
// and gates only the write (PATCH -> requireCollabRole('STRATEGIST')), and the
// tab has never been gated. Whether a BUYER should see the workspace name, and
// whether the name field should be read-only rather than 403 on save, are
// product decisions — guessing them here is what this slice forbids.
export const settingsSections = [
  { key: 'general', label: 'General', path: appRoutes.settingsGeneral },
  // Backend: GET /api/team/members is open to ANY MEMBER by design
  // (src/routes/team/index.js). The four mutations — invite, change role,
  // remove, cancel invite — each carry requireCollabRole('STRATEGIST'). The
  // surface mirrors that split exactly rather than narrowing the read.
  {
    key: 'team',
    label: 'Team & Roles',
    path: appRoutes.settingsTeam,
    manageAudience: ['STRATEGIST'],
  },
  // Backend: POST /api/lumi/revenue/csv is requireCollabRole('STRATEGIST').
  // Here the two axes genuinely coincide: the section IS the upload, so there
  // is no read for a non-strategist to be shown. Stated as both fields rather
  // than inferred, so that a future read-only revenue view has somewhere to go.
  {
    key: 'revenue',
    label: 'Revenue data',
    path: appRoutes.settingsRevenue,
    viewAudience: ['STRATEGIST'],
    manageAudience: ['STRATEGIST'],
  },
  { key: 'workspace', label: 'Workspace', path: appRoutes.settingsWorkspace },
  { key: 'security', label: 'Security', path: appRoutes.settingsSecurity },
];

/** The one lookup, so no caller re-declares an audience it should be reading. */
export function settingsSection(key) {
  return settingsSections.find((s) => s.key === key);
}

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
