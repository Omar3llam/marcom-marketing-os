// ============================================================
// Operations · formatting helpers
// ============================================================

export function shortId(id) {
  if (!id) return '—';
  return id.length > 6 ? id.slice(-6).toUpperCase() : id.toUpperCase();
}

export function formatAge(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  if (seconds < 60) return `0:${String(seconds).padStart(2, '0')}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function durationBetween(a, b) {
  if (!a || !b) return '';
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 0) return '';
  return `+${(ms / 1000).toFixed(2)}s`;
}

export function formatTs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(11, 23); // HH:MM:SS.mmm
}

export function formatLatency(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
