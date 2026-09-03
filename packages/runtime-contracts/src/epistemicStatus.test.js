// ============================================================
// epistemicStatus — the layer itself (C-06)
// ============================================================
// Tests 1–3 of the C-06 contract: the tokens are one language, and a
// declaration that does not describe its vocabulary exactly cannot be made.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  KNOWLEDGE,
  KNOWLEDGE_VALUES,
  declareStatusVocabulary,
  VocabularyDeclarationError,
} from './epistemicStatus.js';

const VOCAB = Object.freeze({ OK: 'OK', GONE: 'GONE' });

describe('C-06 · the five knowledge tokens', () => {
  it('are exactly five, each meaning one thing', () => {
    expect(KNOWLEDGE_VALUES).toEqual([
      'KNOWN', 'COULD_NOT_LOOK', 'NOT_ENOUGH', 'NOTHING_THERE', 'CANNOT_ASK',
    ]);
    // No token is a synonym of another: the set is as large as its members.
    expect(new Set(KNOWLEDGE_VALUES).size).toBe(5);
  });

  it('are frozen — the product epistemology is not patchable at runtime', () => {
    expect(Object.isFrozen(KNOWLEDGE)).toBe(true);
    expect(() => { KNOWLEDGE.KNOWN = 'nope'; }).toThrow();
  });

  it('are deliberately unlike any domain status value', () => {
    // A token confusable with a value it governs reproduces the very defect
    // C-06 exists to end. OK / UNAVAILABLE / EMPTY / UNKNOWN are all in use as
    // DOMAIN values on trunk, so none of them may be a token.
    for (const collidable of ['OK', 'UNAVAILABLE', 'EMPTY', 'UNKNOWN', 'NOT_RECORDED']) {
      expect(KNOWLEDGE_VALUES).not.toContain(collidable);
    }
  });
});

describe('C-06 · declareStatusVocabulary', () => {
  it('maps each value to its token, and refuses to guess for anything else', () => {
    const d = declareStatusVocabulary('TEST_STATUS', VOCAB, {
      OK:   KNOWLEDGE.KNOWN,
      GONE: KNOWLEDGE.COULD_NOT_LOOK,
    });
    expect(d.knowledgeOf('OK')).toBe(KNOWLEDGE.KNOWN);
    expect(d.knowledgeOf('GONE')).toBe(KNOWLEDGE.COULD_NOT_LOOK);
    // An unrecognised or absent value yields null, never a token. A publisher
    // then emits an absent field rather than a fabricated knowledge claim.
    expect(d.knowledgeOf('SOMETHING_ELSE')).toBeNull();
    expect(d.knowledgeOf(null)).toBeNull();
    expect(d.knowledgeOf(undefined)).toBeNull();
  });

  it('throws when a vocabulary value has no token — exhaustiveness is structural', () => {
    // This is the guard that fires at MODULE LOAD the day someone adds a sixth
    // value to a seven-value vocabulary, rather than in a payload months later.
    expect(() => declareStatusVocabulary('TEST_STATUS', VOCAB, { OK: KNOWLEDGE.KNOWN }))
      .toThrow(VocabularyDeclarationError);
    expect(() => declareStatusVocabulary('TEST_STATUS', VOCAB, { OK: KNOWLEDGE.KNOWN }))
      .toThrow(/GONE/);
  });

  it('throws on a declaration for a value the vocabulary does not contain', () => {
    expect(() => declareStatusVocabulary('TEST_STATUS', VOCAB, {
      OK: KNOWLEDGE.KNOWN, GONE: KNOWLEDGE.COULD_NOT_LOOK, STALE_ENTRY: KNOWLEDGE.KNOWN,
    })).toThrow(/STALE_ENTRY/);
  });

  it('throws when a token is not one of the five', () => {
    expect(() => declareStatusVocabulary('TEST_STATUS', VOCAB, {
      OK: KNOWLEDGE.KNOWN, GONE: 'UNAVAILABLE',
    })).toThrow(/UNAVAILABLE/);
  });

  it('freezes what it returns, mapping included', () => {
    const d = declareStatusVocabulary('TEST_STATUS', VOCAB, {
      OK: KNOWLEDGE.KNOWN, GONE: KNOWLEDGE.COULD_NOT_LOOK,
    });
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.mapping)).toBe(true);
  });

  it('refuses a nameless or shapeless declaration', () => {
    expect(() => declareStatusVocabulary('', VOCAB, {})).toThrow(VocabularyDeclarationError);
    expect(() => declareStatusVocabulary('X', null, {})).toThrow(VocabularyDeclarationError);
    expect(() => declareStatusVocabulary('X', VOCAB, null)).toThrow(VocabularyDeclarationError);
  });
});
