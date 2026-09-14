# GOVERNANCE SYNC — Phase 1.5

```text
Date   2026-09-14
HEAD   a3ec11618c6b2a14ec68382ea4f10d44afb9601c (unchanged; nothing committed)
```

## Status

`COMPLETE`

The authority sync is complete. One item needs Omar's confirmation and one
brand blocker remains; both are listed below.

## Authority Hierarchy

```text
1. PRODUCT TRUTH          backend / API and DB-backed behaviour · LUMI_PRODUCT_TRUTH_RULINGS.md,
                          closed as PR-1…PR-13 (design-governance/README.md §3) · locked Product
                          Constitution and B7 / B8 rulings
2. DESIGN AUTHORITY       design-governance/ (Constitution, Grammar, Boundaries, Reference, Component,
                          State, Motion, Anti-Convergence, Review Gate, README) · DESIGN_TOKEN_ARCHITECTURE.md
3. MASTER BUILD SPEC      design-governance/LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md
4. APPROVED BRAND ASSETS  design-governance/brand/
5. HISTORICAL MATERIAL    legacy docs, legacy token files, TAXONOMY-FREEZE.md, legacy implementation
```

- **Flow:** `MASTER BUILD SPEC → DESIGN CONSTITUTION / GRAMMAR / BOUNDARIES / STATE / MOTION / COMPONENT RULES → IMPLEMENTATION`
- **Conflicts:** `PRODUCT TRUTH > DESIGN CONSTITUTION > MASTER BUILD SPEC interpretation > LEGACY MATERIAL`

Recorded in `CLAUDE.md` (Authority), `design-governance/README.md` §2 and
Constitution Article 35.

## Files Changed

**Modified (tracked)**

| Path | Change |
|---|---|
| `CLAUDE.md` | design-authority header replaced with the Authority section; one Styling line clarified; nothing else touched |
| `MARCOM-ARCHITECTURE.md` | section notices on §3C and §13 only |
| `client/design-system/{TAXONOMY-FREEZE,ui-registry,component-states,CVA-API-CONTRACT,CVA-USAGE-EXAMPLES}.md` | one-line HISTORICAL notice each |
| `client/src/components/{ASSEMBLY-ARCHITECTURE,primitives/PRIMITIVE-FREEZE}.md` | one-line HISTORICAL notice each |
| `client/{DESIGN-SYSTEM-REFACTOR,MIGRATION-MAP,TYPOGRAPHY-QUICK-REF}.md` | one-line HISTORICAL notice each |
| `design-system-figma/marcom-ai/README.md` | one-line HISTORICAL notice |

**Added**

- `design-governance/LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md`
- `design-governance/brand/README.md`
- `GOVERNANCE_SYNC.md`

**Updated (untracked Phase 0.5 / Phase 1 documents)**

| Path | Change |
|---|---|
| `design-governance/README.md` | hierarchy, spec provenance §2.1, brand registration, historical list |
| `design-governance/LUMI_DESIGN_CONSTITUTION.md` | Article 35; FC-9 / FC-10 status; new Appendix A.1 |
| `design-governance/REFERENCE_POLICY.md` | RP-7 |
| `design-governance/REVIEW_GATE.md` | Q-13 note; RG-5.6 addendum |
| `design-governance/VISUAL_BOUNDARIES.md` | §5 logo note |
| `DESIGN_TOKEN_ARCHITECTURE.md` | §11 entry conditions |
| `LUMI_PRODUCT_TRUTH_RULINGS.md` | "rulings closed as PR-1…PR-13" notice |

## Master Build Spec

**Added.** It is at `design-governance/LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md`,
copied **byte-for-byte**. The SHA-256 of source and copy match
(`915B3C23…47180C`: 54,052 bytes, 2,506 lines). There are no edits or
annotations inside the file.

Source: `LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC_FINAL_V2_UPDATED(1).md` (local
Downloads, 2026-09-13).

🔒 **Version approved by Omar, 2026-09-14.** Two earlier versions exist, dated
09-09 and 09-10, and are not authority. Only this one contains the September 2026 Brand Identity Lock, the
palette, "01 / Current Base" and the Figma-to-code rule. Those are every passage
the Phase 1 brief quoted from the spec. Its differences from V2 are rewrites
within §5 and §10.

The spec was read in full. Six divergences from the governance documents are
**registered, not reconciled**, as Constitution Appendix A.1:

| ID | Divergence |
|---|---|
| FC-12 | landing page as visual baseline vs reset |
| FC-13 | "preserve existing verdict colours" vs PR-6 |
| FC-14 | brand principles in focus/selected states vs gold never focus |
| FC-15 | `disabled` / `partial` states |
| FC-16 | Campaigns filtering/sorting vs locked B7-08 |
| FC-17 | phase numbering; audit location |

## Logo

**Not found.** `design-governance/brand/README.md` records:

```text
APPROVED LOGO ASSET — SOURCE REQUIRED BEFORE BRAND IMPLEMENTATION
```

- **Searched:** tracked repository files, `G:\MARCOM`, and local Downloads. The
  2026-08 design zip and brand-identity HTML predate the September lock and contain
  no "Current Base" asset. `design-system-figma/` holds only a mascot and
  screenshots.
- **Where the source is:** the spec (§45) places it in the Figma brand file,
  which is not available here.
