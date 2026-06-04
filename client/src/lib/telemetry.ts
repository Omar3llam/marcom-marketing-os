// ============================================================
// MARCOM v4.1 — Telemetry Layer
// ------------------------------------------------------------
// Lightweight event tracking for UI v2 migration monitoring.
//
// ARCHITECTURE:
// - Opt-in via feature flag (features.telemetry)
// - Events stored in memory + localStorage (dev)
// - Periodic flush to backend /api/telemetry (future)
// - No PII tracking (only technical metrics)
//
// USAGE:
//   import { track } from '@/lib/telemetry';
//
//   track('route_render', {
//     route: '/decision',
//     version: 'v2',
//     renderTime: 123,
//   });
//
// DEV TOOLS:
//   window.__telemetry.getLogs()
//   window.__telemetry.clear()
// ============================================================
import { features } from '@/config/features';

// ── Event types ─────────────────────────────────────────────
export type TelemetryEventType =
  | 'route_render'
  | 'route_error'
  | 'api_call'
  | 'api_error'
  | 'fsm_transition'
  | 'fsm_error'
  | 'auth_failure'
  | 'flow_abandoned'
  | 'comparison_diff';

export interface TelemetryEvent {
  type: TelemetryEventType;
  timestamp: number;
  version: 'v1' | 'v2';
  data: Record<string, any>;
  sessionId?: string;
}

// ── In-memory event store (ring buffer, max 1000 events) ───
const MAX_EVENTS = 1000;
const events: TelemetryEvent[] = [];

// ── Session ID (persists across reloads) ────────────────────
function getSessionId(): string {
  let sessionId = sessionStorage.getItem('telemetry_session_id');
  if (!sessionId) {
    sessionId = `session_${crypto.randomUUID()}`;
    sessionStorage.setItem('telemetry_session_id', sessionId);
  }
  return sessionId;
}

// ── Track event ─────────────────────────────────────────────
/**
 * Track a telemetry event.
 * No-op if telemetry feature flag is disabled.
 */
export function track(
  type: TelemetryEventType,
  data: Record<string, any>,
  version: 'v1' | 'v2' = 'v2'
): void {
  // No-op if telemetry disabled
  if (!features.telemetry) return;

  const event: TelemetryEvent = {
    type,
    timestamp: Date.now(),
    version,
    data,
    sessionId: getSessionId(),
  };

  // Add to ring buffer
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.shift(); // Remove oldest event
  }

  // Log in dev mode
  if (import.meta.env.DEV) {
    console.debug('[telemetry]', type, data);
  }

  // Persist to localStorage (dev only)
  if (import.meta.env.DEV) {
    try {
      const stored = JSON.parse(localStorage.getItem('telemetry_events') || '[]');
      stored.push(event);
      if (stored.length > MAX_EVENTS) stored.shift();
      localStorage.setItem('telemetry_events', JSON.stringify(stored));
    } catch {
      // Quota exceeded, ignore
    }
  }
}

// ── Get all events ──────────────────────────────────────────
export function getEvents(): TelemetryEvent[] {
  return [...events];
}

// ── Clear events ────────────────────────────────────────────
export function clearEvents(): void {
  events.length = 0;
  if (import.meta.env.DEV) {
    localStorage.removeItem('telemetry_events');
  }
}

// ── Query events ────────────────────────────────────────────
export function queryEvents(filter: {
  type?: TelemetryEventType;
  version?: 'v1' | 'v2';
  since?: number;
}): TelemetryEvent[] {
  return events.filter((event) => {
    if (filter.type && event.type !== filter.type) return false;
    if (filter.version && event.version !== filter.version) return false;
    if (filter.since && event.timestamp < filter.since) return false;
    return true;
  });
}

// ── Analytics helpers ───────────────────────────────────────

/**
 * Get average metric value across events.
 * Example: getAverageMetric('route_render', 'renderTime')
 */
export function getAverageMetric(
  type: TelemetryEventType,
  metric: string
): number | null {
  const filtered = queryEvents({ type });
  if (filtered.length === 0) return null;

  const values = filtered
    .map((e) => e.data[metric])
    .filter((v) => typeof v === 'number');

  if (values.length === 0) return null;

  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compare v1 vs v2 performance on a metric.
 * Returns { v1: avg, v2: avg, delta: v2 - v1 }
 */
export function compareVersions(
  type: TelemetryEventType,
  metric: string
): { v1: number; v2: number; delta: number } | null {
  const v1Events = queryEvents({ type, version: 'v1' });
  const v2Events = queryEvents({ type, version: 'v2' });

  if (v1Events.length === 0 || v2Events.length === 0) return null;

  const v1Values = v1Events.map((e) => e.data[metric]).filter((v) => typeof v === 'number');
  const v2Values = v2Events.map((e) => e.data[metric]).filter((v) => typeof v === 'number');

  if (v1Values.length === 0 || v2Values.length === 0) return null;

  const v1Avg = v1Values.reduce((sum, v) => sum + v, 0) / v1Values.length;
  const v2Avg = v2Values.reduce((sum, v) => sum + v, 0) / v2Values.length;

  return {
    v1: v1Avg,
    v2: v2Avg,
    delta: v2Avg - v1Avg,
  };
}

/**
 * Get error rate for a specific event type.
 * Returns percentage (0-100).
 */
export function getErrorRate(type: TelemetryEventType): number {
  const total = queryEvents({ type }).length;
  if (total === 0) return 0;

  const errors = queryEvents({ type }).filter((e) => e.data.error || e.data.failed).length;

  return (errors / total) * 100;
}

// ── Export for window access (dev console) ──────────────────
if (import.meta.env.DEV) {
  (window as any).__telemetry = {
    getLogs: getEvents,
    clear: clearEvents,
    query: queryEvents,
    getAverage: getAverageMetric,
    compare: compareVersions,
    getErrorRate,
  };
}

// ── Auto-track: page visibility (detect abandoned flows) ────
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      track('flow_abandoned', {
        route: window.location.pathname,
        timestamp: Date.now(),
      });
    }
  });
}

// ── Auto-track: unhandled errors ────────────────────────────
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    track('route_error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      route: window.location.pathname,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    track('api_error', {
      reason: event.reason?.message || String(event.reason),
      route: window.location.pathname,
    });
  });
}
