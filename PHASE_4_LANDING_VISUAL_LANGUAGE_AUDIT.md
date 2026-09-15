# PHASE 4 — LANDING + VISUAL LANGUAGE AUDIT

```text
Status     READY FOR REVIEW — Final Review Gate (§24) under Omar's temporary bundle-cost ruling;
           ⚠️ post-PR CI correction in §25 changes the measured first load (needs Omar's acknowledgement);
           original gate in §22; remediation pass in §23
           (Stages A–B written before implementation; C–K after; §23 after the remediation spec)
Branch     feat/lumi-landing (new; from origin/master b35d22e)
Base       b35d22e — "LUMI primitives and grammar parts (Phase 3) (#477)"
Date       2026-09-15
Author     Claude Code. Author self-assessment is never approval (Constitution Article 36).
```

---

## 1. Scope

**In scope:**

- the public landing page served at `/`;
- its visual language (composition, light, space, signal, type use, motion);
- its SEO metadata;
- its responsive, accessibility and performance review.

**Out of scope, and untouched:**

- backend, API, routes and permissions;
- the app shell and every authenticated surface;
- legacy token values;
- ThreeUI, Three.js and WebGL;
- Phase 5.

### Baseline correction (recorded, not silent)

The Phase 4 brief names `feat/lumi-primitives @ 9872525` as the baseline. At start:

- `feat/lumi-primitives` was at `b8936f1`, the Phase 3 commit;
- PR #477 had merged as squash `b35d22e`;
- `origin/master` was `b35d22e`.

📏 The trees are identical: `b35d22e^{tree}` = `b8936f1^{tree}` = `eab7a975…`. The FC-19 content was read from `origin/master:client/src/lumi/primitives/controls.module.css` by content, not by badge.

Working on the merged, squashed branch would have stacked Phase 4 on a branch master no longer has (CLAUDE.md PR Base Rule). Phase 4 therefore runs on a new branch `feat/lumi-landing`, cut from `origin/master`. Its upstream is unset, so a stray `git push` cannot target master.

## 2. Authority sources read

In authority order (README §2; CLAUDE.md Authority):

1. **Product truth**
   - PR-1…PR-13 (`design-governance/README.md` §3);
   - backend code where a landing claim depends on it:
     - `src/services/verdict-engine/verdictEngine.js:354-474`
     - `src/services/verdict-engine/verdictTypes.js:54-65`
     - `src/services/execution/decisionExecutability.js`
     - `src/services/connectors/connectorRegistry.js`
2. **Design authority**
   - `LUMI_DESIGN_CONSTITUTION.md` (Articles 1–37, Appendix A / A.1 including FC-18);
   - `PRODUCT_GRAMMAR.md`, `VISUAL_BOUNDARIES.md`, `REFERENCE_POLICY.md`, `COMPONENT_RULES.md`, `STATE_RULES.md`, `MOTION_RULES.md`, `ANTI_CONVERGENCE.md`, `REVIEW_GATE.md`;
   - `DESIGN_TOKEN_ARCHITECTURE.md`.
3. **Master Build Spec** — `LUMI_DESIGN_SYSTEM_MASTER_BUILD_SPEC.md`, read in full.
4. **Brand assets** — `design-governance/brand/`. The logo "01 / Current Base" is **SOURCE REQUIRED**.
5. **Phase 3** — `PHASE_3_PRIMITIVE_AUDIT.md` and `client/src/lumi/README.md`.

Two corrections to the brief's list:

- `DESIGN_TOKEN_ARCHITECTURE.md` lives at the repository root, not in `design-governance/`.
- Spec Rule 4, §12 and §39 ("the existing landing page is the visual baseline", preserve the hero line "Know what to do next. After every sync.") are **overruled by 🔒 FC-12**: the reset wins, the legacy landing is implementation rather than visual authority, and reusing its copy needs an explicit ruling. No legacy landing copy is carried over.

## 3. Current landing audit (Stage A)

### A. Route and implementation

- `/` → `client/src/App.jsx:153` `<LandingPage />`, which is `client/src/pages/LandingPage.jsx`, a re-export of `pages/LandingPage/index.jsx`.
- The page is 8 section modules, a nav and a footer, written in legacy Tailwind classes.
- `ScreenshotGallery.jsx` is **not imported** by the page; it is dead, with only its own test.
- 📏 **The landing renders only after Firebase auth resolves.** `App.jsx:145` returns `AuthLoadingScreen` while `authLoading`, and the landing sits inside that gate.

### B. Information architecture (📏 rendered heading outline, 1440 px)

```text
H1 Know what to do next. After every sync.
H2 From signal to action.
H2 Used by performance marketers who are tired of staring at dashboards.
H2 Every campaign gets a verdict. Not another metric.  (H3 ×6 capability cards)
H2 Why Lumi said KILL
H2 From connect to first verdict — in minutes.          (H3 ×3 steps)
H2 Built for every stage.                               (H3 ×3 pricing tiers)
H2 Get your first verdict in under 2 minutes.
```

📏 **No `<main>` landmark** (0 found), re-confirming audit §20. The skeleton is hero → loop → proof strip → capability card grid → timeline → 3 steps → pricing trio → CTA. That is ANTI_CONVERGENCE F-10, the generic marketing structure.

### C. Copy — every claim classified

| Legacy claim | Location | Status |
|---|---|---|
| "Always watching", "watches your account around the clock", "Lumi starts watching immediately", "Start watching" | `FeaturesSection.jsx:41,89,134`, `CTASection.jsx:20` | **Forbidden** (Constitution Article 30; AC F-11) |
| "Ask anything… Real answers from live data — in seconds" + NEW badge | `FeaturesSection.jsx:51-55` | **Forbidden** (chat-first capability; PR-8; CMP-07 "NEW") |
| "Ask Lumi — account-aware Copilot" as a Free feature | `PricingSection.jsx:17` | **False.** `/app/copilot` is the "Coming soon" page (PR-8) |
| "94%" confidence, "CTR ↓ 42%", "14 minutes" next sync, "CTR at 1.8%", "0.9%", "0.48%", "Frequency 7.1", "CPA increased 31%", "12 days" | `HeroSection.jsx:135,145,165`; `WhyKillSection.jsx:8-11,62,77-79` | **Fabricated figures, not labelled** (PR-7 / Article 28). The hero code comment says "the numbers are an example"; the page does not. |
| "$0 / $49 / $149" | `PricingSection.jsx:11,27,44` | **Unverified.** No billing provider or price source exists in `src/` (📏 no Stripe, Paddle or checkout integration; "checkout" matches are funnel stages only) |
| "Connects in under 2 minutes", "OAuth in 2 minutes" | `SocialProofSection.jsx:12`, `FeaturesSection.jsx:9,133` | **Unmeasured** |
| "Built for MENA… EGP · SAR · AED native", "early access across Egypt, Saudi Arabia, and UAE" | `HeroSection.jsx:32`, `SocialProofSection.jsx:26`, footer | **No governing ruling.** Market focus is not in PR-1…PR-13; not carried over, listed as an open item |
| "Lumi learns from every verdict. Gets sharper over time." | `FeaturesSection.jsx:14` | **Contradicts Constitution R-1** (memory adjusts confidence, never the verdict) |
| "Performance improves" as the loop's terminal node | `SignalToActionSection.jsx:13` | **Implied causation** (PRODUCT_GRAMMAR §7 OUTCOME) |
| `index.html` title "AI Marketing Decision Engine", og "Replace marketing consultants with always-on AI strategic intelligence" | `client/index.html:8-11` | **Forbidden positioning** ("AI" framing; "always-on") |

### D. Assets

- There is **no `client/public/` directory.** No image, favicon, OG image, robots.txt or sitemap ships.
- The gallery's `/screenshots/*.png` are 404s by design.

### E. Logo

- **Not available** (FC-10; `brand/README.md` SOURCE REQUIRED).
- The legacy "concentric ring + dot" `BrandMark` (`index.jsx:140-165`) is **not** the approved "01 / Current Base". It is a legacy invention, and it carries `shadow-gold-glow` (VB-F9).

### F–G. Phase 3 primitives and Phase 2 tokens available

- **Primitives:** Environment (`marketing` · `marketing-dark-section`), Surface, Stack, Inline, Rule, Text, Heading (`brand` 48 / 56 is marketing-only), VisuallyHidden, Icon, Announcement, Button, IconButton, TextLink, fields.
- **Grammar parts:** VerdictMark (Charcoal only), TenseLabel, AgreementNote, DecisionIdentity, Spine, SpineStage, ClaimState, EvidenceGroup, Measurement, Money, ActionControl.
- **Tokens:**
  - type sizes 12 · 14 · 16 · 20 · 24 · 48, where the largest display is 48 / 56;
  - the environment colours;
  - spacing tiers 4 · 8 · 16 · 32 · 64;
  - layout widths 640 · 360 · 1280;
  - motion durations 100 · 200 · 240 · 400 ms, reduced to 0.
- **Already in production CSS:** `client/src/index.css:28` imports `generated/tokens.css`, so the landing adds no token stylesheet.

### H. Responsive (📏 rendered)

| Width | Horizontal overflow | Page height |
|---|---|---|
| 1440 | none | 6,591 px |
| 375 | none | 10,638 px |

📏 **Content hidden behind reveal animations.**

- `useReveal` starts sections at `opacity-0` and shows them only after an IntersectionObserver fires.
- In a full-page capture the "From signal to action" flow, the six capability cards, the KILL timeline and the three steps render as **blank space** (`client/lumi-landing-review/legacy-landing-1440-full-baseline.png`).
- This breaks MO-2 §2 ("content is readable at the first frame") and leaves the content invisible when the observer does not fire.

### I. Performance (📏 production build at base `b35d22e`)

Instrument: `vite build`, then gzip level 9 and brotli quality 11 over exactly the files `dist/index.html` references.

| First-load file | raw B | gzip B | brotli B |
|---|---|---|---|
| `index-*.js` (entry) | 584,224 | 164,714 | 135,959 |
| `vendor-react-*.js` | 179,878 | 59,034 | 51,841 |
| `vendor-firebase-*.js` | 166,042 | 33,710 | 28,634 |
| `index-*.css` | 114,354 | 29,878 | 26,211 |
| **Total** | **1,044,498** | **287,336** | **242,645** |

The landing still downloads the authenticated application (Article 26 §1; audit P0-70). Fonts are extra and requested on use:

- Inter 400 / 500 / 600;
- Space Grotesk 400 / 500 / 600 / 700;
- JetBrains Mono 400 / 500.

### J. SEO and metadata

- **Static only**, from `client/index.html`: `title`, `description`, `og:title`, `og:description`, `og:type`, `theme-color`, and `canonical` `https://lumi.marcomai.com/`.
- **Missing:** `og:url`, `og:site_name`, `twitter:card`, and any image.
- The copy is forbidden (§C).
- The body is client-rendered (SPA); no SSR or prerender exists.

### K. Analytics and conversion events

📏 **None on the landing.**

- `client/src/lib/telemetry.ts` is an in-memory / localStorage ring buffer "for UI v2 migration monitoring", with no destination.
- No analytics provider is present in the client.
- There is nothing to preserve, and adding one is a product and privacy decision, not a design one.

### L. ThreeUI / Three.js / WebGL

📏 No `three`, `@react-three/*`, `@designcodeio/threeui`, WebGL context or shader exists in `client/package.json` or `client/src`.

### M. Patterns that must be removed (VISUAL_BOUNDARIES / MOTION_RULES findings)

