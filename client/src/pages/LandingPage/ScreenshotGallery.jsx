import { useState } from 'react';
import { useReveal } from './useReveal.js';

// Static product preview. The <img> points at /screenshots/*.png (dropped into
// client/public/screenshots/ manually). Until a file exists, the request 404s
// and onError swaps in an honest placeholder — so the gallery works today and
// upgrades to real screenshots the moment the PNGs land, with no code change.
const SHOTS = [
  { tab: "Today's agenda", src: '/screenshots/overview.png',     caption: 'See exactly what needs your attention — no noise, no dashboards.' },
  { tab: 'Blended truth',  src: '/screenshots/intelligence.png', caption: 'What Meta and Google report vs what actually happened. The gap is your real cost.' },
  { tab: 'A/B Testing OS', src: '/screenshots/testing.png',      caption: 'Design, run, and read holdout tests — without a data scientist.' },
];

export function ScreenshotGallery() {
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState({}); // src -> true once we know the PNG isn't there yet
  const [ref, shown] = useReveal();
  const shot = SHOTS[active];

  return (
    <section id="preview" ref={ref} className={`px-4 sm:px-6 py-24 sm:py-28 ${shown ? 'animate-fade-in' : 'opacity-0'}`}>
      <div className="max-w-5xl mx-auto">
        <header className="text-center mb-10">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-dark-muted mb-3.5">
            Product preview
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-[-0.035em] text-dark-base leading-tight">
            See Lumi in action.
          </h2>
        </header>

        <div role="tablist" aria-label="Product screenshots" className="flex flex-wrap justify-center gap-2 mb-8">
          {SHOTS.map((s, i) => (
            <button
              key={s.tab}
              type="button"
              role="tab"
              aria-selected={active === i}
              onClick={() => setActive(i)}
              className={`font-display text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                active === i
                  ? 'bg-dark-base text-surface-light'
                  : 'text-dark-muted hover:text-dark-base hover:bg-surface-card'
              }`}
            >
              {s.tab}
            </button>
          ))}
        </div>

        <div className="bg-surface-card border border-surface-border rounded-2xl shadow-panel overflow-hidden">
          {failed[shot.src] ? (
            <div className="aspect-video bg-lumi-elevated flex items-center justify-center">
              <p className="text-lumi-muted text-sm font-mono">Preview coming soon</p>
            </div>
          ) : (
            <img
              src={shot.src}
              alt={shot.caption}
              className="w-full aspect-video object-cover object-top"
              loading="lazy"
              onError={() => setFailed((f) => ({ ...f, [shot.src]: true }))}
            />
          )}
        </div>

        <p className="mt-5 text-center text-sm text-dark-soft max-w-2xl mx-auto leading-relaxed">
          {shot.caption}
        </p>
      </div>
    </section>
  );
}
