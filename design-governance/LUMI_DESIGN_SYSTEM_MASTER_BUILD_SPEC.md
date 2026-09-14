# LUMI DESIGN SYSTEM MASTER BUILD SPEC

## Full Product Design System Reconstruction

**Status:** MANDATORY\
**Scope:** Full LUMI product\
**Execution:** Claude Code\
**Source of truth:** Current repository + this specification\
**Primary objective:** Build a complete, original LUMI design system and
propagate it across the public landing page and authenticated
application without breaking product truth, routing, permissions, state
semantics, or existing functionality.

------------------------------------------------------------------------

## LATEST UPDATE --- BRAND IDENTITY LOCK (SEPTEMBER 2026)

This section is a **design-system authority update** based on the latest
approved LUMI brand direction. It supersedes any earlier visual guidance
that conflicts with the rules below.

### Brand Core

**LUMI = clarity that leads to a decision.**

The brand idea is:

> **LIGHT REVEALS WHAT MATTERS.**

The product promise remains:

> **CLARITY TURNS COMPLEXITY INTO DECISIONS.**

The product positioning remains:

> **VERDICTS. NOT DASHBOARDS.**

The complete product model remains:

**DATA → EVIDENCE → VERDICT → DECISION → ACTION → OUTCOME → MEMORY**

### Meaning of the Name

LUMI is conceptually associated with **light, illumination, visibility
and clarity**. The name should be interpreted as the idea of making the
important signal visible, not as a literal lamp, light bulb, sun or
sparkle.

Use the name to support: - signal emerging from noise - hidden
information becoming visible - focus - insight - clarity - a clearer
path to action

Do not build literal light-bulb, sun, sparkle, magic or "AI
illumination" iconography around the name.

### Approved Visual Territory

The current approved visual territory is:

**STRUCTURE + LIGHT + NEGATIVE SPACE + SIGNAL**

The visual metaphor is architectural light entering a structured dark
environment and revealing what matters.

This is a **brand language**, not a requirement that every asset become
a dark cinematic render.

Extract from the reference: - directional light - reveal - controlled
contrast - architectural geometry - meaningful negative space - warm
gold as a functional signal - calm, precise composition

Do not turn this into: - sci-fi - cyberpunk - neon AI - decorative
glow - generic premium-tech imagery

### Approved Logo Direction

The current preferred logo direction is the **01 / Current Base** mark.

The symbol is a geometric foundation with a gold reveal element. The
preferred interpretation is:

-   black/charcoal form = foundation, structure, stability
-   gold form = light, signal, attention, insight
-   negative space = what is revealed
-   complete mark = focus and clarity

The logo should be refined, not conceptually replaced, unless a genuine
production issue requires it.

The gold element must be optically refined so the mark does not read
primarily as a pie chart.

The final logo system must include: - primary lockup - wordmark only -
symbol only - monochrome - reversed - favicon - app icon - social
avatar - minimum-size variants where optical refinement requires them

The LUMI wordmark should be treated as **customized vector artwork**,
not plain typesetting.

The gold accent over the final `I` may function as a recurring brand
signature, but it must follow a documented geometry rule and must not
become arbitrary decoration.

### Approved Brand Palette

Use the following as the approved brand foundation:

-   **LUMI Gold:** `#D4A017`
-   **Charcoal:** `#0B0F14`
-   **Off White:** `#F7F7F3`
-   **Warm Gray:** `#E6E2DA`

Gold means: - signal - attention - decision

Charcoal means: - depth - focus - stability

Off White means: - clarity - clean space

Warm Gray means: - balance - structure - background

Brand gold is **not** a generic luxury accent and must not be sprayed
across the interface.

Product semantic colors remain separate: - KILL: `#C74646` - HOLD:
`#D97732` - SCALE: `#3D9B6D`

Semantic verdict/status colors must remain functional and must not be
replaced by brand gold.

### Approved Typography System

The LUMI design system remains:

-   **Space Grotesk:** display, headlines and brand character
-   **Inter:** UI, body, navigation, forms and operational text
-   **JetBrains Mono:** metrics, IDs, technical/data values

Do not replace the product typography system with a different brand font
merely because an exploration board uses another typeface.

The logo is the exception: the wordmark may be custom-modified from a
geometric sans-serif foundation and locked as vector artwork.

### Brand Visual Rules

LUMI should feel: - precise - intelligent - decisive - calm -
analytical - focused - operational - confident - evidence-led -
distinctive

The visual system should not feel: - magical - futuristic for its own
sake - theatrical - noisy - playful AI - cyberpunk - generic SaaS -
generic AI

### Logo-to-Product Continuity

The identity must connect naturally to the product grammar:

**LIGHT / SIGNAL → EVIDENCE → VERDICT → DECISION → ACTION**

The brand mark is not a separate decorative layer. Its principles should
inform: - emphasis - focus states - evidence reveals - decision
highlighting - selected states - important attention points - motion -
marketing visuals

Gold should identify **what matters**, not simply "what is branded."

### Design Priority

When visual appeal conflicts with product clarity:

**PRODUCT TRUTH \> DECISION CLARITY \> EVIDENCE \> ACCESSIBILITY \>
BRAND EXPRESSION \> DECORATION**

## 0. Mission

Build LUMI's new design system from the existing repository.

This is **NOT** a generic SaaS redesign.

This is **NOT** a visual refresh only.

This is **NOT** a landing-page-only redesign.

This is **NOT** a request to imitate modern AI products.

The objective is to establish a complete LUMI product language that
begins with the existing landing page, becomes a formal design system,
and then governs the authenticated application.

The resulting system must cover:

-   Brand
-   Landing
-   Visual language
-   Content language
-   Design tokens
-   Components
-   LUMI-specific decision primitives
-   Motion
-   Data visualization
-   State system
-   App shell
-   Application surfaces
-   Responsive behavior
-   Accessibility
-   Performance
-   Documentation
-   Governance
-   QA

The product model is:

**DATA → EVIDENCE → VERDICT → DECISION → ACTION → OUTCOME → MEMORY**

This product model must be visible in the interface.

Do not allow the design to collapse into:

**DATA → DASHBOARD → CHAT → AI DECORATION**

------------------------------------------------------------------------

## 1. Non-Negotiable Execution Rules

