# design-governance/brand/ — Approved Brand Assets

```text
Authority level  4 — APPROVED BRAND ASSETS (design-governance/README.md §2)
Registered       2026-09-14 · Phase 1.5 Governance Synchronization
```

This folder holds **approved brand source files only**. It contains no
explorations, no drafts, no generated alternatives and no recreations.

## Current official logo — LUMI Brand v1

**Approved by the Product Owner, 2026-10-08.** These exact Adobe Illustrator
exports are the current official identity until an explicitly approved revision
replaces them. The P8-06A re-entry ruling supersedes the original missing-source
and Figma-file gate for these two exports only. The original `.ai` project was
not supplied; a Figma file is not required for these approved exports.

| Variant | Original export | Repository resource | SHA-256 | Source viewBox |
|---|---|---|---|---|
| Primary stacked lockup | `Asset 1(2).svg` | `lumi-primary-lockup-v1.svg` | `8fc5a26db6903306e09a1b1314ed9de6aa4f5a2803b9bedee7dec2a7c7570cac` | `0 0 378.67 344.42` |
| Symbol only | `Asset 2(1).svg` | `lumi-symbol-v1.svg` | `7034cf5e24f6ef233728838631e75e9f8a98d2df90695fe3be71036a66a0c852` | `0 0 378.67 234.85` |

Original bytes are unchanged, including paths, letterforms, fills and internal
gold gradient. The supplied `MANIFEST.json` is retained unchanged. Source package:
`LUMI-P8-06A-approved-SVG-v1.zip`, SHA-256
`3ada0cdfe2b921bb225465a55a41bcdffe8076c0ac205da1b10b8c5bc7800ecf`.
Source/exporter: Product Owner, Adobe Illustrator (owner statement). Export date:
not provided; the approval date is not an inferred export date. SVG uses RGB
colour values; no production colour profile was provided.

Byte-identical static serving copies live in `client/public/brand/`. The installed
Vite build otherwise inlines small imported SVGs. Both source/serving copies are
hash-checked; only the two public copies ship. No artwork, build configuration or
dependency is modified to force external image loading.

Public landing integration uses the symbol in the existing header and the
stacked lockup in the footer, on the existing light ground. Current display sizes
are 48 × 29.77 CSS px (symbol) and 112 × 101.87 CSS px (stacked). These are local
integration sizes, not newly approved global minimum-size rules. The wordmark at
44px overall height would be approximately 8.17px high, so the stacked lockup is
not compressed into the header. Actual responsive/legibility evidence and the
rendered placement require Product Owner review before closure.

Minimum sizes and clear space: no source guideline supplied. Existing layout
spacing is preserved; no universal clear-space unit is invented. Future artwork,
different placement constraints or visual compromises require versioned explicit
approval. The internal gradient is an exception for this exact artwork only,
never permission for decorative gradients elsewhere.

Optional reversed/dark, monochrome, horizontal, standalone wordmark, minimum-size,
favicon, app icon, social avatar and OG assets: **SOURCE PENDING**. No new variant
is derived or approved by integration. Auth and authenticated-shell identity are
outside P8-06A.

## Historical record — `01 / Current Base` (2026-09-14)

The following source search and requirements record describes the original
handoff boundary. Its missing-source status is superseded for the two v1 exports
registered above; it is retained as history, not a claim that no current source
exists.

```text
APPROVED LOGO ASSET — SOURCE REQUIRED BEFORE BRAND IMPLEMENTATION
```

| Field | Status |
|---|---|
| Approved direction | **01 / Current Base** (Master Build Spec, "Approved Logo Direction", §5 "Geometry", §45 "Logo Refinement") |
| Where the source lives | the **Figma brand file** (Master Build Spec §45: "The Figma brand file is the visual reference for the latest identity direction") |
| Source file in this repository | **none** |
| Searched 2026-09-14, not found | tracked repository files (no logo asset; `design-system-figma/` holds a May 2026 handoff bundle with a mascot and screenshots only) · `G:\MARCOM` · the local Downloads folder (`Lumi Design System.zip`, 2026-08-09, and `lumi-brand-identity.html`, 2026-08-10, both **predate** the September 2026 brand lock and contain no "Current Base" asset) |
| Created here | **nothing** — no file was drawn, traced, converted or approximated |

## What this blocks, and what it does not

- **Blocks** brand implementation: the logo variants (primary lockup, wordmark,
  symbol, monochrome, reversed, favicon, app icon, social avatar), minimum sizes,
  clear space, the gold `I` accent geometry, and any logo usage in the landing
  page or app shell.
- **Does not block** governance synchronization or Phase 2 token work, because
  tokens do not depend on the logo drawing. 🔒 *Confirmed by Omar, 2026-09-14.*

## When the source is supplied

1. Add the **original exported files exactly as approved** (for example SVG and
   PDF from the Figma brand file). Do not redraw, optimise, recolour or rename
   their geometry.
2. Record, beside each file: its source (Figma file and frame), export date,
   exporter, and a SHA-256 hash.
3. Measurements such as minimum size and clear space are taken **from the
   source**, never invented (VISUAL_BOUNDARIES.md §5).
4. Refinement, if any, follows Master Build Spec §45: refinement only, restarted
   only under the conditions listed there, and approved as a new version.
