import { useState, useEffect } from 'react';
import { api } from '../../../../lib/api.js';
import { formatLatency } from '../utils/formatting.js';

function Divider() {
  return <span style={{ width: 1, height: 24, background: 'var(--c-surface-border-strong)' }} />;
}

function Vital({ label, value, color, pulse, mono }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {color && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: color,
            boxShadow: pulse ? `0 0 6px ${color}` : 'none',
            animation: pulse ? 'intel-pulse 1.4s ease-in-out infinite' : 'none',
          }} />
        )}
        <span
          className={mono ? 'font-mono tabular-nums' : 'font-display tabular-nums'}
          style={{ fontSize: mono ? 16 : 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--c-text-base)' }}
        >
          {value}
        </span>
      </div>
      <div className="font-mono" style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

export function RuntimeHealthStrip() {
  const [vitals, setVitals] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get('/api/execute/vitals');
        if (!cancelled) {
          setVitals(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    load();
    const id = setInterval(load, 10000); // 10s — vitals don't change as fast as the monitor
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const v = vitals;
  const placeholder = error ? '!' : '—';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <Vital
        label="In-flight"
        value={v ? String(v.inFlightCount) : placeholder}
        color="var(--c-gold)"
        pulse={!!v && v.inFlightCount > 0}
      />
      <Divider />
      <Vital
        label="Success / hr"
        value={v ? String(v.successPerHour) : placeholder}
        color="var(--c-scale)"
      />
      <Divider />
      <Vital
        label="Failed / hr"
        value={v ? String(v.failedPerHour) : placeholder}
        color="var(--c-kill)"
      />
      <Divider />
      <Vital
        label="p95"
        value={v ? formatLatency(v.p95LatencyMs) : placeholder}
        mono
      />
    </div>
  );
}
