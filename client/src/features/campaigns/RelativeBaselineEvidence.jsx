// GRAMMAR OBJECT Supporting RELATIVE_BASELINE EVIDENCE / MEASUREMENT.
// CONTRACT Complete admitted AVAILABLE presentation model only; every field
// is required and already formatted by buildRelativeBaselineReadout.
// STATES AVAILABLE only. Request failures and refusals belong upstream.
// WHY LUMI Explains why a server-selected child was chosen against its measured
// direct parent while retaining source, period and comparable population.
export function RelativeBaselineEvidence({ readout }) {
  return (
    <section aria-label="Selected comparison" className="mb-3">
      <p className="mb-2 font-display text-sm font-semibold text-lumi-text">{readout.metricLabel}</p>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="font-mono text-sm text-lumi-muted">{readout.subjectLabel}</dt>
          <dd className="font-mono text-sm tabular-nums text-lumi-text">{readout.subjectValue}</dd>
        </div>
        <div>
          <dt className="font-mono text-sm text-lumi-muted">{readout.parentLabel}</dt>
          <dd className="font-mono text-sm tabular-nums text-lumi-text">{readout.parentValue}</dd>
        </div>
      </dl>
      <p className="mt-2 flex flex-wrap gap-x-3 font-mono text-sm text-lumi-text">
        <span>{readout.gap}</span><span>{readout.relation}</span>
      </p>
      <p className="mt-2 break-words font-mono text-sm leading-relaxed text-lumi-muted">{readout.basisLabel}</p>
      <p className="mt-1 text-sm leading-relaxed text-lumi-muted">{readout.populationLabel}</p>
    </section>
  );
}