## Top-Level Claude Code Execution Discipline

## AI Coding Agent Operating Contract

The implementation agent is expected to take end-to-end ownership of
execution while preserving human control over irreversible or
identity-defining decisions.

The agent must:

1.  Inspect the repository before making architectural assumptions.
2.  Perform the smallest useful investigation before changing code.
3.  Fix obvious implementation issues encountered during the current
    task when they are directly relevant and low-risk.
4.  Produce explicit artifacts for major discovery and verification
    phases.
5.  Keep human requests short and decision-oriented when an unavoidable
    choice is required.
6.  Never use missing information as a reason to invent product
    behavior.
7.  Never trade product truth for visual completeness.

For deployment, production-readiness, or infrastructure work, create
explicit checklists and verification artifacts before declaring the
system ready.

These rules apply to every phase:

1.  Read only the repository files required for the current decision.
2.  Prefer targeted search and focused file reads over dumping large
    files into context.
3.  Reuse existing components, tokens, utilities, contracts, and tests
    when they satisfy the requirement.
4.  Do not refactor unrelated code while implementing the design system.
5.  Keep implementation batches small enough to verify independently.
6.  Run the narrowest relevant verification after each meaningful batch.
7.  Do not invent missing product behavior to make a screen look
    complete.
8.  When repository truth conflicts with this document, record the
    conflict and resolve it before destructive changes.

### Rule 1: Repository First

Before changing UI, inspect the repository.

Do not design from assumptions.

Inspect:

-   current routes
-   current pages
-   current components
-   current design tokens
-   current CSS
-   Tailwind configuration
-   existing typography
-   existing color system
-   existing state vocabulary
-   verdict vocabulary
-   API contracts consumed by UI
-   role gates
-   plan gates
-   responsive behavior
-   current landing page
-   existing motion utilities
-   existing design-system documentation
-   tests related to UI behavior
-   existing visual primitives

Do not modify working product behavior because a new design is being
created.

### Rule 2: Preserve Product Truth

The redesign must not alter:

-   business logic
-   verdict logic
-   API contracts
-   data semantics
-   permissions
-   role gates
-   plan gates
-   routing semantics
-   absence vocabulary
-   measurement vocabulary
-   currency handling
-   unreadable-state handling
-   decision ownership
-   deep-link behavior
-   existing governance rules

Visual redesign must sit on top of product truth.

### Rule 3: Do Not Rebuild Functionality

If a current component already performs the required behavior, reuse or
refactor it.

Do not rewrite working logic simply because the visual implementation is
changing.

Separate:

**VISUAL CHANGE**

from

**BEHAVIOR CHANGE**

Behavior changes require an explicit product reason.

### Rule 4: Landing Page Is the Starting Artifact

The existing LUMI landing page is the visual baseline.

Do not throw it away and replace it with a generic SaaS landing page.

Preserve its strongest existing characteristics.

Evolve them.

The landing page is the first expression of the new LUMI design
language.

### Rule 5: One Design Language

The landing and app may differ in density and expression, but they must
clearly belong to the same product.

**Landing:** expressive, narrative, persuasive, visual, spacious.

**Application:** operational, analytical, dense where useful,
decision-focused, information-rich.

Same DNA. Different context.

------------------------------------------------------------------------

## 2. Reference Governance

External references are research sources.

They are **NOT** design templates.

Use references only to understand:

-   interaction patterns
-   information hierarchy
-   navigation mechanics
-   investigation flows
-   filtering
-   progressive disclosure
-   recommendation flows
-   evidence presentation
-   decision history
-   responsive patterns
-   data visualization mechanics
-   accessibility patterns

Never copy:

-   colors
-   typography
-   gradients
-   card styling
-   navigation appearance
-   component appearance
-   page composition
-   iconography
-   illustration style
-   motion style
-   visual hierarchy
-   branding
-   recognizable UI combinations

Required process:

**REFERENCE → EXTRACT PATTERN → IDENTIFY USER PROBLEM → TRANSLATE INTO
LUMI PRODUCT MODEL → CREATE ORIGINAL LUMI SOLUTION → RUN SIMILARITY
CHECK → IMPLEMENT**

Never:

**REFERENCE → COPY → IMPLEMENT**

------------------------------------------------------------------------

## 3. Approved Reference Set

### Mobbin

Use for:

-   real shipped interaction patterns
-   navigation
-   filters
-   tables
-   mobile behavior
-   drill-down
-   flows
-   responsive patterns

Do **not** use for visual identity.

Mobbin is a pattern research source.

### SaaSUI / SaaSFrame

Use for:

-   SaaS information architecture
-   dashboard hierarchy
-   progressive disclosure
-   state handling
-   interaction patterns
-   density

Do not copy their visual style.

### Triple Whale

Use for:

-   marketing intelligence workflows
-   investigation
-   workspace concepts
-   modern movement from dashboards toward decision systems
-   strategic understanding of the category

Do not copy:

-   navigation
-   dashboard composition
-   Moby/copilot presentation
-   cards
-   colors
-   visual language

Triple Whale is a category benchmark, not a visual template.

### Madgicx

Use for:

-   recommendation reasoning
-   recommendation → explanation → action patterns
-   decision support

Do not copy its AI visual language.

### Northbeam

Use for:

-   investigation
-   analytical context
-   drill-down
-   metric explanation
-   reducing interpretation effort

Do not copy its visual composition.

### Polar

Use for:

-   metric visualization
-   charts
-   tables
-   overview → detail patterns

Do not turn LUMI into a conventional analytics dashboard.

------------------------------------------------------------------------

## 4. Anti-Convergence Governance

LUMI **MUST NOT** visually converge toward generic AI products.

This is a hard constraint.

The design must not resemble:

-   ChatGPT
-   Claude
-   Gemini
-   Perplexity
-   generic AI copilots
-   generic AI SaaS
-   generic analytics dashboards
-   marketing intelligence dashboards
-   recognizable competitor interfaces

### Forbidden Default Visual Language

Do not introduce:

