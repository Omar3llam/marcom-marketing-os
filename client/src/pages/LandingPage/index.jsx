import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, Menu, X } from 'lucide-react';
import { Hero, MockOSWindow } from './HeroSection.jsx';
import { CapabilitiesGrid, HowItWorks } from './FeaturesSection.jsx';
import { BottomCTA } from './CTASection.jsx';

export default function LandingPage() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-lumi-bg text-lumi-text">
      <Navbar onCta={() => navigate('/signup')} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      <Hero      onPrimary={() => navigate('/signup')} />
      <MockOSWindow />
      <CapabilitiesGrid />
      <HowItWorks />
      <BottomCTA onCta={() => navigate('/signup')} />
      <Footer />
    </div>
  );
}

function Navbar({ onCta, menuOpen, setMenuOpen }) {
  return (
    <header className="sticky top-0 z-50 bg-lumi-bg/80 backdrop-blur-md border-b border-lumi-border/50">
      <nav className="max-w-7xl mx-auto flex items-center justify-between px-4 sm:px-6 h-14">
        <Link to="/" className="flex items-center gap-2" aria-label="Lumi home">
          <Sparkles className="w-5 h-5 text-lumi-accent" strokeWidth={1.5} />
          <span className="font-display font-bold tracking-tight text-lumi-accent">LUMI</span>
        </Link>

        <ul className="hidden md:flex items-center gap-8">
          {['Features', 'How It Works', 'Pricing'].map((label) => (
            <li key={label}>
              <a
                href={`#${label.toLowerCase().replace(/\s+/g, '-')}`}
                className="text-sm font-body text-lumi-muted hover:text-lumi-text transition-colors"
              >{label}</a>
            </li>
          ))}
        </ul>

        <div className="hidden md:flex items-center gap-2">
          <Link
            to="/login"
            className="text-sm font-display font-medium text-lumi-muted hover:text-lumi-text px-3 py-1.5 rounded-lg"
          >Log in</Link>
          <button
            type="button"
            onClick={onCta}
            className="bg-lumi-accent text-lumi-bg font-display font-semibold hover:bg-lumi-accent-hover shadow-accent-glow px-4 py-2 rounded-xl text-sm inline-flex items-center gap-1.5 transition-all"
          >
            Get Started <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>

        <button
          type="button"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((o) => !o)}
          className="md:hidden p-2 text-lumi-muted hover:text-lumi-text"
        >
          {menuOpen ? <X className="w-5 h-5" strokeWidth={1.5} /> : <Menu className="w-5 h-5" strokeWidth={1.5} />}
        </button>
      </nav>

      {menuOpen && (
        <div className="md:hidden border-t border-lumi-border bg-lumi-surface animate-fade-in">
          <div className="flex flex-col gap-1 p-4">
            {['Features', 'How It Works', 'Pricing'].map((label) => (
              <a
                key={label}
                href={`#${label.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => setMenuOpen(false)}
                className="px-3 py-2 text-sm font-display text-lumi-muted hover:text-lumi-text rounded-lg"
              >{label}</a>
            ))}
            <Link
              to="/login"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2 text-sm font-display text-lumi-muted hover:text-lumi-text rounded-lg"
            >Log in</Link>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onCta(); }}
              className="mt-1 w-full bg-lumi-accent text-lumi-bg font-display font-semibold px-4 py-2 rounded-xl text-sm"
            >Get Started →</button>
          </div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="px-4 sm:px-6 py-8 border-t border-lumi-border/50">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-lumi-subtle font-mono">
        <span>© {new Date().getFullYear()} MARCOM AI</span>
        <span>Lumi · Decision OS</span>
      </div>
    </footer>
  );
}