| Finding | Location | Rule |
|---|---|---|
| Blurred gold radial "blob" | `HeroSection.jsx:18-24` | VB-F8, VB-F9, AC-4 |
| Masked radial dot-grid wallpaper | `HeroSection.jsx:8-16` | VB-F14, Article 14 §5 |
| Pulsing gold dot in the eyebrow pill; pulsing "next sync" dot | `HeroSection.jsx:30,164` | MO-8 liveness theatre, VB-F1 |
| Card floating on an infinite 8 s loop | `HeroSection.jsx:103` | MO-8 continuous animation |
| `shadow-gold-glow`, `shadow-accent-glow`, gold box-shadow on the demo | `HeroSection.jsx:59,104`; `PricingSection.jsx:85,140`; `CTASection.jsx:18`; `SocialProofSection.jsx:45`; `index.jsx:153,208` | VB-F9 |
| `backdrop-blur-xl` sticky header | `index.jsx:54-55` | VB-F3 glass |
| `Sparkles` and `Brain` icons | `FeaturesSection.jsx:1,13-14` | Article 22, VB-F6 |
| Verdict colour as text and fill (`text-signal-kill`, `bg-signal-kill/10` card); window-chrome traffic lights in verdict colours | `HeroSection.jsx:109-111,130`; `WhyKillSection.jsx:56-69` | CMP-09 §3–4, §7 |
| Gold used as a button fill, the badge colour, text on Off White, and every icon | throughout | CMP-08 |
| Capability card grid; pricing trio with a scaled "Most Popular" card | `FeaturesSection.jsx`, `PricingSection.jsx` | VB-F13, AC-2 / F-10 |
| `rounded-2xl` / `rounded-3xl` containers | throughout | Article 19 |
| Legacy weights 700 / 800 (`font-bold`, `font-extrabold`) | throughout | Article 20 roles |
| 9 px, 10 px and 11 px text (`text-[9px]`, `text-[10px]`, `text-[11px]`) | throughout | Article 20 §5 legibility floor |
| Sections hidden at `opacity-0` until scrolled | `useReveal.js` consumers | MO-2 §2 |

## 4. Visual language decisions (Stage B proposal, as implemented)

### 4.1 Principle — illumination is the composition

The page is built on one mechanism that no generic product carries: **the amount of light an element receives is how much it matters to the call** (Article 11). It is applied at page scale, not only inside components.

- **Complexity is present but unlit.** Raw inputs are listed in `text.meta` light, many and quiet.
- **Evidence is half-lit.** Questions asked of the data are in `text.body` light, fewer.
- **The call is fully lit.** One verdict word and one sentence are in `text.claim` light, the brightest thing in the region, with the most space around it.

Reading order becomes a gradient of light over **structure that is always present**. That is "LIGHT REVEALS WHAT MATTERS" as behaviour, with no picture of light, no glow and no gradient.

### 4.2 Structure

- **One reading axis per region, drawn as hairline rules.** Each rule is the Decision Spine's own axis or an alignment rule between real columns (Article 18).
- **No bordered containers** except CMP-04 objects: one belief, the action group, and one failed region.
- **No card grid, no pills, no background texture.**

### 4.3 Negative space

- Regions are separated by `space.macro` (64 px) and sections by `space.section` (32 px); these are doubled on wide layouts by stacking tiers, never by a raw length.
- The hero statement is set in the widest empty field on the page.

### 4.4 Light / dark strategy (🔒 PR-9)

- The page ground is **Off White** (`marketing`).
- **Charcoal bands** (`marketing-dark-section`) appear **only where the product is expressed**:
  1. the hero demonstration (DATA → EVIDENCE → VERDICT);
  2. one continuous product band carrying the six verdicts and the Decision Spine.
- Every verdict mark sits inside a Charcoal band (📏 Gold 2.21 : 1 and HOLD 2.95 : 1 on Off White).
- No stripe exists for rhythm alone (VISUAL_BOUNDARIES §4).

### 4.5 Signal

- **Verdict colour** appears only as the square mark beside a verdict word, inside Charcoal (CMP-09).
- **Gold** is not used by the page at all:
  - the approved mark is unavailable, so there is no logo gold;
  - REALLOCATE's mark is the verdict token, not brand gold;
  - there is no attention item on a marketing page, so `color.signal.attention` stays unconsumed.
- CTAs are neutral controls (CMP-08): a CTA's strength comes from position and space, not from a gold fill.

### 4.6 Typography — within the locked roles

| Use | Role |
|---|---|
| H1 | `Heading brand` — Space Grotesk 48 / 56 |
| Section titles | `Heading surface` — Space Grotesk 24 / 32 |
| Lead sentences | `Text claim` — Inter 16 / 24 / 600, the decision sentence role |
| Prose | `Text body` — 14 / 20 |
| Windows, labels, illustrative notices | `Text caption` — 12 / 16 |
| Identifiers | JetBrains Mono |

- No new size, weight or family.
- **Constraint recorded as an open item (§21):** the locked scale has no marketing lead size between 16 and 24, and no display step above 48. Any change is a Phase 2 token ruling, not a landing choice.

### 4.7 Motion

- **Decision: the page is at rest.**
- Motion is limited to control feedback (100 ms, survives reduced motion) through the Phase 3 primitives.
- The decision flow is told by **spatial order and light**, not by time. See §11.

### 4.8 One new generic primitive — `ActionLink` (justified against CMP-01)