-   purple/blue AI gradients
-   neon gradients
-   glowing borders
-   excessive glow
-   glassmorphism
-   frosted glass
-   floating AI orbs
-   AI particle effects
-   sparkle-based AI iconography
-   robot imagery
-   generic AI illustrations
-   futuristic AI decoration
-   excessive dark futuristic UI
-   decorative gradient backgrounds
-   glowing KPI cards
-   decorative intelligence meters
-   excessive pills
-   excessive giant rounded cards
-   generic command-palette-as-product
-   chatbot-first architecture
-   chat-first navigation
-   AI assistant dominating the interface
-   decorative "AI powered" labels

Do not replace one generic visual language with another.

"Minimal" is not automatically LUMI.

"Dark" is not automatically LUMI.

"Premium" is not automatically LUMI.

"Modern" is not automatically LUMI.

------------------------------------------------------------------------

## 5. LUMI Positive Design Language

LUMI should feel:

-   precise
-   operational
-   calm
-   analytical
-   confident
-   evidence-driven
-   decision-oriented
-   trustworthy
-   distinctive
-   focused

### Core Visual Formula

**STRUCTURE + LIGHT + NEGATIVE SPACE + SIGNAL**

The visual system should communicate that LUMI reveals the important
signal inside complexity.

### Architectural Light

Use: - directional light - controlled reveals - thresholds and
openings - strong light/dark relationships - restrained warm
illumination - purposeful focal points

Light is a visual metaphor for **clarity and attention**, not a
decorative special effect.

### Geometry

Use: - simple geometric forms - strong proportions - meaningful negative
space - controlled curves - architectural structure - repeatable
geometry

The preferred logo direction is the **01 / Current Base** geometric
mark. Refine its proportions and gold reveal rather than replacing the
concept casually.

### Gold

Gold is the LUMI signal color.

Use it to identify: - what matters - the important signal - focus -
attention - decision points

Do not use gold to fill every component.

### What LUMI Must Not Become

Avoid making LUMI feel:

-   magical
-   futuristic
-   theatrical
-   noisy
-   playful for the sake of appearing modern
-   AI-showcase-like
-   cyberpunk
-   luxury-tech for its own sake

The product should feel intelligent because it behaves intelligently.

## 6. LUMI Product Grammar

The following are first-class product objects:

1.  VERDICT
2.  EVIDENCE
3.  REASON
4.  ACTION
5.  DECISION
6.  OUTCOME
7.  MEMORY
8.  ATTENTION
9.  MEASUREMENT

Every major surface must clearly express one or more of these.

Metrics are supporting objects.

Charts are supporting objects.

Tables are supporting objects.

Cards are supporting containers.

The decision model is the product.

### Primary Relationship

Make this relationship visually understandable:

**VERDICT → WHY → EVIDENCE → ACTION → OUTCOME → MEMORY**

------------------------------------------------------------------------

## 7. Existing LUMI Product Model

Do not invent a new application architecture.

Discover and preserve the current application surfaces.

Current product concepts include:

-   Attention / Overview
-   Decisions
-   Decision Detail
-   Campaigns
-   Reports / Leadership
-   Memory
-   Connectors
-   Intelligence / Blended Truth
-   Testing
-   Measurement
-   Growth Strategy
-   Content / tools surfaces
-   Settings
-   Publishing / approval-related surfaces where currently active

Respect current role and plan gating.

Do not flatten all surfaces into one dashboard.

Do not turn all surfaces into chat.

Do not merge destinations merely because they look similar.

The existing route and object ownership model is part of product truth.

------------------------------------------------------------------------

## 8. Phase 0: Repository Discovery

Before implementation, create a design-system audit.

Inspect the repository and produce:

A. Current visual inventory\
B. Current component inventory\
C. Current token inventory\
D. Current landing inventory\
E. Current application surface inventory\
F. Current state vocabulary\
G. Current motion inventory\
H. Current responsive behavior\
I. Current accessibility behavior\
J. Current duplicated or conflicting visual patterns\
K. Current dead/legacy visual primitives\
L. Existing design-system documentation\
M. Existing design-system tests or architectural checks

Do not modify the UI during this phase unless required to inspect it.

Create:

`DESIGN_SYSTEM_AUDIT.md`

The audit must distinguish:

-   KEEP
-   EVOLVE
-   CONSOLIDATE
-   REPLACE
-   REMOVE
-   UNKNOWN

Do not guess UNKNOWN values.

------------------------------------------------------------------------

## 9. Phase 1: LUMI Design Constitution

Create a short source-of-truth document.

Recommended:

`design-governance/LUMI_DESIGN_CONSTITUTION.md`

It must define:

-   product identity
-   design principles
-   product grammar
-   visual principles
-   anti-convergence rules
-   reference policy
-   motion philosophy
-   accessibility philosophy
-   state philosophy
-   component philosophy

This document is higher authority than individual component preferences.

------------------------------------------------------------------------

## 10. Phase 2: Visual Foundation

Establish the LUMI visual system without blindly replacing existing
repository tokens.

First map existing tokens. Then determine:

-   KEEP
-   MERGE
-   RENAME
-   DEPRECATE
-   ADD

### Brand Foundations

Define: - brand color - semantic color - typography - spacing - grid -
layout - radius - borders - elevation - iconography - imagery -
illustration - motion - density

### Brand Color Foundation

Approved brand colors:

-   **LUMI Gold:** `#D4A017`
-   **Charcoal:** `#0B0F14`
-   **Off White:** `#F7F7F3`
-   **Warm Gray:** `#E6E2DA`

Use semantic roles rather than raw colors throughout product code.

Gold represents: - signal - attention - decision

Charcoal represents: - depth - focus - stability

Off White represents: - clarity - clean space

Warm Gray represents: - balance - structure - background

### Product Semantic Color

Brand colors and product status colors are separate systems.

Current product verdict colors include: - KILL: `#C74646` - HOLD:
`#D97732` - SCALE: `#3D9B6D`

Preserve all existing semantic verdict/state colors and repository
truth. Do not recolor product states simply to make the brand palette
more uniform.

### Typography

The approved LUMI typography system is:

-   **Space Grotesk:** display, headlines and brand character
-   **Inter:** UI, body, navigation, forms and operational text
-   **JetBrains Mono:** metrics, IDs and technical/data values

Define semantic roles: - display - page title - section title - decision
title - verdict - metric - body - supporting - label - metadata -
mono/data

Typography must communicate:

**DECISION IMPORTANCE \> EVIDENCE \> CONTEXT**

