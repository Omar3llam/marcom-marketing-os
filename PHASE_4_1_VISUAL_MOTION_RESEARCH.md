# PHASE 4.1 — REFERENCE RESEARCH + LEGACY LANDING CLEANUP

```text
Status     CLEANUP: LEGACY LANDING REMOVED · RESEARCH: COMPLETE — nothing implemented beyond the deletion
Branch     feat/lumi-landing (tree == origin/master cd9b332, PR #478 squash; verified by content)
Date       2026-09-15
Author     Claude Code. Author self-assessment is never approval (Constitution Article 36).
Rule       research only: no motion, no hero change, no token / primitive / app-shell / backend change
```

📏 marks a value measured in this phase. Everything else is reading, judgement or proposal.

---

## 1. Sources reviewed

### 1.1 Authority (read before any work)

| # | Source | Used for |
|---|---|---|
| 1 | `design-governance/README.md` | authority order; phase status |
| 2 | `design-governance/LUMI_DESIGN_CONSTITUTION.md` | Articles 10–11 (territory, illumination hierarchy), 24 (motion), 25–26 (responsive, performance), Appendix A / A.1 (FC-1…FC-18) |
| 3 | `design-governance/LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md` | Brand Identity Lock; §2–5 reference governance, anti-convergence, positive language; §12–14 landing, storytelling, motion; §32, §43–44 identity tests; §45 Figma-to-code |
| 4 | `design-governance/PRODUCT_GRAMMAR.md` | grammar objects, Decision Spine vocabulary |
| 5 | `design-governance/VISUAL_BOUNDARIES.md` | VB-A1…A8, VB-F1…F16, environment rules |
| 6 | `design-governance/REFERENCE_POLICY.md` | RP-0…RP-7: extract → discard → translate → test; RP-4 record |
| 7 | `design-governance/MOTION_RULES.md` | MO-1…MO-8 |
| 8 | `design-governance/ANTI_CONVERGENCE.md` | AC-1…AC-6, F-1…F-16 |
| 9 | `PHASE_4_LANDING_VISUAL_LANGUAGE_AUDIT.md` | current landing, §9–10 ThreeUI, §15/§23–25 performance |
| 10 | "Master Build Spec FINAL V2 UPDATED" | 📏 no separate attachment exists in this session. The newest copy on this machine, `Downloads/LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC_FINAL_V2_UPDATED(1).md` (2026-09-13, 54,052 B, SHA-256 `915B3C23…`), is **byte-identical** to the repository copy in row 3. Older copies (09-09 `00069B3B…`, 09-10 `7D660F8C…`) lack the Brand Identity Lock and were not used. |

### 1.2 External references (inspected live, §6)

The 12 sites were opened in headless Chromium (Playwright) at 1440 × 900 and at 375 × 812 (touch, mobile UA).

Each was captured at its first screen, after a 900 px wheel, and at 2.6 viewports. At rest, the probe measured:

- running animations (`document.getAnimations()`);
- transitions and sticky / fixed elements;
- canvas and video;
- `backdrop-filter` and gradients;
- scroll libraries (GSAP / Lenis / Framer Motion markers);
- scroll-driven CSS (`animation-timeline`) and `prefers-reduced-motion` rules;
- whether a wheel is hijacked;
- request count and transferred bytes.

Targeted mechanism probes followed (§6.2). Cookie banners were never accepted. Scripts: `scratchpad/p41-refprobe.mjs`, `p41-mechanics.mjs`.

**Caveats (📏 honest limits):**

- Single run from this machine's network; load time is network-dependent (Apple served an Egypt region banner).
- Transferred bytes are encoded bodies plus headers for requests finished within about 9 s. This is **not** a lab benchmark.
- Herzog & de Meuron refused the desktop connection (`ERR_CONNECTION_CLOSED`). Only its mobile first screen loaded, so it is **excluded** from conclusions and replaced by Our World in Data.

### 1.3 ThreeUI

`github.com/MengTo/threeui`, read through the GitHub API:

- metadata: MIT, 5,794 stars, pushed 2026-09-03;
- README;
- `src/data/shaders.tsx` (458,593 B catalog), from which every Community component, category, runtime and interaction description was extracted (§12).

Nothing was installed or imported.

---

## 2. Master Build Spec principles used

**Evaluation criteria extracted from the spec** (quoted concepts, not visuals):

| Spec source | Principle | How it is used in this research |
|---|---|---|
| Brand Identity Lock · Brand Core | LIGHT REVEALS WHAT MATTERS · CLARITY TURNS COMPLEXITY INTO DECISIONS · VERDICTS. NOT DASHBOARDS · DATA → … → MEMORY | every proposal must make one stage of the model easier to understand |
| Meaning of the Name | "signal emerging from noise · hidden information becoming visible · focus · a clearer path to action"; never lamp / bulb / sun / sparkle | the "reveal" in this document is always *which information matters*, never a light effect |
| Approved Visual Territory | directional light · reveal · controlled contrast · architectural geometry · meaningful negative space · warm gold as a functional signal · calm, precise composition | the four-axis rating in §6 (S / L / NS / SIG) and the directional-light reading in §9 |
| §5 Architectural Light | "thresholds and openings · strong light/dark relationships · purposeful focal points"; "light is a metaphor for clarity and attention, not a decorative special effect" | the Charcoal band read as a threshold (V-4) |
| §5 Gold · What LUMI Must Not Become | gold marks what matters; not magical, futuristic, theatrical, noisy, AI-showcase | rejection column of §15 |
| §12 Landing | verdicts are decision objects; "Why LUMI said KILL" as VERDICT → WHY → EVIDENCE → ACTION; Memory DECISION → OUTCOME → LEARNING → FUTURE DECISION; trust vocabulary | hero and spine directions (§10–11) |
| §13 Visual Storytelling | product in action · decision journey · evidence reveal · verdict reveal · memory timeline · trust / data-state; "the marketing site should visually prove the product"; "do not use fake dashboards" | every direction uses the existing grammar components, never screenshots |
| §14 Motion | motion communicates state, causality, hierarchy, disclosure, transition, confirmation; Decision Reveal CAMPAIGN → SIGNAL → VERDICT → EVIDENCE → ACTION; "do not make every section scroll-animated"; no shimmer, glow, particles, blobs, fake thinking, perpetual motion; `prefers-reduced-motion` | §8 motion principles |
| §32 / §43 / §44 | the AC tests; "remove the logo — does it feel like a generic AI/SaaS product?"; "optimise for clarity that leads to a decision, not 'looks modern / AI / premium'" | pass / fail column of every proposal |
| Design Priority | PRODUCT TRUTH > DECISION CLARITY > EVIDENCE > ACCESSIBILITY > BRAND EXPRESSION > DECORATION | tie-breaker for every open question in §17 |

### 2.1 Conflicts between the spec and later locked rulings

Registered, **not reconciled**. Governance level 2 outranks the spec (level 3). These are new registrations or existing ones that this research depends on.

| ID | Spec says | Later locked rule says | Governing |
|---|---|---|---|
| **MC-1** (new) | §14 Landing Motion lists "scroll-driven signal → action" and "product screenshot transitions" as potential patterns | MOTION_RULES.md MO-8: "Scroll-jacking and parallax — scroll-linked motion on product or marketing pages" is **forbidden** | **MO-8.** No scroll-driven direction is recommended. §17 Q-1 asks whether a *discrete, scroll-triggered emphasis change that hides nothing* falls under "scroll-linked motion". That is a ruling, not an inference. |
| **MC-2** (new) | §12 Hero: prefer "DATA → VERDICT → EVIDENCE → ACTION"; §14 Decision Reveal: CAMPAIGN → SIGNAL → VERDICT → EVIDENCE → ACTION | Constitution Article 5 locks the *production* order DATA → EVIDENCE → VERDICT; MO-2.4 locks the *reveal stagger* claim first ("the call is revealed first, then the reason, then the evidence") | Both are right about different things. The **axis** shows production order (Article 5); a **reveal** arrives in reading order (MO-2.4). The current hero draws the axis. §17 Q-2 asks which one the hero leads with. |
| **MC-3** (new) | §14 Landing Motion: "hero product reveal · verdict reveal · evidence reveal" | MO-2.2 "Nothing waits for an animation. Content is readable and operable at the first frame"; MO-4.1 "structure first, light second" | **MO-2.2.** A reveal may change *emphasis* of content that is already present; it may never hide content until an animation runs. Every direction below obeys this (principle M-0). |
| **MC-4** (new) | §14 "Decision Reveal … can appear on the landing page and inside the app" (a sequence) | MO-6.2 "The spine does not move to show progress. A Decision's stages are not animated along the axis as a 'pipeline running'" | **MO-6.2.** No auto-running spine. The spine may change state only when the reader acts (§11). |
| **FC-12** 🔒 | Rule 4 / §12: the existing landing is the baseline; keep "Know what to do next. After every sync." | reset wins: legacy landing is not visual authority | **Ruled.** The Phase 4.1 deletion is consistent with it (§4). |
| **FC-14** 🔒 | brand-mark principles inform focus and selected states | gold is never a focus ring, hover or selected state | **Ruled.** The "selected" state of every interactive proposal below uses interaction tokens and luminance, never gold. |
| **FC-13** 🔒 | spec lists three verdict colours | PR-6 locks all six values | **Ruled.** Proposals use VerdictMark only. |

---

## 3. Existing LUMI constraints (the lens every reference passed through)

| Constraint | Source | Consequence for motion / visual research |
|---|---|---|
| Motion has exactly four purposes: REVEAL · HIERARCHY · TRANSITION · FEEDBACK | MO-1 | an idea that cannot name one is rejected |
| No motion at rest; nothing waits for an animation | MO-2.2–2.3, VB-A8 | no ambient hero, no autoplay, no loops |
| Reveal = opacity / luminance, ≤ 4 px settle; no fly-in, slide, scale-from-nothing | MO-4.2, token `--lumi-motion-distance-settle: 4px` | directional *movement* is out; directional *light order* is in |
| No count-up, no bars growing, no lines drawing | MO-4.3, PR-7 | memory "accumulation" cannot tick numbers up |
| Divergence (NOW vs AT DECISION) is never animated | MO-4.5, FC-5, B7-06 | the two tenses change emphasis only on reader action, never transition into each other |
| Spine does not run as a pipeline | MO-6.2 | spine progression is reader-driven |
| No scroll-jacking / parallax / scroll-linked motion | MO-8 | see MC-1 |
| Forbidden easings: bounce, elastic, spring overshoot, anticipation | MO-3 | playful motion references are negative references |
| Every animation declares reduced-motion behaviour; reduced motion never removes information | MO-7 | each principle in §8 has a declared fallback |
| Locked tokens exist | 📏 `tokens.css`: `duration-feedback 100ms · reveal 200ms · transition 240ms · maximum 400ms`; `easing-reveal cubic-bezier(0,0,0.2,1)`; `easing-transition cubic-bezier(0.4,0,0.2,1)`; reduced motion → 0 ms / 0 px | no new durations or curves are needed for anything proposed |
| Composited properties only | MO-6.5, Article 26 §4 | opacity and colour steps; no layout animation |
| Light follows the claim; unknown is structure without light | Article 11 | "selection" = raising one thing's light step, not adding colour |
| One gold point per region; gold never text on Off White; verdict marks only in Charcoal | VB-A4, VB §4, FC-4 | the signal cannot be used as a highlight colour |
| No fabricated numbers; illustrative data labelled | PR-7, Article 28 | every demo stays in "Illustrative example" regions and must be true to `verdictEngine.js` |
| No new visual dependency without justification; public bundle regression is already accepted only temporarily | Article 26 §3; Phase 4 ruling | 📏 Three.js alone is 148,741–166,179 B gzip (§13) |

---

## 4. Legacy landing deletion findings (pre-delete audit)

📏 Every search was a `git grep` over the whole tracked repository, rerun after deletion (§4.3).

### 4.1 Audit answers A–K

