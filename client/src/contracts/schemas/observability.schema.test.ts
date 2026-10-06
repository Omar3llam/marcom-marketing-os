import { describe, expect, it } from 'vitest';
import { ObservabilityLiveSchema, RuntimeVitalsSchema, ExecutionMetricsSummarySchema } from './observability.schema';
const at = '2026-10-06T10:00:00Z';
const live = { executions: { active: 0, paused: 0, queued: 0, failed_last_hour: 0 },
  queue: { depth: 0, avg_wait_ms: null, oldest_queued_at: null }, recent_activity: [], generated_at: at };
describe('P7-08 live summary admission', () => {
  it('admits measured counts zero and explicit queue N/A', () => { expect(ObservabilityLiveSchema.parse(live)).toEqual(live); });
  it.each(['active', 'paused', 'queued', 'failed_last_hour'])('requires count %s without fallback', key => {
    const executions = { ...live.executions }; delete executions[key as keyof typeof executions];
    expect(ObservabilityLiveSchema.safeParse({ ...live, executions }).success).toBe(false);
  });
  it.each([-1, .5, null, '0', Infinity, NaN])('rejects invalid count %s', active => {
    expect(ObservabilityLiveSchema.safeParse({ ...live, executions: { ...live.executions, active } }).success).toBe(false);
  });
  it.each([
    { depth: 0, avg_wait_ms: 0, oldest_queued_at: null },
    { depth: 0, avg_wait_ms: null, oldest_queued_at: at },
    { depth: 1, avg_wait_ms: null, oldest_queued_at: at },
    { depth: 1, avg_wait_ms: 0, oldest_queued_at: null },
    { depth: 1, avg_wait_ms: -1, oldest_queued_at: at },
    { depth: 1, avg_wait_ms: Infinity, oldest_queued_at: at },
  ])('rejects contradictory or invalid queue %j', queue => {
    expect(ObservabilityLiveSchema.safeParse({ ...live, queue }).success).toBe(false);
  });
  it('admits real zero wait when a queue exists', () => {
    expect(ObservabilityLiveSchema.parse({ ...live, queue: { depth: 1, avg_wait_ms: 0, oldest_queued_at: at } }).queue.avg_wait_ms).toBe(0);
  });
  it.each(['recent_activity', 'generated_at', 'executions', 'queue'])('requires the published %s field', key => {
    const payload = { ...live }; delete payload[key as keyof typeof payload];
    expect(ObservabilityLiveSchema.safeParse(payload).success).toBe(false);
  });
  it('rejects invalid server timestamp and recent execution facts', () => {
    expect(ObservabilityLiveSchema.safeParse({ ...live, generated_at: 'unknown' }).success).toBe(false);
    expect(ObservabilityLiveSchema.safeParse({ ...live, recent_activity: [{}] }).success).toBe(false);
  });
});
describe('P7-08 operational source admission', () => {
  const v = { inFlightCount: 0, successPerHour: 0, failedPerHour: 0, p95LatencyMs: null, serverNow: at, windowMinutes: 60 };
  const m = { total_executions: 0, success_rate: null, avg_execution_ms: null, windowDays: 7 };
  it('preserves nullable latency and measured zero', () => { expect(RuntimeVitalsSchema.parse(v)).toEqual(v); });
  it('does not invent missing vitals or an unknown window', () => {
    expect(RuntimeVitalsSchema.safeParse({ ...v, inFlightCount: undefined }).success).toBe(false);
    expect(RuntimeVitalsSchema.safeParse({ ...v, windowMinutes: undefined }).success).toBe(false);
  });
  it('preserves empty history and permits independently absent latency in nonempty history', () => {
    expect(ExecutionMetricsSummarySchema.parse(m)).toEqual(m);
    expect(ExecutionMetricsSummarySchema.parse({ ...m, total_executions: 1, success_rate: 0 }).avg_execution_ms).toBeNull();
  });
  it('rejects empty population with a fabricated success rate or duration', () => {
    expect(ExecutionMetricsSummarySchema.safeParse({ ...m, success_rate: 0 }).success).toBe(false);
    expect(ExecutionMetricsSummarySchema.safeParse({ ...m, avg_execution_ms: 0 }).success).toBe(false);
  });
});