Do not create hierarchy by making everything large.

### Logo Typography

The LUMI wordmark is a brand asset, not normal body typography.

Use a customized geometric sans-serif foundation and lock the final
wordmark as vector artwork. Refine: - letter proportions - kerning -
spacing - `I` treatment - gold accent geometry

Do not substitute the wordmark with ordinary text in final brand assets.

### Visual Language

The approved visual territory is:

**STRUCTURE + LIGHT + NEGATIVE SPACE + SIGNAL**

Use architectural light, directional reveal, controlled contrast and
meaningful negative space.

Do not make glow, glass, gradients or cinematic effects the default
product UI language.

### Spacing

Establish a consistent scale.

Avoid arbitrary values.

### Radius

Define a deliberate radius philosophy.

Do not default every element to rounded-xl/2xl.

### Elevation

Use elevation only when it establishes hierarchy or interaction.

### Iconography

Icons must communicate function.

Do not use sparkle icons, robots, magical intelligence symbols or
decorative AI motifs as generic product language.

## 11. Phase 3: Content Design System

Content is part of the design system.

Define:

-   voice
-   terminology
-   button language
-   headings
-   labels
-   helper text
-   tooltips
-   confirmation language
-   error language
-   empty-state language
-   verdict language
-   evidence language
-   action language
-   measurement language

Core language principle:

**Be precise.**

Do not exaggerate.

Do not claim certainty when evidence is insufficient.

Avoid generic AI marketing language.

Avoid:

-   "AI-powered"
-   "AI magic"
-   "Smart everything"
-   "Intelligent insights"

unless there is a specific product reason and the language is genuinely
useful.

LUMI should explain what happened and what can be done.

------------------------------------------------------------------------

## 12. Phase 4: Landing Page System

The existing landing page is the baseline.

Do not discard its strongest current visual direction.

The landing page must become the first complete expression of the LUMI
design system.

### Required Landing Architecture

1.  Navigation
2.  Hero
3.  Problem / reality
4.  LUMI operating model
5.  Verdict system
6.  Evidence / reasoning
7.  Product walkthrough
8.  Before LUMI / With LUMI
9.  Decision Memory
10. Trust / data integrity
11. Who LUMI is for
12. Integrations / connectors
13. Objection handling
14. Pricing
15. FAQ
16. Final CTA
17. Footer

Do not add sections simply to make the page longer.

Every section must have:

-   PURPOSE
-   MESSAGE
-   PROOF
-   VISUAL
-   CTA OR NEXT STEP

### Hero

Preserve the current core direction:

> "Know what to do next. After every sync."

Do not replace it with generic AI positioning.

The hero visual must be a meaningful product demonstration.

Prefer:

**DATA → VERDICT → EVIDENCE → ACTION**

over a decorative screenshot.

### Signal to Action

Make the LUMI operating model visually understandable:

**SIGNAL → EVIDENCE → VERDICT → ACTION → MEMORY**

Use motion where appropriate.

### Verdict Section

Show:

-   KILL
-   HOLD
-   SCALE
-   REFRESH
-   REALLOCATE
-   WATCH

Do not treat these as decorative badges.

They are decision objects.

### Why LUMI Said KILL

Keep this concept.

Upgrade it into a strong product demonstration.

Show:

**VERDICT → WHY → EVIDENCE → RECOMMENDED ACTION**

### Decision Memory

Add a dedicated visual section.

Show:

**DECISION → OUTCOME → LEARNING → FUTURE DECISION**

This must communicate that LUMI remembers outcomes and decisions.

### Trust

Show that LUMI does not manufacture certainty.

Use real product vocabulary where appropriate:

-   measured
-   not measured
-   insufficient data
-   unreadable
-   no measurement
-   mixed currency
-   request failure

Core message:

**LUMI should be honest about what it cannot know.**

### Objection Handling

Address:

-   "I already have dashboards."
-   "I already know how to analyze campaigns."
-   "What if my data is incomplete?"
-   "Does LUMI execute changes automatically?"
-   "Which platforms can I connect?"
-   "Who is LUMI for?"

Do not invent capabilities.

### FAQ

Build an actual FAQ.

Questions should come from product objections, not SEO filler.

Use progressive disclosure.

Do not turn FAQ into giant text blocks.

------------------------------------------------------------------------

## 13. Landing Page Visual Storytelling

The landing page currently has product UI fragments.

Upgrade them into real visual storytelling.

Required visual categories:

1.  Product in action
2.  Decision journey
3.  Evidence reveal
4.  Verdict reveal
5.  Before / after workflow
6.  Decision Memory timeline
7.  Trust / data-state visualization
8.  Actual application previews

At least three substantial product visuals should show real LUMI UI.

Do not use fake dashboards that do not correspond to the actual product.

Where possible, use actual product components.

The marketing site should visually prove the product.

------------------------------------------------------------------------

## 14. Phase 5: Motion System

Motion is a first-class part of the design system.

Do not add motion as a finishing effect.

Define:

-   duration tokens
-   easing tokens
-   enter
-   exit
-   disclosure
-   state change
-   emphasis
-   page transition
-   scroll behavior
-   reduced-motion behavior

### LUMI Motion Principle

Motion communicates:

-   state
-   causality
-   hierarchy
-   disclosure
-   transition
-   confirmation

Motion must **NOT** exist merely to make the product look "AI."

### Decision Reveal

Create a reusable LUMI motion pattern:

**CAMPAIGN → SIGNAL → VERDICT → EVIDENCE → ACTION**

This can appear on the landing page and inside the app.

### Landing Motion

Potential patterns:

-   hero product reveal
-   scroll-driven signal → action
-   verdict reveal
-   evidence reveal
-   decision memory timeline
-   subtle section transitions
-   product screenshot transitions
-   hover/focus evidence highlighting

Do not make every section scroll-animated.

### App Motion

Use motion for:

-   expanding evidence
-   opening decision details
-   changing state
-   action confirmation
-   filtering
-   disclosure
-   navigation transition

Do not use:

-   shimmer
-   AI glow
-   particles
-   floating blobs
-   fake thinking animation
-   perpetual motion

Support:

`prefers-reduced-motion`

------------------------------------------------------------------------

## 15. Phase 6: Core Component System