| | Question | Finding |
|---|---|---|
| **A** | Every legacy landing file | 📏 13 tracked files in `client/src/pages/LandingPage/` (1,258 lines): `index.jsx`, `HeroSection.jsx`, `FeaturesSection.jsx`, `PricingSection.jsx`, `WhyKillSection.jsx`, `SignalToActionSection.jsx`, `SocialProofSection.jsx`, `ScreenshotGallery.jsx`, `CTASection.jsx`, `useReveal.js`, and three tests (`LandingHero.test.jsx`, `ScreenshotGallery.test.jsx`, `SocialProofSection.test.jsx`) |
| **B** | Imports / references | 📏 no code outside the directory imports any file in it. Its own imports are internal (`./…`), `react`, `react-router-dom`, `lucide-react`, `@/lib/utils.js`, and test libraries. The name `HeroSection` also exists in `client/src/lumi/landing/sections/HeroSection.jsx`: a different module, imported only by relative path from `lumi/landing/LandingPage.jsx`, so there is no collision. |
| **C** | Route references | `/` → `App.jsx:153 <LandingPage />` → `client/src/pages/LandingPage.jsx`, which (📏 on `origin/master` and here) re-exports `../lumi/landing/LandingPage.jsx`. No route reaches the legacy directory. |
| **D** | Tailwind / content scan | `tailwind.config.js` content `['./index.html', './src/**/*.{js,jsx,ts,tsx}', '!./src/lumi/**']` scanned the directory only through the generic glob. Its only other mention is a comment (history of the Phase 4 `check:tokens` failure). |
| **E** | Test references | 📏 only the directory's own three tests import its files. `lumi/__tests__/landing.test.jsx` carries legacy *strings* as forbidden-claim regexes, which do not import anything. Two census tests (`app/__tests__/connectorsDestination.test.js`, `retiredFeedEndpoint.test.js`) read every `/src/**` file through `import.meta.glob`. They assert only "> 200 files" and endpoint censuses, and name no legacy file (📏 read). A string match in `OnboardingPage/steps/ReadyStep.test.jsx` ("Alexandria Villas") is an unrelated onboarding fixture. |
| **F** | Build references | `vite.config.js` builds `index.html` only; no manual chunk, alias or lint config names the directory. 📏 the Phase 4 module report already showed the 9 legacy source modules absent from every chunk after `/` was re-pointed. |
| **G** | Documentation references | Historical or evidence documents only: `DESIGN_SYSTEM_AUDIT.md` (§602, §669, §736: "unreachable"), `LUMI_PRODUCT_TRUTH_RULINGS.md:806`, `PHASE_3_PRIMITIVE_AUDIT.md:401`, `PHASE_4_LANDING_VISUAL_LANGUAGE_AUDIT.md`, and a Figma export copy under `design-system-figma/marcom-ai/**` (its own `useReveal`, not an import). Kept unchanged (PR-13: supersede ≠ delete evidence). |
| **H** | Assets used exclusively by the legacy landing | `ScreenshotGallery.jsx` points at `/screenshots/{overview,intelligence,testing}.png`. 📏 **none exist**: there is no `client/public` directory in the repository. No tracked asset is orphaned. `client/lumi-landing-review/legacy-landing-1440-full-baseline.png` is Phase 4 review evidence, not a legacy asset, and is kept. |
| **I** | Shared CSS / classes | Custom `index.css` classes the legacy files used: `.decision-title` (📏 also in 19 other files) and `.section-label` (41 other files): **SHARED**, untouched. `.reveal` / `.reveal-delay-*` (`index.css` `@layer utilities`) are used by no file at all (the legacy `useReveal` sets inline styles). They are left in the legacy stylesheet; Tailwind drops unused `@layer utilities` rules at build. The Tailwind utilities only the legacy page used (e.g. `sm:text-5xl`, `bg-signal-kill/15`, `ring-surface-light`) existed solely because Tailwind scanned the directory. |
| **J** | Still reachable? | **No.** 📏 no static import, no dynamic `import()` string, no `import.meta.glob` that renders it (the two globs are raw-text census tests), no route. |
| **K** | Does rollback need these files? | **No.** Rollback is a git operation: the directory exists unchanged at `cd9b332` (current `origin/master`) and at `b35d22e`. `git revert` of the deletion, or `git checkout cd9b332 -- client/src/pages/LandingPage`, restores it byte-for-byte. |

**Classification:** all 13 files are **LEGACY / UNUSED**. None is ACTIVE, SHARED or UNKNOWN.

### 4.2 Deletion rule check (all five must hold)

| # | Rule | Holds? |
|---|---|---|
| 1 | legacy landing implementation | yes (A) |
| 2 | not referenced by `/` | yes (C) |
| 3 | not shared by another active surface | yes (B, I) |
| 4 | not required by tests / build tooling | yes (E, F); its three tests only test its own components |
| 5 | not the source of truth for active product behaviour | yes (J); product truth lives in `src/` services and `lumi/` grammar |

### 4.3 After deletion (📏 rerun)

| Search | Result |
|---|---|
| imports / paths to `pages/LandingPage/` in code (`client src packages`, non-markdown) | **0 active.** One hit: the history comment in `tailwind.config.js:24` |
| legacy component or hook names (`FeaturesSection`, `PricingSection`, `ScreenshotGallery`, `SignalToActionSection`, `SocialProofSection`, `WhyKillSection`, `CTASection`, `useReveal`, `LandingHero`) in `client/src`, `client/index.html` | **0** |
| strings unique to the old landing ("Know what to do next", "After every sync", "Why Lumi said KILL", `/screenshots/`, "Most Popular") | **0 active.** Two hits are the forbidden-claim regexes in `landing.test.jsx` (guards) |
| Tailwind content | unchanged: `!./src/lumi/**` is still the only exclusion. The deleted files simply left the generic glob, so **no active source file is excluded** and the token checker was **not** modified. |
| `npm run check:tokens` | 📏 exit 0: "Every colour class resolves (1048 selectors in the compiled CSS)", down from 1,140 because the legacy-only utilities are gone |

**Comment corrected:** `client/src/pages/LandingPage.jsx` said "the legacy page … is kept, unreferenced, until approved". Leaving that would be a false comment. It now records the deletion. The re-export line is unchanged.

---

## 5. Deleted files and evidence

`ACTIVE REFERENCES` counts code outside the deleted directory (§4.1 B, C, E, F, J). `SHARED REFERENCES` counts other files that use this file or an asset, class or hook only it provides (§4.1 H, I).

```text
LEGACY FILE:        client/src/pages/LandingPage/index.jsx
WHY LEGACY:         the pre-Phase-4 page; `/` was re-pointed to lumi/landing in PR #478 (origin/master cd9b332)
ACTIVE REFERENCES:  none (the route file re-exports ../lumi/landing/LandingPage.jsx)
SHARED REFERENCES:  none (uses shared .section-label / .decision-title; nothing uses it)
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/HeroSection.jsx
WHY LEGACY:         legacy hero ("Know what to do next") imported only by the legacy index.jsx and LandingHero.test.jsx
ACTIVE REFERENCES:  none (the live HeroSection is client/src/lumi/landing/sections/HeroSection.jsx, a different module)
SHARED REFERENCES:  none
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/FeaturesSection.jsx
WHY LEGACY:         imported only by the legacy index.jsx
ACTIVE REFERENCES:  none
SHARED REFERENCES:  none (.decision-title is shared CSS, kept in index.css)
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/PricingSection.jsx
WHY LEGACY:         imported only by the legacy index.jsx; unsourced prices (Phase 4 audit §3)
ACTIVE REFERENCES:  none
SHARED REFERENCES:  none
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/WhyKillSection.jsx
WHY LEGACY:         imported only by the legacy index.jsx; fabricated figures (PR-7 evidence, rulings doc :806)
ACTIVE REFERENCES:  none
SHARED REFERENCES:  none
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/SignalToActionSection.jsx
WHY LEGACY:         imported only by the legacy index.jsx
ACTIVE REFERENCES:  none
SHARED REFERENCES:  none
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/SocialProofSection.jsx
WHY LEGACY:         imported only by the legacy index.jsx and its own test
ACTIVE REFERENCES:  none
SHARED REFERENCES:  none
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/ScreenshotGallery.jsx
WHY LEGACY:         imported only by its own test; DESIGN_SYSTEM_AUDIT.md §736 already recorded it "unreachable"
ACTIVE REFERENCES:  none
SHARED REFERENCES:  none (its /screenshots/*.png assets do not exist in the repository)
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/CTASection.jsx
WHY LEGACY:         imported only by the legacy index.jsx
ACTIVE REFERENCES:  none
SHARED REFERENCES:  none
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/useReveal.js
WHY LEGACY:         IntersectionObserver reveal hook imported only by five legacy sections
ACTIVE REFERENCES:  none
SHARED REFERENCES:  none (no other file imports it; the .reveal CSS classes are used by nothing)
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/LandingHero.test.jsx
WHY LEGACY:         tests the legacy HeroSection only; protects no active behaviour
ACTIVE REFERENCES:  none
SHARED REFERENCES:  none
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/ScreenshotGallery.test.jsx
WHY LEGACY:         tests the unreachable ScreenshotGallery only
ACTIVE REFERENCES:  none
SHARED REFERENCES:  none
SAFE TO DELETE:     YES

LEGACY FILE:        client/src/pages/LandingPage/SocialProofSection.test.jsx
WHY LEGACY:         tests the legacy SocialProofSection only
ACTIVE REFERENCES:  none
SHARED REFERENCES:  none
SAFE TO DELETE:     YES
```

### 5.1 Performance (📏 same `measure-dist.mjs`, production `npm run build`)

| | Raw | Gzip | Brotli |
|---|---:|---:|---:|
| **before** (tree == `cd9b332`; hashes `index-mtedZriH.js`, `index-BSiOsFUj.css`) | 1,086,645 | **299,989** | 252,601 |
| **after** (hashes `index-CNpArzHv.js`, `index-CoAe4tri.css`) | 1,081,634 | **299,071** | 252,345 |
| **delta** | −5,011 | **−918** | −256 |
| vs original baseline `b35d22e` (287,336 gzip / 242,645 brotli) | +37,136 | **+11,735 (+4.08 %)** | +9,700 (+4.00 %) |

- **Where it came from.** All of the saving is entry CSS, 34,193 → 33,280 B gzip: the utilities only the legacy page used. The entry JS is the same size (604,112 raw); its hash changed only because it references the new CSS file name.
- **CI bundle budget** (gzip of every JS file): 📏 608,805 B, against 716,800.
- **Not solved.** The Phase 3 primitive / grammar layer in the shared entry chunk (≈ +12.7 KB, Phase 4 audit §23.1) remains. Final optimisation is still Phase 5 app-shell code splitting. This deletion changes no part of that ruling, and no micro-optimisation was attempted.

### 5.2 Validation after deletion

| Check | 📏 Result |
|---|---|
| `npx vitest run src/lumi src/app` (LUMI, landing, router smoke, both glob census tests) | **362 / 362**, 13 files (the three deleted legacy test files are no longer counted) |
| `npm run check:tokens` | exit 0, 1,048 selectors |
| `npm run lint:ci` | exit 0 |
| `npm run build` | exit 0; dev-only review files absent from `dist/` |
| bundle measurement | §5.1 |
| legacy-landing reference search | §4.3: 0 active |
| active MARCOM AI | 📏 unchanged. Client source hits are the ruled exceptions (Privacy / Terms bylines), the unreachable `WelcomeStep.jsx`, one comment, and two test guards; the built bundle has exactly 2 (Privacy, Terms). **0 outside the ruled exceptions.** |
| browser title | 📏 `LUMI \| Decision Intelligence for Performance Marketing` in `dist/index.html` and on the rendered `/` |
| rendered `/` (the real `App.jsx` route with Firebase config, `vite` dev server) at 1440 / 1024 / 768 / 375 | h1 "Verdicts. Not dashboards." (Space Grotesk 48 px); category line present; 9 verdict marks; page environment `rgb(247,247,243)`, dark band `rgb(11,15,20)`; LUMI module CSS loaded; **overflow 0**; **0 broken images**; **0 legacy strings**; **0 console errors / warnings / failed requests / HTTP ≥ 400**. First-screen captures viewed at all four widths: identical to the Phase 4 review captures. |
| not run | Full client suite and `tokens:check` (token source): no token or authenticated component changed. The rendered colour / effects scan was not rerun: no LUMI CSS or source changed, and only unused Tailwind utilities left the stylesheet. |

---

## 6. Reference matrix

Ratings: ● strong · ◐ partial · ○ absent, judged against LUMI's meaning of each axis (Constitution Article 10), not the site's own goals. "Motion @rest" = 📏 running animations after 3.5 s idle, desktop.

