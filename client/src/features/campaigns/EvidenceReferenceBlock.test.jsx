// ============================================================
// R5 — the decision surface renders provenance, or renders nothing
// ============================================================
// API-exposes-it and UI-renders-it are two different claims. This file owns the
// second, and most of it is about the ABSENT case: a null reference means
// provenance was never captured, and the one thing the UI must not do is turn
// that into a sentence about the data — "No evidence", an empty block, a dash.
// All three would report an absence of evidence where the truth is an absence of
// a record about it.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvidenceReferenceBlock } from './EvidenceReferenceBlock.jsx';

const REFERENCE = Object.freeze({
  population:        'canonical-verdict',
  selector:          'selectCanonicalVerdictSnapshots',
  measurementWindow: 'CUMULATIVE_30D',
  sources:           ['META'],
  observedAt:        ['2026-08-10T09:00:00.000Z'],
  reduction:         'latest-per-entity',
  entityIds:         ['c1'],
  rowCount:          11,
  refs:              [],
});

const renderRef = (over) =>
  render(<EvidenceReferenceBlock reference={over === null ? null : { ...REFERENCE, ...over }} />);

describe('R5 — EvidenceReferenceBlock', () => {
  describe('when provenance was captured', () => {
    it('names the population and the window it represents', () => {
      renderRef();
      expect(screen.getByText(/Canonical verdict evidence/)).toBeInTheDocument();
      expect(screen.getByText(/CUMULATIVE_30D/)).toBeInTheDocument();
    });

    it('names the source and the observation date', () => {
      renderRef();
      expect(screen.getByText('META')).toBeInTheDocument();
      // The visible line, not the screen-reader label beside it — `Observed`
      // alone matches both, and matching the label would pass with no date
      // rendered at all.
      expect(screen.getByText(/Observed \S/)).toBeInTheDocument();
    });

    it('states how many rows were consumed — not how many decisions came out', () => {
      renderRef();
      expect(screen.getByText(/11 evidence rows/)).toBeInTheDocument();
    });

    it('says "row" for one and "rows" for several, and never rounds zero up', () => {
      const { unmount } = renderRef({ rowCount: 1 });
      expect(screen.getByText(/1 evidence row$/)).toBeInTheDocument();
      unmount();
      renderRef({ rowCount: 0, sources: [], observedAt: [] });
      expect(screen.getByText(/0 evidence rows/)).toBeInTheDocument();
    });

    it('spells the reduction out rather than calling it daily', () => {
      // The R4 rule, held at the last surface it could be broken on: an
      // observation-day reduction over trailing-window rows must not be
      // rendered as a daily series.
      renderRef({ reduction: 'latest-per-stream-per-day' });
      expect(screen.getByText(/per observation day/)).toBeInTheDocument();
      expect(screen.queryByText(/^Daily/)).not.toBeInTheDocument();
    });

    it('shows the multiple observations behind a series', () => {
      renderRef({
        reduction: 'series',
        observedAt: ['2026-08-09T09:00:00.000Z', '2026-08-10T09:00:00.000Z'],
      });
      expect(screen.getByText(/latest of 2/)).toBeInTheDocument();
    });
  });

  describe('when a fact was not captured', () => {
    it('renders no source line rather than "unknown"', () => {
      // The guardrail writer's real state: it projects no source, so none was
      // captured. A rendered "unknown" would be a claim about the data.
      const { container } = renderRef({ sources: null });
      expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
      expect(container.textContent).not.toMatch(/META/);
      // …and the block is still there, because the rest of it is real.
      expect(screen.getByText(/Evidence/)).toBeInTheDocument();
    });

    it('renders no window when the read could not establish one', () => {
      renderRef({ measurementWindow: null });
      expect(screen.queryByText(/CUMULATIVE_30D/)).not.toBeInTheDocument();
      expect(screen.getByText(/Canonical verdict evidence/)).toBeInTheDocument();
    });

    it('renders no observation line rather than a fabricated date', () => {
      const { container } = renderRef({ observedAt: null });
      expect(container.textContent).not.toMatch(/Observed/);
    });
  });

  describe('when provenance was never captured at all', () => {
    it('renders NOTHING for a null reference', () => {
      // THE RULE THIS COMPONENT EXISTS FOR. Every pre-R5 decision, and every
      // campaign with no stored decision, arrives here as null.
      const { container } = renderRef(null);
      expect(container).toBeEmptyDOMElement();
    });

    it('does not say "No evidence", or draw an empty block, or show a dash', () => {
      const { container } = renderRef(null);
      expect(screen.queryByText(/Evidence/)).not.toBeInTheDocument();
      expect(screen.queryByText(/No evidence/i)).not.toBeInTheDocument();
      expect(container.textContent).toBe('');
    });

    it('renders nothing when the reference carries nothing sayable', () => {
      const { container } = render(<EvidenceReferenceBlock reference={{}} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