| CMP-01 test | Answer |
|---|---|
| Expresses a token category, no product meaning | Yes: the control category (border, prominence, focus ring, target size) applied to a **link** element. No verdict, decision or plan knowledge. |
| At least two consumers with the same behaviour | The landing's account CTAs ("Create an account", "Sign in", "See a verdict and its grounds"), and every product step that navigates to another address while carrying a control's weight (Attention → a Decision's own destination, PRODUCT_GRAMMAR.md §9). |
| Accessibility contract before visuals | Native `<a>` / router `Link`; name from the visible label; the one neutral focus ring; `size.target.minimum`, `size.target.touch` under a coarse pointer. |
| No data fetching or state logic | None. |

**Why an existing part could not do it.**

- `Button` has no address: it cannot open in a new tab, and assistive technology and crawlers do not read it as a link.
- `TextLink` is sentence-level navigation: always underlined, no target size of its own. Measured on the landing, a standalone `TextLink` beside a CTA was a **17 px tall** target on a 375 px touch viewport (§12).

**No second look.** `ActionLink` uses the Phase 3 `controls.module.css` classes. 📏 The test asserts that its class list is identical to `Button`'s for the same prominence.

### 4.9 Deviations from the Stage B proposal (found in rendered review)

| Proposal | Implemented | Why |
|---|---|---|
| Section links always in the header | Hidden below 688 px; repeated in the footer at every width | At 375 px the links took three rows (≈ 180 px) of the first screen (📏 capture v2-375). They are in-page anchors, not capabilities, and stay reachable (Article 25) |
| Standalone text links beside CTAs | `ActionLink quiet` | 17 px targets under a coarse pointer (§12); FC-19 quiet affordance |
| Section padding `2 × space.macro` on wide layouts | `1.5 × space.macro` for sections; the hero at `space.macro` | 256 px between consecutive Off White sections diluted grouping. At `2 × macro` the hero demonstration began below the first 1440 × 900 screen (📏 KILL at y ≈ 800; now the whole demonstration fits) |
| Repeated column captions in ledger rows | One header row once columns sit side by side; captions inside rows only when rows stack | Captions repeated on every desktop row (📏 capture v1-1440-difference) |
| DATA inputs as a column at every width | A wrapping run of words below 1096 px | A 400 px-tall column of eight single words on a phone (📏 capture v2-375-demo) |
### 4.10 Anti-convergence reasoning

- **What makes the page identifiable without a logo:**
  - the page-scale illumination gradient;
  - verdict word + square mark in Charcoal bands;
  - tense labels (NOW / AT DECISION) and a divergence named in words;
  - absences stated as states;
  - the model drawn as a spine, not as feature cards.
- **What it refuses:** the hero-plus-card-grid skeleton, product-window chrome, the chat box, the KPI strip and the pricing trio.

## 5. Information architecture (as implemented)

| # | Brief question | Section | Ground | EXPLAIN / PROVE / CONVERT |
|---|---|---|---|---|
| 1 | What is LUMI? | Hero — "Verdicts. Not dashboards." + CTA | Off White | explain, convert |
| 1b | — | Hero demonstration: DATA → EVIDENCE → VERDICT | Charcoal | prove (illustrative) |
| 2–3 | Why does it exist? What is wrong today? | The work between data and a decision | Off White | explain |
| 4 | How does LUMI think? | The model as one axis (Data → … → Memory), and what LUMI decides about: campaigns · budget · tests | Off White | explain |
| 5 | What does a verdict look like? | Six verdicts: word + mark, when LUMI calls it, what happens next (Verdict ≠ Action) | Charcoal | explain, prove |
| 6 | How does evidence become a decision? | A stored decision on the real Decision Spine, and today's assessment disagreeing in words | Charcoal (same band) | prove (illustrative) |
| 6b | Why trust it? | What LUMI says when it cannot know: real states | Off White | prove |
| 7 | How does decision memory compound? | Decision → Outcome → Memory → Next assessment, and one belief with its four facts | Off White | explain, prove (illustrative) |
| 8 | Why not a dashboard or an AI assistant? | A comparison of three ways of working, then objections as questions | Off White | explain |
| 9 | What does the user do next? | Start: create an account, connect an ad account | Off White | convert |

**Not built:**

- **Pricing** — no price source (§3C).
- **"Trusted by" / testimonials** — no real customers to name (VB §4).
- **Integrations logo grid** — connectors are stated in words (Meta Ads, Google Ads, Google Analytics 4; `connectorRegistry.js:19-23`).

## 6. Hero decision (as implemented)

- **H1:** "Verdicts. Not dashboards." (🔒 Article 4 positioning).
- **Lead:** a single sentence saying what LUMI does, in claim role.
- **Primary CTA:** create an account → `/signup`. **Secondary:** a text link to the evidence walkthrough.
- **Demonstration** (Charcoal band, directly under the statement): three ruled columns, reading in production order.

| Column | Light | Contents |
|---|---|---|
| DATA | `meta` | the inputs as words; **no figures** |
| EVIDENCE | `body` | the questions LUMI asks, each answered in words ("below break-even", "past the fatigue ceiling") |
| VERDICT | `claim` | `TenseLabel` NOW, `VerdictMark` KILL, one reason sentence |

- **Grounding:** KILL requires return below break-even **and** frequency past the fatigue ceiling (`verdictEngine.js:387-391`), so the illustration shows exactly those two grounds.
- **Tense:** a NOW assessment carries no action (PR-1), so none is shown.
- **Label:** the demonstration is labelled "Illustrative example" at readable size, adjacent to its content.

## 7. Product visualisation decisions (as implemented)

- **Real LUMI grammar parts, not screenshots or fake chrome.** The spec §13 asks for "actual product components". The demonstrations use `Spine`, `SpineStage`, `VerdictMark`, `TenseLabel`, `AgreementNote`, `DecisionIdentity`, `EvidenceGroup`, `ClaimState`, `Measurement` and `ActionControl` as the product renders them.
- **No window chrome, no browser frame, no device mockup** (VB §4).
- **No chart.** No visualisation passed Article 23's three questions for a marketing page with no account data.
- **Figures:**
  - none in the hero or the verdict list;
  - a figure appears only where the grammar requires one (tense clocks, one belief's counts);
  - each such figure sits under an adjacent "Illustrative example" label.
- **The only interactive product visual** is the illustrative decision's ActionControl. Activating it shows the confirmed state with the words "Illustrative example: nothing was sent to Meta", so the difference between "LUMI will do this" and "I did this" can be experienced (B8-03 invariant 9) without a fake success.

## 8. Decision Memory treatment (as implemented)

Decision Memory is presented as **institutional memory of decisions and outcomes**, never as AI or chat memory. The sequence is:

```text
DECISION ─ OUTCOME ─ MEMORY ─ NEXT ASSESSMENT
```

It is drawn on the same axis logic as the spine, with the constitutional edge stated in words: **memory adjusts confidence, never the verdict** (Constitution R-1).

**One illustrative belief** carries the four temporal facts C-14 / B8-05 publish:

- since when;
- how often tested;
- how often it held;
- what it replaced.

**Forbidden:** a chart of learning over time (B8-05), "gets smarter" claims, brain iconography (Article 22).

## 9. ThreeUI references considered

Source reviewed: the repository page `github.com/MengTo/threeui`.

- **What it is:** a React + Three.js / WebGL + shader component catalogue, package `@designcodeio/threeui`, which bundles the Three.js runtime.
- **Limit of the review:** the repository page does not enumerate its components by name. They are recorded here **at the category level stated by the source** (3D scenes, shader-based effects, interactive renderers), not as invented component names.

| Category | Idea extracted (RP-3 step 1, in words) | LUMI question: does it make the decision story clearer? |
|---|---|---|
| Shader light / volumetric light over a plane | "Light has a direction, and what it lands on is what matters." | The principle is kept. It is translated into the illumination hierarchy (§4.1): light is assigned by importance through text light steps, not rendered. |
| Spatial depth / 3D scene composition | "Depth separates foreground from background." | Rejected as a technique. LUMI does not model height (Article 11 §5); hierarchy is luminance and space. |
| Interactive renderers reacting to pointer | "The interface responds where attention is." | Rejected: a pointer-driven spotlight is VISUAL_BOUNDARIES §1's literal failure ("spotlight cursors, torch effects"). |
| Spatial transitions between states | "Continuity across a change of state." | Kept as a principle only (MO-6). Nothing on a marketing page changes state except the one illustrative action, which uses the primitive's feedback. |

## 10. ThreeUI items rejected, and why

- **Every runtime item is rejected.** No install, no import, no WebGL context, no shader.
  - **Performance:** the package bundles the Three.js runtime into a page whose first load is already 287,336 B gzip of an application it does not use (§3I), and a continuous WebGL canvas is a constant repaint (MO-8; audit P0-72).
  - **Governance:** a 3D or shader hero reads as generic premium-tech (spec "Do not turn this into: sci-fi … generic premium-tech imagery"; VB-F2, VB-F4). A glowing light volume is VB-F9 / VB-F12.
  - **Truth:** no 3D form expresses a grammar object. The answer to "how does this make the decision story clearer?" was "it would look impressive", which the brief defines as a rejection.
- **CSS / native alternative chosen:** the illumination hierarchy with the locked text light steps, and hairline structure. Zero dependencies.
- **AC result of the extraction:** a reviewer cannot identify ThreeUI in the result, because nothing visual was taken (RP-3 step 4).

## 11. Motion decisions (as implemented)

| Candidate | Decision | Reason |
|---|---|---|
| Scroll-triggered section reveals (legacy `useReveal`) | **Removed** | Content was invisible until the observer fired (📏 §3H); MO-2 §2; MO-8 scroll-linked motion |
| Hero "evidence resolving into a verdict" timed reveal | **Rejected** | Nothing arrives on a marketing page, so a timed light-up would simulate a computation that is not happening (MO-8 "thinking simulation"; MO-4 §1) |
| Floating demo card, pulsing dots | **Removed** | MO-8 continuous animation and liveness theatre |
| Smooth anchor scrolling | **Rejected** | Movement without information; orientation is kept by landing on the section's heading |
| Control hover, pressed and focus feedback | **Kept** | MO-5; `motion.duration.feedback` (100 ms) through Phase 3 primitives, reduced-motion safe |
| FAQ disclosure open / close | **Instant** | Native `<details>`; no transition |

---

# Stages C–K — implementation and rendered review

## 12. Responsive review (📏 rendered)

**Instrument.** Chromium through Playwright on the dev review entry `client/lumi-landing.html`. It renders the same `LandingPage` the `/` route renders, with the application's own `index.css`, fonts and `<html>` / `<body>` attributes (§19). Widths at 1440 and 1024 use a fine pointer; 375 uses `isMobile` + `hasTouch`, and `matchMedia('(pointer: coarse)')` was confirmed `true`. Captures are in `client/lumi-landing-review/`.

| Width | Horizontal overflow | Page height | Layout observed |
|---|---|---|---|
| 1440 | none | 8,274 px (v1; after fixes see full capture) | statement + full DATA → EVIDENCE → VERDICT demonstration in the first 900 px screen; model axis horizontal (7 stops); ledgers as columns with one header row; decision and assessment side by side |
| 1024 | none | 9,615 px | laptop breakpoint not reached (1096): demonstration stacks, ledger rows two-column where declared |
| 768 | none | 9,795 px | tablet gutter; page links shown; header wraps to two rows (brand + page links, then account links) |
| 375 | none | 11,445 px (v1) | page links move to the footer; DATA inputs wrap as a run of words; every ledger row stacks with its column captions; spines stay vertical |

**Issues found and fixed in review** (each seen in a capture before it was changed):

1. **Hero demonstration lost its frame at 1440.** The `figure` margin reset also cleared `margin-inline: auto`, so content started at x = 32 px instead of the 112 px page edge. Fixed: `.demo { margin-block: 0 }`.
2. **Demonstration below the first screen at 1440 × 900.** KILL was at y ≈ 800. Fixed by the hero and band padding change (§4.9).
3. **Column captions repeated on every desktop row** (problem, comparison). Fixed with one header row plus row captions only when stacked (§4.9).
4. **Header took about 180 px of the 375 px first screen.** Fixed (§4.9).
5. **Eight-word DATA column about 400 px tall on a phone.** Fixed (§4.9).
6. **Standalone links were 17 px tall targets under a coarse pointer** ("See a verdict and its grounds", "Sign in"). Wrapping them in a taller span does **not** enlarge the target (📏 still 17 px), so they became `ActionLink quiet` (§4.8).
7. **The brand placeholder was 24 px under a coarse pointer.** A touch rule declared before the base rule lost the cascade. Fixed by moving coarse-pointer rules to the end of the stylesheet.

📏 **After the fixes, at 375 px with a coarse pointer, no link, button or summary is below 44 px.** The only exception is the legacy skip link, which is 1 × 1 px until focused (index.html `sr-only`).

## 13. Accessibility review

| Check | Result | Evidence |
|---|---|---|
| One `h1`; `main` landmark with `id="main-content"` (skip-link target) | ✅ | `landing.test.jsx`; legacy page had 0 `main` (§3B) |
| Heading levels never skip | ✅ | `landing.test.jsx` walks every `h1`–`h6` |
| Keyboard reaches every control, in reading order | ✅ | 📏 29 focus stops at 1440: skip link → header → hero CTAs → illustrative actions → 6 disclosures → start CTAs → footer (walked before two standalone text links became ActionLink quiet — a one-for-one element swap, not re-walked) |
| Visible focus, neutral, never gold (Article 21; FC-14) | ✅ after fix | 📏 **Defect found:** the legacy global `:focus-visible` in `client/src/index.css` drew a gold `rgba(246, 201, 69, 0.6)` box-shadow ring around **every Phase 3 control** (TextLink, ActionLink, Button), in addition to the LUMI outline. The Phase 3 lab never loaded that stylesheet, so its review could not see it. Fixed at the primitive (`controls.module.css`: `box-shadow: none`) and for the page's own focusable elements. 📏 After: `solid 2px rgb(11, 15, 20)` on Off White, `solid 2px rgb(247, 247, 243)` on Charcoal, `box-shadow: none` on every LUMI stop |
| Text selection is not gold | ✅ after fix | 📏 **Defect found:** legacy `::selection` gold wash `rgba(224, 168, 0, 0.2)`. Fixed in `layout.module.css` (`.environment ::selection` → claim light on the ground colour). 📏 After: `rgb(11, 15, 20)` |
| Hover / pressed feedback | ✅ | 📏 CTA rest transparent → hover `rgb(233, 233, 230)` (`interaction.hover.surface`) → pressed `rgb(223, 224, 221)` (`interaction.pressed.surface`); no shadow, no gold |
| Target size 2.5.8 (24 px), 44 px under coarse pointer | ✅ | §12 |
| Colour is never the only carrier | ✅ | every verdict mark has its word (`VerdictMark`); states carry words and reasons |
| Contrast | ✅ by construction | every foreground / ground pair on the page is a Phase 2 token pair from the contrast manifest (228 checks, 0 failing). **Not re-measured pixel by pixel in this phase.** |
| The illustrative action | ✅ | activating "Pause campaign" by keyboard removes the control, so focus moves to the confirmation (📏 `document.activeElement` contains "nothing was sent to Meta"; region `role="status"`) |
| Disclosures | ✅ | native `<details>` / `<summary>`; 📏 Enter opens; neutral ring |
| Reduced motion | ✅ | 📏 0 animations on the page; control transitions reduce to `1e-05s` under `prefers-reduced-motion: reduce` |
| **Not performed** | — | screen reader (NVDA / VoiceOver), 200 % / 400 % zoom and reflow, forced colours / Windows High Contrast, real iOS / Android devices |
| **Remaining defect outside the page** | open | the skip link in `client/index.html` (shared document shell) still shows the legacy gold ring and gold fill when focused (📏 focus stop 1). §21 |

## 14. SEO review

| Item | Before | After |
|---|---|---|
| `title` | "Lumi — AI Marketing Decision Engine \| MARCOM AI" | "LUMI — Verdicts, not dashboards" |
| `description` | "Drop a URL. Lock your context in 30 seconds… AI operating system…" (unmeasured claim; forbidden framing) | the hero lead sentence |
| `og:title` / `og:description` | "AI" and "always-on" framing | positioning + the six verdicts |
| `og:site_name`, `og:url`, `twitter:card` | absent | added (`og:url` = the existing canonical) |
| `og:image` | absent | **still absent**: no approved image exists (§3D); none was invented |
| canonical | `https://lumi.marcomai.com/` | unchanged |
| One `h1`, ordered headings, landmarks | no `main` | ✅ (§13) |
| Crawlable content | sections hidden at `opacity-0` until scrolled | all content rendered at first paint (no reveal) |
| Structured data | none | none — nothing true to mark up without inventing it |
| Rendering | client-rendered SPA | unchanged (no SSR / prerender exists; out of scope) |

`index.html` is the document for **every** route (📏 no per-route `document.title` or helmet in `client/src`), so the new title also shows on authenticated pages. It is still accurate there; §21.

## 15. Performance measurements (📏)

**Instrument.** `vite build`, then gzip level 9 and brotli quality 11 over exactly the files `dist/index.html` references (scratch script `measure-dist.mjs`). Baseline is a fresh build at `b35d22e`; after is the working tree.

| First load | Baseline raw | After raw | Baseline gzip | After gzip | Baseline brotli | After brotli |
|---|---|---|---|---|---|---|
| entry JS | 584,224 | 603,288 | 164,714 | 172,787 | 135,959 | 143,343 |
| vendor-react | 179,878 | 179,878 | 59,034 | 59,034 | 51,841 | 51,841 |
| vendor-firebase | 166,042 | 166,042 | 33,710 | 33,710 | 28,634 | 28,634 |
| entry CSS | 114,354 | 138,929 | 29,878 | 34,355 | 26,211 | 29,023 |
| **Total** | **1,044,498** | **1,088,137** | **287,336** | **299,886** | **242,645** | **252,841** |
| **Δ** | | **+43,639** | | **+12,550 (+4.37 %)** | | **+10,196 (+4.20 %)** |

**⚠️ This is a measured first-load regression, which the brief makes a hard stop without explicit approval (§29).** What it is made of:

- **Every lazy chunk has the same size in bytes** (📏 31 JS files compared by length; only the entry differs). The growth is entirely the entry chunk and the entry stylesheet, i.e. what the landing itself adds.
- **JS +19,064 raw (+8,073 gzip).** The first production use of the Phase 3 parts, including their closed-API refusal messages, plus nine sections of real copy, minus the legacy landing (📏 legacy strings "Know what to", "Always watching", "Alexandria Villas" are no longer in the entry). The contract modules the grammar reads were **already** in the entry (📏 `COULD_NOT_LOOK`, `NOTHING_THERE`, `REALLOCATE` present at baseline).
- **CSS +24,575 raw (+4,477 gzip).** The LUMI CSS modules (grammar, controls, type, layout, landing). 📏 Removing the now-unreferenced legacy landing files from Tailwind's scan would recover only **918 B gzip** (experiment build; config restored, `git diff` empty).
- **Fonts** requested by the rendered landing: 📏 Inter 400 / 500 / 600, Space Grotesk 600, JetBrains Mono 400 (5 faces). No new font file was added. The legacy page's font requests were not measured, so no comparison is claimed.
- **Bundle budget** (CLAUDE.md "< 700KB"): all JS + CSS gzip is 📏 645,568 B (610,133 + 35,435), inside a 716,800 B reading of the budget.

**What decides it — the landing still downloads the application.**

- 📏 A measurement-only build of the review entry alone (landing + the app's global CSS and fonts, **without** App.jsx, Firebase or any authenticated route) is **428,033 raw / 121,831 gzip / 106,405 brotli**, against 299,886 B gzip today.
- That split is Constitution Article 26 §1 / audit P0-70. It needs route and app-shell changes that this phase is not allowed to make (§19), so it is **not** done here and **not** claimed.

**Not measured:** LCP, CLS, INP, TTFB on a deployed page. A local checkout has no Firebase configuration, so the production entry renders its configuration error page, not the landing (§19). The landing also waits for Firebase auth before it paints (`App.jsx:145`), which a Web Vitals run would include.

## 16. Data integrity review (🔒 PR-7, Article 28)

- **No product number.** 📏 The rendered page contains exactly nine digit-bearing strings, excluding the product name "Google Analytics 4":
  - three tense clocks;
  - one decision id;
  - one evidence-group meta line;
  - two belief counts;
  - two window lines.

  Every one sits inside a `figure` or section whose text contains "Illustrative example". `landing.test.jsx` pins the complete list, so a new figure fails the suite until it is reviewed (📏 mutation "94% of the time" → 2 failing tests).
- **No fabricated zeros, ROAS, spend, conversions, percentages, customer counts, prices or durations.** Legacy figures and prices are gone (test-pinned).
- **Illustrative interaction is honest.** The confirmation says "Illustrative example: nothing was sent to Meta"; the recorded variant says "nothing was saved" (📏 mutation "Your campaign is paused." → caught).
- **Product claims traced to code:**

| Claim on the page | Source |
|---|---|
| Six verdicts | `prisma/schema.prisma` `enum Verdict`; PR-5 |
| KILL = return below break-even **and** frequency past the fatigue ceiling | `verdictEngine.js:387-391` |
| No KILL / SCALE on unmeasured revenue; judged on engagement | `verdictEngine.js:358-363` |
| SCALE / WATCH / REFRESH / REALLOCATE conditions | `verdictEngine.js:374-465` |
| Only KILL is carried out: pause on Meta; SCALE / REFRESH / REALLOCATE need operator input; HOLD / WATCH no action; Google not executable | `decisionExecutability.js:39-126`, `verdictTypes.js:54-65` |
| Nothing changes on its own | 📏 no auto-execution path in `src/` (search: `autoExecut`, `autopilot`, `auto_execute`: 0) |
| Meta Ads, Google Ads, Google Analytics 4 | `connectorRegistry.js:19-23` |
| A decision is written when the verdict changes; not rewritten by a later assessment; divergence named | B7-01; Constitution R-1; C-12 `decisionAgreement` |
| Memory adjusts confidence, never the verdict | Constitution R-1 |
| Belief facts: since, tested, held, replaced; "Established" | C-14; B8-05; B7-06 |
| Allocation is a plan you approve, not a verdict | Constitution R-3; C-18 |
| Tests read out causation, including inconclusive | B8-05 |
| Verdicts are not written by a chat model | `verdictEngine.js` is a deterministic function of its inputs |
| State words and reasons | `STATE_RULES.md` §4, §12–§15; `vocabulary.js` `STATE_LABEL` |

## 17. Anti-convergence review (ANTI_CONVERGENCE.md record format)

```text
ARTEFACT        LUMI landing page — client/src/lumi/landing/ (rendered at 1440 · 1024 · 768 · 375)
DATE · REVIEWER 2026-09-15 · Claude Code (author; not approval)
AC-1 Visual      PASS — resemblances listed: hairline-bounded neutral buttons and a sans-serif display are common;
                 kept because they are the Phase 3 controls. No stock component styling, no accent-coloured CTA,
                 no default radii or shadows (📏 0 box-shadows, 0 background images, 0 filters on the page).
AC-2 Structural  PASS — the grey-box skeleton is: statement → a three-column light gradient ending in one call →
                 a model drawn as one axis → a verdict ledger → two decision spines in two tenses → states →
                 an axis into a belief → a comparison ledger → disclosures → start. It is not hero → feature cards
                 → pricing trio → FAQ; it only makes sense for a call and its grounds.
AC-3 Behavioural PASS — no prompt, no streaming, no greeting, no feed; the only action is bound to a decision id and
                 says it is illustrative; the NOW assessment has no control; nothing moves at rest.
AC-4 Decorative  PASS — elements removed: gold blob, dot-grid wallpaper, pulses, float loop, glows, glass header,
                 sparkles/brain icons, pill badges, window chrome (📏 scans: 0 gold, 0 effects, 0 animations).
AC-5 Transfer    PASS — neutral sentence: "a page that shows raw inputs in low light, the questions asked of them,
                 and one call in full light, then a committed decision and today's reading of it in two named
                 tenses with the disagreement written out" — not a useful description of a chat, analytics or
                 generic SaaS landing.
AC-6 Why LUMI    PASS — "It exists to show VERDICT → WHY → EVIDENCE → ACTION → OUTCOME → MEMORY with PR-1's two
                 tenses, PR-5's Verdict ≠ Action and PR-7's labelled illustration" (grammar objects; PR-1, PR-5, PR-7).
RESULT          PASS by author — approval is Omar's
```

**Identity tests (RG-4), on the rendered page:**

- **Test 1 — logo removed, generic AI / SaaS? NO.** The placeholder is plain text anyway.
- **Test 2 — does it make sense because LUMI reveals what matters and organises decisions, evidence, actions, outcomes and memory? YES.** Every region is one of those objects.

**Honest risk.** At a glance, a sparse Off White editorial page with a Charcoal band and hairlines resembles restrained "premium" sites. The distinction lies in the grammar (tense labels, measured absence, verdict ledger), which a viewer sees only on reading. This is exactly the AC-0 warning ("Dark is not automatically LUMI"), recorded for Omar's visual judgement.

## 18. Files changed and created

**Modified (tracked) — 8 files, +56 / −12:**

| File | Change |
|---|---|
| `client/index.html` | head metadata only (§14) |
| `client/src/pages/LandingPage.jsx` | the `/` page export now points at `lumi/landing/LandingPage.jsx` (1 export line + comment) |
| `client/src/lumi/primitives/controls.module.css` | `text-decoration-line: none` on `.button` (ActionLink); `box-shadow: none` in the focus rule (§13) |
| `client/src/lumi/primitives/layout.module.css` | `.environment ::selection` neutral (§13) |
| `client/src/lumi/index.js` | export `ActionLink`; header comment |
| `client/src/lumi/README.md` | registry: `ActionLink` row, consumers, `landing/` and the review entry |
| `client/src/lumi/__tests__/lumiAudit.js` | the static audit accepts `box-shadow: none` (a reset) and still rejects any other shadow |
| `client/src/lumi/__tests__/tokenUsage.test.js` | landing CSS enrolled; planted-violation control for the reset; focus-ring and selection assertions |

**Created (untracked):**

| File | Purpose |
|---|---|
| `PHASE_4_LANDING_VISUAL_LANGUAGE_AUDIT.md` | this record |
| `client/src/lumi/landing/LandingPage.jsx` | the page (80 lines) |
| `client/src/lumi/landing/parts.jsx` | `LandingSection`, `IllustrativeNote`, `Axis`, `BrandPlaceholder` |
| `client/src/lumi/landing/landing.module.css` | page composition; tokens only |
| `client/src/lumi/landing/sections/{HeroSection, ModelSections, VerdictsSection, DecisionSection, TrustMemorySections, CloseSections}.jsx` | the nine questions |
| `client/src/lumi/primitives/ActionLink.jsx` | new generic primitive (§4.8) |
| `client/src/lumi/lab/landingMain.jsx` · `client/lumi-landing.html` | dev-only review entry (§19) |
| `client/src/lumi/__tests__/actionLink.test.jsx` · `landing.test.jsx` | 10 + 14 tests |
| `client/lumi-landing-review/` | 12 PNG captures (3,955,198 B): first screen and full page at 1440 / 1024 / 768 / 375, focus ring, decision after the illustrative action, disclosure open, legacy baseline |

**Deleted:** none. `.claude/launch.json` was created for the review server and removed afterwards; it was never tracked, because it starts the whole client dev server rather than only the review page.

## 19. Files intentionally untouched

| Untouched | Why |
|---|---|
| `client/src/App.jsx`, routes, redirects, gates | no route or permission change; the `/` route element is the same import |
| `client/src/main.jsx` | app entry; its font imports (Space Grotesk 400 / 500 / 700 unused by LUMI roles) are shared with the app |
| `client/src/pages/LandingPage/*` (legacy page, 13 files, tests included) | now unreferenced; kept until the new page is approved (spec §30 "do not remove old code until the replacement is verified"); its tests still pass |
| `client/src/index.css`, legacy tokens, `tailwind.config.js` | legacy values are not changed; the LUMI parts neutralise the two legacy global rules inside their own scope instead |
| `client/index.html` body, skip link, `theme-color`, `html.dark` | the document shell of every route (§21) |
| `client/design-system/foundation/` tokens | no token added or changed (§4.6) |
| backend, API, Prisma, `packages/` | no change |
| every authenticated surface and the app shell | no change |
| governance documents (`design-governance/`) | no new ruling was needed; open questions go to §21 |

**Review entry isolation.**

- 📏 `client/dist/index.html` contains no `lumi-landing` / `landingMain` reference.
- 0 `lumi-lab` / `lumi-landing` files in `client/dist`.
- `vite.config.js` has no build `input` (test-pinned).

## 20. Validation

| Check | Result | Why it was run |
|---|---|---|
| LUMI suite (`client/src/lumi`) | 📏 **225 / 225** passed, 9 files | new primitive, page, tests, audit instrument |
| Targeted: LUMI + legacy landing tests + `src/app` (router smoke) | 📏 **370 / 370** passed, 16 files | the `/` export changed; the router smoke test mocks that module |
| `eslint src/ --max-warnings 0` (`lint:ci`) | 📏 pass (after fixing 7 `react/jsx-key` errors in the first `actionLink.test.jsx`) | source changed |
| Production build | 📏 success; measurements §15 | performance is a phase requirement |
| Mutation checks (each planted, run, restored) | 📏 **7 / 7 caught**: unlabelled figure (2 failing), legacy gold focus ring (1), control on the NOW assessment (1), confirmation claiming it was sent (1), liveness copy (1), `ActionLink` accepting `className` (1), gradient in landing CSS (1); after restore 225 / 225 | an instrument must be shown to fail |
| Rendered governance scan (1440, 375) | 📏 0 gold (outside the REALLOCATE mark), 0 verdict colour outside the 9 marks, 0 effects, 0 animations, 0 text under 12 px; families Inter / Space Grotesk / JetBrains Mono only; weights 400 / 500 / 600 | 📏 **planted probe first**: an injected gold glow, gradient, gold text and animation were all reported |
| Keyboard walk, hover / pressed / focus, reduced motion, touch targets | §12, §13 | rendered, not inferred |
| **Not run** | full client suite (232 files), `tokens:check`, backend tests | no token file, backend file or authenticated surface changed; the broad checks were previously rejected as ceremony. The targeted run covers every changed module and every test that imports one |

## 21. Known open items

| # | Item | Needs |
|---|---|---|
| 1 | **First-load +12,550 B gzip (+4.37 %)** (§15) | **Omar's explicit approval**, or a ruling to split the public bundle (📏 landing-only 121,831 B gzip) in a phase allowed to touch routes / app shell |
| 2 | The landing paints only after Firebase auth resolves (`App.jsx:145`) | app-shell work; Web Vitals run on a deployed build |
| 3 | Logo: text placeholder `BrandPlaceholder` (FC-10) | the approved "01 / Current Base" asset; replace one component |
| 4 | Typography: no marketing lead size (between 16 and 24) or display step above 48 in the locked scale | a Phase 2 token ruling if Omar wants more typographic range on marketing |
| 5 | Legacy skip link (gold ring + fill), `theme-color #0A0B0F`, `html.dark` / legacy body classes in `client/index.html` | a document-shell decision (affects every route) |
| 6 | No pricing section: no price source in the repository; plan tiers FREE / GROWTH / PRO exist only as gates | a product ruling with a price source |
| 7 | No market positioning (legacy "MENA", currencies) | a product ruling |
| 8 | No conversion analytics: no destination exists. `data-landing-cta="hero" \| "start"` hooks are in place; nothing is sent | a provider and privacy ruling |
| 9 | No OG image, favicon, robots.txt or sitemap (§3D) | approved assets |
| 10 | Legacy landing files unreferenced (§19) | delete after approval, per the CLAUDE.md Deletion Protocol (separate commit) |
| 11 | Motion: the page is at rest; timed reveals rejected (§11) | Omar's visual judgement |
| 12 | All copy is new (FC-12 forbade inheriting legacy copy) | Product Owner copy review |
| 13 | Accessibility not performed: screen reader, zoom / reflow, forced colours, devices | a dedicated pass |
| 14 | `index.html` title applies to every route (no per-route titles in the SPA) | app-shell decision |
| 15 | The ThreeUI repository page does not enumerate components by name; §9 records categories | none, unless a named component is proposed |
| 16 | Illustrative dates (2026-09-01, 2026-09-14, 2026-06-02) will age | refresh or ruling on dateless illustrations (the grammar requires a clock) |
| 17 | At 768 px the header wraps to two rows | acceptable in review; revisit with the logo asset |
| 18 | The verdict word is 16 px (`type.body.claim`) even in the hero; weight comes from light and space, not size | confirm under Omar's visual review (token-locked) |

## 22. Final gate recommendation

> Kept as the original finding. The remediation pass (§23) re-measured and re-decided the gate; read §23.15 for the current recommendation.

```text
GATE            Phase 4 — Landing + Visual Language → review
DATE            2026-09-15
ARTEFACTS       client/src/lumi/landing/ · client/src/lumi/primitives/ActionLink.jsx · client/lumi-landing-review/
Q-1  Product truth preserved            YES — §16 source table; no state derived; no recomputation
Q-2  Grammar visible                    YES — §5; every region is a grammar object
Q-3  Distinctive                        YES by author — §17 Test 1 (with the recorded risk)
Q-4  No AI convergence                  YES — §17 AC-3/AC-4; no VB-F4…F7, F11 signal (📏 scans)
Q-5  No SaaS convergence                YES — §17 AC-2/AC-5; no card grid, pricing trio or KPI strip
Q-6  State semantics                    YES — real ClaimState states with reasons (§16)
Q-7  Accessibility                      YES with gaps — §13 (not-performed list)
Q-8  Responsive                         YES — §12, four widths, no hidden capability
Q-9  Performance                        NO WITHOUT APPROVAL — §15: +12,550 B gzip first load
Q-10 Numeric truth                      YES — §16, test-pinned figure census
Q-11 Action identity                    YES — ActionControl bound to a decision id; NOW has none
Q-12 Conflicts registered               YES — no new governance conflict; product / asset gaps in §21
Q-13 Authority diff                     YES — Master Build Spec read; FC-12 applied to its landing clauses
IDENTITY TESTS  Test 1: NO (not generic)   Test 2: YES
APPROVER        Omar — pending
```

**Recommendation: `BLOCKED`**, on one item only.

- **The block.** The measured first-load increase of **+12,550 B gzip (+4.37 %)** is a production performance regression. The brief lists that as a hard stop without explicit approval (§29).
- **Everything else is ready.** The page, the visual language and the review evidence are ready for Omar's visual review.
- **With that approval** (or a ruling that moves the public-bundle split into scope), the recommendation is **`READY FOR REVIEW`**.
- **Not `READY FOR PHASE 5`.** That requires Omar's approval of the visual direction.

---

## 23. Remediation pass — performance, naming, pre-review cleanup

```text
Spec       LUMI — PHASE 4 REMEDIATION SPEC (performance + naming + pre-review cleanup)
Branch     feat/lumi-landing, base b35d22e, uncommitted
Date       2026-09-15
Rule       no redesign · no dependency · no backend/API/auth/route/app-shell change · no Phase 5
```

Every number below is 📏 measured from a production build of this tree, with `measure-dist.mjs`: gzip level 9 and brotli quality 11 over the files `dist/index.html` makes the browser fetch before any lazy route. Each scratch variant (`vite.report.config.mjs`) loads the real `vite.config.js` and swaps **only** `pages/LandingPage.jsx` in memory; it changes no working-tree file.

📏 **Instrument check.** The `legacy` variant reproduced the recorded baseline to the byte, with the same asset hashes (`index-Or9c0dNa.js`, `index-DAR-fMBt.css`, 287,336 B gzip). The `current` variant reproduced the recorded Phase 4 build the same way (`index-H5Qq8Wel.js`, `index-DcMzSFiZ.css`, 299,886 B). The final `npm run build` produced the same hashes as its report variant (`index-Bvh6ZJZZ.js`, `index-CoAe4tri.css`).

### 23.1 Performance investigation — where the +12,550 B came from

**Decomposition** of the first load: the same config and the same app, with only the `/` route module swapped.

| `/` renders | First load gzip | Entry JS gzip | Entry CSS gzip | vs empty route |
|---|---:|---:|---:|---:|
| nothing (`return null`) | 279,718 | 157,096 | 29,878 | — |
| legacy landing (baseline `b35d22e`) | 287,336 | 164,714 | 29,878 | **+7,618** |
| only the LUMI parts the landing imports (20 primitives + grammar parts, no landing code) | 292,448 | 166,455 | 33,249 | **+12,730** |
| Phase 4 landing, as first delivered | 299,886 | 172,787 | 34,355 | **+20,168** |

**Root cause.**

- **The landing's own code and copy** cost +7,438 B on top of the LUMI layer (JS +6,332, CSS +1,106). The legacy landing it replaced cost **+7,618 B**, so the page itself is 180 B *lighter* than the one it replaced.
- **The regression is the Phase 3 primitive and grammar layer** entering the shared entry chunk for the first time: **+12,730 B** (JS +9,359, CSS +3,371). Before Phase 4 nothing in the application imported `src/lumi`, so no production build contained it.

**Per-module attribution** of the entry chunk. Sizes are rendered bytes before minification, from Rollup's module report.

| Group | Modules | Rendered bytes |
|---|---:|---:|
| legacy landing (removed) | 9 | −45,304 |
| landing sections + page + CSS-module class maps | 9 | +37,310 |
| grammar parts (`Measurement`, `ClaimState`, `ActionControl`, `Tense`, `Spine`, `vocabulary`, …) | 10 | +27,413 |
| primitives (`Flow`, `Text`, `Button`, `Icon`, `Surface`, `Environment`, `ActionLink`, `TextLink`, CSS maps) | 11 | +16,395 |
| `contract.js` | 1 | +2,496 |
| lucide icons only the legacy page used (removed) | 5 | −2,132 |
| any other application module | 11 | ≤ ±16 each (minifier renames) |

**Answers to spec §3 A–J.**

| Question | Answer |
|---|---|
| **A · JavaScript** | +8,073 B gzip in the entry. Every lazy chunk is unchanged in size. |
| **B · CSS** | +4,477 B gzip. All of it is 155 LUMI CSS-module rules (24,575 raw bytes). Not one Tailwind rule left the build when the legacy page left the route, because Tailwind still scanned the unreferenced legacy files. |
| **C · landing-specific code** and **D · landing copy** | +7,438 B together, which is less than the legacy page cost. |
| **E · imported primitives** | +12,730 B: the root cause. |
| **F · accidental eager imports** | None. No module outside `src/lumi` entered the entry chunk. |
| **G · duplicated utilities** | None. `cx`/`assert*` exist once, and money formatting goes through `lib/money.ts`, which was already in the entry. |
| **H · Tailwind output** | 918 B of utilities (plus `.reveal*` in `@layer utilities`) were generated only for the unreferenced legacy page. |
| **I · app-shell dependencies** | Firebase, React and the router are unchanged: `vendor-*` chunks are byte-identical. |
| **J · anything unexpected** | CSS modules ship whole. 8 of the 15 classes in `controls.module.css` were field rules (2,483 source bytes) that no landing component uses. One landing class (`.bandDivider`) was dead. |

### 23.2 Original bundle measurement

| Build | Raw | Gzip | Brotli |
|---|---:|---:|---:|
| Baseline `b35d22e` | 1,044,498 | 287,336 | 242,645 |
| Phase 4 as first delivered | 1,088,137 | 299,886 | 252,841 |
| Delta | +43,639 | **+12,550 (+4.37 %)** | +10,196 (+4.20 %) |

### 23.3 Changes attempted

**Applied** (smallest and safest first; each one is behaviour-preserving):

| # | Change | Files | Measured effect |
|---|---|---|---|
| R-1 | Tailwind no longer scans the unreferenced legacy landing: `'!./src/pages/LandingPage/**'`. A test fails if the route is re-pointed at the legacy page while the exclusion stands. | `client/tailwind.config.js`, `landing.test.jsx` | 📏 **−916 B** (attribution build with the directory scanned again: 299,756 → 298,840). The Phase 4 experiment measured 918 B. |
| R-2 | Field rules moved from `controls.module.css` to a new `fields.module.css`, unchanged. A page that draws a button no longer ships every field rule. The field focus rule repeats the controls ring declaration-for-declaration, and a test holds the two bodies equal. | `primitives/{controls,fields}.module.css`, `TextField.jsx`, `ChoiceField.jsx`, `FieldParts.jsx`, `tokenUsage.test.js` | 📏 R-2 + R-3 + the copy and skip-link additions below net **−130 B** together |
| R-3 | Dead `.bandDivider` removed | `landing/landing.module.css` | (in the −130 B) |

**Measured and not applied**, each for a stated reason:

| # | Experiment | Measured | Why it was not applied |
|---|---|---:|---|
| X-1 | Hash-only CSS-module class names in production (`_[hash:base64:5]`) | −720 B | Changes `vite.config.js` for **every** CSS module in the application, including authenticated surfaces (`Operations.module.css`): a build-wide change outside the landing's scope, and production class names become opaque when debugging. |
| X-2 | Strip the diagnostic text from every `new Error(…)` in `src/lumi/{primitives,grammar}` in production | −1,569 B | Weakens the closed-API contract in production. A refused prop would throw without naming the rule it broke. It is either a build-time source transform (new build tooling) or ~40 edits to merged Phase 3 files. That is a Phase 3 contract decision, not landing cleanup. |
| X-3 | Lazy-load the landing route | not built | Does not reduce what a `/` visitor downloads. It moves the same bytes into a second request that starts only after Firebase auth resolves, so the landing paints later. It also edits `App.jsx`, the routing shell. |
| X-4 | Remove landing content | not attempted | Forbidden by the spec. The page's own code already costs less than the legacy page (§23.1). |

X-1 and X-2 were measured one at a time; they were not stacked. Even applied together they would leave roughly +9.2 KB (+3.2 %), so neither clears the hard stop.

### 23.4 Final bundle measurement

| | Raw | Gzip | Brotli |
|---|---:|---:|---:|
| `assets/index-Bvh6ZJZZ.js` (entry) | 603,489 | 172,816 | 143,228 |
| `assets/vendor-react-By8n3Crz.js` | 179,878 | 59,034 | 51,841 |
| `assets/vendor-firebase-CUif7fEU.js` | 166,042 | 33,710 | 28,634 |
| `assets/index-CoAe4tri.css` | 131,602 | 33,280 | 28,288 |
| **First load** | **1,081,011** | **298,840** | **251,991** |

- **Whole build:** all JS 610,168 B gzip (baseline 602,020); all CSS 34,360 B gzip (baseline 30,958); 118 assets (baseline 118).
- **Dev-only review files:** `lumi-landing.html` and `landingMain` are absent from `dist/` (📏 0 files).

### 23.5 Exact delta

| | Gzip | Brotli | Raw |
|---|---:|---:|---:|
| vs baseline `b35d22e` | **+11,504 B (+4.00 %)** | +9,346 B (+3.85 %) | +36,513 B |
| vs Phase 4 as first delivered | −1,046 B | −850 B | −7,126 B |

**What remains** is the LUMI primitive and grammar layer (≈ +12.7 KB) living in the shared entry chunk, less the Tailwind saving. It cannot be removed within the approved scope without either:

- deleting the design system the page is built from; or
- touching the app shell.

### 23.6 Auth rendering investigation

- **Finding** (📏 source):
  - `client/src/main.jsx:92` wraps every route in `AuthProvider`.
  - `client/src/App.jsx:143-147` returns `AuthLoadingScreen` for **every** path while Firebase auth is resolving. That screen is dark `bg-surface-dark` with a spinner and "Initializing authentication…"; the comment marks the gate `CRITICAL`.
  - The landing reads no auth state. Even so, a first-time visitor sees the dark loading screen before the Off White landing.
- **Why it is not fixed here.** A fix must render `/` outside that gate, or move the gate below the public routes. Either way it changes the root routing shell's auth-loading contract, which every protected route currently relies on. The spec forbids authentication-architecture and app-shell changes.
- **Deferred to Phase 5.** The correct fix restructures the app shell: public routes rendered outside the auth-loading gate. The same work is where a public bundle split belongs (landing-only 📏 121,831 B gzip, measured before remediation).
- **Not measured.** How long the gate holds: this checkout has no Firebase environment (the real entry renders `ConfigErrorPage`). The dark-screen-then-light-page flash has not been observed on a deployed build.

### 23.7 MARCOM AI cleanup

**Search.** Every tracked file (`git grep -i`) plus the untracked Phase 4 files, for:

- `MARCOM AI` / `Marcom AI`;
- `AI Marketing Decision Engine`;
- `Marketing OS`;
- `marcom` in any case.

Every hit outside comments and `@marcom/*` import specifiers was then classified. Most `marcom` hits (📏 289 tracked client files contain one) are `// MARCOM / Lumi — …` file-header comments or the `@marcom/runtime-contracts` package name: internal technical identifiers (class 11), untouched.

| Occurrence | Class | Active? | Action |
|---|---|---|---|
| `client/index.html` `<title>` "Lumi — AI Marketing Decision Engine \| MARCOM AI" (at `b35d22e`; Phase 4 had replaced it) | 3 browser title | yes | **now "LUMI \| Decision Intelligence for Performance Marketing"** |
| `client/index.html` `og:title` | 4 Open Graph | yes | **same title** |
| `client/src/pages/PrivacyPage.jsx:30`, `TermsPage.jsx:29` "MARCOM AI / Lumi · Last updated" | 7 UI copy on public legal pages (linked from the landing footer) | yes | ⚠️ **ambiguous — reported, not changed.** On a privacy policy and terms of service this byline may name the **legal entity** that operates the service, not the product. Renaming a contracting party is a legal decision. Needs a ruling. |
| `privacy@marcom.ai`, `legal@marcom.ai`, `sales@marcom.ai` (Privacy, Terms, `CopilotPage.jsx:34`) | 11 technical identifier (real mailboxes) | yes | unchanged: an address, not identity copy |
| `og:url` / canonical `https://lumi.marcomai.com/` | 11 hostname | yes | unchanged: the deployed domain, not copy |
| `client/src/pages/OnboardingPage/steps/WelcomeStep.jsx:18` "Welcome to Marcom AI" | 7 UI copy | **no** — 📏 `WelcomeStep` has no importer | unchanged (dead code; no unrelated cleanup). Report for deletion. |
| `client/src/pages/LandingPage/{index,PricingSection}.jsx` mailto links | 9 historical (unreferenced legacy landing) | no | unchanged |
| `src/modes/mode1-onboarding.js:181-193` AI system prompt "Lumi, … built by MARCOM AI", "the full MARCOM tool suite" | 8 user-visible AI output | yes | ⚠️ **backend, frozen — reported.** Needs a backend-authorized slice. |
| `src/utils/email.js:35,66,99-101` sender "MARCOM" / "MARCOM Alerts"; `src/routes/master.js:179` subject "MARCOM — Context Locked" | 7 user-facing email | yes | ⚠️ **backend, frozen — reported** |
| `render.yaml:103-107` Firebase project `marcom-ai-722f0` (auth domain `marcom-ai-722f0.firebaseapp.com`, which Google sign-in can show) | 11 infrastructure identifier | yes | ⚠️ reported. Changing it needs a Firebase custom auth domain (infrastructure), not a string edit. |
| `package.json:4` description; `src/data/dialects/*` `compiled_for`; `src/server.js`, `src/config.js` log prefixes; `export.js` `source`/User-Agent | 11 internal | no | unchanged |
| `marcom_*` tables, `marcom:*` storage keys, `@marcom/*` packages, `prisma/schema.prisma` "Marketing OS" comments, migration SQL | 12 database / storage / API identifier | no | unchanged (spec §7) |
| `design-system-figma/marcom-ai/**`, `docs/deployment.md`, audits, governance | 9–10 historical | no | unchanged |
| manifest / favicon | 6 | — | 📏 none exist (`client/public` has no tracked files) |

📏 **Result.** The built document head has 0 occurrences of `MARCOM AI` or `AI Marketing Decision Engine` (checked in the browser on `dist/`). Nothing on the landing names MARCOM (`landing.test.jsx` pins the metadata).

### 23.8 Browser title

📏 `document.title` of the built `dist/index.html` is **`LUMI | Decision Intelligence for Performance Marketing`** (read in Chromium via `vite preview`). `og:title` is identical, and both are pinned by `landing.test.jsx`.

The SPA has one document title for every route (§21 item 14, unchanged).

**Category on the page itself.** The hero now carries the category above the h1, as a meta-light label: "Decision Intelligence for Performance Marketing" (📏 6.55:1 on Off White). The footer caption now states the locked promise: "LUMI — Decision Intelligence for Performance Marketing. Clarity turns complexity into decisions." It replaces the earlier paraphrase "clarity that leads to a decision".

### 23.9 Skip-link treatment

- **Before.** The skip link on every route drew a gold fill (`focus:bg-lumi-accent`, #E0A800) and, through the legacy global `:focus-visible` box-shadow, a gold ring.
- **After.** The smallest change that affects nothing else:
  - `client/index.html`: the two colour utilities are removed, and the link gains `class="lumi-skip-link"` and `data-lumi-env="marketing"`. The attribute makes the `--lumi-*` colour tokens resolve on the link itself, on any route. Position and typography utilities are unchanged.
  - `client/src/index.css`: one rule, `.lumi-skip-link:focus, .lumi-skip-link:focus-visible`, placed outside every `@layer`. It sets `color: text.claim`, `background: surface.base`, `outline: focus.width solid interaction.focus-ring`, `outline-offset: focus.offset` and `box-shadow: none`. These are the same declarations as the LUMI controls.
  - `client/lumi-landing.html` mirrors the document shell.
- **📏 Rendered in the built document.** Tab once: focused; `rgb(11,15,20)` on `rgb(247,247,243)`; outline `solid 2px rgb(11,15,20)`, offset 2px; `box-shadow: none`; 142×30.
  - **On a charcoal ground** (simulating product routes), the chip is unchanged. The charcoal ring merges with the ground there, but the Off White chip against charcoal (≈18:1) is itself the visible focus indicator.
  - **On the Off White ground**, where the chip matches the page, the ring carries it.
  - Captures: scratchpad `skip-link-light.png` and `skip-link-dark.png`.
- **Keyboard access unchanged.** The link is still the first focus stop on the landing (📏 walk below).

### 23.10 Metadata review

| Item | State | Decision |
|---|---|---|
| title, og:title | LUMI \| Decision Intelligence for Performance Marketing | fixed (§23.8) |
| description, og:description | the hero lead; the six verdicts. No "AI-powered", no invented claim. | unchanged |
| og:type, og:site_name, og:url, twitter:card | website · LUMI · https://lumi.marcomai.com/ · summary | unchanged. `twitter:title` falls back to `og:title`. |
| OG image, favicon, manifest, robots, sitemap | none exist | open: needs approved assets (§21 item 9) |
| `theme-color #0A0B0F` | legacy near-black, **document-wide** | **deferred.** One static value serves the dark-first product and the light-first marketing page (🔒 PR-9). A correct value is per-route, which is app-shell work. Changing it to either ground is wrong for the other. |
| `<html class="dark">`, `<body class="bg-lumi-bg text-lumi-text antialiased">` | legacy Tailwind infrastructure the authenticated UI renders with | **deferred.** Removing them restyles every legacy route. They are not identity text. |
| Vite metadata | none (no `vite-plugin-html`, no injected head) | — |

### 23.11 Accessibility impact

**Retested because touched** (📏 rendered, `lumi-landing.html` inside the application CSS):

- **Keyboard walk:** 29 focus stops. The skip link comes first, then brand, page nav, account links, hero CTAs, the two illustrative action buttons, and the 6 disclosures. Every ring is neutral: `rgb(11,15,20)` on Off White and `rgb(247,247,243)` on Charcoal. Box-shadow is `none` on all 29.
- **CTA states:**
  - hover `rgb(233,233,230)`;
  - pressed `rgb(223,224,221)`;
  - focus-visible 2px neutral outline.
- **Selection:** `rgb(11,15,20)`, not gold.
- **Keyboard interaction:** activating "Pause campaign" with Enter moves focus to its `role="status"` confirmation. A FAQ disclosure opens with Enter.
- **Reduced motion:** 0 animations; transition duration `1e-05s`.
- **Touch at 375 (coarse pointer):** every target is ≥ 44px except the skip link. It measures 1×1 while hidden and 142–150 × 30 when focused (measured at 1440): a keyboard-only control that clears WCAG 2.5.8 (24px), not LUMI's 44px touch size.
- **New hero category line:** a `<p>` above the h1 inside the hero section, so the heading outline is unchanged (one h1, no skipped level; test-pinned). Contrast 6.55:1.

**Still not performed** (unchanged from §13):

- screen readers;
- 200–400 % zoom and reflow;
- forced colours;
- real phones.

No compliance claim is made.

### 23.12 Visual impact

- **No regression from optimisation.**
  - R-1 removes only utilities no rendered element uses.
  - R-2 moves rules between files without editing a declaration.
  - R-3 removes an unused class.
- **One deliberate visual addition:** the hero category label (§23.8). 📏 Re-rendered at 1440, 1024, 768 and 375:
  - no horizontal overflow at any width;
  - the label fits one line at all four;
  - the dark demonstration band still starts inside the first screen (top at 529 / 529 / 569 / 705 px).
- **Governance scan** (📏 planted probe reported first; 1440):
  - 0 gold, 0 verdict colour outside the 9 marks, 0 effects, 0 animations, 0 text under 12px;
  - families Inter / Space Grotesk / JetBrains Mono; weights 400 / 500 / 600.
- **Captures:** the 11 landing PNGs in `client/lumi-landing-review/` were re-captured. `legacy-landing-1440-full-baseline.png` is kept as history.
- **Visual language.** Structure, light, negative space and signal are unchanged. No gradient, glass, glow, 3D, blob, card wall or imagery was added.

### 23.13 Validation

| Check | Result |
|---|---|
| LUMI + legacy landing + router smoke (`vitest run src/lumi src/pages/LandingPage src/app`) | 📏 **375 / 375** (16 files) |
| LUMI + legacy landing (first run after edits) | 📏 243 / 243 (12 files) |
| New tests | `landing.test.jsx` +4: metadata identity, category and promise on the page, neutral skip link, Tailwind-exclusion pairing. `tokenUsage.test.js`: file list includes `fields.module.css`, and the field focus rule body equals the controls rule. |
| Mutation checks (planted, run, restored; 📏 files byte-identical afterwards) | 📏 **8 / 8 caught**: title back to MARCOM AI · og:title drift · skip-link gold fill · skip-link legacy ring · legacy landing re-scanned · route re-pointed at the legacy page · field ring without its reset · hero without the category |
| `npm run lint:ci` | 📏 exit 0 |
| `npm run build` | 📏 success; §23.4 |
| Bundle measurement | 📏 §23.4, §23.5, reproducible hashes |
| Repository naming search | §23.7 |
| Active metadata inspection | 📏 built document, §23.8, §23.10 |
| Visual render | §23.12 |
| Runtime errors | 📏 0 console errors or warnings at 1440 and 375, loading plus the illustrative action plus a disclosure |
| **Not run** | Full client suite, `tokens:check`, backend tests. No token source, backend or authenticated component changed. The `index.css` and `tailwind.config.js` edits reach every route's stylesheet, but jsdom tests do not load CSS, and their built effect is measured directly (§23.4). |

### 23.14 Remaining blockers and open items

| # | Item | Needs |
|---|---|---|
| **B-1** | **First load +11,504 B gzip (+4.00 %)** vs `b35d22e`: the LUMI layer in the shared entry chunk (§23.1, §23.5) | **A ruling, one of:** (a) accept the design system's one-time first-load cost, which later surfaces reuse rather than add; (b) authorise the X-1 / X-2 changes knowing they do not clear the stop; (c) move the public/app bundle split into Phase 5 and accept the regression until then |
| 2 | Landing paints after Firebase auth resolves, behind a dark loading screen | Phase 5 app shell (§23.6) |
| 3 | "MARCOM AI / Lumi" byline on Privacy and Terms | legal-entity ruling (§23.7) |
| 4 | "MARCOM AI" in the onboarding AI prompt and in email sender/subjects | backend-authorised slice (§23.7) |
| 5 | Firebase auth domain `marcom-ai-722f0.firebaseapp.com` | infrastructure decision |
| 6 | `WelcomeStep.jsx` ("Welcome to Marcom AI") has no importer | deletion per the Deletion Protocol |
| 7 | `theme-color`, `html.dark`, legacy body classes | app-shell decision (§23.10) |
| 8 | Logo: text placeholder (approved "01 / Current Base" asset unavailable) | the asset; no recreation |
| 9 | CTA instrumentation hooks exist (`data-landing-cta`); **analytics destination is not currently available** | provider and privacy ruling |
| 10 | No OG image, favicon, manifest | approved assets |
| 11 | Copy is new, including the hero category label and footer promise | Product Owner copy review |
| 12 | No pricing source; no market-positioning source (no MENA claim made) | product rulings |
| 13 | Accessibility not performed: screen reader, zoom, forced colours, real phones | a dedicated pass |
| — | §21 items 4, 11, 14–18 | unchanged |

### 23.15 Final gate

```text
GATE            Phase 4 remediation → review
Q-9  Performance        NO — +11,504 B gzip (+4.00 %) remains after every safe in-scope optimisation
Naming                  YES — no active MARCOM AI in the landing or document metadata; ambiguous and
                        backend occurrences reported (§23.7)
Skip link               YES — neutral, test-pinned, rendered in the built document
Visual                  YES — stable at four widths; one deliberate addition (category label)
Other Q-1…Q-13          unchanged from §22
APPROVER                Omar — pending
```

**Recommendation: `BLOCKED`.** The hard stop is not resolved: the regression is smaller, not gone.

- **Safe in-scope optimisations exhausted.** The page's own weight is already below the legacy page's. What remains is the cost of the design-system layer itself, and it can move only through an app-shell split (Phase 5) or through changes this scope forbids (§23.3 X-1, X-2).
- **Asking Omar for a ruling is now warranted** (B-1). With an explicit acceptance of +11,504 B gzip, the recommendation becomes **`READY FOR REVIEW`**.
- **Not `READY FOR PHASE 5`.**

> Kept as the remediation record. Omar ruled on B-1 in the Phase 4 Review Gate spec; the current gate is §24.

---

## 24. Final Review Gate

```text
Spec       LUMI — PHASE 4 REVIEW GATE (accept temporary bundle cost + freeze landing)
Branch     feat/lumi-landing, base b35d22e, uncommitted
Date       2026-09-15
State      Landing implementation FROZEN for visual review. No code changed in this pass:
           no regression was found, so nothing was fixed.
```

### 24.1 Performance ruling

> **Accepted temporary Phase 4 review cost. Final bundle optimization is deferred to Phase 5 app-shell/code-splitting work.**
>
> Omar, 2026-09-15.

This is a **review-stage ruling, not a production-performance waiver.**

| | Scope | Status |
|---|---|---|
| **PHASE 4 REVIEW APPROVAL** (of the bundle cost) | the +11,504 B gzip may stand while Omar reviews the rendered landing | ✅ granted by the ruling |
| **PRODUCTION PERFORMANCE APPROVAL** | the first-load weight a production release ships with | ❌ **not granted.** It remains open until Phase 5 code splitting is done and re-measured. |

The ruling rejects further micro-optimisation. The following were **not** done and must not be done under this ruling:

- shortened production class names (§23.3 X-1);
- stripped contract text (X-2);
- weakened validation;
- lazy-loading that only moves bytes (X-3);
- removed content;
- architecture, routing or auth changes.

### 24.2 Why +11,504 B is accepted temporarily

- **The cost is the design system, not the page** (📏 §23.1):
  - **the landing's own code and copy:** +7,438 B, lighter than the legacy landing's +7,618 B;
  - **the Phase 3 LUMI primitive/grammar layer**, entering the shared entry chunk for the first time: +12,730 B.
- **In-scope reductions are exhausted:** −1,046 B were applied (§23.3). The rest can move only through architecture that this phase forbids.

### 24.3 Phase 5 code-splitting requirement

Phase 5 must do both of the following before production performance approval:

1. **Split the public route(s) from the authenticated application bundle.** That work touches `App.jsx`/`main.jsx` route and provider structure. Reference point 📏: a landing-only build weighed 121,831 B gzip before remediation, against 298,840 B for today's shared first load.
2. **Render public routes outside the root auth-loading gate** (`App.jsx:143-147`, §23.6).

Then re-measure with `measure-dist.mjs` against the 287,336 B baseline, and bring the result for a production-performance decision.

### 24.4 Naming ruling

The active identity is:

- **Product:** LUMI.
- **Category:** Decision Intelligence for Performance Marketing.
- **Browser title:** `LUMI | Decision Intelligence for Performance Marketing`.
- **Positioning:** VERDICTS. NOT DASHBOARDS.

"MARCOM AI" must not be introduced anywhere in the active frontend or landing.

### 24.5 Active MARCOM AI count

| Surface | 📏 Occurrences of `MARCOM AI` / `AI Marketing Decision Engine` |
|---|---:|
| Rendered landing text (Chromium, 1440) | **0**; also 0 for `MARCOM`, `AI-powered` |
| Built document head (`dist/index.html`, Chromium) | **0** |
| Landing source (`client/src/lumi/**`, `client/index.html`, `client/lumi-landing.html`) | **0**, outside tests that forbid the string |
| Built bundle (`client/dist/**`) | **2**: the Privacy Policy and Terms of Service bylines "MARCOM AI / Lumi", both under the ruled legal exception (§24.6) |
| Unreachable source | `pages/OnboardingPage/steps/WelcomeStep.jsx:18`: 📏 no importer and absent from the bundle; a comment in `pages/demo/Operations/index.jsx:2` |

**Active user-facing occurrences outside the ruled exceptions: 0.**

### 24.6 Backend / legal / infrastructure occurrences deferred

> **MARCOM AI backend/legal/infrastructure identity cleanup requires a separate authorised naming migration.**

Untouched by ruling:

- the frozen backend onboarding AI prompt (`src/modes/mode1-onboarding.js:181-193`);
- backend email sender and subject identity (`src/utils/email.js`, `src/routes/master.js:179`);
- the Firebase infrastructure domain `marcom-ai-722f0.firebaseapp.com`;
- legal-company references in Privacy/Terms;
- `@marcom/*` package names;
- `@marcom.ai` addresses;
- `lumi.marcomai.com`;
- `marcom_*` tables and `marcom:*` storage keys;
- historical documentation and technical identifiers.

`WelcomeStep.jsx` is dead code: delete it under the Deletion Protocol, in that migration or in a cleanup slice.

### 24.7 Final visual review (📏 rendered, frozen implementation)

**Review surface.** `client/lumi-landing.html`: the landing inside the application's own CSS and fonts, on the Vite dev server run from `client/`.

**Captures.** Re-captured into `client/lumi-landing-review/` (12 PNGs, 4,000,922 B):

- first screen and full page at 1440, 1024, 768 and 375;
- CTA focus-visible;
- the decision after the illustrative pause;
- questions open;
- the kept legacy baseline.

| Check | Result |
|---|---|
| Hero composition, first viewport | Category label → h1 "Verdicts. Not dashboards." → lead → two CTAs. The dark data→evidence→verdict demonstration starts inside the first screen at every width (top 529 / 529 / 569 / 705 px). |
| Category line | one line at all four widths; meta light, 6.55:1 |
| Decision demonstration | AT DECISION KILL with the illustrative pause, beside NOW REFRESH; the disagreement is stated in words |
| Verdict hierarchy | 9 verdict marks, all in Charcoal bands; verdict words in claim light, never in verdict colour |
| Section rhythm, negative space | Off White sections separated by Charcoal product bands; one claim column; hairline ledgers; no card wall |
| Typography | 📏 Inter / Space Grotesk / JetBrains Mono only; weights 400 / 500 / 600; 0 text under 12 px |
| CTA | 📏 rest transparent with a strong border; hover `rgb(233,233,230)`; pressed `rgb(223,224,221)`; focus-visible 2px `rgb(11,15,20)` outline, no shadow |
| Keyboard focus | 📏 29 stops at 1440 and 25 at 375 (section nav hidden below 688 px); every ring neutral; 0 gold in the walk; skip link first |
| Reduced motion | 📏 0 animations; transition duration `1e-05s` |
| Gold | 📏 0 outside the REALLOCATE verdict mark; selection `rgb(11,15,20)` |
| Verdict colour outside marks | 📏 0 |
| Gradients, glass, glow, effects | 📏 0 `background-image`, `filter`, `backdrop-filter`, `text-shadow` or `box-shadow` on any element |
| Instrument | 📏 the planted probe (gold glow, gradient, gold text, animation) was reported first (6 lines) |
| Console | 📏 0 errors or warnings at 1440 and 375 (load, illustrative action, disclosure) |

**Anti-convergence final check** (logo mentally removed):

| Question | Answer |
|---|---|
| Recognisable as a generic AI SaaS landing? | **No.** There is no hero illustration, gradient, glow, product screenshot mosaic, feature-card grid, logo strip, pricing trio, testimonial or KPI strip. Most of the page is a verdict ledger, a decision spine and honest-absence states, which only this product's grammar produces. *Recorded risk (unchanged from §17):* restrained type on Off White is a common editorial register, and the grammar content carries the identity. → PASS |
| STRUCTURE + LIGHT + NEGATIVE SPACE + SIGNAL, without literal light imagery? | **Yes.** Structure is rules and one axis. Light is text-light steps (inputs meta → questions body → verdict claim). Negative space is a single claim column with macro spacing. Signal is verdict marks only in Charcoal bands. There is no light, sun or bulb imagery. → PASS |
| Centred on decisions rather than dashboards? | **Yes.** The h1 is a positioning against dashboards; the problem section contrasts what a dashboard hands you with what is left to you; the centre of gravity is verdicts and a recorded decision. → PASS |
| Feels like a chatbot product? | **No.** There is no chat input, conversation or assistant persona. The difference ledger and FAQ state that verdicts are not written by a chat model. → PASS |

### 24.8 Responsive review

📏 Horizontal overflow is 0 px at 1440, 1024, 768 and 375.

- **Coarse pointer at 375:** every link, button and summary is ≥ 44 px, except the keyboard-only skip link (1×1 hidden; 30 px tall when focused).
- **Mobile hierarchy:** brand and account actions in the header; the category, h1 and lead in one column; the demonstration, ledgers and axis stacked in reading order.
- **Known, unchanged:** at 768 the header wraps to two rows (§21 item 17).

### 24.9 Accessibility status

**Tested:**

- landmarks and heading order (one h1, no skipped level; test-pinned);
- the keyboard walk and neutral focus rings;
- hover and pressed states;
- focus moves to the illustrative action's `role="status"` confirmation;
- disclosures open by keyboard;
- reduced motion;
- touch targets;
- the skip link on light and dark grounds in the built document;
- contrast of the category line.

**Not tested — no compliance claim is made:**

- screen readers;
- 200–400 % zoom and reflow;
- forced colours;
- real phones.

### 24.10 Data integrity status

📏 **Rendered text census:** every text node containing a digit.

- **9 illustrative strings**, all inside a region labelled "Illustrative example":
  - `computed 2026-09-14 09:00 UTC` ×2;
  - `committed 2026-09-01 09:00 UTC`;
  - `dec_illustrative_01`;
  - `Illustrative account · Since 2026-06-02 · …`;
  - `6 decisions`;
  - `Since 2026-06-02` ×2;
  - `5 of 6`.
- **The product name "Google Analytics 4"** (×2), which is not a figure.
- **None of the following:** pricing, `$`, `%`, customer counts, ROI claims, customer logos, market claims, fake metrics, fake dashboard data or fabricated zeros.

The test-pinned census in `landing.test.jsx` passes.

**Copy integrity:**

| Required message | Rendered |
|---|---|
| LUMI | ✅ header brand placeholder, body copy, footer |
| Decision Intelligence for Performance Marketing | ✅ hero category label, footer |
| VERDICTS. NOT DASHBOARDS. | ✅ h1 |
| CLARITY TURNS COMPLEXITY INTO DECISIONS. | ✅ footer |
| DATA → EVIDENCE → VERDICT → DECISION → ACTION → OUTCOME → MEMORY | ✅ `#how` axis, in that order |
| Decision Memory | ✅ section nav, `#memory` section |
| Budget Allocation | ◐ **communicated, not named verbatim:** "Budget — Allocation plans across campaigns. A plan is something you approve; it is not a verdict." |
| Testing OS | ◐ **communicated, not named verbatim:** "Tests — Experiments and holdouts, read out as whether the change caused the result…" |

The two ◐ rows are left for Product Owner copy review. The landing is frozen, and adding module names is a copy decision, not a regression.

### 24.11 ThreeUI status

Reference only (§9–§10). 📏 Nothing installed or imported. No `three`, `@react-three/*` or WebGL: the static audit test forbids them in LUMI source, and `package.json` is unchanged.

### 24.12 Open assets

| Asset | Status |
|---|---|
| Logo "01 / Current Base" | **missing.** The text placeholder `BrandPlaceholder` stays; nothing recreated or approximated. |
| Social preview (OG) image | missing |
| Favicon | missing |
| Web app manifest | missing |

📏 No approved asset or source exists in the repository (`client/public` has no tracked files).

### 24.13 Analytics status

CTA instrumentation hooks exist: `data-landing-cta="hero"` and `data-landing-cta="start"`. **The analytics destination is not currently available.** Nothing is sent, and no provider or dependency was added.

### 24.14 Final files

No file changed in this final pass other than this audit (§24). The captures were re-rendered in place. The working tree is §23's.

- **Modified (13):**
  - `client/index.html`
  - `client/src/index.css`
  - `client/tailwind.config.js`
  - `client/src/pages/LandingPage.jsx`
  - `client/src/lumi/README.md`
  - `client/src/lumi/index.js`
  - `client/src/lumi/__tests__/lumiAudit.js`
  - `client/src/lumi/__tests__/tokenUsage.test.js`
  - `client/src/lumi/primitives/ChoiceField.jsx`
  - `client/src/lumi/primitives/FieldParts.jsx`
  - `client/src/lumi/primitives/TextField.jsx`
  - `client/src/lumi/primitives/controls.module.css`
  - `client/src/lumi/primitives/layout.module.css`
- **Created:**
  - `PHASE_4_LANDING_VISUAL_LANGUAGE_AUDIT.md`
  - `client/lumi-landing.html`
  - `client/lumi-landing-review/` (12 PNGs)
  - `client/src/lumi/__tests__/actionLink.test.jsx`
  - `client/src/lumi/__tests__/landing.test.jsx`
  - `client/src/lumi/lab/landingMain.jsx`
  - `client/src/lumi/landing/` (`LandingPage.jsx`, `landing.module.css`, `parts.jsx`, `sections/` ×6)
  - `client/src/lumi/primitives/ActionLink.jsx`
  - `client/src/lumi/primitives/fields.module.css`
- **Deleted:** none.

### 24.15 Final validation

| Check | 📏 Result |
|---|---|
| Landing + LUMI + legacy landing + router smoke (`vitest run src/lumi src/pages/LandingPage src/app`) | **375 / 375**, 16 files |
| `npm run lint:ci` | exit 0 |
| `npm run build` | exit 0; same asset hashes as §23.4 (`index-Bvh6ZJZZ.js`, `index-CoAe4tri.css`); dev-only review files absent from `dist/` |
| Bundle measurement | first load 1,081,011 raw · **298,840 gzip** · **251,991 brotli**; delta vs `b35d22e` +11,504 gzip (+4.00 %), +9,346 brotli (+3.85 %) |
| Repository naming search | §24.5 |
| Browser title | `LUMI \| Decision Intelligence for Performance Marketing` (built document, Chromium) |
| Rendered browser review | §24.7 |
| Responsive review | §24.8 |
| Console errors | 0 |
| **Not run** | Full client suite, `tokens:check`, backend tests. No code changed in this pass, and the targeted run covers every module changed in Phase 4. |

### 24.16 Final gate

```text
GATE            Phase 4 — Landing + Visual Language → Omar's visual review
PERFORMANCE     ACCEPTED FOR PHASE 4 REVIEW ONLY (+11,504 B gzip) — NOT production-performance approval;
                final optimisation = Phase 5 code splitting (§24.3)
NAMING          active user-facing MARCOM AI outside the ruled exceptions: 0
VISUAL          frozen implementation passes §24.7, no regression found
ANTI-CONVERGENCE PASS (with the §17 editorial-register risk recorded)
DATA INTEGRITY  PASS — 9 illustrative strings, all labelled; no fabricated figure
ACCESSIBILITY   tested items pass; screen reader / zoom / forced colours / real phones NOT tested
APPROVER        Omar — pending (visual review of the rendered landing)
```

**`READY FOR REVIEW`.**

- **Not `READY FOR PHASE 5`.** Phase 5 begins only after Omar reviews the rendered landing and explicitly approves it.
- **Nothing committed, pushed or merged.**

---

## 25. Post-PR correction — CI `check:tokens` failure (PR #478)

### 25.1 What failed

PR #478's **Architecture & Token Discipline → Token resolution (every colour class exists)** step failed. 📏 `npm run check:tokens` reported 27 colour classes, at 37 call sites, all in `src/pages/LandingPage/**`.

The same failure reproduced locally after `npm run build`.

### 25.2 Cause — a defect introduced in §23 R-1, and missed by validation

- **The mechanism.** R-1 excluded `src/pages/LandingPage/**` from the Tailwind scan. `client/scripts/checkTokenResolution.js` walks **every** file under `src/` and fails on any colour class the compiled CSS does not define. With the legacy files still present, their classes stayed in source but were no longer generated.
- **Why validation missed it.** §23.13 and §24.15 listed "`tokens:check`" as not run, on the grounds that no token source changed. That conflated two different commands:
  - `tokens:check` validates the token source;
  - `check:tokens` asks whether every class in source exists in the build (CLAUDE.md, "Enforcement mechanisms in force").

  A Tailwind content change is exactly what the second one measures, so it should have run.

### 25.3 Fix

| Option | Decision |
|---|---|
| Revert R-1 (restore the Tailwind scan of the legacy landing) | **applied** |
| Make the checker skip `src/pages/LandingPage/**` | rejected. It blinds the existence check in exactly the files where a class cannot resolve, which weakens enforcement. |
| Delete the legacy landing | not authorised. It needs approval and the Deletion Protocol's separate commit (§21 item 10). |

- `client/tailwind.config.js`: the content globs are back to `['./index.html', './src/**/*.{js,jsx,ts,tsx}', '!./src/lumi/**']`, with a comment explaining why a directory that still holds classes must not be excluded.
- `landing.test.jsx`: the pairing test is replaced. The test now pins the only allowed exclusion to `./src/lumi/**` and still checks that the route does not import the legacy page.

The same commit fixes two comments flagged by the PR code review (both scored 50, below the posting threshold):

- `ActionLink.jsx` and `TextLink.jsx`: the error message now reads "`href` (a same-page anchor or an address outside the app)".
- `HeroSection.jsx`: the header comment now matches its light steps.

### 25.4 Re-measured (📏 same `measure-dist.mjs`)

| | Raw | Gzip | Brotli |
|---|---:|---:|---:|
| baseline `b35d22e` | 1,044,498 | 287,336 | 242,645 |
| accepted in §24.1 | 1,081,011 | 298,840 | 251,991 |
| **now** | **1,086,645** | **299,989** | **252,601** |
| delta vs baseline | +42,147 | **+12,653 (+4.40 %)** | +9,956 (+4.10 %) |
| delta vs accepted | +5,634 | **+1,149** | +610 |

**Composition of the +1,149 B:**

- **entry CSS +913 B** (33,280 → 34,193): the legacy-landing utilities are back;
- **entry JS +236 B** (172,816 → 173,052): the only JS change is the longer error-message text in `ActionLink` and `TextLink`.

**⚠️ This exceeds the +11,504 B Omar accepted in §24.1 by 1,149 B**, so the ruling needs acknowledging at the corrected figure. The cause and the Phase 5 remedy are unchanged. Deleting the unreferenced legacy landing (§21 item 10) would recover the CSS part without touching the checker.

### 25.5 Validation after the fix

| Check | 📏 Result |
|---|---|
| `npm run build` | exit 0 |
| `npm run check:tokens` | exit 0; every colour class resolves (1,140 selectors) |
| `vitest run src/lumi src/pages/LandingPage src/app` | 375 / 375 |
| `npm run lint:ci` | exit 0 |