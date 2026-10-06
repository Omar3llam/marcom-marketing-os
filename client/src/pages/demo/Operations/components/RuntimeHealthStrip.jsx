import { useState, useEffect } from 'react';
import { api } from '../../../../lib/api.js';
import { RuntimeVitalsSchema, ExecutionMetricsSummarySchema } from '@/contracts/schemas/observability.schema';
import { formatLatency } from '../utils/formatting.js';
import styles from '../Operations.module.css';

function Measurements({ items }) {
  return <dl className={styles.measurements}>{items.map(([label, value]) => <div key={label}>
    <dt>{label}</dt><dd className="font-mono tabular-nums">{value}</dd>
  </div>)}</dl>;
}

export function RuntimeHealthStrip() {
  const [vitals, setVitals] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [vitalsError, setVitalsError] = useState(false);
  const [metricsError, setMetricsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get('/api/execute/vitals');
        const admitted = RuntimeVitalsSchema.parse(data);
        if (!cancelled) { setVitals(admitted); setVitalsError(false); }
      } catch {
        if (!cancelled) { setVitals(null); setVitalsError(true); }
      }
    };
    load(); const id = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get('/api/execute/metrics/summary');
        const admitted = ExecutionMetricsSummarySchema.parse(data);
        if (!cancelled) { setMetrics(admitted); setMetricsError(false); }
      } catch {
        if (!cancelled) { setMetrics(null); setMetricsError(true); }
      }
    };
    load(); const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return <div className={styles.healthGroups}>
    <section aria-label="Runtime vitals">
      <h2>{vitals ? `Runtime, last ${vitals.windowMinutes} min` : 'Runtime vitals'}</h2>
      {vitalsError ? <p role="status">Runtime vitals unavailable</p> : !vitals ? <p role="status">Reading runtime vitals…</p>
        : <Measurements items={[
          ['In-flight', vitals.inFlightCount], ['Success in window', vitals.successPerHour],
          ['Failed in window', vitals.failedPerHour], ['p95 latency', formatLatency(vitals.p95LatencyMs)],
        ]} />}
    </section>
    <section aria-label="Historical execution metrics">
      <h2>{metrics ? `Execution history, last ${metrics.windowDays} days` : 'Execution history'}</h2>
      {metricsError ? <p role="status">Historical metrics unavailable</p> : !metrics ? <p role="status">Reading historical metrics…</p>
        : metrics.total_executions === 0 ? <p>No execution metrics in this {metrics.windowDays}-day window</p>
          : <Measurements items={[
            ['Executions', metrics.total_executions], ['Success rate', `${Math.round(metrics.success_rate * 100)}%`],
            ['Avg execution', formatLatency(metrics.avg_execution_ms)],
          ]} />}
    </section>
  </div>;
}
