# LUMI MOTION RULES

```text
Status   FOUNDATION — principles only; no motion library in Phase 1; awaiting Review Gate G-1
Date     2026-09-14 · base a3ec116
```

## MO-1 · Purpose

Motion exists to communicate exactly four things:

| Purpose | What it tells the person |
|---|---|
| **REVEAL** | *this has just become known* — a value lit on data arrival |
| **HIERARCHY** | *look here first* — order of arrival follows the order of importance |
| **TRANSITION** | *you moved; this is where you are now* — spatial continuity between views or stages |
| **FEEDBACK** | *your input was received; this is its result* — acknowledgement of a control |

The conceptual sequence it serves:

```text
complexity  →  signal  →  clarity  →  decision
```

If an animation cannot be assigned to one of the four purposes, it does not
ship. Motion is never decoration, attention farming, continuous animation, or
cinematic loading.

## MO-2 · Timing principles

1. **Relative order is fixed:** `feedback < reveal ≤ transition`. Feedback must
   feel immediate; a transition may take longest because it carries spatial
   meaning.
2. **Nothing waits for an animation.** Content is readable and operable at the
   first frame. Motion accompanies a change; it never gates one.
3. **No motion at rest.** An open surface with no change in data or input is
   completely still.
4. **Stagger follows hierarchy, not decoration.** When several things are revealed
   together, the call is revealed first, then the reason, then the evidence. The
   stagger is short enough that the whole group reads as one arrival.
5. 🧪 **Proposed ranges** for Phase 2 to verify and lock as tokens:

   | Kind | Proposed range |
   |---|---|
   | feedback | ≤ 100 ms |
   | reveal | 160–240 ms |
   | transition | 200–320 ms |
   | maximum for any UI motion | 400 ms |

## MO-3 · Easing philosophy

- **Reveal decelerates.** Light arrives quickly and settles. It does not bounce.
- **Transitions ease in and out**, symmetrically, so spatial movement feels
  continuous rather than thrown.
- **Feedback is near-linear and short.**
- **Forbidden easings:** bounce, elastic, spring overshoot, anticipation or
  wind-up. Each implies playfulness or physical mass that a decision system
  should not perform.
- 🧪 A small set of named curves (`reveal`, `transition`, `feedback`) is proposed
  for Phase 2. No component defines its own curve.

## MO-4 · Reveal behaviour

1. **Structure first, light second.** The structure of a region (labels, the
   spine, empty value slots) is present at once. Values become lit when **their**
   data arrives. A region that has no data yet is not animated to look like it
   does.
2. **Opacity and luminance, not movement.** A reveal is a change in light
   (opacity) with at most a very short positional settle. Values do not fly in,
   slide across or scale up from nothing.
3. **Numbers never animate through values they did not have.**
   - **No count-up.**
   - **No bars growing from zero.**
   - **No lines drawing themselves as if time were passing.**

   Each intermediate frame would display a number LUMI never measured, which
   violates numeric truth (🔒 PR-7).
4. **An absent value is not revealed.** Measured absence (NOT_MEASURED,
   UNAVAILABLE…) appears as structure with its reason. It never fades in and
   out, and never "tries" to load.
5. **Divergence is not animated.** A NOW verdict appearing beside an AT DECISION
   verdict gets no transition between them (B7-06: named, not diffed).

## MO-5 · Feedback behaviour

1. A control acknowledges input within the feedback range (press state, focus
   visible), with no delay introduced for effect.
2. **Process feedback shows the published stage** (`QUEUED`, `EXECUTING`) and ends
   in a terminal state. An indicator that cannot end does not exist, because
   `TIMED_OUT` exists (STATE_RULES.md §10).
3. **No optimistic success** for a platform mutation. SUCCESS appears when the
   backend confirms it.
4. **No celebration.** No confetti, checkmark bursts, gold flashes, shakes or
   haptic-style wobbles. A decision system confirms; it does not cheer.
5. Errors do not shake, flash red or pulse. They appear in place with their
   scope (STATE_RULES.md §4).
6. Every meaningful state change is also announced through a live region. Motion
   is never the only feedback channel.

## MO-6 · Transition behaviour

1. **Transitions preserve orientation.** Moving from Attention to a Decision
   destination keeps the item recognisable, so the person knows *which*
   Decision they opened. Moving along the Decision Spine keeps the spine fixed.
2. **The spine does not move to show progress.** A Decision's stages are not
   animated along the axis as a "pipeline running".
3. **Overlays enter with a short reveal and leave faster than they enter.**
   Focus moves into the overlay and returns to the invoking control on close.
4. **No page-level cinematic transitions:** no full-screen wipes, morphs, or
   parallax between routes.
5. Only composited properties are animated (opacity, transform). Layout does
   not animate on data arrival (Constitution Article 26).

## MO-7 · Reduced motion

- Every animation declares its **reduced-motion behaviour** at the time it is
  defined. An animation without a declared reduction is incomplete.
- Under `prefers-reduced-motion: reduce`:
  - reveals become **instant**, or an opacity change within the feedback range;
  - positional movement is **removed**;
  - transitions become instant, and orientation is preserved through focus and
    heading placement, not motion;
  - process indicators remain as **static text stage labels**.
- The global reduced-motion override that exists today (audit §20, §25 KEEP) is
  kept as a safety net. It does not replace per-animation declarations.
- Reduced motion never removes **information**. Anything conveyed by motion must
  also be conveyed by static means.

## MO-8 · Forbidden motion

| Forbidden | Recognisable form | Why |
|---|---|---|
| Continuous animation | pulses, breathing, rotating icons, marquee, animated backgrounds | motion at rest; constant repaint (audit P0-72) |
| Liveness theatre | pulsing "live" dots, radar sweeps, WATCHING pulses | LUMI computes when you arrive and does not pretend it was watching (B7-01; PR-11) |
| Skeleton shimmer | moving highlight across placeholder blocks | continuous, and imitates content that does not exist |
| Thinking simulation | typing dots, "LUMI is thinking…" ellipses, streaming text for deterministic results | no published process says that; `ON_READ` never narrates |
| Count-up and grow-from-zero | numbers rolling, bars and lines growing | displays values never measured (PR-7) |
| AI orb / logo animation | glowing or breathing sphere, animated logo as loader | VISUAL_BOUNDARIES.md VB-F7, §5 |
| Celebration | confetti, bursts, sparkles, gold flash | calm precision |
| Attention farming | shaking badges, bouncing CTAs, animated upsell | PR-4: a lock is structural |
| Cinematic loading | branded full-screen loaders, logo reveals before content, the legacy animated-gradient `LumiLoader` (audit §17) | decoration that delays reading |
| Scroll-jacking and parallax | scroll-linked motion on product or marketing pages | disorienting; fails reduced-motion expectations |

## MO-9 · Scope of Phase 1

No motion tokens, CSS or library are created in Phase 1. Phase 2 locks the
named durations and curves (DESIGN_TOKEN_ARCHITECTURE.md §9). Phase 3
components declare which named motion they use, and their reduced-motion
behaviour, in their header.
