// ============================================================
// MetricsPanel — the KPI strip reads its real source, honestly
// ------------------------------------------------------------
// The strip used to hardcode "Live · CSV-derived" and render fmtCurrency(0) even
// when the live connector (not CSV) was the substrate feeding the page — a $0.00
// that asserted a source that wasn't there. These assert the source-resolved,
// null-honest behavior: live spend shows the live label; an absent metric shows
// "—", never a fabricated 0 or a stale source claim.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetricsPanel } from '../MetricsPanel.jsx';

// Blended CPA null now renders an "Add revenue data" Link → needs a Router.
const renderPanel = (props) => render(<MemoryRouter><MetricsPanel {...props} /></MemoryRouter>);

describe('MetricsPanel — source-resolved, null-honest KPI strip', () => {
  it('live connector: real spend + "Live · connector", never the stale CSV-derived label', () => {
    renderPanel({
      spend: 1234, spendLabel: 'Live · connector', blendedCpa: null,
      wasted: null, wastedPct: null, healthScore: null, healthLabel: 'Sync Meta to see health',
      healthColor: 'text-lumi-muted', currency: 'USD',
    });
    expect(screen.getByText(/\$1,234/)).toBeInTheDocument();
    expect(screen.getByText('Live · connector')).toBeInTheDocument();
    expect(screen.queryByText(/CSV-derived/)).not.toBeInTheDocument();
  });

  it('Wasted Spend with no analysis backing renders "—" + "Needs analysis", not $0.00', () => {
    renderPanel({
      spend: 500, spendLabel: 'Live · connector', blendedCpa: null,
      // The absence is now NAMED. This line used to be absent and the caption
      // was inferred from `blendedCpa == null`, which is the defect: it read
      // "No conversions tracked yet" for all seven absences.
      cpaAbsence: 'NO_CONVERSIONS', cpaLabel: 'No conversions tracked yet',
      wasted: null, wastedPct: null, healthScore: null, healthLabel: 'Sync Meta to see health',
      healthColor: 'text-lumi-muted', currency: 'USD',
    });
    expect(screen.getByText('Needs analysis')).toBeInTheDocument();
    expect(screen.getByText('No conversions tracked yet')).toBeInTheDocument();
  });

  it('no source at all: Total Spend shows "—" + "No data yet" (no fabricated 0)', () => {
    renderPanel({
      spend: null, spendLabel: 'No data yet', blendedCpa: null,
      wasted: null, wastedPct: null, healthScore: null, healthLabel: 'Sync Meta to see health',
      healthColor: 'text-lumi-muted', currency: 'USD',
    });
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    // The Total Spend card value is an em-dash, not "$0.00".
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  // Retitled: "unknown" was the old, value-based rule and it is exactly what
  // sent an operator to reconnect revenue during an outage. The CTA belongs to
  // ONE absence; the per-absence cases are asserted further down.
  it('offers the "Connect sales data" CTA when conversions are the thing missing', () => {
    const { unmount } = renderPanel({
      spend: 500, spendLabel: 'Live · connector', blendedCpa: null,
      cpaAbsence: 'NO_CONVERSIONS', cpaLabel: 'No conversions tracked yet',
      wasted: null, wastedPct: null, healthScore: null, healthLabel: '—', healthColor: '', currency: 'USD',
    });
    const cta = screen.getByRole('link', { name: /Connect sales data to unlock profit-based recommendations/i });
    expect(cta).toHaveAttribute('href', '/app/settings/revenue');
    unmount();

    // Real CPA present → no CTA (nothing to unlock).
    renderPanel({
      spend: 500, spendLabel: 'Live · connector', blendedCpa: 4200,
      wasted: null, wastedPct: null, healthScore: null, healthLabel: '—', healthColor: '', currency: 'USD',
    });
    expect(screen.queryByRole('link', { name: /Upload revenue CSV/i })).not.toBeInTheDocument();
  });
});

// ── The CPA absence carries its own reason ──────────────────────────────────
// This card used to INFER the reason from the value:
//
//     delta={blendedCpa != null ? 'Per-campaign avg' : 'No conversions tracked yet'}
//
// `blank(absence)` sets `blendedCpa: null` for ALL SEVEN absences, so six of
// them rendered the seventh's reason — and the footer turned that wrong reason
// into an ACTION ("Connect sales data →"). A failed read, a refused seat, a
// mixed-currency account and a request still in flight were each reported as a
// tracking gap, with an instruction to connect data that is already connected.
//
// RULING (Omar): the aggregate token carries the reason; the consumer does not
// infer it from `blendedCpa === null`. C-07 — a token cannot replace a reason.
//
// Note what the old suite proved: one case, `blendedCpa: null` with spend
// present, commented "blendedCpa null → honest". It passed because it only ever
// tried the ONE absence whose hardcoded reason happens to be right.
import { AGGREGATE_ABSENCE } from '@/lib/accountAggregate.js';

describe('MetricsPanel — Blended CPA names the absence it actually has', () => {
  const withCpaAbsence = (cpaAbsence, cpaLabel) => renderPanel({
    spend: 500, spendLabel: 'Live · connector', blendedCpa: null,
    cpaAbsence, cpaLabel,
    wasted: null, wastedPct: null, healthScore: null, healthLabel: 'Sync Meta to see health',
    healthColor: 'text-lumi-muted', currency: 'USD',
  });
  const connectLink = () => screen.queryByText(/Connect sales data/i);

  // Every member of the vocabulary, not one representative of it.
  const CASES = [
    [AGGREGATE_ABSENCE.LOADING, 'Checking…'],
    [AGGREGATE_ABSENCE.READ_FAILED, 'Couldn’t read this account'],
    [AGGREGATE_ABSENCE.NO_MEASUREMENT, 'No data yet'],
    [AGGREGATE_ABSENCE.NOT_MEASURED, 'Not measured yet'],
    [AGGREGATE_ABSENCE.MIXED_CURRENCY, 'Mixed currencies — no single total'],
    [AGGREGATE_ABSENCE.NO_CONVERSIONS, 'No conversions tracked yet'],
    [AGGREGATE_ABSENCE.NOT_PERMITTED, 'Not available for this seat'],
  ];

  it.each(CASES)('%s reads its own reason, not another absence’s', (absence, label) => {
    withCpaAbsence(absence, label);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each(CASES.filter(([a]) => a !== AGGREGATE_ABSENCE.NO_CONVERSIONS))(
    '%s does NOT say conversions are untracked',
    (absence, label) => {
      withCpaAbsence(absence, label);
      expect(screen.queryByText('No conversions tracked yet')).not.toBeInTheDocument();
    },
  );

  // ── the instruction, which is the half that costs the operator work ───────
  it.each(CASES.filter(([a]) => a !== AGGREGATE_ABSENCE.NO_CONVERSIONS))(
    '%s offers NO "connect sales data" instruction',
    (absence, label) => {
      // Sending someone to reconnect revenue they already have — or that their
      // seat cannot reach — is a wrong next step, not a missing one.
      withCpaAbsence(absence, label);
      expect(connectLink()).not.toBeInTheDocument();
    },
  );

  it('NO_CONVERSIONS is the one absence that DOES offer it', () => {
    withCpaAbsence(AGGREGATE_ABSENCE.NO_CONVERSIONS, 'No conversions tracked yet');
    expect(connectLink()).toBeInTheDocument();
  });

  // ── self-refutation: the present case is untouched ────────────────────────
  it('a real CPA still reads "Per-campaign avg" — that caption is the surface’s', () => {
    renderPanel({
      spend: 500, spendLabel: 'Live · connector', blendedCpa: 42,
      cpaAbsence: null, cpaLabel: null,
      wasted: null, wastedPct: null, healthScore: null, healthLabel: 'x',
      healthColor: 'text-lumi-muted', currency: 'USD',
    });
    expect(screen.getByText('Per-campaign avg')).toBeInTheDocument();
    expect(connectLink()).not.toBeInTheDocument();
  });
});
