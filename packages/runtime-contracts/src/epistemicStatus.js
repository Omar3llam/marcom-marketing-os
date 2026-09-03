// ============================================================
// epistemicStatus — the five things Lumi can know about a claim (C-06)
// ============================================================
// 🔒 C-06, locked: THE NAMES STAY. THE MEANINGS ARE DEFINED ONCE.
//
// Lumi carries seventeen-odd status vocabularies that each answer, in their own
// words, the same five underlying questions. "We could not look" alone is
// spelled MEMORY_UNAVAILABLE, EVIDENCE_UNAVAILABLE, HISTORY_UNAVAILABLE,
// UNAVAILABLE, NOT_RECORDED and FAILING, in six different modules.
//
// This module does NOT merge them, and merging was considered and refused:
//   · HISTORY_UNAVAILABLE says WHICH read failed. Flattening it to UNAVAILABLE
//     destroys exactly what EVIDENCE_REASON exists to preserve.
//   · fifty-two hand-written z.enum mirrors on the client encode the current
//     names; a rename breaks them for no gain in truth.
//
// It adds a LAYER. Each domain vocabulary DECLARES which of five knowledge
// tokens each of its values means. The declaration — not a comment — is what
// makes "we could not look" one sentence across the whole system, and it lets a
// client handle the CLASS of an absence without knowing every dialect.
//
// ── WHAT THE TOKEN ANSWERS ──────────────────────────────────────────────────
// For the CLAIM the vocabulary exists to make — not for anything downstream of
// it, and not for what the value implies about other data:
//
//   KNOWN           we looked, and the claim can be made (whatever it says)
//   COULD_NOT_LOOK  we could not establish the truth
//   NOT_ENOUGH      we established what there is, and it does not suffice
//   NOTHING_THERE   we looked, and there is nothing
//   CANNOT_ASK      the question does not apply, or we are not entitled to ask
//
// KNOWN covers FAILING, INCOMPLETE and DEGRADING alike: each is a claim we can
// make. The domain value keeps the difference — that is the whole point of a
// registry rather than a merge.
//
// ── WHY THE NAMES ARE DELIBERATELY UNLIKE ANY DOMAIN VALUE ──────────────────
// `OK` / `UNAVAILABLE` / `EMPTY` / `UNKNOWN` would be indistinguishable from the
// domain statuses they classify, and a token confusable with a value it governs
// reproduces the defect this module exists to end.
//
// ── JURISDICTION ────────────────────────────────────────────────────────────
// Not every frozen enum is epistemic, and this module does not pretend to
// classify them all. A vocabulary belongs here when at least one of its values
// reports OUR POSITION rather than the subject, AND every remaining value can
// be classified without inventing a distinction the value does not carry.
// BOUNDS_STATUS (`SINGLE` / `NON_UNIFORM`) and CURRENCY_STATUS describe the
// ANSWER, so they stay out by ruling. The registered set, and the set
// deliberately excluded with reasons, live in
// `src/services/vocabulary/epistemicInventory.js`.
//
// PURE. No I/O, no clock, no logger. Shared by backend and client so the token
// crosses the wire without a fifty-third hand-written mirror.
// ============================================================

/** The five knowledge states. Frozen; the whole product's epistemology. */
export const KNOWLEDGE = Object.freeze({
  /** We looked, and the claim can be made. */
  KNOWN: 'KNOWN',
  /** We could not establish the truth — the read failed, or no record of it exists. */
  COULD_NOT_LOOK: 'COULD_NOT_LOOK',
  /** We established what there is, and it does not suffice to state the claim. */
  NOT_ENOUGH: 'NOT_ENOUGH',
  /** We looked, and there is nothing. A finding, not a failure. */
  NOTHING_THERE: 'NOTHING_THERE',
  /** The question does not apply here, or we are not entitled to ask it. */
  CANNOT_ASK: 'CANNOT_ASK',
});

/** The token values, for validation and for tests that must be exhaustive. */
export const KNOWLEDGE_VALUES = Object.freeze(Object.values(KNOWLEDGE));

/** Raised when a declaration does not describe its vocabulary exactly. */
export class VocabularyDeclarationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VocabularyDeclarationError';
  }
}

/**
 * Declare what each value of a status vocabulary means epistemically.
 *
 * EXHAUSTIVENESS IS STRUCTURAL, NOT A TEST. The vocabulary itself is passed in,
 * and the mapping's key set must equal its value set exactly. A value added to
 * the vocabulary later throws at module load — before a payload can carry a
 * status no one classified, and long before a client has to guess.
 *
 * @param {string} name  registry key. MODULE-QUALIFIED where a name is used
 *   twice on trunk (`attribution/EVIDENCE_STATUS`), because those collisions are
 *   real and out of C-06's scope: the qualifier records the collision rather
 *   than pretending the two vocabularies are one.
 * @param {Record<string,string>} vocabulary  the frozen domain vocabulary
 * @param {Record<string,string>} mapping  every vocabulary VALUE → one token
 * @returns {{name:string, values:readonly string[], knowledgeOf:(v:string)=>string|null,
 *            mapping:Readonly<Record<string,string>>}}
 */
export function declareStatusVocabulary(name, vocabulary, mapping) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new VocabularyDeclarationError('a status vocabulary declaration needs a name');
  }
  if (!vocabulary || typeof vocabulary !== 'object') {
    throw new VocabularyDeclarationError(`${name}: no vocabulary object was passed`);
  }
  if (!mapping || typeof mapping !== 'object') {
    throw new VocabularyDeclarationError(`${name}: no mapping was passed`);
  }

  const values = Object.values(vocabulary);
  const declared = Object.keys(mapping);

  // A value the vocabulary has and the declaration does not: the payload could
  // carry a status with no knowledge token behind it.
  const undeclared = values.filter((v) => !Object.hasOwn(mapping, v));
  if (undeclared.length > 0) {
    throw new VocabularyDeclarationError(
      `${name}: no knowledge token declared for ${undeclared.join(', ')}`,
    );
  }

  // A declaration the vocabulary does not have: a stale entry left behind by a
  // rename, which would silently stop applying to anything.
  const stray = declared.filter((k) => !values.includes(k));
  if (stray.length > 0) {
    throw new VocabularyDeclarationError(
      `${name}: declared ${stray.join(', ')}, which the vocabulary does not contain`,
    );
  }

  for (const [value, token] of Object.entries(mapping)) {
    if (!KNOWLEDGE_VALUES.includes(token)) {
      throw new VocabularyDeclarationError(
        `${name}.${value}: "${token}" is not one of ${KNOWLEDGE_VALUES.join(' | ')}`,
      );
    }
  }

  const frozenMapping = Object.freeze({ ...mapping });

  return Object.freeze({
    name,
    values: Object.freeze([...values]),
    mapping: frozenMapping,
    /**
     * The token for a status value. `null` — never a guessed token — for an
     * unrecognised or absent value, so a caller that publishes it emits an
     * absent field rather than a fabricated knowledge claim.
     */
    knowledgeOf(value) {
      return Object.hasOwn(frozenMapping, value) ? frozenMapping[value] : null;
    },
  });
}