Create a coherent component library.

Foundational components should include where needed:

-   Button
-   Link
-   Input
-   Select
-   Combobox
-   Checkbox
-   Radio
-   Switch
-   Tabs
-   Menu
-   Tooltip
-   Popover
-   Modal
-   Drawer
-   Toast
-   Alert
-   Badge
-   Status
-   Table
-   Pagination
-   Search
-   Filter
-   Date range
-   Skeleton
-   Empty state
-   Error state
-   Loading state
-   Progress
-   Divider
-   Avatar where needed

Do not create components merely because a UI library has them.

Create only components required by LUMI.

------------------------------------------------------------------------

## 16. LUMI-Specific Component System

These are more important than generic primitives.

Formalize or create:

### Verdict

Represents the system's judgment.

Must support all current verdict vocabulary.

Must support:

-   label
-   context
-   severity/meaning
-   confidence where supported
-   evidence access
-   reasoning access
-   action access
-   states

### Evidence

Represents proof behind a verdict.

Must support:

-   metric
-   comparison
-   trend
-   threshold
-   source
-   timeframe
-   measurement state
-   drill-down

### Reason

Explains why the evidence leads to the conclusion.

Do not expose fabricated model internals.

Explain observable decision logic.

### Action

Represents what should happen next.

Must distinguish:

-   recommendation
-   available action
-   completed action
-   unavailable action
-   blocked action

### Decision

The decision is a first-class object.

Support:

-   verdict
-   campaign/entity
-   timestamp
-   reasoning
-   evidence
-   action
-   outcome
-   history

### Outcome

Represents what happened after a decision.

### Memory

Represents learned history across decisions.

Must not look like generic AI memory/chat.

### Attention

Represents what requires attention now.

Must not become a generic KPI dashboard.

### Measurement

Represents whether the evidence substrate can be trusted.

------------------------------------------------------------------------

## 17. State System

State is part of LUMI's product truth.

Do not collapse everything into:

> "No data."

Support the repository's actual semantic vocabulary.

At minimum account for:

-   loading
-   loaded
-   valid empty
-   partial
-   unreadable
-   request failed
-   insufficient data
-   not measured
-   no measurement
-   no conversions
-   mixed currency
-   not permitted
-   stale
-   processing
-   success
-   disabled

Do not invent contradictory state labels.

If an existing server/client vocabulary exists, consume it.

The visual system must preserve semantic distinctions.

------------------------------------------------------------------------

## 18. Data Visualization System

Create a deliberate visualization system.

Supported visualization roles may include:

-   trend
-   comparison
-   target vs actual
-   threshold
-   distribution
-   time series
-   before/after
-   evidence timeline
-   decision outcome
-   attribution where supported

Every chart must answer:

1.  What question does this answer?
2.  What evidence does it provide?
3.  What decision does it support?

If these cannot be answered:

**DO NOT ADD THE CHART.**

Charts are evidence.

Charts are not decoration.

------------------------------------------------------------------------

## 19. Table System

Tables are important for performance marketing.

Support:

-   readable rows
-   unreadable rows
-   sorting
-   filtering
-   selection where valid
-   row actions
-   expandable details
-   density variants
-   responsive behavior
-   loading
-   empty
-   error
-   partial
-   unavailable

Never silently drop unreadable records when product truth requires
preserving them.

------------------------------------------------------------------------

## 20. Card Governance

Cards are not the default UI primitive.

Use a card when:

-   information forms a meaningful object
-   decision context needs a boundary
-   evidence needs grouping
-   action needs grouping
-   an independent entity needs separation

Do not create cards for every metric.

Do not create a wall of rounded rectangles.

If every element becomes a card:

**STOP AND REASSESS.**

------------------------------------------------------------------------

## 21. App Shell

Redesign the app shell using the new LUMI system.

Preserve:

-   current routing
-   current role behavior
-   current plan behavior
-   current destinations
-   current deep links
-   current accessibility requirements

The shell must support:

-   navigation
-   workspace/context
-   page title
-   contextual actions
-   breadcrumbs where useful
-   responsive navigation
-   notification/status patterns where real
-   consistent page transitions

Do not turn the shell into a generic AI sidebar.

------------------------------------------------------------------------

## 22. Application Surfaces

Redesign each active surface using the same system.

### Attention

Primary question:

> "What needs attention now?"

Lead with decisions and severity.

Do not lead with a wall of KPIs.

### Decisions

Primary question:

> "What decisions exist?"

Use decision ledger patterns.

Support:

-   filtering
-   sorting
-   status
-   timeframe
-   detail
-   outcome

### Decision Detail

Primary flow:

**VERDICT → WHY → EVIDENCE → ACTION → OUTCOME → MEMORY**

Preserve context.

Do not force unnecessary page transitions.

### Campaigns

Campaigns are an investigation lens.

They are not merely a data table.

Support:

-   discovery
-   filtering
-   verdict filtering
-   investigation
-   deep linking
-   campaign context
-   decision access

### Reports

Reports should communicate:

-   What happened?
-   Why?
-   What matters?
-   What should leadership know?

Do not turn Reports into a generic BI dashboard.

### Memory

Memory should answer:

> "What did we learn from previous decisions?"

Show relationships between:

**decision → outcome → learning → future use**

### Connectors

Connectors should communicate:

-   Where does evidence come from?
-   What is connected?
-   What is syncing?
-   What is healthy?
-   What is unavailable?

Do not make connectors decorative logo grids.

### Testing

Testing is a product surface.

Design it as a testing/decision system, not a generic analytics
dashboard.

### Measurement

Measurement communicates whether LUMI can trust the evidence substrate.

Make measurement states understandable.

Do not hide uncertainty.

### Intelligence

Preserve the current distinction between intelligence, truth, memory,
and decisions.

Do not collapse everything into an AI assistant.

------------------------------------------------------------------------

## 23. Responsive System

Define responsive behavior intentionally.

Do not simply add:

> "mobile: stack everything."

Support:

-   desktop
-   laptop
-   tablet
-   mobile

For each major component define:

-   layout transformation
-   density transformation
-   navigation behavior
-   table behavior
-   drawer behavior
-   modal behavior
-   typography changes
-   motion changes

Landing page must be mobile-first credible.

