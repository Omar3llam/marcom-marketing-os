// ============================================================
// R7 — the tested-dimension contract, pinned across the two files that share it
// ------------------------------------------------------------
// One real learning loop runs through DecisionMemoryEntry, and it is held
// together by a string:
//
//   TestTrackerService   writes  actionType = `${TEST_ROOT_PREFIX}${dimension}`
//   TestGeneratorService reads   actionType startsWith TEST_MEMORY_PREFIX
//                        and     dimension = actionType.slice(PREFIX.length)
//
// Both literals were 'test:', declared independently in two files, and NO TEST
// referenced either one. Rename one and nothing fails: the generator simply
// stops recognising concluded tests and begins re-proposing experiments the
// account has already run — a silent regression that looks like enthusiasm.
//
// R7 does not generalise this into a memory abstraction. It pins it.
// ============================================================
import { describe, it, expect } from 'vitest';
import { TEST_MEMORY_PREFIX, buildMemoryInputs } from './TestGeneratorService.js';
import { TEST_ROOT_PREFIX } from '../test-tracker/TestTrackerService.js';
import { generateAgenda } from './testGeneratorEngine.js';

describe('R7 — writer and reader agree on the tested-dimension prefix', () => {
  it('THE CONTRACT: the two prefixes are identical', () => {
    // If this fails, one side was renamed without the other. Fix the rename —
    // do not "fix" the test, and do not add a compatibility shim that accepts
    // both, which would make every row written under the old prefix ambiguous.
    expect(TEST_ROOT_PREFIX).toBe(TEST_MEMORY_PREFIX);
  });

  it('the prefix is non-empty and delimited', () => {
    // An empty prefix would make the reader match EVERY DecisionMemoryEntry —
    // including the FATIGUE_FORECAST and incrementality rows written by two
    // unrelated services — and feed them to the generator as tested dimensions.
    expect(TEST_ROOT_PREFIX).toBeTruthy();
    expect(TEST_ROOT_PREFIX.endsWith(':')).toBe(true);
  });

  it('ROUND TRIP: what the tracker writes, the generator reads back intact', () => {
    // The writer's exact expression, from TestTrackerService.
    const dimension = 'CREATIVE_FORMAT';
    const written = { entityId: 'e1', actionType: `${TEST_ROOT_PREFIX}${dimension}`, rationale: 'variant B won', isSustainable: true };

    const [read] = buildMemoryInputs([written]);
    expect(read.dimension).toBe(dimension);
    expect(read.entityId).toBe('e1');
    expect(read.isSustainable).toBe(true);
  });

  it('a dimension containing the delimiter still round-trips', () => {
    // slice(PREFIX.length) keeps everything after the first prefix, so a
    // dimension with its own colon survives. A split(':')[1] implementation
    // would truncate it, and this is what would catch that.
    const dimension = 'AUDIENCE:LOOKALIKE_1PCT';
    const [read] = buildMemoryInputs([{ actionType: `${TEST_ROOT_PREFIX}${dimension}` }]);
    expect(read.dimension).toBe(dimension);
  });

  it('rows written by the OTHER DecisionMemoryEntry producers are ignored', () => {
    // The table is shared. FatiguePredictionService writes FATIGUE_FORECAST and
    // IncrementalityService writes its own rows; neither is a tested dimension,
    // and admitting one would tell the generator an experiment ran that did not.
    const inputs = buildMemoryInputs([
      { actionType: 'FATIGUE_FORECAST', entityId: 'e1' },
      { actionType: 'incrementality', entityId: 'e2' },
      { actionType: null, entityId: 'e3' },
      { entityId: 'e4' },
      { actionType: `${TEST_ROOT_PREFIX}COPY_TONE`, entityId: 'e5' },
    ]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].entityId).toBe('e5');
  });

  it('absent outcome and sustainability stay null, never invented', () => {
    const [read] = buildMemoryInputs([{ actionType: `${TEST_ROOT_PREFIX}X`, entityId: 'e1' }]);
    expect(read.outcome).toBeNull();
    expect(read.isSustainable).toBeNull();
    expect(read.isSustainable).not.toBe(false);
  });

  it.each([null, undefined])('unmeasured durability (%s) has no sustained or failed-learning multiplier', (isSustainable) => {
    const memory = buildMemoryInputs([{ entityId: 'e1', actionType: `${TEST_ROOT_PREFIX}HOOK`, isSustainable }]);
    expect(memory[0].isSustainable).toBeNull();
    const entities = [{ entityId: 'e1', metrics: { ctr: 0.5, spendMinor: 10000 } }];
    const hook = (flag) => generateAgenda({ entities, memory: [{ ...memory[0], isSustainable: flag }] }).find((s) => s.dimension === 'HOOK');
    const unknown = hook(memory[0].isSustainable);
    expect(unknown.rationale).toContain('memory ×1).');
    expect(unknown.priority).toBeGreaterThan(hook(true).priority);
    expect(hook(true).priority).toBeGreaterThan(hook(false).priority);
    // Historical explicit true/false rows retain their existing meanings.
    expect(hook(true).rationale).toContain('memory ×0.8).');
    expect(hook(false).rationale).toContain('memory ×0.5).');
  });
});
