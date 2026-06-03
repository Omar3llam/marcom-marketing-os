import { useReveal } from './useReveal.js';

export function TrustedBy() {
  const partners = [
    { name: 'Maison Salam', tag: 'Apparel · Cairo' },
    { name: 'Layla & Co.', tag: 'Beauty · Riyadh' },
    { name: 'Forge Studio', tag: 'SaaS · Dubai' },
    { name: 'Karim Foods', tag: 'FMCG · Cairo' },
    { name: 'Atlas Mobility', tag: 'Logistics · Amman' },
  ];
  const [ref, shown] = useReveal();

  return (
    <section className="px-4 sm:px-6 py-8 pb-2">
      <div ref={ref} className={`max-w-7xl mx-auto ${shown ? 'animate-fade-in' : 'opacity-0'}`}>
        <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-dark-muted text-center mb-6">
          Operators using Lumi every day
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 opacity-85">
          {partners.map((p) => (
            <div
              key={p.name}
              className="px-4 py-3.5 flex flex-col items-center gap-1 border-l border-surface-border transition-transform duration-200 hover:-translate-y-0.5 cursor-default"
            >
              <div className="font-display text-[15px] font-bold tracking-tight text-dark-soft">
                {p.name}
              </div>
              <div className="font-mono text-[9px] tracking-[0.08em] uppercase text-dark-subtle">
                {p.tag}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
