// ============================================================
// R1 — the Evidence read seam
// ============================================================
// R1 ships a seam and no behaviour. That is an unusually easy thing to get
// wrong in an invisible way: a re-export that quietly wraps, reorders, or
// SHADOWS a symbol looks identical from the outside and only diverges once R3
// starts routing real consumers through it.
//
// So this file asserts two things and not much else:
//
//   1. IDENTITY — every symbol the seam exposes is the *same reference* as the
//      one its owning module exports. Not "equivalent", not "behaves the same":
//      the same object. That is what makes R1 provably a move rather than a copy,
//      and it is the only evidence that can rule out a wrapper having crept in.
//
//   2. THE COLLISION IS NOT COLLAPSED — both canonical modules export a function
//      named `latestCanonicalByEntity`, keyed differently. A flat re-export of
//      both would drop one silently, and the survivor would be chosen by
//      declaration order. The resulting defect is a wrong number on a screen, not
//      a crash, so nothing else would catch it.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { metricSnapshot: { findMany: vi.fn() } },
}));

import * as evidence from './index.js';
import * as verdictSource from '../verdict-engine/canonicalVerdictEvidence.js';
import * as fatigueSource from '../fatigue-forecaster/canonicalFatigueEvidence.js';
import * as connectorTypes from '../connectors/connectorTypes.js';

const SEAM_SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js'),
  'utf8',
);

describe('R1 — Evidence read seam', () => {
  // ── 1. Identity ───────────────────────────────────────────────────────────
  describe('re-exports by identity, never by copy', () => {
    const verdictSymbols = [
      'CANONICAL_VERDICT_WINDOW', 'CANONICAL_VERDICT_WINDOW_FILTER', 'CANONICAL_VERDICT_SELECT',
      'PLATFORM_VERDICT_SOURCES', 'PLATFORM_SOURCE_FILTER', 'NO_CANONICAL_WINDOW',
      'selectCanonicalVerdictSnapshots', 'partitionByCanonicalEvidence',
    ];
    it.each(verdictSymbols)('canonical verdict: %s is the same reference', (name) => {
      expect(evidence[name]).toBe(verdictSource[name]);
    });

    const fatigueSymbols = [
      'CANONICAL_FATIGUE_WINDOW', 'CANONICAL_FATIGUE_WINDOW_FILTER',
      'CANONICAL_FATIGUE_SELECT', 'selectCanonicalFatigueSnapshots',
    ];
    it.each(fatigueSymbols)('canonical fatigue: %s is the same reference', (name) => {
      expect(evidence[name]).toBe(fatigueSource[name]);
    });

    const operationalSymbols = [
      'OPERATIONAL_MEASUREMENT_WINDOWS', 'OPERATIONAL_WINDOW_FILTER', 'isOperationalWindow',
    ];
    it.each(operationalSymbols)('operational: %s is the same reference', (name) => {
      expect(evidence[name]).toBe(connectorTypes[name]);
    });

    it('exposes each canonical module whole, under its own namespace', () => {
      for (const name of Object.keys(verdictSource)) {
        expect(evidence.canonicalVerdict[name]).toBe(verdictSource[name]);
      }
      for (const name of Object.keys(fatigueSource)) {
        expect(evidence.canonicalFatigue[name]).toBe(fatigueSource[name]);
      }
    });
  });

  // ── 2. The collision ──────────────────────────────────────────────────────
  describe('latestCanonicalByEntity — the two are kept apart', () => {
    it('is NOT reachable flat, so neither can shadow the other', () => {
      expect(evidence.latestCanonicalByEntity).toBeUndefined();
    });

    it('both survive, one per namespace, as distinct functions', () => {
      expect(evidence.canonicalVerdict.latestCanonicalByEntity)
        .toBe(verdictSource.latestCanonicalByEntity);
      expect(evidence.canonicalFatigue.latestCanonicalByEntity)
        .toBe(fatigueSource.latestCanonicalByEntity);
      expect(evidence.canonicalVerdict.latestCanonicalByEntity)
        .not.toBe(evidence.canonicalFatigue.latestCanonicalByEntity);
    });

    // The behavioural proof that flattening would have been a real defect and
    // not merely untidy: one id, two levels — exactly what an entity and its
    // children look like to a hand-built row set.
    it('the two disagree on what one key means, which is why the seam cannot merge them', () => {
      const rows = [
        { entityId: 'e1', entityLevel: 'CAMPAIGN', date: '2026-08-01T00:00:00Z', frequency: 2.0, reach: 100 },
        { entityId: 'e1', entityLevel: 'ADSET',    date: '2026-08-02T00:00:00Z', frequency: 9.0, reach: 10 },
      ];

      // Fatigue keys on entityId:entityLevel — a campaign and an ad-set that
      // share an id stay two separate observations.
      const byFatigue = evidence.canonicalFatigue.latestCanonicalByEntity(rows);
      expect(byFatigue.size).toBe(2);
      expect(byFatigue.get('e1:CAMPAIGN').frequency).toBe(2.0);
      expect(byFatigue.get('e1:ADSET').frequency).toBe(9.0);

      // Verdict keys on entityId alone — correct for its own query, which has
      // already narrowed to CAMPAIGN, and wrong for fatigue's multi-level set:
      // the ad-set's 9.0 wins on date and the campaign's real 2.0 is gone.
      const byVerdict = evidence.canonicalVerdict.latestCanonicalByEntity(rows);
      expect(byVerdict.size).toBe(1);
      expect(byVerdict.get('e1').frequency).toBe(9.0);
    });
  });

  // ── 3. Structural guards ──────────────────────────────────────────────────
  describe('the seam stays a seam', () => {
    it('adds no logic of its own — import/export only', () => {
      const code = SEAM_SRC
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
      // No query, no reduction, no branching: anything the seam computed would be
      // behaviour R1 declared it was not introducing.
      expect(code).not.toMatch(/prisma\./);
      expect(code).not.toMatch(/\bfunction\b/);
      expect(code).not.toMatch(/=>/);
    });

    it('offers no blend, fallback, or promotion between the two policies', () => {
      // I4: canonical never falls back to operational. The seam is the one place
      // a well-meaning convenience helper would be easiest to add and hardest to
      // notice, so the absence is asserted rather than assumed.
      const flat = Object.keys(evidence);
      expect(flat.filter((k) => /fallback|blend|promote|orOperational|coalesce/i.test(k))).toEqual([]);
      expect(SEAM_SRC).not.toMatch(/fallback|coalesce/i);
    });

    it('does not re-export the connector vocabulary it does not own', () => {
      // connectorTypes carries detId/ENTITY_LEVEL/DATA_SOURCE/staleness. Evidence
      // re-exporting them would make it look like their owner.
      for (const name of ['detId', 'ENTITY_LEVEL', 'DATA_SOURCE', 'MEASUREMENT_WINDOW', 'isStale']) {
        expect(evidence[name]).toBeUndefined();
      }
    });
  });
});
