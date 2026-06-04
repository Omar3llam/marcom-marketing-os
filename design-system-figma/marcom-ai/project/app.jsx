// ============================================================
// Lumi — Root App (router + Tweaks + Shell)
// ============================================================

import { Icons }                                          from './icons.jsx';
import { VerdictPill, PriorityPill, StagePill,
         InlineBar, GlowDot, LumiLoader, SectionLabel,
         MetricRow, Card, Skeleton, useIsMobile }         from './primitives.jsx';
import { Sidebar, ContextBar }                            from './shell.jsx';
import { DEMO_DATA }                                      from './data.js';
import { HomePage }                                       from './home.jsx';
import { CampaignsPage }                                  from './campaigns-page.jsx';
import { ContentLab }                                     from './content-lab.jsx';
import { InputView }                                      from './input-view.jsx';
import { TheatreView }                                    from './theatre-view.jsx';
import { SuccessView }                                    from './success-view.jsx';
import { ExecutionView }                                  from './execution-view.jsx';
import { GrowthPage, CalendarPage }                       from './growth-calendar.jsx';
import { GenericPage }                                    from './misc-views.jsx';

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "comfortable",
  "verdictStyle": "editorial",
  "persona": "apparel"
}/*EDITMODE-END*/;

const FSM = {
  HOME:      'HOME',
  CAMPAIGNS: 'CAMPAIGNS',
  CONTENT:   'CONTENT',
  GROWTH:    'GROWTH',
  CALENDAR:  'CALENDAR',
  // Verdict flow (entered via Upload new data / review alert)
  INPUT:     'INPUT',
  THEATRE:   'THEATRE',
  SUCCESS:   'SUCCESS',
  EXECUTION: 'EXECUTION',
  // Settings page
  GENERIC:   'GENERIC',
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [state, setState] = React.useState(FSM.HOME);
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [activeNav, setActiveNav] = React.useState('home');
  const [genericTarget, setGenericTarget] = React.useState(null);
  // Content Lab can be pre-loaded with a campaign
  const [contentContext, setContentContext] = React.useState(null);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', t.theme);
    document.documentElement.setAttribute('data-density', t.density);
  }, [t.theme, t.density]);

  const workspace    = DEMO_DATA.WORKSPACES[t.persona] || DEMO_DATA.WORKSPACES.apparel;
  const featured     = DEMO_DATA.FEATURED[t.persona]   || DEMO_DATA.FEATURED.apparel;
  const radarAlerts  = DEMO_DATA.RADAR_BY_WS[t.persona] || DEMO_DATA.RADAR_BY_WS.apparel;

  // ── Handlers ──────────────────────────────────────────────
  const startFlow = (mode) => {
    if (mode === 'campaign') {
      setActiveNav('campaigns');
      setState(FSM.INPUT);
    }
  };

  const reviewAlert = (alert) => {
    if (['KILL', 'HOLD', 'SCALE'].includes(alert?.verdict)) setState(FSM.SUCCESS);
  };

  const fixContent = (alert) => {
    setContentContext(alert);
    setActiveNav('content');
    setState(FSM.CONTENT);
  };

  const goHome = () => { setActiveNav('home'); setState(FSM.HOME); };

  const handleNav = (key) => {
    setActiveNav(key);
    setMobileMenuOpen(false);
    if (key === 'home')      setState(FSM.HOME);
    else if (key === 'campaigns') setState(FSM.CAMPAIGNS);
    else if (key === 'content')   setState(FSM.CONTENT);
    else if (key === 'growth')    setState(FSM.GROWTH);
    else if (key === 'calendar')  setState(FSM.CALENDAR);
    else if (key === 'settings')  { setGenericTarget({ title: 'Settings', sub: 'Workspace, billing, API connections, alert thresholds.', Icon: Icons.Settings, locked: false }); setState(FSM.GENERIC); }
  };

  // ── Body content per state ────────────────────────────────
  let body;
  switch (state) {
    case FSM.INPUT:
      body = <InputView workspace={workspace} featured={featured} onAnalyze={() => setState(FSM.THEATRE)} onCancel={goHome} />;
      break;
    case FSM.THEATRE:
      body = <TheatreView workspace={workspace} featured={featured} onComplete={() => setState(FSM.SUCCESS)} />;
      break;
    case FSM.SUCCESS:
      body = (
        <SuccessView
          workspace={workspace}
          featured={featured}
          verdictStyle={t.verdictStyle}
          onExecute={() => setState(FSM.EXECUTION)}
          onCancel={() => setState(FSM.INPUT)}
          onBackToHub={goHome}
        />
      );
      break;
    case FSM.EXECUTION:
      body = <ExecutionView workspace={workspace} featured={featured} onBackToHub={goHome} />;
      break;
    case FSM.CAMPAIGNS:
      body = (
        <CampaignsPage
          workspace={workspace}
          alerts={radarAlerts}
          onStartFlow={startFlow}
          onReviewAlert={reviewAlert}
          onFixContent={fixContent}
        />
      );
      break;
    case FSM.CONTENT:
      body = (
        <ContentLab
          workspace={workspace}
          contextCampaign={contentContext}
          onClearContext={() => setContentContext(null)}
          onNav={handleNav}
        />
      );
      break;
    case FSM.GROWTH:
      body = <GrowthPage workspace={workspace} onNav={handleNav} />;
      break;
    case FSM.CALENDAR:
      body = <CalendarPage workspace={workspace} onNav={handleNav} />;
      break;
    case FSM.GENERIC:
      body = <GenericPage {...genericTarget} />;
      break;
    case FSM.HOME:
    default:
      body = (
        <HomePage
          workspace={workspace}
          radarAlerts={radarAlerts}
          sessions={workspace.sessions}
          onNav={handleNav}
          onReviewAlert={reviewAlert}
          onStartFlow={startFlow}
        />
      );
  }

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: '100vh', background: 'var(--c-surface-light)', color: 'var(--c-text-base)' }}>
      {/* Mobile top bar with hamburger */}
      {isMobile && (
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'var(--c-lumi-surface)',
          borderBottom: '1px solid var(--c-lumi-border)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          gap: 12,
        }}>
          <button
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
            style={{
              background: 'transparent',
              border: '1px solid var(--c-surface-border-strong)',
              borderRadius: 8,
              padding: '8px 10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--c-text-base)',
            }}
          >
            <Icons.Menu style={{ fontSize: 16 }} />
            <span className="font-display" style={{ fontSize: 13, fontWeight: 600 }}>Menu</span>
          </button>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <img
              src={(typeof window !== "undefined" && window.__resources && window.__resources.lumiMascot) || "assets/lumi-mascot.png"}
              alt="Lumi"
              style={{ width: 28, height: 28, objectFit: 'contain' }}
            />
            <span className="font-display" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>LUMI</span>
          </div>
          <button
            onClick={() => handleNav('campaigns')}
            className="font-mono"
            aria-label="Search"
            style={{
              background: 'var(--c-gold)',
              color: 'var(--c-text-base)',
              border: 'none',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icons.Plus style={{ fontSize: 13 }} />
            NEW
          </button>
        </header>
      )}

      {/* Sidebar — overlay drawer on mobile, inline rail on desktop */}
      {isMobile && mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 49,
            animation: 'fade-in 180ms ease-out both',
          }}
        />
      )}
      <div
        style={
          isMobile
            ? {
                position: 'fixed',
                top: 0,
                left: 0,
                bottom: 0,
                zIndex: 50,
                transform: mobileMenuOpen ? 'translateX(0)' : 'translateX(-105%)',
                transition: 'transform 260ms cubic-bezier(0.16,1,0.3,1)',
                boxShadow: mobileMenuOpen ? '0 16px 48px rgba(0,0,0,0.25)' : 'none',
                display: 'flex',
              }
            : { display: 'flex' }
        }
      >
        <Sidebar
          collapsed={isMobile ? false : sidebarCollapsed}
          onToggle={() => isMobile ? setMobileMenuOpen(false) : setSidebarCollapsed((p) => !p)}
          workspace={workspace}
          activeNav={activeNav}
          onNav={handleNav}
          sessions={workspace.sessions}
          radarAlerts={radarAlerts}
          personas={DEMO_DATA.WORKSPACES}
          currentPersona={t.persona}
          onSwitchPersona={(p) => setTweak('persona', p)}
        />
      </div>

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1 }}>
          {body}
        </div>
        <ContextBar workspace={workspace} />
      </main>

      {/* Replay demo — only show after entering the verdict flow */}
      {[FSM.INPUT, FSM.THEATRE, FSM.SUCCESS, FSM.EXECUTION].includes(state) && (
        <button className="demo-replay" onClick={goHome}>
          <Icons.RotateCcw style={{ fontSize: 12 }} />
          Restart demo
        </button>
      )}

      <DemoTweaks t={t} setTweak={setTweak} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Tweaks Panel
// ══════════════════════════════════════════════════════════════
function DemoTweaks({ t, setTweak }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Demo persona">
        <TweakRadio
          label="Workspace"
          value={t.persona}
          onChange={(v) => setTweak('persona', v)}
          options={[
            { value: 'apparel', label: 'Cairo' },
            { value: 'riyadh',  label: 'Riyadh' },
            { value: 'dubai',   label: 'Dubai' },
          ]}
        />
      </TweakSection>

      <TweakSection label="Appearance">
        <TweakRadio
          label="Theme"
          value={t.theme}
          onChange={(v) => setTweak('theme', v)}
          options={[
            { value: 'light', label: 'Warm Light' },
            { value: 'dark',  label: 'War-room' },
          ]}
        />
        <TweakRadio
          label="Density"
          value={t.density}
          onChange={(v) => setTweak('density', v)}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact',     label: 'Compact' },
          ]}
        />
      </TweakSection>

      <TweakSection label="Verdict reveal">
        <TweakRadio
          label="Style"
          value={t.verdictStyle}
          onChange={(v) => setTweak('verdictStyle', v)}
          options={[
            { value: 'editorial', label: 'Editorial' },
            { value: 'card',      label: 'Composed' },
          ]}
        />
      </TweakSection>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
