import { Lock } from 'lucide-react';

export default function OutcomeHeader() {
  return (
    <header className="mb-8">
      <h1 className="font-display font-bold text-2xl lg:text-3xl text-dark-base">
        Command Center
      </h1>
      <p className="mt-2 font-mono text-sm text-dark-soft inline-flex items-center gap-2">
        <Lock className="w-3 h-3 text-signal-scale" strokeWidth={1.5} />
        Context locked · Premium Intelligence · MENA market
      </p>
    </header>
  );
}
