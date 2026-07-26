// ============================================================
// Sidebar nav copy — the Campaigns entry names the decision queue
// ------------------------------------------------------------
// Asserted on the exported array rather than a render: Sidebar needs auth,
// plan and router context to mount, none of which this copy depends on.
// ============================================================
import { describe, it, expect } from 'vitest';
import { tools } from './Sidebar.jsx';

describe('Sidebar nav — Campaigns', () => {
  it('describes the page as the decision queue', () => {
    const campaigns = tools.find((t) => t.key === 'campaigns');
    expect(campaigns.sub).toBe('Decision queue');
  });

  it('no longer says "Verdicts + diagnosis"', () => {
    expect(tools.map((t) => t.sub)).not.toContain('Verdicts + diagnosis');
  });
});