Application must remain usable at narrow widths.

------------------------------------------------------------------------

## 24. Accessibility

Maintain and improve existing accessibility infrastructure.

Target:

**WCAG 2.2 AA where practical.**

Required:

-   keyboard navigation
-   visible focus
-   semantic HTML
-   screen-reader labels
-   sufficient contrast
-   reduced motion
-   accessible forms
-   accessible tables
-   accessible dialogs
-   accessible menus
-   accessible status messages
-   touch target sizing

Do not sacrifice accessibility for visual polish.

------------------------------------------------------------------------

## 25. Performance

The landing page must remain fast.

Avoid:

-   unnecessary JS
-   heavy animation libraries
-   huge images
-   excessive blur
-   expensive continuous animations
-   unnecessary video
-   duplicate component logic

Optimize:

-   images
-   fonts
-   lazy loading
-   animation
-   layout stability
-   CSS
-   bundle impact

Visual storytelling must not become a performance liability.

------------------------------------------------------------------------

## 26. SEO / Marketing Engineering

The public landing page must preserve or improve:

-   semantic HTML
-   heading hierarchy
-   metadata
-   Open Graph
-   crawlability
-   Core Web Vitals
-   CTA tracking
-   conversion events

Track meaningful interactions such as:

-   hero CTA
-   product walkthrough interaction
-   pricing interaction
-   FAQ expansion
-   signup
-   connector start
-   first verdict

Do not add fake analytics.

------------------------------------------------------------------------

## 27. Component Documentation

Every major reusable component must document:

-   purpose
-   anatomy
-   variants
-   states
-   behavior
-   accessibility
-   responsive behavior
-   motion
-   usage
-   do
-   don't

The design system must be understandable by another developer.

------------------------------------------------------------------------

## 28. Token Governance

Do not create arbitrary tokens.

Every token must have a semantic purpose.

Avoid token names based on visual fashion.

Bad:

``` text
--ai-purple
--magic-glow
--futuristic-blue
```

Better:

``` text
--color-verdict-kill
--color-verdict-scale
--color-attention-critical
--color-surface-primary
--color-text-primary
--color-evidence-boundary
```

Before adding a token:

1.  Search for an existing equivalent.
2.  Reuse if appropriate.
3.  Merge if duplicated.
4.  Add only when necessary.
5.  Document semantic purpose.

------------------------------------------------------------------------

## 29. Engineering Governance

The design system must be implemented as reusable code.

Prevent:

-   duplicated visual primitives
-   one-off colors
-   arbitrary spacing
-   arbitrary radius
-   duplicate buttons
-   duplicate cards
-   duplicate state treatments
-   page-specific versions of global primitives

Prefer:

**FOUNDATION → PRIMITIVE → LUMI COMPONENT → SURFACE**

Do not create:

**SURFACE → CUSTOM CSS → ANOTHER CUSTOM CSS → THIRD BUTTON VARIANT**

------------------------------------------------------------------------

## 30. Migration Strategy

Do not rewrite the application in one giant change.

Use:

**AUDIT → FOUNDATION → TOKENS → PRIMITIVES → LANDING → MOTION → APP
SHELL → SURFACE MIGRATION → CLEANUP → QA**

Migrate surface by surface.

Do not remove old code until the replacement is verified.

------------------------------------------------------------------------

## 31. Visual Regression Safety

Before replacing existing components, identify:

-   functional dependencies
-   state dependencies
-   tests
-   routes
-   responsive behavior
-   accessibility behavior

After migration:

run relevant tests.

Do not accept:

> "Looks good in the browser."

as sufficient verification.

------------------------------------------------------------------------

## 32. Anti-Convergence Review Gate

Every major surface must pass all of the following.

### Test 1: Visual Resemblance

Does this visually resemble a recognizable AI product?

If yes:

**FAIL.**

### Test 2: Structural Resemblance

Does the combination of layout + components + navigation resemble a
known competitor?

If yes:

**REWORK.**

### Test 3: Behavioral Resemblance

Does the product behave like a generic AI copilot?

If yes:

**REWORK.**

### Test 4: Decorative Resemblance

Are gradients, glow, glass, iconography, or motion borrowed from AI
conventions?

If yes:

**REMOVE OR REWORK.**

### Test 5: Transfer Test

Could this component be dropped into:

-   ChatGPT
-   Claude
-   Gemini
-   Perplexity
-   generic SaaS analytics
-   generic marketing analytics

with almost no changes?

If yes:

**FAIL.**

### Test 6: Why LUMI Test

Can you explain in one sentence why this component exists specifically
in LUMI?

If no:

**FAIL.**

------------------------------------------------------------------------

## 33. Component Design Review Protocol

Before implementing a major new component, write:

``` text
COMPONENT:
[what is being created]

USER PROBLEM:
[problem]

LUMI CONCEPT:
[verdict/evidence/reason/action/decision/outcome/memory/etc.]

USER DECISION:
[decision supported]

INFORMATION RELATIONSHIP:
[what belongs together]

REFERENCE:
[reference used, if any]

PATTERN EXTRACTED:
[what was learned]

LUMI TRANSFORMATION:
[how it was redesigned]

SIMILARITY RISK:
[what products it could resemble]

DIFFERENTIATION:
[why it is specifically LUMI]

STATE MODEL:
[loading/empty/unreadable/etc.]

MOTION:
[if applicable]
```

Only then implement.

------------------------------------------------------------------------

## 34. Landing Page Content Review

Every section must answer one of:

**EXPLAIN**

**PROVE**

**CONVERT**

If a section does none of these:

**REMOVE IT.**

Avoid:

-   feature dumping
-   generic claims
-   filler sections

The page should progressively answer:

-   What is LUMI?
-   Why does it exist?
-   How does it work?
-   What does it actually show me?
-   Why should I trust it?
-   Who is it for?
-   What happens after I sign up?
-   Why is it different?
-   What does it cost?
-   What are the objections?
-   What do I do next?

------------------------------------------------------------------------

## 35. Visual System Review

After implementation, review the complete experience at once.

Do not inspect only component-by-component.

Check:

-   visual rhythm
-   typography hierarchy
-   density
-   surface consistency
-   semantic color
-   component reuse
-   whitespace
-   section transitions
-   visual storytelling
-   motion consistency
-   product/marketing continuity

