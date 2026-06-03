// ============================================================
// MARCOM / Lumi — Campaign Filter Chips
// ============================================================
// All / KILL / HOLD / SCALE verdict filters
// ============================================================

export default function FilterChips({ filterVerdict, setFilterVerdict, counts }) {
  const filters = [
    { key: 'All', label: `All · ${counts.all}` },
    { key: 'KILL', label: 'KILL' },
    { key: 'HOLD', label: 'HOLD' },
    { key: 'SCALE', label: 'SCALE' },
  ];

  return (
    <div className="flex gap-1.5 mb-3.5">
      {filters.map((filter) => {
        const isActive = filterVerdict === filter.key;
        return (
          <button
            key={filter.key}
            onClick={() => setFilterVerdict(filter.key)}
            className={`
              px-3 py-1.5 rounded-full font-mono text-[11px] font-semibold tracking-[0.06em] uppercase
              border transition-all
              ${isActive
                ? 'bg-lumi-elevated text-dark-base border-lumi-border'
                : 'bg-surface-card text-dark-muted border-surface-border hover:border-lumi-accent/30'
              }
            `}
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}
