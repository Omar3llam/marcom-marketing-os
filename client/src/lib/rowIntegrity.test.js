// ============================================================
// rowIntegrity — Tier 2b: the mechanism, proved once
// ------------------------------------------------------------
// RULING (Omar): an unreadable row is never equivalent to an absent row. For
// ordinary entity and experiment lists the shape is PRESERVE + MARK, in place:
//
//     Campaign A     VALID          not:    Campaign A
//     Campaign B     UNREADABLE             Campaign C
//     Campaign C     VALID
//
// "لأن الثانية تصنع false absence."
//
// Two outputs on purpose. `entries` is positional and holds every row, so a
// surface can render the gap where a row could not be read. `readable` is the
// old array, unchanged in element type, so nothing that COUNTS, sorts or
// computes can accidentally take a marker for a row — which would replace a
// false absence with a false presence.
// ============================================================
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ROW, readRows } from './rowIntegrity.js';

const Schema = z.object({ id: z.string().min(1), n: z.number() });
const good = (id, n = 1) => ({ id, n });

describe('readRows · every row survives, readable or not', () => {
  it('keeps an unreadable row IN POSITION rather than closing the gap', () => {
    const r = readRows(Schema, [good('a'), { id: 'b' }, good('c')]);
    expect(r.entries.map((e) => e.state)).toEqual([ROW.READABLE, ROW.UNREADABLE, ROW.READABLE]);
    expect(r.entries.map((e) => e.index)).toEqual([0, 1, 2]);
  });

  it('counts what it could not read', () => {
    const r = readRows(Schema, [good('a'), { id: 'b' }, 'not even an object']);
    expect(r.unreadableCount).toBe(2);
  });

  it('an unreadable entry carries NO value — a half-parsed row is not a row', () => {
    const r = readRows(Schema, [{ id: 'b', n: 'twelve' }]);
    expect(r.entries[0].state).toBe(ROW.UNREADABLE);
    expect(r.entries[0].value).toBeNull();
  });

  it('`readable` holds only parsed rows, so nothing that counts sees a marker', () => {
    const r = readRows(Schema, [good('a'), { id: 'b' }, good('c', 5)]);
    expect(r.readable).toHaveLength(2);
    expect(r.readable.map((v) => v.id)).toEqual(['a', 'c']);
    expect(r.readable.every((v) => typeof v.n === 'number')).toBe(true);
  });

  it('a non-array collection is reported, never silently emptied', () => {
    // The caller decides whether that is an error; the mechanism refuses to
    // pretend a missing collection is an empty one.
    expect(readRows(Schema, undefined).ok).toBe(false);
    expect(readRows(Schema, null).ok).toBe(false);
    expect(readRows(Schema, { rows: [] }).ok).toBe(false);
  });

  // ── self-refutation ───────────────────────────────────────────────────────
  it('an all-valid collection is fully readable, with nothing marked', () => {
    const r = readRows(Schema, [good('a'), good('b')]);
    expect(r.ok).toBe(true);
    expect(r.unreadableCount).toBe(0);
    expect(r.entries.every((e) => e.state === ROW.READABLE)).toBe(true);
    expect(r.readable).toHaveLength(2);
  });

  it('a genuinely empty collection is empty, and is NOT unreadable', () => {
    const r = readRows(Schema, []);
    expect(r.ok).toBe(true);
    expect(r.entries).toEqual([]);
    expect(r.unreadableCount).toBe(0);
  });
});
