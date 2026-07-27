// ============================================================
// MARCOM / Lumi — Pagination
// ------------------------------------------------------------
// Offset paging for the admin lists. `total` is the server's real count under
// the active filters, so the range it states ("26–50 of 312") is a fact, not an
// estimate drawn from the page it happens to be holding.
//
// Hidden entirely when everything fits on one page — a control that can only be
// disabled is noise.
//
// The arrows carry aria-labels: "←" as an accessible name tells a screen-reader
// user nothing about where the button goes.
// ============================================================

const BTN =
  'rounded border border-lumi-border px-2 py-1 transition-colors hover:bg-lumi-elevated disabled:opacity-30 disabled:hover:bg-transparent';

export function Pagination({ total = 0, limit = 25, offset = 0, onPageChange }) {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  if (totalPages <= 1) return null;

  const currentPage = Math.floor(offset / limit) + 1;
  // Clamped so a stale offset (a filter narrowed the set under the reader)
  // cannot render an impossible range like "51–40 of 40".
  const from = Math.min(offset + 1, total);
  const to = Math.min(offset + limit, total);

  return (
    <div className="mt-4 flex items-center justify-between text-xs text-lumi-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          disabled={offset === 0}
          aria-label="Previous page"
          className={BTN}
        >
          <span aria-hidden>←</span>
        </button>
        <span className="px-2 py-1 tabular-nums">
          {currentPage} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(offset + limit)}
          disabled={offset + limit >= total}
          aria-label="Next page"
          className={BTN}
        >
          <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}