The system must feel intentional when viewed as a whole.

------------------------------------------------------------------------

## 36. Design Drift Prevention

Create governance files in the repository.

Recommended:

``` text
design-governance/
  README.md
  LUMI_DESIGN_CONSTITUTION.md
  DESIGN_SYSTEM_AUDIT.md
  PRODUCT_GRAMMAR.md
  VISUAL_BOUNDARIES.md
  REFERENCE_POLICY.md
  COMPONENT_RULES.md
  STATE_RULES.md
  MOTION_RULES.md
  ANTI_CONVERGENCE.md
  REVIEW_GATE.md
```

These documents become the long-term design source of truth.

------------------------------------------------------------------------

## 37. Automated Guardrails

Where technically practical, add automated checks for:

-   unauthorized colors
-   duplicated tokens
-   forbidden gradient patterns
-   excessive blur/glass usage
-   forbidden AI icon assets
-   duplicate component primitives
-   hardcoded semantic colors
-   arbitrary radius
-   arbitrary spacing
-   design-system bypasses

Automated checks cannot fully detect visual resemblance.

Human/product review remains required.

------------------------------------------------------------------------

## 38. Hard Stop Conditions

**STOP implementation** if:

-   visual identity begins resembling generic AI SaaS
-   competitor UI is being copied
-   landing page becomes generic SaaS
-   app becomes generic dashboard
-   chat becomes the dominant interface without a product requirement
-   gradients become dominant
-   glass becomes dominant
-   every object becomes a card
-   charts are added without decision purpose
-   AI decoration becomes more prominent than product evidence
-   existing product truth is being altered for visual reasons
-   semantic states are being collapsed
-   permissions or routes are being changed unintentionally
-   design decisions cannot be tied to LUMI's product model

Do not continue blindly.

Resolve the governance conflict first.

------------------------------------------------------------------------

## 39. Execution Phases

### Phase 0: Repository Audit

Output:

`DESIGN_SYSTEM_AUDIT.md`

Do not redesign yet.

### Phase 1: LUMI Design Constitution

Output:

Design governance documents.

Do not implement major UI yet.

### Phase 2: Visual Foundation

Implement:

-   tokens
-   typography
-   colors
-   spacing
-   radius
-   elevation
-   iconography
-   layout foundations

Validate against existing UI.

### Phase 3: Core Primitives

Implement/reconcile:

-   buttons
-   inputs
-   navigation
-   overlays
-   tables
-   state primitives
-   feedback

### Phase 4: LUMI-Specific Primitives

Implement:

-   Verdict
-   Evidence
-   Reason
-   Action
-   Decision
-   Outcome
-   Memory
-   Attention
-   Measurement

### Phase 5: Landing Page

Evolve existing landing.

Add missing:

-   stronger product visuals
-   visual storytelling
-   Decision Memory
-   trust/data integrity
-   objections
-   FAQ
-   actual product walkthrough
-   stronger conversion structure

Do not discard the current visual direction without evidence.

### Phase 6: Motion

Build motion system and apply it to:

-   landing
-   components
-   verdict reveal
-   evidence disclosure
-   decision transitions
-   memory storytelling

### Phase 7: App Shell

Apply LUMI visual language to:

-   navigation
-   layout
-   page headers
-   contextual actions
-   responsive shell

### Phase 8: Application Migration

Migrate:

-   Attention
-   Decisions
-   Decision Detail
-   Campaigns
-   Reports
-   Memory
-   Connectors
-   Intelligence
-   Testing
-   Measurement
-   relevant active surfaces

Respect all current gates and route behavior.

### Phase 9: Cleanup

Remove:

-   obsolete visual primitives
-   duplicate tokens
-   dead styling
-   conflicting component variants
-   abandoned AI-looking patterns

Do not remove behavior accidentally.

### Phase 10: Full QA

Run:

-   tests
-   lint
-   build
-   accessibility
-   responsive checks
-   visual review
-   state review
-   motion review
-   anti-convergence review
-   design-system consistency review

------------------------------------------------------------------------

## 40. Token / Code Change Discipline

Do not make giant unrelated refactors.

Keep changes scoped.

Avoid modifying backend code unless required to preserve a UI contract.

Avoid changing product behavior.

Avoid changing route architecture.

Avoid changing API semantics.

Do not create speculative infrastructure.

Do not introduce a dependency unless it solves a demonstrated problem.

Prefer existing repository tooling.

------------------------------------------------------------------------

## 41. Claude Code Token Discipline

Do not waste tokens narrating obvious actions.

For each phase:

1.  Inspect.
2.  Summarize findings briefly.
3.  Define plan.
4.  Implement.
5.  Test.
6.  Report concrete results.

Do not repeatedly explain the same design philosophy.

Do not paste huge unchanged files into responses.

When a decision is obvious from this specification, execute it.

When repository truth conflicts with this specification:

**STOP AND IDENTIFY THE CONFLICT.**

Do not guess.

------------------------------------------------------------------------

## 42. Definition of Done

The redesign is **NOT** complete when:

> "the landing page looks better."

It is complete only when:

-   [ ] LUMI has a documented design constitution.
-   [ ] Existing design tokens have been audited.
-   [ ] Token duplication/drift is addressed.
-   [ ] Typography is semantic.
-   [ ] Color is semantic.
-   [ ] Layout and spacing are systematic.
-   [ ] Components are reusable.
-   [ ] LUMI-specific decision components exist.
-   [ ] State vocabulary is preserved.
-   [ ] Data visualization has decision purpose.
-   [ ] Motion system exists.
-   [ ] Reduced motion works.
-   [ ] Landing page expresses LUMI's product model.
-   [ ] Landing page contains meaningful product visuals.
-   [ ] Landing page contains FAQ.
-   [ ] Landing page handles objections.
-   [ ] Landing page explains trust/data integrity.
-   [ ] Landing page explains Decision Memory.
-   [ ] Landing page has real product walkthroughs.
-   [ ] Landing page and app share visual DNA.
-   [ ] App shell uses the new system.
-   [ ] Active app surfaces use the new system.
-   [ ] Existing routes remain correct.
-   [ ] Existing role gates remain correct.
-   [ ] Existing plan gates remain correct.
-   [ ] Existing decision ownership remains correct.
-   [ ] Existing deep links remain correct.
-   [ ] Existing state semantics remain correct.
-   [ ] Accessibility is preserved/improved.
-   [ ] Responsive behavior is intentional.
-   [ ] Performance is acceptable.
-   [ ] SEO/analytics requirements are preserved.
-   [ ] Design governance is documented in the repo.
-   [ ] Anti-convergence checks pass.
-   [ ] No generic AI visual language dominates.

