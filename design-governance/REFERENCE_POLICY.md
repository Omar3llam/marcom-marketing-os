# LUMI REFERENCE POLICY

```text
Status   FOUNDATION — awaiting Review Gate G-1
Date     2026-09-14 · base a3ec116
```

## RP-0 · The rule

> **References can inform principles. They never supply outputs.**

A reference teaches *why* something works. LUMI then builds its own *what*
from its own grammar. If a reviewer can name the reference by looking at the
result, the reference was copied, not transformed.

---

## RP-1 · What may be taken from a reference

Only these five, and only in abstract form:

| May take | Meaning | Example of legitimate extraction |
|---|---|---|
| **Principle** | a reason something works | "a single axis of reading reduces the cost of comparison" |
| **Composition** | a proportion or arrangement idea, detached from its content | "a primary column with a subordinate annotation margin" |
| **Interaction idea** | a behaviour pattern, detached from its styling | "focus returns to the invoking control after a dialog closes" |
| **Material** | a physical or print quality translated into screen terms | "hairline rules in architectural drawings separate without enclosing" |
| **Hierarchy** | an ordering logic | "the conclusion is set before its evidence in legal judgments" |

Non-software references (architectural drawings, engineering documentation,
editorial typography, cartography, instrument panels, legal and scientific
writing) are **preferred**. They carry the structure-and-evidence qualities
LUMI needs without importing another product's identity.

## RP-2 · What may never be reproduced

- **Competitor layouts**: any analytics, ads-management, BI or AI-assistant
  product's screen arrangement, even restyled.
- **Recognisable AI UI**: chat surfaces, prompt bars, assistant avatars, sparkle
  and orb iconography, streaming-text presentation (VISUAL_BOUNDARIES.md
  VB-F4…VB-F7, VB-F11).
- **Existing brand systems**: another company's palette, type pairing, logo
  geometry, illustration style, iconography set identity or motion signature.
- **Distinctive product structures**: a named product's signature navigation,
  onboarding sequence, pricing-page structure, or data-card anatomy.
- **Assets**: screenshots, icons, illustrations or fonts, unless their licence
  permits use **and** the use passes RP-4. Licence permission alone is not
  approval.
- **Framework defaults presented as design**: a stock component kit with only the
  accent colour changed (ANTI_CONVERGENCE.md AC-1).

## RP-3 · Transformation — the required step

Every reference used for a LUMI artefact goes through four steps.

```text
1. EXTRACT    state the principle / composition / interaction / material / hierarchy in words,
              with NO reference to how the source looks
2. DISCARD    list what is deliberately NOT taken (its colours, shapes, layout, copy, icons)
3. TRANSLATE  express the extracted idea using ONLY LUMI grammar, tokens and rules
              (PRODUCT_GRAMMAR.md, LUMI_DESIGN_CONSTITUTION.md)
4. TEST       run ANTI_CONVERGENCE.md AC-1…AC-6 on the result, including
              "can a reviewer identify the source by looking?"  YES → FAIL
```

If step 1 cannot be written without describing the source's appearance, the
reference is being copied, and it is not used.

## RP-4 · Reference record

Recorded in the review record of the artefact that used it:

```text
REFERENCE      <what it is — described, not embedded>
TYPE           principle | composition | interaction idea | material | hierarchy
EXTRACTED      <the idea, in words>
NOT TAKEN      <explicit list>
LUMI FORM      <which grammar object / rule / token expresses it>
AC RESULT      <AC-1…AC-6 outcome>
```

## RP-5 · Reference images in the repository and in Figma

- Competitor or AI-product screenshots are **not** stored as templates in design
  files or the repository. A moodboard, if one exists, is labelled *reference
  only, not a source*, and is never linked from a component.
- AI-generated imagery or layouts count as references under this policy. They
  are subject to RP-2 and RP-3 like any other source, because they tend to
  reproduce the convergent average.

## RP-6 · Authority split

**Figma is the visual source of truth; the repository is the behavioural source
of truth.** Behaviour, state, routing, permissions, API, measurement, currency
and data integrity are decided in the repository (Constitution Article 35). A
reference can never settle one of those questions, however authoritative its
source.

## RP-7 · Internal references

- The legacy LUMI frontend is **evidence**, not a reference for visual form
  (PR-13; brief §37). Its **product logic** is extracted
  (Constitution Article 37); its look is not inherited.
- `DESIGN_SYSTEM_AUDIT.md` and `LUMI_PRODUCT_TRUTH_RULINGS.md` are evidence and
  are preserved unchanged.
- The LUMI Design System Master Build Spec
  (`LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md`) is an **authority**, not a
  reference. It is authority level 3: it flows into this policy, and where the two
  conflict, this policy's interpretation governs and the conflict is registered
  (Constitution Article 35). Its §2 "Reference Governance" and §3 "Approved
  Reference Set" (Mobbin, SaaSUI / SaaSFrame, Triple Whale, Madgicx, Northbeam,
  Polar, for patterns only and never visual identity) are the approved research
  sources. They are used under RP-1…RP-4.