| # | Reference | Category | STRUCTURE | LIGHT | NEG. SPACE | SIGNAL | Model stage it informs | 📏 Motion @rest · sticky · canvas · video | 📏 Transfer · requests | 📏 Reduced-motion rules | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R-1 | **The Pudding** — "Are Pop Lyrics Getting More Repetitive?" | editorial data storytelling | ● | ● | ◐ | ◐ | EVIDENCE → VERDICT | 0 · fixed graphic · 0 · 0 | 2,198 KB · 30 | 0 | **strongest** (principle) |
| R-2 | **Our World in Data** — Life Expectancy | evidence publishing | ● | ◐ | ● | ○ | EVIDENCE, MEASUREMENT | 0 · 2 · 0 · 0 | 2,774 KB · 50 | 11 | **strong** (hierarchy) |
| R-3 | **Things** (Cultured Code) | premium product | ◐ | ◐ | ● | ◐ | ACTION (calm demo) | 0 · 0 · 0 · 1 (behind a click) | 608 KB · 61 | 1 | **strong** (restraint) |
| R-4 | **teenage engineering** | premium product · spatial | ● | ● | ● | ◐ | — (material) | 0 · 0 · 0 · 0 | 1,828 KB · 89 | 1 | **strong** (material) |
| R-5 | **Apple** — MacBook Pro | premium product · motion-led | ◐ | ● | ● | ◐ | — (material + discipline) | 2 · 20 · 0 · 12 | 3,469 KB · 54 | 27 | **partial** (take discipline, reject form) |
| R-6 | **Rauno Freiberg** | interactive / interaction craft | ● | ○ | ● | ◐ | DECISION (orientation) | 0 · 0 · 0 · 0 | 635 KB · 32 | 0 | **partial** (one idea) |
| R-7 | **Observable** | data / technology product | ● | ◐ | ◐ | ○ | EVIDENCE (prose + live evidence) | 25 (shimmer, parallax, zoom) · 27 · 0 · 0 | 2,553 KB · 252 | 2 | **partial** |
| R-8 | **Linear** | product walkthrough | ● | ◐ | ◐ | ○ | VERDICT (typographic light) | **110** (animated dot grid) · 0 · 0 · 0 | 2,415 KB · 475 | 6, yet 📏 **76 still running under reduced motion** | **partial**; high convergence |
| R-9 | **Mercury** | premium fintech product | ◐ | ◐ | ◐ | ○ | ACTION (one-open disclosure) | 1 (noise) · 4 · 1 · 1 | **8,873 KB** · 173 | 6 | **weak**; mostly rejected |
| R-10 | **Vercel** | data / technology product | ◐ | ◐ | ● | ◐ | VERDICT (single focal object) | 1 · 2 · 1 · 0 | 2,359 KB · 126 | 15 | **weak**; chat demo rejected |
| R-11 | **Stripe** | data / technology product | ◐ | ○ | ◐ | ○ | — | 1 · 1 · 1 · 0 | 3,095 KB · 183 | 0 | **negative reference** |
| R-12 | **Family** | motion-led interface | ○ | ○ | ◐ | ○ | ACTION (feedback) | **59** · 2 · 0 · 9 | 6,098 KB · 94 | 0 | **negative reference** |
| — | Herzog & de Meuron | architecture | — | — | — | — | — | desktop refused | — | — | excluded (§1.2) |

📏 No reference hijacked the wheel: a 900 px wheel moved every page exactly 900 px. None exposed GSAP, Lenis or Three.js globals. Family exposed Framer Motion markers.

### 6.1 Observations per reference (what the page actually does)

- **R-1 The Pudding.** A graphic is pinned (📏 `position: fixed`, class `is-fixed`) while short text "slides" scroll past it. 📏 Inactive slides sit at `opacity: 0.5`, and the slide being read is fully opaque, so the reader's current step is the lit one and the rest step down. The graphic's state changes per step: a lyric is shown compressed further. There is no ambient motion. It is scroll-triggered, so under MO-8 it is a principle source, not a mechanism source.
- **R-2 Our World in Data.** The page leads with a claim title ("Life expectancy has increased across the world") beside the chart. The chart carries a title, a one-line definition, view switches (Table · Map · Line · Bar, seen in the capture) and a source. 📏 A data source is named on the page. There is no motion at rest, 11 reduced-motion rules, and the cookie banner took about 25 % of the mobile first screen.
- **R-3 Things.** The real product interface is shown at legible scale; copy is one short paragraph; video waits behind an explicit "Watch" link. 📏 0 animations, 5 elements with transitions, 608 KB: the lightest product site in the set.
- **R-4 teenage engineering.** A strict typographic grid, pictogram navigation and very large type. Product photography sits in near-black stages lit from a single source above. 📏 0 animations at rest.
- **R-5 Apple.** Products lit from one side on black, with the unlit side falling into the ground. 📏 From about the 4th viewport, full-viewport sections are pinned while scrolling. 7 pause / play buttons exist for 12 videos. Under `reducedMotion: reduce`, 📏 0 videos play and 2 animations run. There are 30 `backdrop-filter` elements, 174 gradient backgrounds, and gradient headline text.
- **R-6 Rauno Freiberg.** The page moves along a horizontal track of large type cards. A tick "ruler" at the top shows the reader's position among the sections, with the current section drawn as a box among ticks. 📏 0 animations; 📏 mobile horizontal overflow 2,504 px (the track is the layout).
- **R-7 Observable.** Prose and live evidence (code, chart, table) share one document column with provenance visible. 📏 25 running animations named `animation-shimmer`, `animate-zoom-in`, `animate-parallax`; 27 sticky elements.
- **R-8 Linear.** Real product UI fragments, and headlines set in two light steps: the claim clause bright, the elaboration dimmed (seen in captures; 📏 the colour probe missed the element and is not counted). 📏 110 CSS animations run at rest (a dot grid, `grid-dot-*-upDown`), 76 of them still under reduced motion. 475 requests.
- **R-9 Mercury.** A photoreal landscape hero; a capability list where exactly one item is expanded beside a product panel, with pause / play controls. 📏 A `noise` animation runs at rest; 8.9 MB transferred; the load event took about 37 s on this network. (📏 The walkthrough auto-advance probe matched no element and is **not measured**.)
- **R-10 Vercel.** One geometric object with a soft shadow in wide white space as the hero focal point; two-tone sentences; a chat-assistant panel as the product demonstration.
- **R-11 Stripe.** A saturated gradient ribbon behind the hero. A headline "Global GDP running on Stripe: 1.715857…%" **changed between two loads** (seen in the desktop vs mobile captures), a live figure in the hero. A customer logo wall.
- **R-12 Family.** Mascot illustrations, bouncy transforms, 📏 59 running animations and 9 videos, 6.1 MB.

### 6.2 Mechanism probes that did not measure (declared, not hidden)

| Probe | Result |
|---|---|
| Stripe / Linear two-tone headline colours | selector matched no multi-colour `h1`/`h2` span → **not measured** (observed visually only) |
| Our World in Data chart view tabs | tabs inside the grapher component not matched → **not measured** (observed visually) |
| Mercury walkthrough auto-advance | no element matched → **not measured** |

---

## 7. Strongest references (RP-4 records)

```text
REFERENCE      The Pudding, "Are Pop Lyrics Getting More Repetitive?" (editorial data essay)
TYPE           interaction idea + hierarchy
EXTRACTED      One evidence object stays in place while the reader moves through short claims; the claim
               being read is fully lit and the others step down; the object's state follows the claim.
NOT TAKEN      scroll triggering and pinning (MO-8, MC-1); illustration; serif/sans pairing; layout; colours
LUMI FORM      the Decision Spine stays fixed (MO-6.2) while the reader SELECTS a stage; the selected stage
               rises to claim light (Article 11), the rest step to meta light; the evidence slot shows that
               stage's grammar object. Reader-driven, not scroll-driven.
AC RESULT      AC-1 PASS (no visual trace) · AC-2 PASS (axis carries the call and its grounds) · AC-3 PASS if
               reader-driven, FAIL if scroll-jacked · AC-4 PASS · AC-5 PASS · AC-6 PASS (MO-6.2, Article 11)
```

```text
REFERENCE      Our World in Data, topic page with chart
TYPE           hierarchy
EXTRACTED      A figure is introduced by the claim it supports; the figure carries its definition and its
               source; alternative views of the same evidence are the reader's choice.
NOT TAKEN      charts themselves (Article 23 three questions), serif typography, colour palette, tabs styling
LUMI FORM      EvidenceGroup named by its claim, Measurement with window + basis (B8-01 L-6); already in the
               grammar. Confirms the current landing's DecisionSection pattern rather than adding one.
AC RESULT      all PASS (no visual element taken)
```

```text
REFERENCE      Things (Cultured Code) product page
TYPE           principle
EXTRACTED      Show the actual product at legible scale; keep copy short; motion only when the reader asks
               (video behind a click); the page is still at rest.
NOT TAKEN      app-icon hero, device frames, Apple-platform visual language, pricing tiles
LUMI FORM      demonstrations built from the real grammar components that reflow with the page (not
               screenshots); any "play" is an explicit reader action.
AC RESULT      all PASS
```

```text
REFERENCE      teenage engineering (product and system design)
TYPE           material + composition
EXTRACTED      A strict grid and very large, confident type make structure visible without boxes; objects are
               lit from ONE source in darkness, so importance is where the light falls.
NOT TAKEN      its typeface, pictograms, illustration, product photography, orange accent — all brand-owned (RP-2)
LUMI FORM      Charcoal band as a threshold (VB §4 "controlled Charcoal sections"); one lit claim per band;
               hairline structure (VB-A1). No photography, no lamp imagery (VB-F12).
AC RESULT      AC-1 PASS only if no pictogram/type style is borrowed · AC-4 PASS · AC-6 PASS (Article 11)
```

```text
REFERENCE      Apple MacBook Pro page — DISCIPLINE ONLY
TYPE           principle
EXTRACTED      Every media element that moves has a visible pause control, and reduced motion stops it; light
               comes from one direction, so one side of the object is lit and the rest recedes.
NOT TAKEN      scroll pinning (MO-8), cinematic product rendering, gradient text (VB-F8), glass bars (VB-F3),
               autoplay (MO-2.3), device imagery
LUMI FORM      LUMI ships NO autoplay; the directional idea becomes an ordering of light steps across the
               reading axis (inputs meta → evidence body → verdict claim), which the hero already draws.
AC RESULT      form FAIL (AC-1/AC-4 if copied) · principle PASS
```

---

## 8. Motion principles

**M-0 (governing all of the below): emphasis moves, content never hides.**

- Every word, mark and figure is present and readable at the first frame (MO-2.2).
- "Reveal" means a change of light step on content that is already there (MO-4.2).
- Reduced motion makes every change instant; information is identical (MO-7).

| # | Principle | WHAT | WHY | LUMI TRANSLATION | PERFORMANCE COST | MOBILE FALLBACK | CONVERGENCE RISK |
|---|---|---|---|---|---|---|---|
| **M-1** | Progressive decision reveal | On first load only, the demonstration's call reaches claim light first, then its reason, then the evidence. One arrival within `duration-maximum` 400 ms; staggered at `reveal` 200 ms. | MO-2.4: arrival order encodes importance, so the call is read before its grounds. | The hero's existing VerdictMark + sentence, reason caption and evidence answers start one light step down and settle to their Article 11 steps. Opacity only, `easing-reveal`, no position change beyond the 4 px settle token (or none). Triggered by load, **never by scroll** (MC-1). | CSS only; ≈ 0.2–0.5 KB gzip. No JS. | Same arrival. The stacked order puts the Verdict column below the fold, so the arrival runs only for the part in the first viewport; the rest is simply at rest. Reduced motion: instant. | **Medium.** Fade-in heroes are common. Mitigated only if the order visibly encodes hierarchy, and it plays once. |
| **M-2** | Evidence reveal (reader-driven) | Choosing a question lights the inputs that answered it and steps the others down. | Makes DATA → EVIDENCE causality visible: LUMI's "light reveals what matters" as behaviour, not decoration. | In the hero, each evidence question is a control. Selected: its inputs go to claim light, unused inputs to meta light with the words "not read for this call". 📏 True to the engine: return = `revenueMinor / spendMinor` against break-even (`verdictEngine.js:156,174,387`), frequency against the fatigue ceiling (`:387`), revenue measured = revenue > 0 and spend > 0 (`:156`). Clicks, CTR, Conversions and objective are not read by the KILL branch. | Small React state; ≈ 0.5–1 KB gzip. Uses `transition` 240 ms on colour/opacity. | Tap targets ≥ 44 px; the input list stays a wrapping list. Without JS, all inputs are visible at body light and each question lists its inputs in words. | **Low.** Interactive demos exist, but "which data did NOT matter" is LUMI-specific (B8-01 / measured absence). |
| **M-3** | Directional information flow | Direction is expressed by the order of light steps along the reading axis, not by moving arrows, flowing lines or particles. | Spec: "directional light"; MO-4.2 forbids movement as reveal. | Already present in the hero (inputs meta → evidence body → verdict claim). Extend only to the model axis (§11). | 0 KB (static). | Vertical axis, same step order top to bottom. | **Low.** |
| **M-4** | Focused signal emergence | The verdict mark is the last element to reach its locked value in an arrival (M-1), once, with no glow, pulse or flash. | VB-A4: one signal per region; MO-5.4: no gold flash. | VerdictMark opacity 0 → 1 inside M-1's stagger. The verdict **word** is present from frame one (the word is mandatory, FC-3). | Included in M-1. | Same. | **Medium-high** if it drifts into "logo reveal" (MO-8 cinematic loading). Guard: never delay the h1 or any text. |
| **M-5** | Decision-spine progression | The spine is fixed. Selecting a stage raises that stage to claim light and shows its grammar object; other stages step to meta light. No auto-advance, no scroll link, no movement along the axis. | MO-6.1 orientation; MO-6.2 no pipeline animation; spec §13 "decision journey". | §11 S-4 / S-6. Transition 240 ms on colour/opacity only. | ≈ 1–2 KB gzip (state + CSS); reuses Spine/SpineStage vocabulary. | Vertical stage list; selection by tap; the selected stage's detail opens beneath it (disclosure). Without JS, every stage's text is visible. | **Low.** Tabbed feature walkthroughs are common (R-9); the axis + light steps + real grammar objects are not. |
| **M-6** | Memory accumulation | Memory is shown as discrete, dated states that the reader steps through ("Since 2026-06-02", "5 of 6"). There is no counting, drawing or timeline animation. | MO-4.3 / PR-7: no intermediate values that were never measured. | The existing Belief record gains, at most, reader-selectable recorded decisions, each at its own date, in illustrative regions. | ≈ 0.5 KB gzip. | List. | **Low.** |
| **M-7** | Restrained product-state transitions | The illustrative "Pause campaign" → confirmation → OUTCOME stage appears with a `reveal` 200 ms opacity change. Focus moves (already) and a live region announces (already). | MO-5 feedback and MO-6 transition; the only genuine state change on the page. | Add the token-driven opacity reveal to the confirmation and outcome stage that already appear. | ≈ 0.1 KB. | Same. Reduced motion: instant (token already 0 ms). | **Low.** |

