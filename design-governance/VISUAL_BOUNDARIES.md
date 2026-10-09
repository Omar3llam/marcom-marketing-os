# LUMI VISUAL BOUNDARIES

```text
Status   FOUNDATION — part of LUMI_DESIGN_CONSTITUTION.md (Parts I and III); awaiting Review Gate G-1
Date     2026-09-14 · base a3ec116
```

The boundaries say what LUMI **looks like** and what it must **never** look
like. A boundary is enforceable only if a reviewer can point at a pixel and
name the rule, so every entry states **recognisable signals** as well as the
intent behind it.

---

## 1. The metaphor is conceptual

> **LIGHT REVEALS WHAT MATTERS** means *revealing signal*, not *drawing a lamp*.

| The idea | Its correct expression | Its literal failure |
|---|---|---|
| light | illumination hierarchy: the call is the most lit element (Constitution Article 11) | bulbs, lamps, suns, beams, lens flares, rays, halos |
| reveal | a value becomes lit when its data arrives; structure is present before light | spotlight cursors, torch effects, scanning lines |
| signal | one gold point marks what needs a person | glowing dots, pulsing beacons, radar sweeps |
| clarity | negative space and declarative type | soft-focus blurs, fog, depth-of-field |

---

## 2. Approved

| ID | Element | What it means in LUMI | Recognisable signals | Test |
|---|---|---|---|---|
| VB-A1 | **Structure** | order that a reader can see: alignment columns, a rule system, the Decision Spine | continuous hairline rules; consistent column edges; stages hanging off one axis | remove every container border: does grouping still read? It must. |
| VB-A2 | **Light** | importance expressed as luminance on charcoal | the verdict word is the brightest text in its region; metadata steps down; unknown slots are unlit structure | squint: is the brightest thing the call? |
| VB-A3 | **Negative space** | room that ranks: the most space surrounds the most important claim | a verdict with more space around it than any metric; sections separated by space before rules | remove half the space: does priority collapse? Then the space was doing work. |
| VB-A4 | **Signal** | gold for the one thing that needs a person; verdict colour marks the call | one gold point per region; verdict marks paired with verdict words | count gold elements per region: more than one is a defect |
| VB-A5 | **Architectural composition** | layouts built like floor plans: load-bearing axes, clear circulation, rooms with purposes | a primary reading axis; secondary columns subordinate to it; no floating widgets | can each region be named by the question it answers? |
| VB-A6 | **Controlled contrast** | contrast used as information, verified against WCAG | measured ratios (Constitution Article 21); no low-contrast "elegant" grey text for real content | every text/ground pair has a measured ratio |
| VB-A7 | **Warm gold** | `#D4A017`: a considered, warm signal, not a neon yellow | gold appears small and deliberate: a mark, an attention point, the logo | gold is never a large fill or a glow |
| VB-A8 | **Calm precision** | operational confidence: nothing moves unless something changed | static surfaces at rest; mono figures with windows; square or minimal radii | leave a surface open for a minute: nothing should animate |

---

## 3. Forbidden

| ID | Forbidden | Recognisable signals | Why it fails LUMI | Replace with |
|---|---|---|---|---|
| VB-F1 | **Neon** | saturated emissive colours, especially cyan / magenta / electric green; text-shadow glows; outer glows on lines | reads as spectacle; competes with verdict colour for attention | verdict marks at locked values; no glow |
| VB-F2 | **Cyberpunk / sci-fi UI** | scanlines, HUD corner brackets, hexagon grids, glitch effects, terminal-green on black, "SYSTEM ONLINE" labels | fiction of machine power; the legacy "Dual-Agent Ready" and "Context: Locked" were this in text (PR-10) | real status only (Constitution Article 30) |
| VB-F3 | **Glass / glassmorphism** | translucent panels, `backdrop-filter: blur`, frosted overlays, glossy highlights | layers that hide what is behind them contradict "reveal" | flat surfaces; overlays with a flat dimming backdrop |
| VB-F4 | **Generic AI aesthetic** | purple-to-blue gradients, "✨ AI-powered" labels, iridescent blobs, chrome robots, abstract neural meshes | makes LUMI indistinguishable from every AI product; claims intelligence visually instead of demonstrating it through reasoning | show the reasoning: rejected alternatives, evidence, confidence with its weak dimension |
| VB-F5 | **Magic** | wands, stars, "magically", reveal-with-sparkle transitions, "one click" miracle framing | implies LUMI acts without grounds; contradicts "Verdict ≠ Action" (PR-5) and evidence-led trust | declarative verdict + reason |
| VB-F6 | **Sparkles** | ✨ icons on AI features or buttons; sparkle particles | the most convergent AI signifier; the legacy `Sparkles` on "Lumi's read" (audit §23) | no icon, or a functional icon |
| VB-F7 | **AI orbs** | glowing spheres, animated blobs, breathing circles as the "assistant" | anthropomorphises a deterministic engine; `ON_READ` never narrates (B7-01) | Copilot entered from an object, with no avatar (PR-8) |
| VB-F8 | **Decorative gradients** | gradient backgrounds, gradient text, gradient borders, gradient avatars and loaders | 22 legacy instances (audit §9) carried no information | flat tokens |
| VB-F9 | **Decorative glow** | coloured box-shadows on buttons and cards; glowing focus rings; `shadow-*-glow` | six legacy glow tokens, including on primary CTAs (audit §10) | one functional overlay shadow; neutral focus ring |
| VB-F10 | **Generic dashboard aesthetic** | a KPI strip of 4–6 equal cards with deltas and sparklines as the page header; a grid of charts as the home; "Overview" of metrics before any claim | "VERDICTS. NOT DASHBOARDS." (🔒); B8-02 attention deliberately has no KPI strip or chart | the call first; metrics only as evidence of a claim |
| VB-F11 | **Chat-first UX** | a persistent chat column; "Ask anything…" as the hero; message bubbles, typing dots, an assistant avatar; the product entry is a prompt box | PR-8: Copilot is not the primary surface; the legacy `CopilotPanel` on Attention was this (audit §23) | contextual reasoning entered from a grammar object |
| VB-F12 | **Literal light imagery** | lamps, light bulbs, suns, rays, lighthouse, torch | the brief's explicit boundary; the metaphor is conceptual | §1 of this document |
| VB-F13 | **Huge rounded-card grids** | large-radius containers tiled in equal grids; `rounded-2xl/3xl` everywhere (137 legacy uses) | the visual signature of generic SaaS; cards are not the default (Constitution Article 17) | rules, spacing tiers, the spine |
| VB-F14 | **Dashboard wallpaper and decorative charts** | background grid lines, dotted textures, abstract charts without data, radar or "live" pulses | claims liveness or analysis without evidence (the legacy WATCHING pulse and RadarStrip, audit P0-10) | nothing, or real evidence named by a claim |
| VB-F15 | **Emoji as UI** | emoji status icons, emoji section headers | inconsistent rendering; playful register contradicts calm precision | functional icons |
| VB-F16 | **Upsell theatre** | gold glows, shimmering "PRO" badges, locked features with blurred fake data | a lock is a structural state, and fake data violates numeric truth (PR-4, PR-7) | the lock icon + plan name + honest gate |

