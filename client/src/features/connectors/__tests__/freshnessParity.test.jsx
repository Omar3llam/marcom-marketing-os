import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConnectionsResponseSchema } from '@/contracts/schemas';
import ConnectionHealthStrip from '@/features/overview/components/ConnectionHealthStrip.jsx';
import { ConnectionsView } from '../ConnectorsView.jsx';

vi.mock('@/hooks/useConnections.js', () => ({ useConnections: () => ({ data: null, loading: true, error: null }) }));
const now = new Date('2026-10-04T12:00:00Z');
const stamp = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
const connection = (over = {}) => ({
  platform: 'META', isActive: true, connected: true, connection: 'CONNECTED', stale: false,
  readiness: 'CURRENT', availability: 'OK', completeness: 'COMPLETE',
  readinessKnowledge: 'KNOWN', availabilityKnowledge: 'KNOWN', completenessKnowledge: 'KNOWN',
  lastSuccessfulSync: stamp(30), lastSyncedAt: stamp(4320), ...over,
});
const parsed = (over) => ConnectionsResponseSchema.parse({ workspaceId: 'ws', connections: [connection(over)] });
const surfaces = [
  ['Overview compact', (data) => <MemoryRouter><ConnectionHealthStrip compact state={{ data, loading: false, error: null }} /></MemoryRouter>],
  ['Overview full', (data) => <MemoryRouter><ConnectionHealthStrip state={{ data, loading: false, error: null }} /></MemoryRouter>],
  ['Channels', (data) => <ConnectionsView connections={data.connections} />],
];
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now.getTime()));
afterEach(() => vi.restoreAllMocks());

describe.each(surfaces)('%s published → parsed → rendered', (_, view) => {
  it.each([
    ['CURRENT', 'OK', 'COMPLETE', 'Current'],
    ['STALE', 'OK', 'COMPLETE', 'Stale'],
    ['NEVER_SYNCED', 'NOT_RECORDED', 'NOT_RECORDED', 'Never synced'],
    ['CURRENT', 'FAILING', 'COMPLETE', 'Current'],
    ['CURRENT', 'OK', 'INCOMPLETE', 'Current'],
    ['CURRENT', 'FAILING', 'INCOMPLETE', 'Current'],
    ['STALE', 'FAILING', 'INCOMPLETE', 'Stale'],
    ['NEVER_SYNCED', 'FAILING', 'NOT_RECORDED', 'Never synced'],
    [null, 'FAILING', 'INCOMPLETE', 'Freshness unavailable'],
    ['FUTURE_READINESS', 'OK', 'COMPLETE', 'Freshness unavailable'],
    ['CURRENT', 'FUTURE_AVAILABILITY', 'COMPLETE', 'Current'],
    ['CURRENT', 'OK', 'FUTURE_COMPLETENESS', 'Current'],
  ])('%s + %s + %s keeps independent facts', (readiness, availability, completeness, label) => {
    const { container } = render(view(parsed({ readiness, availability, completeness })));
    expect(container.textContent).toContain(label);
    if (availability === 'FAILING') expect(container.textContent).toContain('Latest sync attempt failed');
    else if (availability !== 'OK') expect(container.textContent).toContain('Latest attempt status unavailable');
    if (completeness === 'INCOMPLETE') expect(container.textContent).toContain('Last successful sync was incomplete');
    else if (completeness !== 'COMPLETE') expect(container.textContent).toContain('Completeness not recorded');
    if (readiness !== 'CURRENT' || availability !== 'OK' || completeness !== 'COMPLETE') {
      expect(container.querySelector('.lucide-circle-check, .lucide-circle-check-big')).toBeNull();
    }
    expect(container.innerHTML).not.toMatch(/text-signal-(kill|scale)/);
    expect(container.textContent).not.toMatch(/reconnect|healthy|degraded|broken|NaN/i);
  });

  it.each([
    ['CURRENT', stamp(30), stamp(4320), '30m ago'],
    ['STALE', stamp(4320), stamp(30), '3d ago'],
  ])('%s uses only the resolved successful clock', (readiness, lastSuccessfulSync, lastSyncedAt, age) => {
    const { container } = render(view(parsed({ readiness, lastSuccessfulSync, lastSyncedAt,
      health: { platform: 'META', lastSuccessfulSync: stamp(120) } })));
    expect(container.textContent).toContain(`Last successful sync ${age}`);
    expect(container.textContent).not.toContain('2h ago');
    expect(container.textContent).not.toContain(age === '30m ago' ? '3d ago' : '30m ago');
  });

  it.each(['malformed', stamp(-30), null, undefined])('invalid/absent/future success %s never fabricates age', (lastSuccessfulSync) => {
    const { container } = render(view(parsed({ lastSuccessfulSync, lastSyncedAt: 'also-malformed' })));
    expect(container.textContent).toContain('Current');
    expect(container.textContent).not.toMatch(/NaN|0m ago|Last successful sync .*ago/);
  });
  it.each([null, undefined, 'NEW_STATE'])('readiness %s cannot be inferred from compatibility fields', (readiness) => {
    const { container } = render(view(parsed({ readiness, stale: false })));
    expect(container.textContent).toContain('Freshness unavailable');
    expect(container.textContent).not.toMatch(/Current|30m ago|Synced/);
  });
  it('missing availability and completeness stay unavailable despite raw health prose', () => {
    const { container } = render(view(parsed({ availability: undefined, completeness: undefined,
      availabilityKnowledge: 'COULD_NOT_LOOK', completenessKnowledge: 'COULD_NOT_LOOK',
      health: { platform: 'META', lastError: 'raw error', lastWarning: 'raw warning' } })));
    expect(container.textContent).toContain('Latest attempt status unavailable');
    expect(container.textContent).toContain('Completeness not recorded');
    expect(container.textContent).not.toMatch(/Latest sync attempt failed|was incomplete|raw error|raw warning/);
  });
  it.each([
    ['readinessKnowledge', 'Freshness knowledge unavailable'],
    ['availabilityKnowledge', 'Latest attempt knowledge unavailable'],
    ['completenessKnowledge', 'Completeness knowledge unavailable'],
  ])('unknown %s is not silently successful', (field, label) => {
    const { container } = render(view(parsed({ [field]: 'FUTURE_KNOWLEDGE' })));
    expect(container.textContent).toContain(label);
    expect(container.querySelector('.lucide-circle-check, .lucide-circle-check-big')).toBeNull();
  });
});

it('Channels labels the later failed attempt and earlier incomplete success beside their own details', () => {
  const { container } = render(<ConnectionsView connections={parsed({ availability: 'FAILING', completeness: 'INCOMPLETE',
    health: { platform: 'META', lastError: 'rate limited', lastWarning: 'short read' } }).connections} />);
  expect(container.textContent).toContain('Latest sync attempt failed · rate limited');
  expect(container.textContent).toContain('Last successful sync was incomplete · short read');
});
