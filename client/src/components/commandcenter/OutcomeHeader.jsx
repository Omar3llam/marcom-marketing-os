import { Lock } from 'lucide-react';
import { MetricValue } from '@/components/primitives';

export default function OutcomeHeader() {
  return (
    <header className="mb-8">
      <MetricValue as="h1" className="text-dark-base">
        Command Center
      </MetricValue>
      <p className="mt-2 font-mono text-sm text-dark-soft inline-flex items-center gap-2">
        <Lock className="w-3 h-3 text-signal-scale" strokeWidth={1.5} />
        Context locked · Premium Intelligence · MENA market
      </p>
    </header>
  );
}