---

## 4. Environment-specific boundaries (🔒 PR-9)

| | Product (Charcoal, dark-first) | Marketing (Off White, light-first) |
|---|---|---|
| Ground | Charcoal `#0B0F14` | Off White `#F7F7F3`, with **controlled** Charcoal sections |
| Verdict depictions | allowed anywhere, as word + mark | **only inside Charcoal sections**, because Gold (2.21) and HOLD (2.95) fail 3:1 on Off White (📏 Constitution Article 21) |
| Gold | mark, attention point, REALLOCATE | mark and small signal on Charcoal sections; **never text on Off White** |
| Product imagery | n/a | product depictions are either real (with consent and provenance) or labelled **"Illustrative example"**, adjacent to the figures (PR-7) |
| Forbidden additionally | theme switch (PR-9) | stock photos of people pointing at dashboards · device mockups floating at angles with glow · fabricated logos in "trusted by" rows · fabricated statistics (PR-7) · "Always watching" copy (Constitution Article 30) |

"Controlled Charcoal sections" means full-width bands that carry product
expression (a verdict, a decision spine), not alternating stripes for rhythm.

---

## 5. Logo direction (🔒 starting identity · requirements only)

**Starting point:** the approved **01 / Current Base**. It is refined and
systemised, never replaced with a new concept.

> 🔒 Product Owner, 2026-10-08 (P8-06A re-entry): **LUMI Brand v1** is registered
> in `brand/README.md` as two exact approved Illustrator exports: primary stacked
> lockup and symbol. FC-10's earlier missing-source/Figma requirement is superseded
> for these exports. The exact internal gold gradient is approved only as part of
> this artwork, an exception to VB-F8 for the logo alone. Other variants, minimum
> sizes and clear-space guidelines remain pending; measurements are verified on
> the artwork and reviewed by the Product Owner, never invented.

This existing 2026-10-08 artwork exception is cross-registered on 2026-10-09 as
[FC-22](LUMI_DESIGN_CONSTITUTION.md#fc-22-official-logo-gradient). VB-F8 continues
to prohibit decorative UI gradients; no recoloring, derived variant, additional
placement, source-pending artwork or invented guideline is approved here.

**The mark must communicate** `structure + reveal + negative space`, and
**must not primarily read as a pie chart**. A reviewer test: show the symbol
without context to someone unfamiliar with it. If "pie chart" or "chart" is the
first reading, the refinement is not done.

**Gold is controlled and intentional.** At most one gold element in the mark.
Monochrome and reversed variants contain no gold.

**Wordmark.** Custom vector artwork, not typeset in Space Grotesk, Inter or
JetBrains Mono.

**Required variants**

| Variant | Requirement |
|---|---|
| Primary lockup | symbol + wordmark; the one used when space allows |
| Wordmark | standalone, for contexts where the symbol would repeat nearby |
| Symbol | standalone mark; must survive without the wordmark |
| Monochrome | single neutral colour; no gold |
| Reversed | for Charcoal grounds; contrast measured against Charcoal |
| Favicon | legible at the smallest favicon size; simplified drawing if needed, measured on the asset |
| App icon | platform-safe margins; readable on light and dark home screens |
| Social avatar | survives circular crop |
| Minimum-size variants | the smallest size at which each variant stays legible, **measured on the asset**, plus a simplified form below it |

**Forbidden logo uses**

- animated as a loader, spinner or pulse (the AI-orb failure);
- used as a status indicator;
- given a glow, gradient or shadow;
- recoloured with verdict colours;
- redrawn per campaign or season.

---

## 6. How a reviewer uses this document

1. Open the artefact (a Figma frame, a screenshot, a running page).
2. For each Forbidden row, look for its **recognisable signals**. One match is a
   finding, recorded as `VB-Fn` with a location.
3. For each Approved row, run its **test**. A failed test is a finding.
4. Any VB-F finding blocks the artefact at the Review Gate until it is removed,
   or until a recorded ruling permits it (REVIEW_GATE.md).
