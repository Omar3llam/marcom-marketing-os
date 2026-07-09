// ============================================================
// agendaItemRoute — where an agenda item navigates (deep-link)
// ------------------------------------------------------------
// A VERDICT that carries its entityId deep-links to that campaign row
// (Campaigns reads ?entity= to scroll-to + expand it); without one it falls
// back to the list. Other item types keep their existing surfaces.
// ============================================================
import { describe, it, expect } from 'vitest';
import { agendaItemRoute } from './AgendaItem.jsx';
import { appRoutes } from '@/app/routeManifest.js';

describe('agendaItemRoute — VERDICT deep-link', () => {
  it('deep-links a VERDICT with an entityId to that campaign (?entity=)', () => {
    expect(agendaItemRoute({ type: 'VERDICT', entityId: 'abc-123' }))
      .toBe(`${appRoutes.campaigns}?entity=abc-123`);
  });

  it('URL-encodes the entityId', () => {
    expect(agendaItemRoute({ type: 'VERDICT', entityId: 'a b&c' }))
      .toBe(`${appRoutes.campaigns}?entity=${encodeURIComponent('a b&c')}`);
  });

  it('falls back to the campaigns list when a VERDICT carries no entityId', () => {
    expect(agendaItemRoute({ type: 'VERDICT', entityId: null })).toBe(appRoutes.campaigns);
  });

  it('leaves other item types on their own surfaces', () => {
    expect(agendaItemRoute({ type: 'TEST' })).toBe(appRoutes.testing);
    expect(agendaItemRoute({ type: 'PLAN_ADJUSTMENT', id: 'blended:gap' })).toBe(appRoutes.blendedTruth);
  });
});
