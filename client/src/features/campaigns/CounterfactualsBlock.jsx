// ============================================================
// MARCOM / Lumi — CounterfactualsBlock  (Campaigns · "What we ruled out")
// ------------------------------------------------------------
// The alternatives the engine considered and set aside, with what argued against
// each. The complement to the "Why?" block above it: that one says what we
// think is wrong, this one says what we checked and found was fine.
//
// It is the line that stops a marketer rewriting a creative that was working.
// A KILL with no counterfactual reads as "something is broken, go look" — and
// the cheapest thing to change is usually the creative, whether or not it is the
// problem. Naming what was ruled out turns a verdict into a direction.
//
// PURE RENDERER. Takes a view model, emits JSX, and knows nothing about enum
// keys, label maps or the engine's shapes — counterfactualViewModel owns all of
// that. So this component can be dropped onto the feed, the memory timeline or a
// narrative without dragging the vocabulary along, and a label change never
// touches markup.
// ============================================================

function LineList({ heading, lines }) {
  if (!lines?.length) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-lumi-muted">{heading}</p>
      {lines.map((l) => (
        <p key={l.key} className="pl-2 text-xs leading-relaxed text-lumi-subtle">· {l.label}</p>
      ))}
    </div>
  );
}

/**
 * @param {{ viewModel: Array<{mechanism, label, rejectedBy, preferredBecause}> }} props
 *   `viewModel` comes from buildCounterfactualViewModel. An empty list renders
 *   nothing at all: "we ruled nothing out" is not a finding, and an empty
 *   bordered box would read as a failed load.
 */
export function CounterfactualsBlock({ viewModel }) {
  if (!viewModel?.length) return null;

  return (
    <div className="mt-3 space-y-2">
      <p className="section-label text-lumi-muted">What we ruled out</p>

      {viewModel.map((cf, i) => (
        // mechanism is the engine's enum key and unique per counterfactual (one
        // per alternative hypothesis). Index only as the fallback for a payload
        // that arrived without one.
        <div
          key={cf.mechanism ?? `cf-${i}`}
          className="space-y-1.5 rounded-lg border border-lumi-border bg-lumi-surface p-3"
        >
          <p className="text-sm font-medium text-lumi-text">{cf.label}</p>
          <LineList heading="Ruled out because:" lines={cf.rejectedBy} />
          <LineList heading="The primary explanation also covers:" lines={cf.preferredBecause} />
        </div>
      ))}
    </div>
  );
}