------------------------------------------------------------------------

## 43. Final LUMI Identity Test

Remove the LUMI logo.

Look at the landing page.

Look at the app.

Ask:

> "Does this feel like a generic AI/SaaS product?"

If yes:

**FAIL.**

Then ask:

> "Does the visual and interaction language make sense because LUMI is
> organized around decisions, evidence, actions, outcomes, and memory?"

If yes:

**PASS.**

------------------------------------------------------------------------

## 44. Final North Star

Do not optimize for:

> "Looks modern."

Do not optimize for:

> "Looks like AI."

Do not optimize for:

> "Looks premium."

Do not optimize for:

> "Looks like the competitors."

Optimize for:

> **"Clarity that leads to a decision."**

The latest LUMI brand expression is built around:

> **LIGHT REVEALS WHAT MATTERS.**

The visual grammar is:

**STRUCTURE + LIGHT + NEGATIVE SPACE + SIGNAL**

The product grammar is:

**DATA → EVIDENCE → VERDICT → DECISION → ACTION → OUTCOME → MEMORY**

LUMI is not primarily: - a dashboard - a chatbot - an AI assistant

LUMI is a decision-intelligence system.

The landing page should sell this. The design system should encode this.
The application should operate through this. The motion system should
reinforce this. The content system should explain this. The state system
should protect the truth behind this. The governance system should
prevent drift.

### Final Identity Test

Remove the LUMI logo.

Look at the landing page. Look at the app. Look at the product visuals.

Ask:

> "Does this feel like a generic AI/SaaS product?"

If yes:

**FAIL.**

Then ask:

> "Does the visual and interaction language make sense because LUMI
> reveals the important signal and organizes the experience around
> decisions, evidence, actions, outcomes and memory?"

If yes:

**PASS.**

### Final Visual Test

Ask:

1.  Is the visual language recognizable through structure, light,
    negative space and functional gold?
2.  Does the logo remain distinctive without literal light-bulb
    symbolism?
3.  Does gold identify importance rather than decorate everything?
4.  Does the wordmark remain ownable as customized artwork?
5.  Does the landing page and app share the same visual DNA?
6.  Does the product remain readable and operational rather than
    cinematic?
7.  Could this design be mistaken for another AI product?

If #7 is yes:

**STOP AND REWORK.**

Build from repository truth. Use references to learn. Do not copy them.
Preserve what works. Improve what is weak. Create what is missing.
Remove what is generic.

And do not ship a LUMI identity that could be mistaken for another AI
product.

------------------------------------------------------------------------

## 45. Figma Brand Identity Handoff

The Figma brand file is the visual reference for the latest identity
direction.

The working Figma guideline should document:

### Logo

-   Primary lockup
-   Wordmark only
-   Symbol only
-   Monochrome
-   Reversed
-   Favicon
-   App icon
-   Social avatar
-   Clear space
-   Minimum size
-   Incorrect usage

### Logo Refinement

The preferred concept is:

**01 / Current Base**

Do not restart logo exploration unless: - the mark fails at small
sizes - the geometry is not reproducible - the gold element is still
perceived primarily as a pie chart - the wordmark cannot be made
optically balanced - a production constraint makes the concept
non-viable

Refinement should focus on: - gold reveal geometry - negative-space
relationship - curve quality - proportions - optical balance - `I`
accent consistency

### Color

Document: - LUMI Gold `#D4A017` - Charcoal `#0B0F14` - Off White
`#F7F7F3` - Warm Gray `#E6E2DA` - product semantic colors separately

### Typography

Document: - Space Grotesk - Inter - JetBrains Mono

### Visual Direction

Use the architectural light reference as the brand mood anchor.

The reference should inform: - light behavior - contrast - geometry -
reveal - focus - composition

It must not force every page or asset into: - dark cinematic rendering -
heavy glow - glass - futuristic AI aesthetics

### Brand Applications

Validate the identity in: - website header - hero - app icon - favicon -
product UI - social avatar - LinkedIn creative - Instagram creative -
reports - presentation cover - office/signage applications

### Figma-to-Code Rule

Figma is the visual source of truth for the approved identity.

Repository implementation remains the source of truth for: - product
behavior - state semantics - routing - permissions - API contracts -
measurement - currency - data integrity

Never allow Figma visual decisions to silently alter product behavior.

------------------------------------------------------------------------

## 46. Latest Update Changelog

This update incorporates the latest LUMI brand decisions:

1.  **Preferred logo:** 01 / Current Base is the leading identity
    direction.
2.  **Logo strategy:** refine the existing mark instead of replacing the
    concept casually.
3.  **Logo concern:** reduce pie-chart perception through gold reveal
    and negative-space refinement.
4.  **Brand concept:** Light reveals what matters.
5.  **Brand metaphor:** signal emerging from complexity/noise.
6.  **Visual grammar:** Structure + Light + Negative Space + Signal.
7.  **Brand palette:** LUMI Gold `#D4A017`, Charcoal `#0B0F14`, Off
    White `#F7F7F3`, Warm Gray `#E6E2DA`.
8.  **Typography:** Space Grotesk + Inter + JetBrains Mono remains the
    product design-system typography.
9.  **Wordmark:** customized vector artwork, not ordinary typesetting.
10. **Gold `I` accent:** may become a recurring signature, governed by
    explicit geometry.
11. **Cinematic architecture:** mood/reference language only, not the
    default UI treatment.
12. **Brand gold:** functional signal, not decorative luxury color.
13. **North Star:** Clarity that leads to a decision.
14. **Identity line:** Light reveals what matters.
15. **Anti-convergence:** no generic AI visual language, even when it is
    trendy or polished.
16. **Figma handoff:** identity rules must be represented as a reusable
    brand system, not a single logo board.

These updates do not authorize changes to existing product behavior or
product truth.
