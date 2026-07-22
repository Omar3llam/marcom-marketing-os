import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Menu, X } from 'lucide-react';
import { Hero } from './HeroSection.jsx';
import { SignalToAction } from './SignalToActionSection.jsx';
import { TrustedBy } from './SocialProofSection.jsx';
import { CapabilitiesGrid, HowItWorks } from './FeaturesSection.jsx';
import { WhyLumiDecides } from './WhyKillSection.jsx';
import { Pricing } from './PricingSection.jsx';
import { BottomCTA } from './CTASection.jsx';

// Nav anchors map to the real section ids (Hero=top, Features=features, How=how,
// Pricing=pricing). Hardcoded — never auto-derived from the label — so the link
// can't silently drift away from the section id.
const NAV_LINKS = [
  { label: 'Get started', href: '#how' },
  { label: 'Inside Lumi', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface-light text-dark-base">
      <Navbar menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      <Hero />
      <SignalToAction />
      <TrustedBy />
      <CapabilitiesGrid />
      <WhyLumiDecides />
      <HowItWorks />
      <Pricing onStartFree={() => navigate('/signup')} />
      <BottomCTA onCta={() => navigate('/signup')} />
      <Footer />
    </div>
  );
}

function Navbar({ menuOpen, setMenuOpen }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-240 ${
        scrolled
          ? 'bg-surface-light/82 backdrop-blur-xl border-b border-surface-border'
          : 'bg-surface-light/70 backdrop-blur-sm border-b border-surface-border/40'
      }`}
    >
      <nav
        className={`max-w-7xl mx-auto flex items-center justify-between gap-8 transition-all duration-240 ${
          scrolled ? 'px-4 sm:px-6 py-3' : 'px-4 sm:px-6 py-5'
        }`}
      >
        <BrandMark scrolled={scrolled} />

        <ul className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map(({ label, href }) => (
            <li key={label}>
              <a
                href={href}
                className="font-display text-[13px] font-medium text-dark-soft hover:text-dark-base transition-colors"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden md:flex items-center gap-2">
          <Link
            to="/login"
            className="font-display text-[13px] font-medium text-dark-muted hover:text-dark-base px-3 py-1.5 rounded-lg transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className={`btn-gold inline-flex items-center gap-1.5 text-[13px] rounded-xl transition-all ${
              scrolled ? 'px-4 py-2' : 'px-4 py-2.5'
            }`}
          >
            Start free
            <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
          </Link>
        </div>

        <button
          type="button"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((o) => !o)}
          className="md:hidden p-2 text-dark-muted hover:text-dark-base"
        >
          {menuOpen ? <X className="w-5 h-5" strokeWidth={1.5} /> : <Menu className="w-5 h-5" strokeWidth={1.5} />}
        </button>
      </nav>

      {menuOpen && (
        <div className="md:hidden border-t border-surface-border bg-surface-card animate-fade-in">
          <div className="flex flex-col gap-1 p-4">
            {NAV_LINKS.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="px-3 py-2 text-sm font-display text-dark-muted hover:text-dark-base rounded-lg"
              >
                {label}
              </a>
            ))}
            <Link
              to="/login"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2 text-sm font-display text-dark-muted hover:text-dark-base rounded-lg"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              onClick={() => setMenuOpen(false)}
              className="mt-1 w-full btn-gold px-4 py-2 rounded-xl text-sm"
            >
              Start free →
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

function BrandMark({ scrolled }) {
  const size = scrolled ? 'sm' : 'md';
  const fs = size === 'sm' ? 13 : 16;

  return (
    <Link to="/" className="inline-flex items-center gap-2.5 no-underline">
      {/* Geometric monogram — concentric ring + dot */}
      <span className="relative flex-shrink-0" style={{ width: fs + 6, height: fs + 6 }}>
        <span
          className="absolute inset-0 rounded-full border-lumi-accent"
          style={{ borderWidth: '1.5px' }}
        />
        <span
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lumi-accent shadow-gold-glow"
          style={{ width: fs * 0.35, height: fs * 0.35 }}
        />
      </span>
      <span
        className="font-display font-bold tracking-tight text-dark-base"
        style={{ fontSize: fs, letterSpacing: '-0.02em' }}
      >
        Lumi
      </span>
    </Link>
  );
}

// Footer columns. Only links with a real destination ship — internal routes
// (/privacy, /terms, /login, /signup), the contact mailto, and the on-page
// section anchors. No dead links: a footer full of hrefs that go nowhere reads
// as unfinished, which the page's honesty bar forbids.
const FOOTER_COLUMNS = [
  {
    heading: 'Product',
    links: [
      { label: 'Pricing', href: '#pricing' },
      { label: 'How it works', href: '#how' },
      { label: 'Inside Lumi', href: '#features' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'Privacy', to: '/privacy' },
      { label: 'Terms', to: '/terms' },
    ],
  },
  {
    heading: 'Connect',
    links: [
      { label: 'Sign in', to: '/login' },
      { label: 'Start free', to: '/signup' },
      { label: 'Contact', href: 'mailto:hello@marcom.ai' },
    ],
  },
];

function Footer() {
  return (
    <footer className="px-4 sm:px-6 pt-16 pb-10 border-t border-surface-border/60 bg-surface-card">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 sm:gap-12">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-1">
            <div className="inline-flex items-center gap-2.5">
              <span className="relative flex-shrink-0" style={{ width: 20, height: 20 }}>
                <span className="absolute inset-0 rounded-full border-lumi-accent" style={{ borderWidth: '1.5px' }} />
                <span
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lumi-accent shadow-gold-glow"
                  style={{ width: 6, height: 6 }}
                />
              </span>
              <span className="font-display font-bold tracking-tight text-dark-base text-base">Lumi</span>
            </div>
            <p className="mt-3 text-xs text-dark-muted leading-relaxed max-w-[220px]">
              Decisions, not dashboards. A verdict on every campaign, every sync.
            </p>
          </div>

          {/* Link columns */}
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-dark-muted mb-3.5">
                {col.heading}
              </div>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.to ? (
                      <Link to={link.to} className="text-sm text-dark-soft hover:text-dark-base transition-colors">
                        {link.label}
                      </Link>
                    ) : (
                      <a href={link.href} className="text-sm text-dark-soft hover:text-dark-base transition-colors">
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-6 border-t border-surface-border/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-dark-subtle font-mono">
          <span>© {new Date().getFullYear()} Lumi · Built for MENA performance marketers</span>
          <span>EGP · SAR · AED native</span>
        </div>
      </div>
    </footer>
  );
}