- **Nothing was created.** This blocks brand implementation only, not governance
  and not tokens.

## Legacy Conflicts

**Neutralized by edit**

- `CLAUDE.md` named `tokens/*.json`, `ui-registry`, `component-states` and
  `TAXONOMY-FREEZE` as design authority. That table is removed and replaced.
- These documents claimed Active, FROZEN, Law, Production-Ready or "source of
  truth" status, or instructed coding agents to implement an old design:
  `TAXONOMY-FREEZE`, `ui-registry`, `component-states`, `CVA-API-CONTRACT`,
  `CVA-USAGE-EXAMPLES`, `PRIMITIVE-FREEZE`, `ASSEMBLY-ARCHITECTURE`,
  `DESIGN-SYSTEM-REFACTOR`, `MIGRATION-MAP`, `TYPOGRAPHY-QUICK-REF`, and
  `design-system-figma/marcom-ai/README.md` ("CODING AGENTS: READ THIS FIRST").
- `MARCOM-ARCHITECTURE.md` §3C ("CANONICAL … design-system/tokens/") and §13
  ("Source of truth: ui-registry.md").
- `LUMI_PRODUCT_TRUTH_RULINGS.md` could have been read as open options. It is now
  marked closed, with PR-n governing.

**Neutralized by governance statement only.** These were not edited because
they are implementation files (Task G):

- the `client/design-system/tokens/{colors,typography}.json` `_comment` text
  "Design Token Source of Truth";
- the `lint/no-generic-tailwind.js:6` comment "from the Design Bible".

**Scan classification**

| Class | Hits |
|---|---|
| A — current and correct | `.github/CI-SETUP.md:61` (describes the current lint mechanism); every non-design "single source of truth" (backend, runtime contracts, currency, `.nvmrc`), which is out of scope |
| B — historical but acceptable | dated audits (`PRIMITIVE-INVENTORY`, `ADOPTION-COVERAGE`, `SEMANTIC-DUPLICATE-ANALYSIS`, `ASSEMBLY-CANDIDATES`); `FEED_PAGE_REDESIGN_V4.2.md`; codemods docs; `design-system-figma/project/**` copies (covered by the bundle notice); `MARCOM-ARCHITECTURE.md` §2 tree and §11 lines; code comments in `tailwind.config.js`, `index.css`, `signals.js`, `MemoryView.jsx`, `assemblies/index.js`, which describe the legacy implementation |
| C / D — fixed | everything listed under "Neutralized" above; none remain unaddressed |

## Implementation Safety

- ✅ frontend implementation untouched
- ✅ backend untouched
- ✅ product behaviour untouched
- ✅ design tokens not implemented
- ✅ components not implemented

**Evidence**

- `git diff --name-only` contains only `.md` files, and every untracked file is
  `.md`.
- No path under `src/`, `prisma/`, `packages/`, `client/src/**/*.{js,jsx,ts,tsx,css}`,
  `client/design-system/{tokens,lint}/`, `client/scripts/`, `client/tests/`,
  `render.yaml` or `package*.json` is touched.
- There are 0 deletions.
- The raw and `--ignore-cr-at-eol` diff stats are equal (13 files, +101 / −17),
  so there is no line-ending churn.
- Historical-document diffs contain exactly 11 added notice lines and 0 removed
  lines (control count: 11 of 11).

## Rulings Recorded (Omar, 2026-09-14)

| Item | Ruling | Recorded in |
|---|---|---|
| Spec version | 2026-09-13 Brand Identity Lock is authoritative | README §2.1 · Constitution FC-10 · RG-5.6 |
| FC-5 | NOW vs AT DECISION in the same Decision experience; disagreement in language; never a visual diff | Constitution FC-5 (Article 9 unchanged) · RG-5.6 |
| FC-13 | six locked PR-6 verdict colours; no reversion to implementation colours | Constitution FC-13 · DESIGN_TOKEN_ARCHITECTURE §11.4 · RG-5.6 |
| FC-12 | reset wins; the existing landing page is legacy implementation, not visual authority | Constitution FC-12 · RG-5.6 |
| FC-16 | locked IA wins; no browsable Campaigns list, filter or sort because the spec mentions it | Constitution FC-16 · RG-5.6 |
| Logo | blocks brand implementation, not token architecture | brand/README · Constitution FC-10 · DESIGN_TOKEN_ARCHITECTURE §11.5 · RG-5.6 |

**Ruled NON-BLOCKING (Omar, second ruling, 2026-09-14):**

| Item | Ruling |
|---|---|
| FC-14 | Gold principles may inform focus and selection. Brand gold must not become a universal interaction-state colour; brand and semantic interaction tokens stay distinct. |
| FC-15 | `disabled` and `partial` are valid semantic states. Phase 2 may define their token roles, but must not invent component-specific state behaviour before the relevant phase (STATE_RULES.md §18). |
| FC-17 | Phase numbering and the audit's location are documentation concerns; architecture is not reopened over them. |

**The Governance Sync is approved.**

## Phase 2 Gate

```text
READY FOR PHASE 2 — DESIGN TOKENS
```

The authority sync no longer blocks Phase 2. Two conditions remain:

- **No commit** until Omar inspects the exact governance diff.
- **Phase 2 starts** only when Omar declares the diff clean.

See `design-governance/REVIEW_GATE.md` RG-5.6.