**Evaluated and not proposed:** scroll-triggered reveals (MC-1), parallax (MO-8), count-up (MO-4.3), autoplay (MO-2.3), ambient backgrounds (MO-8), cursor-follow light (VB §1 "spotlight cursors, torch effects" is a listed literal failure).

---

## 9. Visual interaction principles

| # | Principle | From | LUMI form | Guard |
|---|---|---|---|---|
| V-1 | **Typographic light:** within one statement, the claim is lit and the elaboration steps down | R-8, R-10, R-11 (seen) | a section title in claim light followed by its lead in body light: the landing already does this through `LandingSection` | this is now a widespread SaaS headline trend. Use it only where the claim and its grounds are genuinely two things, never as a style on every heading. |
| V-2 | **One fixed object, changing state** | R-1 | the spine or the hero demonstration stays still; only its light steps change | reader-driven only (MC-1) |
| V-3 | **Evidence is named by its claim, with definition and source** | R-2 | EvidenceGroup + Measurement window / basis (already locked, B8-01 L-6) | confirms, adds nothing new |
| V-4 | **Threshold:** the Charcoal band is an opening where product truth is lit | R-4, R-5 (material), spec §5 "thresholds and openings" | full-width Charcoal bands only where a verdict or spine lives (VB §4); nothing decorative inside | no photography, glow or gradient at the band edge |
| V-5 | **Orientation in a sequence** | R-6 | the spine itself shows where the reader is (the selected stage), so no separate progress bar is needed | never a scroll-progress indicator (MO-8) |
| V-6 | **Nothing plays unless asked** | R-3, R-5 | LUMI has no autoplay; any demonstration is a reader action | — |
| V-7 | **Real product at legible scale** | R-3 | grammar components rendered live (reflowing text), never screenshots that shrink to illegible on mobile (📏 R-3 and R-8 mobile captures) | spec §13 "no fake dashboards" |

---

## 10. Hero directions (research only, not implemented)

The current hero is kept as the control: category line → h1 → lead → two calls to action, with a Charcoal band holding the data → evidence → verdict demonstration. All three directions keep that content and copy.

### H-A — "The call arrives first"

| | |
|---|---|
| **Visitor sees** | the page exactly as today at the first frame: every word readable. |
| **What moves** | once, on load: in the Charcoal band the verdict mark, verdict sentence, evidence answers and data inputs settle from one light step below to their resting steps, call first (M-1, M-4). Opacity only. Total ≤ 400 ms. |
| **What changes** | nothing after the arrival; the band is still. |
| **Decision concept** | LUMI commits to a call and shows its grounds, in that order (MO-2.4, "Why LUMI said KILL" as VERDICT → WHY → EVIDENCE). |
| **Why LUMI** | the arrival order *is* the illumination hierarchy (Article 11). A generic fade-in has no order. |
| **Performance** | CSS only, ≈ 0.2–0.5 KB gzip, composited properties. |
| **Mobile fallback** | the band stacks Data → Evidence → Verdict; only elements inside the first viewport take part; reduced motion is instant. |
| **Anti-convergence risk** | **medium:** "hero content fades in" is common. It passes AC-3 only because the order is semantic and it never repeats. |
| **Open** | MC-2: this leads with reading order inside a band that draws production order. |

### H-B — "Light what mattered" (evidence selection)

| | |
|---|---|
| **Visitor sees** | today's demonstration, with the three evidence questions as quiet controls. The first question ("Is it earning back what it spends?") is selected by default, so the resting state is complete without interaction. |
| **What moves** | on selection, the Data column's inputs change light step: those this question read go to claim light; the others go to meta light and are marked "not read for this call". 240 ms colour / opacity transition. |
| **What changes** | only light steps and one short caption; layout never moves. |
| **Decision concept** | DATA → EVIDENCE: a verdict rests on a few inputs, and LUMI can say which. Of eight inputs, a KILL here read spend, conversion value and frequency (📏 engine lines in M-2). |
| **Why LUMI** | measured relevance and measured absence are product truth (B8-01, B8-02). Competitor demos show *more* data; this shows *less, and why*: "clarity turns complexity into decisions" as behaviour. |
| **Performance** | ≈ 0.5–1 KB gzip, React state already in the bundle; no dependency. |
| **Mobile fallback** | tap-sized question controls (≥ 44 px); inputs wrap. Without JS or with reduced motion, each question lists its inputs in words and all inputs are visible. |
| **Anti-convergence risk** | **low.** Needs keyboard semantics (buttons with `aria-pressed`, or a radio group) and a live-region caption. |
| **Truth obligation** | the input-to-question mapping must be re-verified against `verdictEngine.js` at implementation and pinned by a test, like the figure census. |

### H-C — "Two tenses, one threshold"

| | |
|---|---|
| **Visitor sees** | in the Charcoal band, the recorded decision (AT DECISION · KILL) beside today's assessment (NOW · REFRESH), with the disagreement stated in words. This moves the Phase 4 `#evidence` pair up into the hero. |
| **What moves** | nothing on load. The reader may focus one tense, which raises that spine to claim light and steps the other down. There is no transition between the verdicts (MO-4.5) and no diff (FC-5). |
| **What changes** | light steps of two spines on reader action. |
| **Decision concept** | DECISION → OUTCOME → MEMORY: a decision keeps its grounds while the present moves on. |
| **Why LUMI** | tense is unique to LUMI (Constitution R-1, PR-1). No reference or competitor shows a stored call beside a live one. |
| **Performance** | ≈ 0–1 KB gzip. |
| **Mobile fallback** | stacked: NOW first, AT DECISION below; the divergence line always sits beside the NOW verdict (Article 25 "decision readability"). |
| **Anti-convergence risk** | **lowest.** Comprehension risk is **highest**: two verdicts in the first five seconds may confuse a first-time visitor, which is why this stays in `#evidence` unless a test says otherwise. |

---

## 11. Decision Spine directions (research only)

The model DATA → EVIDENCE → VERDICT → DECISION → ACTION → OUTCOME → MEMORY is drawn today as a static horizontal axis in `#how` (`parts.jsx` `Axis`).

| # | Direction | What it would be | Governance | Cost | Mobile | Convergence | Assessment |
|---|---|---|---|---|---|---|---|
| S-1 | **Static** | today's axis with descriptions | pass | 0 | vertical list (today) | low | correct but "too static" (the brief's own finding) |
| S-2 | **Progressive** | stages light up one after another on load or on a timer | **FAIL**, MO-6.2 ("stages are not animated along the axis as a pipeline running") and MO-2.3 | CSS | — | medium | **rejected** |
| S-3 | **Scroll-driven** | pinned spine; each scroll step lights the next stage (R-1 pattern) | **FAIL as written**, MO-8 (MC-1); needs a ruling even in a discrete form | ≈ 1 KB (IntersectionObserver) + pinning | pinning on phones fights the browser UI; R-5 pins on mobile too, and it is the heaviest page class | **high**: the recognisable scrollytelling / product-page idiom | **not recommended** |
| S-4 | **Interactive** | the reader selects a stage; the spine stays still; the selected stage reaches claim light and its grammar object appears in the evidence slot | pass: MO-5 feedback, MO-6.1 orientation, Article 11 | ≈ 1–2 KB gzip | stages as a vertical list, selected stage's object opens beneath (disclosure) | low–medium | **recommended mechanism** |
| S-5 | **Spatial** | depth layers / 3D stack of stages | FAIL: VB-F2/F3 territory, MO-6.4; 📏 Three.js 148,741–166,179 B gzip | very high | poor | **high** (ThreeUI-style) | **rejected** |
| S-6 | **Typographic** | the seven stage words set as one line; unselected words at meta light, the selected word at claim light; the line itself is the control | pass | ≈ 0.3 KB | wraps into two lines; selection unchanged | **low**: no box, card or tab styling | **recommended form** |
| S-7 | **Hybrid (S-6 + S-4)** | the typographic line is the spine; selecting a word shows that stage's real grammar object from the existing landing (data list · EvidenceGroup · VerdictMark · DecisionIdentity · ActionControl · NOT_MEASURED outcome · Belief), with the spine fixed | pass | ≈ 1–2 KB gzip | as S-4 | low | **recommended direction** (§16) |

**Default state for S-4 / S-7.** A stage is pre-selected (VERDICT, the product's centre), so the resting page is complete. With JS disabled or before hydration, all seven descriptions are visible as today's static list. Nothing is hidden behind the interaction (M-0).

---

## 12. ThreeUI findings

📏 **Catalog (Community edition, from `src/data/shaders.tsx`).**

- 50 parent components: 141 free variant records plus 23 singletons, 164 browse results (README).
- Catalog records by `category` label: Backgrounds 29 · Three.js 20 · Buttons 20 · Text Animation 14 · UI Elements 9 · CSS 5 · Hero 3 · Sections 2 · Landing Pages 2.
- Largest `runtime` labels: Canvas 2D 24 · DOM + CSS 20 · Three.js-only 21 (r128–r165) · raw WebGL / WebGL2-only 12; the remainder are combinations, many including Three.js or WebGL.
- Licence MIT; an npm package (`@designcodeio/threeui`) and a Pro CLI exist.
- **This corrects Phase 4 audit §21 item 15**, which said the repository page does not name components: the source does, and they are listed below.

**Components whose names suggest structure** (read, not rendered):

| Component | Category · runtime | Its own description (paraphrased) | LUMI question: *does it make a decision easier to understand?* |
|---|---|---|---|
| Structure Flow | Three.js | 13 field studies: particle domes, horizons, orbitals, matrices, topology, fluids, embers, vortexes | **No:** decorative fields. REJECT (VB-F14, MO-8 continuous) |
| Interface Lines / Gateway Flow / Defense Lines / Connectivity Graph | Backgrounds · Canvas 2D | line / flow / graph fields behind hero stages; "customizable speed, density…" | **No:** dashboard wallpaper (VB-F14), motion at rest. REJECT |
| Topology Field · Data Field · Logic Core | Three.js | rotating topology with node pulse; global-data scene; orbiting nodes | **No:** liveness theatre (MO-8), AI orb territory (VB-F7). REJECT |
| Diagnostics Panel | UI Elements · Canvas 2D | layered planes / node cubes / flowing mesh illustrations | **No:** decorative chart (Article 23). REJECT |
| Performance Gauges | CSS | dials with "self-test needle sweep … counting readout" | **No:** count-up (MO-4.3, PR-7). REJECT |
| Editorial Intro | Sections · DOM + CSS | dimly lit device illustration, circuit traces, oversized gradient type; "reduced-motion fallback" | **No** for the form (gradient, device, circuit = VB-F4/F8). The reduced-motion fallback is a practice, not a design. |
| Article Headings / Outline Typeflow / Semantic Bloom | Text Animation | chromatic intro, particle wordmark, letters orbiting and bursting, particles "illuminating the text" | **No:** literal illumination (VB-F12 spirit) and particles. REJECT |
| Thinking Button | Buttons · Canvas 2D | "continuous thinking trace … luminous blue trace orbiting" | **No:** thinking simulation (MO-8). REJECT |
| Brand Orbs · Glassmorphism CTA · Neon Typography · Gradient Beam CTA | various | self-describing | **No:** VB-F7, VB-F3, VB-F1, VB-F8. REJECT |

**Principles extracted** (practices, not designs):

1. **Visibility pausing** ("visibility pausing" in Semantic Bloom's description). Anything that ever animates must stop when off-screen. LUMI already has no motion at rest, so this is moot unless a future demo plays.
2. **A declared reduced-motion path per component** (several descriptions). This matches MO-7 exactly and confirms that the rule is practical.
3. **"Final-frame" rendering** (many components offer an "optional final-frame palette"). Every motion should resolve to a meaningful still frame. LUMI's version: the resting state is the complete state (M-0).

**Verdict.** Reference only. Nothing installed, imported or rendered. No Three.js, no WebGL. Not one ThreeUI component passes "does this make a LUMI decision easier to understand?".

---

## 13. Performance observations

| Observation | 📏 Evidence | Implication for LUMI |
|---|---|---|
| Calm pages were the lightest | Things 608 KB · Rauno 635 KB · teenage engineering 1,828 KB, all 0 animations at rest | calm precision and low weight are the same decision |
| Motion-led pages were the heaviest | Family 6,098 KB (59 animations, 9 videos) · Mercury 8,873 KB (noise animation, video, canvas; load ≈ 37 s here) · Apple 3,469 KB (12 videos) | autoplay media and ambient motion carry megabytes |
| A 3D runtime alone is 13–14 times LUMI's whole accepted Phase 4 regression | Three.js `three.min.js` r128: 603,445 raw / **148,741 gzip**; `three.module.min.js` r160: 670,681 raw / **166,179 gzip** (downloaded from jsDelivr, measured, not executed) vs the accepted +11,735 B | spatial or WebGL directions are not viable before, or even after, Phase 5 code splitting |
| Request counts vary more than weight | Linear 475 requests vs Pudding 30 | not a LUMI risk today (single entry bundle); relevant when Phase 5 splits routes |
| Reduced motion is often ignored | 📏 Linear: 76 animations still running under `reducedMotion: reduce`; Pudding, Stripe, Family, Rauno expose 0 reduced-motion rules (Pudding and Rauno have nothing to reduce) | LUMI's token-level reduction (📏 all durations → 0 ms under `prefers-reduced-motion`) is already stricter than every reference |
| Recommended mechanics cost | M-1 ≈ 0.2–0.5 KB · M-2 / S-7 ≈ 0.5–2 KB gzip, CSS + existing React | within noise of the current 299,071 B first load; must still be measured at implementation |

---

## 14. Mobile observations

| Observation | 📏 Evidence | Implication |
|---|---|---|
| Ambient motion survives on phones | Linear 81 animations at 375 px; Observable 25; Family 27 | phones pay battery and attention cost; LUMI keeps 0 |
| Pinning persists on mobile | Apple 20 sticky elements at 375 px | S-3 would pin on small screens where the browser chrome already moves |
| Horizontal tracks overflow | Rauno: page scrollWidth exceeds viewport by 2,504 px at 375 | no horizontal layouts (Article 25: the body never scrolls sideways) |
| Screenshots become illegible | Linear and Things product captures shrink to unreadable UI at 375 px | V-7: live grammar components that reflow (LUMI's current approach) are better on mobile than any screenshot |
| Consent banners take the first screen | Our World in Data banner ≈ 25 % of the 375 px first screen; Apple region banner | LUMI has no analytics destination today; if one is added, the banner competes with the hero |
| Hero type scales down hard | h1 sizes at 375 px: Things 20 px, Apple 21 px, Linear 38 px, Vercel 48 px, Family 44 px (LUMI 48 px, two lines) | LUMI's locked 48 px display role reads as intended; H-A/H-B must not push the demonstration further below the fold |
| Interaction must be tap-first | none of the references relied on hover for content | M-2 / S-7 selection is tap and keyboard; hover may never be the only way to see anything |

---

## 15. Rejected patterns

| Pattern | Observed where | Rule |
|---|---|---|
| Generic AI SaaS: chat panel as the product demo, "agentic" framing | Vercel second screen; ThreeUI Thinking Button | VB-F11, AC-3, AC-5, PR-8 |
| Cyberpunk / sci-fi fields | ThreeUI Defense Lines, Gateway Flow, Logic Core, Topology Field | VB-F2, VB-F14 |
| Neon | ThreeUI Neon Typography | VB-F1 |
| Futuristic tech cliché: orbiting nodes, data globes | ThreeUI Data Field, Logic Core, Globe collection | VB-F7, spec §4 |
| Glowing gradients | Stripe hero ribbon; Apple gradient headline; ThreeUI Gradient Beam CTA | VB-F8 |
| Glassmorphism | Apple (📏 30 blur elements); Linear (3); ThreeUI Glassmorphism CTA | VB-F3 |
| Floating blobs / orbs | ThreeUI Brand Orbs, Liquid Form; Family mascots | VB-F7 |
| Decorative particles | ThreeUI Particle Drift / Network / Wordmark, Semantic Bloom | spec §14, VB §1 |
| Excessive 3D | ThreeUI Three.js category (📏 20 variant records); 📏 148–166 KB runtime | Article 26 §3, MO-6.4 |
| Excessive parallax | Observable (`animate-parallax`) | MO-8 |
| Scroll-jacking / pinned cinematic sequences | Apple pinned sections; Rauno horizontal track | MO-8, Article 25 |
| Cinematic effects: photoreal scenes, lit product renders | Mercury landscape hero; Apple product renders | VB §4 marketing boundaries, spec "not a dark cinematic render" |
| Constant animation | Linear animated dot grid (📏 110 at rest); Mercury noise; Family (📏 59) | MO-2.3, VB-A8 |
| AI magic: "illuminating" text, sparkle-like particles | ThreeUI Semantic Bloom, Spark Badge | VB-F5, VB-F6, VB-F12 |
| Chatbot aesthetics | Vercel chat panel demo | VB-F11 |
| Live-ticking figures | Stripe "Global GDP running on Stripe" (value changed between loads) | MO-4.3, PR-7, Article 30 |
| Count-up instruments | ThreeUI Performance Gauges ("counting readout") | MO-4.3 |
| Autoplay video | Apple (12), Family (9) | MO-2.3 |
| Logo walls | Linear, Stripe, Vercel | PR-7 (fabricated logos forbidden; no real customer source) |
| Shimmer | Observable (`animation-shimmer`) | MO-8 |
| Bouncy / playful easing | Family transforms | MO-3 |
| Cursor-follow spotlight or "torch" reveal | considered as a literal reading of the brand idea | VB §1 literal failure |

---

## 16. Recommended direction

### SELECTIVE ILLUMINATION: light follows the reader's question

The single strongest direction: **one mechanic, used twice.**

1. **In the hero, H-B "Light what mattered".** Selecting an evidence question lights the inputs it actually read and steps the rest down, stating what was not read.
2. **In `#how`, S-7 hybrid spine.** The seven stage words form one typographic line. Selecting a word lights it and shows that stage's real grammar object beneath, while the spine never moves.

Both obey the same rules:

- **M-0:** everything is present at first frame.
- **Reader-driven only:** no scroll link, no timer, no autoplay (MO-8, MO-6.2, MO-2.3).
- **Light steps only:** Article 11 text-light tokens and the 240 ms transition token; no gold, no verdict colour for selection (FC-14).
- **Reduced motion:** instant, with the same information.
- **Truth:** every lit input traces to `verdictEngine.js`, pinned by a test; illustrative regions stay labelled (PR-7).

**Why this, over the others:**

- **It is the brand idea as behaviour.** "Light reveals what matters" becomes literal in *interaction*, not in imagery: the reader asks, and LUMI lights what mattered and dims what did not. That is VERDICTS. NOT DASHBOARDS in one gesture, since a dashboard lights everything.
- **It passes every AC test on paper.** It takes no visual element from any reference; its skeleton only makes sense for a call and its grounds (AC-2); it behaves like a decision system (AC-3); it adds nothing decorative (AC-4); its neutral sentence ("selecting a question highlights the inputs that determined a verdict and names the unused ones") does not describe a component in a generic AI or SaaS product (AC-5); and its Why-LUMI answer cites B8-01, B8-02 and Article 11 (AC-6).
- **It is the cheapest distinctive option.** About 1–2 KB gzip, no dependency, no new token.
- **It fixes "too static" without motion at rest.** The page is still until the reader acts.

**Companions, optional and lower priority:**

- M-7 (token reveal on the illustrative action's confirmation);
- M-1 / H-A, **only** if §17 Q-2 rules for claim-first arrival.

**Explicitly not recommended:** S-3 scroll-driven spine (needs an MO-8 ruling, has the highest convergence risk, and has mobile pinning problems); any ThreeUI, WebGL or 3D direction.

**Implementation is not started.** It needs Omar's approval of this direction and the §17 answers, then a Phase 4.x implementation brief with its own review gate.

---

## 17. Open questions

| # | Question | Why it matters | Needs |
|---|---|---|---|
| Q-1 | Does MO-8 ("scroll-linked motion") also forbid a **discrete, scroll-triggered emphasis change** that hides nothing and moves nothing? | only S-3 / R-1-style storytelling depends on it; the recommendation does not | Omar ruling (MC-1) |
| Q-2 | Should the hero lead with **reading order** (call first, MO-2.4; spec §12 DATA → VERDICT → EVIDENCE → ACTION) or keep **production order** (Article 5) for its arrival? | decides whether H-A exists | Omar ruling (MC-2) |
| Q-3 | Is a pre-selected default (VERDICT for the spine, the first question for H-B) acceptable as the "complete resting state"? | M-0 requires completeness without interaction | design review |
| Q-4 | The H-B input-to-question mapping: approve the wording "not read for this call" for inputs the KILL branch does not use? | a truth statement about the engine | product-truth review at implementation, pinned by test |
| Q-5 | Should hover on pointer devices *preview* illumination, or only explicit selection? | hover-only content is forbidden; preview adds motion | design + accessibility review |
| Q-6 | Spec §12 sections still absent (Pricing, Integrations band, Who LUMI is for, Before / With LUMI) | spec architecture vs no price or market source | product rulings (Phase 4 audit §21) |
| Q-7 | Spec §13 "actual application previews": the authenticated surfaces are not yet rebuilt (Phase 5); legacy screenshots would violate FC-12 / RP-7 | storytelling category 8 cannot be met truthfully yet | defer to Phase 5 |
| Q-8 | Motion tokens exist but no motion has shipped: is the first motion (M-7 / S-7 transition) a Phase 4.x change or does it wait for a motion review gate (spec §39 Phase 6)? | phase gating (REVIEW_GATE.md) | Omar |
| Q-9 | The approved logo "01 / Current Base" is still unavailable | the hero's identity moment and the "gold reveal" signature depend on it | the asset |
| Q-10 | ThreeUI: Phase 4 audit §21 item 15 said components are not enumerated; §12 now enumerates them. Close that item? | record accuracy | audit update at the next commit |

---

## 18. Prototype Results

```text
Phase      4.2 — HERO + DECISION SPINE INTERACTION PROTOTYPE (prototype only; the landing is not rebuilt)
Date       2026-09-15 · branch feat/lumi-landing, uncommitted, on top of the §4–5 deletion
Built      H-B "Light what mattered" (§10) · S-7 hybrid typographic + interactive spine (§11)
Not built  H-A · H-C · S-2 · S-3 · S-5 · M-1 · M-4 · M-6 · M-7 · any ThreeUI / Three.js / WebGL / canvas
Gate       READY FOR VISUAL REVIEW — not Phase 5, not production
```

§1–17 are unchanged except where §18.8 records a correction.

### 18.1 Hero: what was built

`client/src/lumi/landing/sections/HeroDemonstration.jsx` is a new page part, moved out of `HeroSection.jsx` to stay under the 150-line budget. It keeps the Charcoal band, production order DATA → EVIDENCE → VERDICT, and the KILL verdict, tense and caption.

| Element | Before (Phase 4) | Prototype |
|---|---|---|
| Evidence questions | 3 static question / answer pairs | **4** questions as native toggle buttons (`aria-pressed`), in two groups: **The grounds for this call** (return, frequency) and **Checked before any call** (revenue measured, delivery) |
| Under each question | answer only | answer, plus **`Reads: <inputs>`**, always visible |
| Data inputs | 8 inputs, all at meta light | the same 8. Inputs the chosen question reads are at **claim** light with a selection mark; inputs another question of this call reads are at **body**; inputs that decided nothing are at **meta** |
| Data column | — | one static line: **"Did not decide this call: Clicks, Click-through rate, Conversions and Campaign objective."** |
| Verdict sentence | one claim sentence | the same words in two clauses. Choosing *return* keeps "It is losing money," lit and steps the fatigue clause to body; *frequency* does the opposite; a pre-call check leaves both lit |
| Figure caption | "From what the platforms report to one call." | "…to one call — and which of it mattered."; the column hint gains "— choose a question" |

At rest the first question is chosen, so the page is complete with no interaction (Q-3).

### 18.2 Decision Spine: what was built

`client/src/lumi/landing/sections/ModelSpine.jsx` replaces the static `Axis` in `#how`. `Axis` itself is unchanged and still draws the memory sequence.

- **The controls are the words.** The seven stage words are native toggle buttons, set in the `heading.surface` role. There are no boxes, cards, tabs, pills, numbers, arrows or progress bar.
- **What the reader sees.** Each stage keeps its Phase 4 description and gains one **"Never …"** line stating a locked rule: B8-02, B8-01 L-6, PR-5, PR-1/R-1, confirmation before execution, PR-7, and Constitution R-1. The sources are in the file header.
- **Light by distance from the chosen stage.** The chosen stage is at claim, the stages either side at body, and the rest at meta. A 2 px selection mark sits on the axis rule: above the stage when the axis is horizontal (≥ 1096 px), beside it when vertical.
- **At rest.** VERDICT is chosen.
- **Copy moved.** The paragraph under the axis ("Memory can make LUMI more or less confident… It never changes the verdict.") is removed because the Memory stage's never-line now says it. "Not every verdict has one." moved from Action to Verdict.

### 18.3 Interaction behaviour

| | Hero | Spine |
|---|---|---|
| Trigger | click, tap, Enter or Space on a question | click, tap, Enter or Space on a stage word |
| What changes | light steps of inputs, questions, answers, "Reads" lines and verdict clauses; the selection mark | light steps of the seven stages; the selection mark |
| What never changes | text, order, layout, the verdict, its mark, its tense (📏 tested for every question) | text, order, position, the number of stages (📏 tested) |
| State | one `useState`, one chosen question | one `useState`, one chosen stage |
| Timers, effects, scroll or visibility listeners | none (📏 source test) | none (📏 source test) |

### 18.4 Motion behaviour

| Change | Property | Token | Purpose (MO-1) | Reduced motion |
|---|---|---|---|---|
| light step (text colour) | `color` | `duration.feedback` 100 ms, `easing.feedback` | FEEDBACK | stays within the feedback range (DESIGN_TOKEN_ARCHITECTURE.md §9) |
| selection mark | `opacity` | `duration.reveal` 200 ms, `easing.reveal` | FEEDBACK / REVEAL | 0 ms |
| hover surface (pointer devices only) | `background-color` | `duration.feedback` | FEEDBACK | — |

📏 **Measured in Chromium.** Every figure in this subsection comes from the Playwright run on the dev server.

- **Transitions after a choice:** exactly `opacity:200ms` and `color:100ms`.
- **Settle time:** the chosen input read claim colour and mark opacity 1.00 at 460 ms.
- **Motion at rest:** 0 running animations at load and after every interaction, at all four widths.
- **Reduced motion:** `--lumi-motion-duration-reveal` resolved to `0ms`. The final colours and mark were in place two animation frames after the click. The legacy global override also clamps every transition to `0.01ms`.

There is no autoplay, loop, timer, scroll link, parallax, glow, pulse, gradient or movement; nothing is positioned or scaled.

**Registered tension (not resolved).** MO-6.5 says only composited properties are animated. The text-colour change is not composited. It is classed as FEEDBACK because token §9 names "colour or opacity" for `duration.feedback`, and `controls.module.css` already transitions `background-color` the same way. See Q-12.

### 18.5 Accessibility (📏 tested where stated; not a compliance claim)

- **Semantics.** Native `<button type="button">` with `aria-pressed`, exactly one pressed per group (📏 unit test). There is no hover-only content: hover is guarded by `@media (hover: hover)`.
- **Keyboard.** 📏 At 1440, 1024 and 768, Space activated a question and Enter activated a question and a stage word. Tab order is the four questions in reading order, then the seven stages in production order. The focus ring is the neutral LUMI ring, never gold, and was visible in capture B.
- **Selection never relies on colour alone.** Three cues:
  - the pressed state;
  - a selection mark in `interaction.selected.indicator`;
  - words that always state the relationship ("Reads: …", "Did not decide this call: …").
- **Targets.** 📏 Controls measured 24 px (hero) and 32 px (spine) with a fine pointer, and **44 px** with a coarse pointer, at load and after taps.
- **Measurement caveat.** An earlier run reported 24 px on a phone. That run had lost mobile emulation: Playwright element screenshots taller than the viewport resize the page, and the pointer and hover media flipped. Phone figures come only from the viewport-screenshot run.
- **Zoom.** 📏 At 640 px and 320 px viewports (the layout of 200 % and 400 % zoom on a 1280 px window), there was 0 horizontal overflow, and choosing a question and a stage worked.
- **Contrast.** Light steps and the indicator are Phase 2 tokens whose contrast pairs `tokens:check` enforces; no new colour was introduced.
- **Not done.** No screen-reader session (NVDA / VoiceOver) and no automated axe run.
- **Announcements.** No separate live region was added; the pressed state is the announcement and the "Reads" line is the next text (see Q-13).

### 18.6 Responsive behaviour

| Width | Hero | Spine |
|---|---|---|
| 1440 / 1024 (📏 captures A, B, B2, C, D) | three columns at ≥ 1096; stacked at 1024 with inputs as a wrapping run | horizontal axis of seven words at ≥ 1096; vertical list at 1024 |
| 768 (📏) | stacked | vertical list |
| 375 phone (📏 F, G, emulation asserted) | stacked; the tapped question's "Reads" line and answer sit next to it; the verdict clause is below it on the same screen in capture F | vertical list; a tap lights the stage in place |

📏 Across the four widths:

- 0 horizontal overflow;
- 0 console errors or warnings;
- 0 failed requests;
- 9 verdict marks.

**Mobile simplification.** On a phone the Data column is above the fold of the Evidence column, so lighting inputs alone would happen off-screen. The always-visible "Reads" line was added so the concept survives there; it does not depend on seeing the Data column.

### 18.7 Performance (📏 `measure-dist.mjs`, production `npm run build`, same script as §5.1)

| | Before (📏 re-measured at the start of 4.2) | After | Delta |
|---|---|---|---|
| First load gzip | 299,071 B | **300,397 B** | **+1,326 B** |
| First load brotli | 252,345 B | 253,165 B | +820 B |
| First load raw | 1,081,634 B | 1,087,638 B | +6,004 B |
| entry JS gzip | 173,047 B | 173,913 B | +866 B |
| entry CSS gzip | 33,280 B | 33,740 B | +460 B |
| all JS gzip (CI budget 716,800) | 610,365 B | 611,252 B | +887 B |

- **Target.** The ~1–2 KB target is met.
- **Dependencies.** None added: no animation library, no Three.js.
- **Cumulative.** Against the original 287,336 B baseline the first load is now **+13,061 B (+4.55 %)**, all still awaiting Phase 5 code splitting.

### 18.8 Data and evidence truth verification

📏 Re-read `src/services/verdict-engine/verdictEngine.js` before writing:

| Question | Reads | Engine line |
|---|---|---|
| Has it been shown enough times to judge? | Impressions | `:290` `if (sampleKnown && impressions < MIN_IMPRESSIONS)`, a gate before every verdict |
| Was revenue measured at all? | Spend, Conversion value | `:156` `revenueMeasured = agg.revenueMinor > 0 && agg.spendMinor > 0`; routes at `:358` |
| Is it earning back what it spends? | Spend, Conversion value | `:174` `roas = revenueMinor / spendMinor`; `:387` `roas < V.BREAKEVEN_ROAS` |
| Is the audience seeing it too often? | Frequency | `:387` `frequency >= V.FATIGUE_FREQ` |

**Clicks, click-through rate, conversions and campaign objective ARE computed.** They feed the diagnosis, the funnel, the objective benchmarks and data confidence, but no condition on the path to KILL reads them.

**Pinned by tests** (`landingIllumination.test.jsx`):

- the question-to-input map;
- the derived "did not decide" set;
- the exact engine source lines above;
- that the KILL condition names none of the four.

A change to the engine fails the test.

**Corrections to this document** (the recommendation is unchanged):

1. §8 M-2 and §17 Q-4 proposed "**not read** for this call". That wording is **false**: the engine computes those inputs. The prototype says "**did not decide** this call".
2. §10 H-B said a KILL "read spend, conversion value and frequency". It omitted **impressions**, which the minimum-sample gate reads before any call. The prototype adds the delivery question rather than mark impressions as unused.
3. Simplification kept visible: for a campaign rolled up from children, frequency is impression-weighted (`:111-139`). The demonstration is a single illustrative campaign, so "Reads: Frequency" is stated at leaf level.

**No figures.** The prototype adds no figure. The Phase 4 figure census in `landing.test.jsx` is unchanged and passes.

### 18.9 Anti-convergence review (author self-assessment, not approval — Article 36)

| Test | Hero | Spine |
|---|---|---|
| Mistaken for ChatGPT / Claude / Gemini / Perplexity / a copilot? | No: no chat, prompt, streaming, typing, orb or glow; the verdict is fixed and never "generated" | No |
| Mistaken for a generic SaaS stepper / wizard / carousel? | — | Lower risk than a stepper: no numbers, checkmarks, Next button, progress fill, boxes or auto-advance. **Residual risk:** at ≥ 1096 px the seven words over a rule with a top mark can read as a tab bar (capture C/D). Tested for, not eliminated. |
| Mistaken for an analytics dashboard? | No: no chart, figure or tile; it shows *less* data and says which did not matter | No |
| AC-5 neutral sentence | "Choosing an evidence question lights the inputs that question read and names the inputs that did not decide the call." This does not describe a generic product component. | "Each stage of the model states what it holds and what it never does; the reader chooses which to read." |
| Gold | none (📏 token test: no `signal-attention` anywhere) | none |
| Verdict colour for emphasis | none; the single KILL mark is unchanged | no verdict mark in `#how` (📏 tested) |

### 18.10 What worked

- **The reasoning becomes legible in one gesture.** Choosing *frequency* lights Frequency, its answer and "…seen it too often". The reader sees *which* input stands behind *which* clause of the call. This is the brand idea as behaviour, not imagery (§16).
- **The two groups and the new delivery question teach a truth the static hero hid.** LUMI refuses a call on thin data before it judges anything.
- **"Did not decide this call"** is the most LUMI-specific line on the page. It names measured irrelevance, which a dashboard never does.
- **The never-lines turn the model axis into a system of rules** rather than a feature list.
- **Nothing moves unless asked**, and the resting page is complete. Cost is +1.3 KB gzip.

### 18.11 What did not work, or is not yet good enough

1. **Claim versus body is a small luminance step,** especially at caption size in the Data column and on Off White in the spine (captures B, D). The selection mark and the words carry selection; the light step alone would not.
2. **The tablet spine (688–1095 px) is long:** seven stages × three lines as a vertical list.
3. **On a phone the Data column's lighting happens off-screen.** It was mitigated with the "Reads" line; the verdict clause is visible below the question in capture F, but only just.
4. **The hero evidence column is denser.** It has four questions, four answers, four "Reads" lines and two group captions.
5. **Space Grotesk for seven stage words** may exceed Article 20 §2's "rare" use of that face (Q-14).
6. **New copy has had no copy or truth review.** This covers the never-lines, the delivery question, the group captions, the figure caption suffix and "choose a question" (Q-15).

### 18.12 What should be rejected

| Rejected | Why |
|---|---|
| The wording "not read for this call" | false against the engine (§18.8) |
| Lighting inputs without a words channel | fails on phones and fails colour-alone (§18.6, §18.5) |
| A hover-only or hover-preview version | touch devices kept the hover surface after a tap and it read as a selected card; `(hover: hover)` guard kept (Q-5 answered for this prototype: explicit selection only) |
| A separate live-region caption repeating the question | removed during review: it duplicated the pressed state and sat in the wrong column on a phone |
| A selected-surface block behind the chosen stage | considered, not built: it turns the stage into a card (brief §14) |
| Every item not pursued in §10–11 | still research alternatives or rejected there; nothing from them was built |

### 18.13 Open questions added by the prototype

| # | Question | Needs |
|---|---|---|
| Q-11 | Approve the hero's fourth question and the two groups ("The grounds for this call" / "Checked before any call")? | Omar + product-truth review |
| Q-12 | MO-6.5 (only composited properties animate) versus token §9 ("feedback: colour or opacity"): may a light step change colour over `duration.feedback`, or must it be instant? | motion ruling |
| Q-13 | Is the pressed state plus the adjacent "Reads" line enough announcement under MO-5.6, or must selection also write to a live region? | accessibility review with a screen reader |
| Q-14 | Space Grotesk (`heading.surface`) for the seven stage words: within Article 20 §2? | design ruling |
| Q-15 | Copy review of the seven never-lines and the other new strings (§18.11 item 6) | copy + product truth |
| Q-16 | At ≥ 1096 px, does the spine read as a tab bar? If so, the fallback is a vertical spine at every width | Omar, from captures C / D |

### 18.14 Review patch (2026-09-15): decisions closed

Omar's review closed Q-3, Q-11, Q-12, Q-13, Q-14 and Q-16. **Where this subsection and §18.4, §18.5 or §18.13 disagree, this subsection governs.**

| # | Ruling | Applied |
|---|---|---|
| Q-11 | **Approved.** Fourth question and both groups kept | unchanged; the impressions gate stays, and no threshold appears in the UI |
| Q-3 | **Approved.** A default chosen question, and VERDICT in the spine, are presentation state only | no copy claims anyone chose them (📏 tested); nothing records or implies a decision |
| Q-12 | **Rejected: no colour animation.** Text light changes at once; only the selection mark fades (200 ms) | the `color` transitions and the control `background-color` transition removed; the landing now declares exactly one transition, the mark's `opacity` (📏 tested). §18.4's colour row is withdrawn |
| Q-13 | **No live region.** Native button, `aria-pressed`, the visible mark and the "Reads" line | unchanged; nothing removed |
| Q-14 | **Approved.** Space Grotesk for the seven stage words | unchanged |
| Q-16 | **Keep horizontal on wide screens; must not read as tabs; do not simply go vertical** | recomposed, see below |

**Q-16: what changed in the spine.**

- **≥ 1096 px (1440):** the rule above the words, and the selection mark that lay on it, are removed. A row of words over a rule with one lit segment is the anatomy of a tab strip.
  - The seven words now form one phrase, each joined to the next by a hairline (Data —— Evidence —— Verdict …).
  - The selection mark stands beside the chosen stage, the same mark as in the hero.
  - The list is pulled into the gutter by the mark's inset, so "Data" aligns with the section heading.
  - The word control now fits the word, not the column, so no column-wide hover fill.
- **688–1095 px (1024, 768):** the same vertical axis, but each stage is one row: the word, then what it holds and what it never does. Seven stages take seven rows instead of twenty-one lines.
- **< 688 px (375):** vertical list, as before.

**Why 1024 is not horizontal.** 📏 Forcing the laptop composition at 1024 gave 139 px columns: descriptions of up to 6 lines in a ~123 px measure, connectors of 20–71 px, and one "never" line crossing into the next column (capture `X-spine-horizontal-forced-1024`). At 768 four words overflowed their columns and the page overflowed by 6 px. A horizontal sequence at 1024 would also need a breakpoint below the locked `layout.breakpoint.laptop` (1096 px): a new token, which this patch may not create. **Judged not legible; reported rather than forced.**

📏 **Rendered QA** (`p42-patch-review.mjs`: real `/`, viewport screenshots only, measured before each capture):

| | 1440 | 1024 | 768 | 375 (coarse pointer, no hover, asserted) |
|---|---|---|---|---|
| transitions after a hero choice | `opacity:200ms` only | same | same | same |
| chosen input two frames after the choice | final claim colour; mark mid-fade | same | same | same |
| spine layout | horizontal phrase | stage rows | stage rows | vertical list |
| horizontal overflow · controls outside the viewport | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| control heights | 24 / 32 px | 24 / 32 px | 24 / 32 px | 44 px |
| hover surface left after interaction | none | none | none | none |
| running animations at rest | 0 | 0 | 0 | 0 |
| console errors · failed requests | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 |
| keyboard | Space (question) and Enter (stage) worked | same | same | tap |

**Clipped content.** The one clipped element at every width is the verdict mark's visually hidden "Verdict: " prefix, which is intentional.

**Reduced motion.**

- `--lumi-motion-duration-reveal` = `0ms`.
- The final state was in place after two frames.
- The legacy global safety net (index.css) still stamps 0.01 ms on `color`, `border-color` and `background-color` changes; that is not a declared animation.

**Zoom proxies (640 / 320 px).** 0 overflow, and both controls work.

📏 **Performance.**

| | gzip | brotli |
|---|---|---|
| before Phase 4.2 | 299,071 B | 252,345 B |
| after the review patch | 300,532 B | 253,263 B |
| delta vs before 4.2 | **+1,461 B** | +918 B |
| delta vs the prototype | +135 B | — |

- **Dependencies:** none added.
- **All JS gzip:** 611,294 B against the 716,800 B budget.

**Known weaknesses, reviewed and not redesigned.**

| Weakness | Finding | Change |
|---|---|---|
| **A. Brightness gap** | The claim versus body step is still small (captures 02, 07). Selection stays legible because the mark, the "Reads" line, the question's rule and position carry it together. | none: no glow, no gold |
| **B. Tablet spine** | Resolved by the stage-row composition (captures 08, 09). | see Q-16 above |
| **C. Hero evidence density** | Four question groups remain readable at every width (captures 02–05). | no cards added, no relationship removed |

**Anti-convergence at 1440.**

- **Not a tab bar:** there is no rule under or over the words, no underline, no panel and no per-column hover fill. The hairlines join words into a sentence of the model, and the lit stage is marked beside its text, as evidence is in the hero.
- **Not a stepper:** there are no numbers, circles, checkmarks or progress fill.
- **Author self-assessment only** (Article 36); Omar reviews the captures.

**Captures.**

- **Hero:** 01 rest 1440 · 02 selected 1440 · 03 selected 1024 · 04 selected 768 · 05 selected 375
- **Spine:** 06 rest 1440 · 07 selected 1440 · 08 selected 1024 · 09 selected 768 · 10 selected 375
- **Reduced motion:** 11 hero selected · 12 spine selected
- **Q-16 evidence:** `X-spine-horizontal-forced-1024`, `-768`

**Still open.**

- Q-15: copy review of the never-lines and the other new strings.
- Q-8: whether the first shipped motion needs a motion review gate.
- No screen reader session and no axe run.

### 18.15 Final review gate (2026-09-15): Q-15 BLOCKED · Q-8 CLOSED

**Rule applied.** Code truth outranks documentation. A "Never" line that the current code does not prove is **reported, not rewritten** (final-gate brief §4). No copy was changed in this pass; the proposals below need a ruling.

#### Q-15 — copy review of every Phase 4.2 string

📏 Each string was checked against source, not against governance prose.

| # | String | Verdict | Evidence |
|---|---|---|---|
| H1 | "From what the platforms report to one call — and which of it mattered." | PASS | describes the interaction, claims nothing about data |
| H2 | "What LUMI asks of it — choose a question" | PASS | an invitation; no claim that anyone chose (default selection 📏 tested) |
| H3 | "The grounds for this call" | PASS | return and frequency are exactly the KILL predicate, `verdictEngine.js:387` |
| H4 | "Checked before any call" | **CONCERN (overclaim, approved in Q-11)** | impressions: true, gate 1 `:290` runs before every verdict. **Revenue: false as worded.** Gates 1 and 2 (`:290`, `:305`) return a WATCH call *before* `revenueMeasured` is tested at `:358`. Candidate: "Checked first" (both precede the grounds at `:387`) |
| H5 | "Has it been shown enough times to judge?" | PASS | impressions are times shown; gate 1 is the minimum sample |
| H6 | "Yes — enough impressions for any call to be made." | **CONCERN (minor)** | passing gate 1 does not by itself allow a call (gate 2, days running, `:305`). Candidate: "Yes — enough impressions to judge it." |
| H7 | "Reads: Spend and Conversion value" / "Reads: Frequency" / "Reads: Impressions" | PASS | `:156`, `:174`, `:290`, `:387`; states what the question reads, not that others went uncomputed |
| H8 | "Did not decide this call: Clicks, Click-through rate, Conversions and Campaign objective." | PASS | computed (diagnosis, funnel, benchmarks, confidence) but absent from the KILL predicate. The relative CTR-rank KILL (`relativeRanking.js:128-137`) excludes campaigns with measured revenue, and this campaign has it |
| S1 | Data: "Never a zero standing in for a number no platform reported." | **FAIL (false in code)** | `aggregateMetrics` defaults absent impressions, clicks, conversions and frequency to `0` (`verdictEngine.js:116-121`); `toSignalInput` sets `frequency: agg.frequency ?? 0` (`:161`) and CTR `0` when impressions are 0 (`:158`). Google reports frequency as `null` (`googleNormalize.js:89`), which the engine turns into `0` and compares with the fatigue ceiling |
| S2 | Evidence: "Never a measurement without the window it was taken over." | **FAIL (not provable)** | the operational read population includes `MEASUREMENT_WINDOW.LEGACY_UNKNOWN` (`connectorTypes.js:74-77`). The locked display rule (B8-01 L-6) is enforced only by the LUMI `Measurement` part, which no authenticated surface imports yet (only `pages/LandingPage.jsx` imports `src/lumi`) |
| S3 | Verdict: "Never an action by itself. Not every verdict has one." | PASS | every sweep writes PROPOSED decisions ("never auto-executes": `VerdictService.js:349`, `GuardrailSweepService.js:7`, `AgenticLoopService.js:355`); `executionRequest.create` exists only in user-invoked routes `routes/execution/meta.js:198` and `retry.js:185` |
| S4 | Decision: "Never rewritten when a later assessment disagrees." | **CONCERN (precision)** | on a changed call a NEW decision is created and the old row IS updated (status `SUPERSEDED`, `resolvedAt`, `resolution`, `confidenceDelta`; `VerdictService.js:86-99`, "WRITES OUTCOME, NEVER REASONING"). Its verdict, diagnosis and hypotheses are untouched. Candidate: "Its call and reasons are never rewritten when a later assessment disagrees." |
| S5 | Action: "Never carried out before you confirm it." | PASS | same evidence as S3 |
| S6 | Outcome: "Never claimed before it was measured." | **FAIL (not provable)** | 📏 traced in source, not reproduced by a test: a superseded decision's `resolution` is computed from `signalInput.ctr` (`VerdictService.js:40-43`, `:147`), which is `0` when impressions are 0 (`verdictEngine.js:158`). `computeResolution` accepts `0` as a real reading (`decisionLifecycle.js:60`, `:82`), so a superseded KILL (an engagement verdict, `:53`) can be recorded `WORSENED` from a CTR that was never measured |
| S7 | Memory: "Never changes a verdict. It makes LUMI more or less confident." | **CONCERN (precision)** | `memoryDecisionFacts` changes only confidence (`memoryProvenance.js:58-103`). When memory is not consulted, or its factor is 1, it changes nothing, so "makes" overclaims. Phase 4's approved wording said "can". Candidate: "Never changes a verdict. It can make LUMI more or less confident." |

**Also checked, all pass:**

- no copy implies the default selection was made by the reader (📏 tested);
- no generic AI or SaaS language;
- no string implies execution;
- the current-assessment / stored-decision / evidence / action distinctions hold.

**Outside the Phase 4.2 strings, reported and not changed.**

- **Phase 4 #verdicts KILL row.** It states only the absolute predicate. `relativeRanking.js` also issues KILL to no-revenue campaigns in the bottom CTR quartile of a cohort.
- **Phase 4 Outcome description** ("What was measured after acting — or why it could not be.") is exposed to the same zero path as S6.

**Candidates for S1, S2 and S6 need a ruling, not a wording tweak.** Each changes what the line claims.

- **S1:** "Never judges return on revenue no platform reported." Provable: `roas` is null unless revenue and spend are both > 0 (`:156`, `:174`), and the return branch requires `revenueMeasured` (`:358`, `:387`).
- **S2 and S6:** no provable replacement was verified in this pass. The options are to drop the line, or to fix the backend so the claim becomes true (frozen; needs authorisation).

#### Q-8 — motion review gate: CLOSED

| Requirement | Evidence |
|---|---|
| no motion at initial rest | 📏 0 running animations at 1440 / 1024 / 768 / 375; the landing CSS and both components declare no animation or keyframes (📏 tested) |
| text brightness never transitions | 📏 after a choice the only transition is `opacity:200ms`; text is at its final colour two frames after the click; exactly one `transition` declaration in the landing CSS (📏 tested) |
| only the mark fades, ≤ 200 ms | `opacity` over `motion.duration.reveal` 200 ms; composited property (MO-6.5, REVIEW_GATE Q-9) |
| reduced motion | 📏 token `0ms` at every width; the final state is in place two frames after the click; the legacy index.css safety net stamps `0.01ms` (MO-7 keeps it) |
| no timer, auto-progression or non-determinism | 📏 tested with fake timers (60 s) and repeated selection; source has no timer, effect or scroll listener |
| verdict unchanged by a question | 📏 tested for every question |
| hard stops | none present: no autoplay, loop, scroll link, parallax, arrow motion, glow, pulse, shimmer, gradient, particle, orb, canvas, WebGL, Three.js or ThreeUI (source and dependency greps) |

**Motion rules satisfied.**

- MO-1: FEEDBACK only.
- MO-2.2 and MO-2.3.
- MO-4.2: opacity.
- MO-6.2: the spine never runs.
- MO-6.5: composited only.
- MO-7: declared reduction.
- MO-8: nothing forbidden.
- Constitution Article 24.

**Planted violations fail.** A colour transition, an interval timer, a CSS animation and a toggle-off selection were each planted; each was caught, then reverted.

**Final captures (viewport only, all four widths).** Hero rest, hero selected, spine rest, spine selected, and reduced motion for the hero and for the spine.

**Gate: PHASE 4.2 = BLOCKED** on Q-15 items S1, S2 and S6 (FAIL), with H4, H6, S4 and S7 recommended for correction in the same ruling.

### 18.16 Q-15 closure patch (2026-09-15): copy truth only

**Scope.** Omar ruled the copy. The landing copy changed; no backend, engine, lifecycle, measurement component, normaliser, schema or API was touched. Where this subsection and §18.15 disagree, this subsection governs.

| # | Before | After | Why it is true now |
|---|---|---|---|
| S1 Data | "Never a zero standing in for a number no platform reported." | **"Never judges return on revenue no platform reported."** | `roas` is null unless revenue and spend are both > 0 (`verdictEngine.js:156`, `:174`); the return branch is reachable only when `revenueMeasured` is true (`:358` routes the rest to the no-revenue track; `:387`). Pinned by a source test |
| S2 Evidence | "Never a measurement without the window it was taken over." | **removed, not replaced** | no universal window guarantee is provable (Finding B) |
| S6 Outcome | "Never claimed before it was measured." | **removed, not replaced** | the resolution path can score a zero-derived CTR (Finding C) |
| S4 Decision | "Never rewritten when a later assessment disagrees." | **"Its call and reasons are never rewritten when a later assessment disagrees."** | every `decision.update/updateMany` in `src/` writes only status, lifecycle, human or outcome fields (`VerdictService.js:89-96`, `:322`; `humanJudgment.js:144-151`, "verdict is deliberately absent"; `decisionSignalStamps.js:65`, `:138`; `decisionAttribution.js:111-114`; `GuardrailSweepService.js:201`; `PromotionService.js:303`). None writes `verdict`, `diagnosis`, `hypotheses` or `counterfactuals`; the only `upsert` is `prisma/seed.js`. A changed call creates a new row. The stored/current distinction is kept in the words "a later assessment" |
| S7 Memory | "…It makes LUMI more or less confident." | **"…It can make LUMI more or less confident."** | `memoryDecisionFacts` changes confidence only, and only when memory was consulted with a factor ≠ 1 (`memoryProvenance.js:65-95`) |
| H4 | "Checked before any call" | **"Checked first"** | both checks precede the grounds at `:387`; gates 1–2 (`:290`, `:305`) can call WATCH before revenue is checked at `:358` |
| H6 | "Yes — enough impressions for any call to be made." | **"Yes — enough impressions to judge it."** | impressions pass gate 1; they are not the only condition (gate 2 `:305`) |

**Verified unchanged:**

- **Behaviour:** hero mappings, the impressions gate, verdict behaviour, the seven spine stages and their order, the NOW / stored distinction, execution semantics, memory and outcome semantics.
- **Figures and motion:** no numbers; no JavaScript behaviour added (a stage without a never-line simply renders one paragraph); motion tests unchanged and passing.
- **Planted regression:** re-adding the S2 line fails two tests.

📏 **Rendered check (1440 / 1024 / 768 / 375, viewport screenshots).**

- **Layout:** 0 overflow, 0 controls outside the viewport, 0 console errors.
- **Motion:** the only transition after a choice is `opacity:200ms`.
- **Removed lines:** the Evidence and Outcome stages end after their description. At 1440 the columns keep their top alignment and simply end sooner; at 768 and 375 the rows are shorter.
- **Layout change:** no gap artefact, so no spacing or typographic adjustment was needed or made.
- **Tab-bar resemblance:** unchanged.

**Not changed, reported earlier (§18.15), outside the Phase 4.2 strings:**

- the Phase 4 #verdicts KILL row omits the relative CTR-rank KILL;
- the Phase 4 Outcome description sits on the path of Finding C.

#### Backend integrity findings (recorded, not repaired; backend frozen)

📏 **Method.** Severity is judged from code reading only. No production data was queried and no test reproduces the paths, so the reachability statements below are traced, not measured.

**Finding A — absent delivery metrics become zero before the verdict engine judges them**

| | |
|---|---|
| Severity | **MEDIUM** (systematic for one channel; errs toward *not* calling, never toward fabricating a KILL) |
| Module | connector verdict tree → verdict engine |
| Location | `src/services/verdict-engine/connectorVerdictService.js:114-123` (`toLeafMetrics`: `impressions`, `clicks`, `conversions`, `frequency` `?? 0`); `verdictEngine.js:116-121` (`aggregateMetrics` leaf `?? 0`), `:135-136`, `:148-161` (`toSignalInput`: `frequency: agg.frequency ?? 0`, CTR `0` when impressions are 0) |
| Observed | Google Ads reports no frequency, and normalisation correctly stores `null` (`googleNormalize.js:89`; typedef "null where the platform has no equivalent", `ChannelConnector.js:35`). The verdict path converts that `null` to `0` and compares it with the fatigue ceiling. Impressions, clicks and conversions are required numbers in the connector contract, so their `?? 0` affects only rows that break it |
| Expected | an unreported metric stays unmeasured through judgement, and a condition that needs it declines, stating why (B8-02: absence is a measured state; R-4 UNKNOWN ≠ HEALTHY) |
| Evidence | the lines above. My search found no test stating that a `null` frequency should be judged as `0`; `canonicalVerdictEvidence.test.js:247` covers evidence eligibility only |
| Impact | for every Google Ads campaign the fatigue conditions can never fire: KILL (`:387`), and REFRESH / WATCH saturation on the no-revenue track (`:374`, `:377`). A money-losing Google campaign with measured revenue can therefore never reach the absolute KILL, and no verdict field I traced says fatigue went unmeasured (the client disclosure path was not verified) |
| Why it matters | LUMI's central promise is that absence is never read as a value. Here "not reported" behaves as "not fatigued" |
| Recommended action | rule how an unmeasured fatigue dimension affects and discloses a verdict; then make the engine carry `null` and decline the fatigue conditions with a stated reason, pinned by a Google fixture |
| Classification | **PRODUCT RULING** (the fix changes which Google campaigns can be called KILL / REFRESH / WATCH), then FIX |

**Finding B — rows with an unknown measurement window are read in normal operation**

| | |
|---|---|
| Severity | **LOW** (deliberate and documented; verdicts and budget comparisons already guarded) |
| Module | connector measurement populations |
| Location | `src/services/connectors/connectorTypes.js:38-43` (`MEASUREMENT_WINDOW.LEGACY_UNKNOWN`), `:70-77` (`OPERATIONAL_MEASUREMENT_WINDOWS` includes it) |
| Observed | operational readers consume `LEGACY_UNKNOWN` rows: every pre-Phase-C row and every ACTUAL-revenue row (GA4 / MANUAL). The comment at `:70-73` states that dropping it "would blank actual revenue everywhere" |
| Expected (locked display rule) | a figure shown to a person carries its window (B8-01 L-6), or says the window is unknown |
| Evidence | the lines above. Verdicts are decided on `CUMULATIVE_30D` only (`canonicalVerdictEvidence.js:66-73`, an `equals` filter, not the allow-list). Spend-to-budget comparisons require a matching window (Spend-Window Integrity, PR #474) |
| Impact | blended-truth, overlay and actual-revenue figures carry no established period. The LUMI `Measurement` part (which refuses a figure without a window) cannot render them truthfully when authenticated surfaces migrate in Phase 5 |
| Why it matters | a figure without its period invites comparison across different periods, which is the defect class of Phase F and PR #474 |
| Recommended action | give ACTUAL-revenue rows a declared window at ingestion; decide whether legacy rows are backfilled, labelled "window unknown" or retired; do this before the first migrated surface renders them |
| Classification | **PROJECT** (with a display ruling for unknown-window figures) |

**Finding C — outcome resolution can score a zero-derived CTR as a real reading**

| | |
|---|---|
| Severity | **LOW** reachability, **persistent** consequence (traced, not reproduced) |
| Module | decision lifecycle (supersede → resolution) |
| Location | `src/services/verdict-engine/VerdictService.js:40-43` (`nodeMetrics` = `signalInput.ctr`), `:147`, `:89-96` (`resolution: computeResolution(...)`); `decisionLifecycle.js:53` (KILL / REALLOCATE / REFRESH scored on CTR), `:60` (`real` = any finite number, so `0` counts), `:82`; `verdictEngine.js:158` (CTR `0` when impressions are 0) |
| Observed | the path needs a campaign that stays eligible (measured revenue and spend > 0, `connectorVerdictService.js:74-78`, `:139`) with zero or missing impressions (missing → `0` at `:118`), whose call changes from an engagement verdict. Its before-CTR is > 0 and its now-CTR is `0`, so the ratio is 0 and the row is written `WORSENED` |
| Expected | `computeResolution`'s own contract: "no current reading … none of these are scoreable" → `UNKNOWN` |
| Evidence | the lines above |
| Impact | `resolution` is published on the decision detail read (`decisionDetail.js:139`, `:181`), carried into decision history context (`decisionHistory.js:99`, `:177`), and counted in learning tallies (`decisionLearning.js:117`, `:161-163`). One false `WORSENED` becomes a lasting record and a learning input |
| Why it matters | Decision Memory's credibility depends on outcomes being measured, not inferred from absent delivery |
| Recommended action | at the resolution boundary, treat CTR as unmeasured when impressions are 0 or absent (so `UNKNOWN`), with a RED test for the traced path first |
| Classification | **FIX** |

**Gate.** Q-15 = CLOSED · Q-8 = CLOSED → **PHASE 4.2 = READY FOR MERGE REVIEW** (not merged, not committed).

### 18.17 Merge review approval (2026-09-15) and backend finding priority

**Approved by Omar for merge review.** The decisions below are final:

- **Copy:** S1 uses the narrower, provable wording; S2 and S6 are removed; H4 is "Checked first"; H6 is "Yes — enough impressions to judge it."; S4 keeps the stored call and its reasons distinct; S7 says "can".
- **Resting state:** default selections are presentation-only.
- **Motion:** text state changes are instant; only the selection mark fades, and reduced motion removes that fade.
- **Spine layout:** horizontal at 1440; one row per stage at 1024 and 768; a vertical list at 375. No tab semantics.
- **Hard exclusions:** no ThreeUI, Three.js or WebGL; no new dependencies; no fabricated numbers.

**Findings A, B and C are backend integrity findings, NOT part of the Phase 4.2 implementation.** They are kept at the severity and classification recorded in §18.16 and are not downgraded by this approval. Their future priority:

| Priority | Finding | Classification | Why this order | Expected future direction | Constraint |
|---|---|---|---|---|---|
| 1 | **C** — outcome scoring from a zero-derived CTR | **FIX** | a false `WORSENED` enters decision detail, decision history and learning tallies; **Decision Memory would learn from evidence that was never measured** | zero or missing impressions produce `UNKNOWN`, never a real CTR reading, for outcome comparison | **a failing regression test precedes the fix** |
| 2 | **A** — an unreported metric becomes `0` | **PRODUCT RULING before implementation** | "missing measurement → measured-looking value" in the decision engine; must be resolved before the product truth layer is considered complete | a missing metric stays unmeasured, and dependent rules decline with an explicit reason | changing it changes KILL / REFRESH / WATCH eligibility (all Google Ads campaigns), so the ruling comes first |
| 3 | **B** — unknown measurement window | **PROJECT** | lower urgency; verdicts and budget comparisons are already guarded | declare the measurement window at ingestion where possible; define display behaviour for legacy unknown-window revenue; schedule with the Phase 5 measurement surfaces | **do not break current actual-revenue ingestion** to satisfy landing copy |

**Out of scope for Phase 4.2**, and not to be edited by it: `verdictEngine.js`, `connectorVerdictService.js`, `connectorTypes.js`, `VerdictService.js`, `decisionLifecycle.js`, canonical evidence, the measurement pipeline and the database schema.
