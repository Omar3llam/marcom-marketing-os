// ============================================================
// MARCOM Demo — Shell (Sidebar + ContextBar)
// ============================================================

function Sidebar({ collapsed, onToggle, workspace, activeNav, onNav, sessions, radarAlerts = [], personas, onSwitchPersona, currentPersona }) {
  const coreTools = [
    { key: 'home',       label: 'Home',         sub: 'Account pulse',                Icon: Icons.Layout },
    { key: 'campaigns',  label: 'Campaigns',    sub: 'Verdicts + diagnosis',         Icon: Icons.BarChart },
    { key: 'content',    label: 'Content Lab',  sub: 'Copy + visual generation',     Icon: Icons.Send },
    { key: 'growth',     label: 'Growth',       sub: 'Memory layer + opportunities', Icon: Icons.Target },
    { key: 'calendar',   label: 'Calendar',     sub: '4-week content plan',          Icon: Icons.Calendar },
  ];
  const proTools = [];

  const highAlerts = radarAlerts.filter((a) => a.priority === 'HIGH');
  const alertCount = highAlerts.length;
  const alertsByKey = { home: alertCount };

  // Notifications popover
  const [notifOpen, setNotifOpen] = React.useState(false);
  // Workspace switcher
  const [wsOpen, setWsOpen] = React.useState(false);
  // Cmd+K palette
  const [cmdkOpen, setCmdkOpen] = React.useState(false);

  // Wire Cmd/Ctrl+K keyboard shortcut
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen((p) => !p);
      } else if (e.key === 'Escape') {
        setCmdkOpen(false);
        setWsOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Live "next sweep" countdown (visual only — wraps from 60)
  const [secs, setSecs] = React.useState(47);
  React.useEffect(() => {
    const id = setInterval(() => setSecs((s) => (s <= 1 ? 60 : s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const w = collapsed ? 64 : 268;

  return (
    <aside
      style={{
        width: w,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignSelf: 'stretch',
        background: 'var(--c-lumi-surface)',
        borderRight: '1px solid var(--c-lumi-border)',
        transition: 'width 200ms ease-out',
        position: 'relative',
      }}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          height: 56,
          padding: '0 14px',
          borderBottom: '1px solid var(--c-lumi-border)',
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          background: 'var(--c-lumi-surface)',
          zIndex: 5,
        }}
      >
        <button
          onClick={onToggle}
          style={{
            background: 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 0,
            color: 'var(--c-lumi-accent)',
          }}
        >
          <img
            src={(typeof window !== "undefined" && window.__resources && window.__resources.lumiMascot) || "assets/lumi-mascot.png"}
            alt="Lumi"
            style={{
              width: collapsed ? 30 : 34,
              height: collapsed ? 30 : 34,
              objectFit: 'contain',
              filter: 'drop-shadow(0 2px 6px rgba(246,201,69,0.4))',
            }}
          />
          {!collapsed && (
            <span className="font-display" style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>
              LUMI
            </span>
          )}
        </button>

        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              onClick={() => setNotifOpen((p) => !p)}
              aria-label="Notifications"
              style={{
                position: 'relative',
                background: notifOpen ? 'var(--c-lumi-elevated)' : 'transparent',
                border: 'none',
                padding: 6,
                borderRadius: 8,
                color: alertCount > 0 ? 'var(--c-kill-text)' : 'var(--c-lumi-muted)',
                display: 'flex',
              }}
            >
              <Icons.Bell style={{ fontSize: 16 }} />
              {alertCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: 4, right: 4,
                    width: 8, height: 8,
                    borderRadius: '50%',
                    background: 'var(--c-kill)',
                    boxShadow: '0 0 6px var(--c-kill)',
                    animation: 'intel-pulse 1.6s ease-in-out infinite',
                  }}
                />
              )}
            </button>
            <button
              onClick={onToggle}
              aria-label="Collapse sidebar"
              style={{
                background: 'transparent',
                border: 'none',
                padding: 6,
                borderRadius: 8,
                color: 'var(--c-lumi-muted)',
                display: 'flex',
              }}
            >
              <Icons.PanelLeftClose style={{ fontSize: 16 }} />
            </button>
          </div>
        )}

        {/* ── Notifications popover ──────────────────────── */}
        {notifOpen && !collapsed && (
          <NotificationsPopover
            alerts={highAlerts}
            onClose={() => setNotifOpen(false)}
            onPick={(a) => { setNotifOpen(false); onNav('home'); }}
          />
        )}
      </div>

      {/* ── Body (natural height; footer stays sticky at viewport bottom) */}
      <div style={{ padding: '12px 0' }} className="no-scrollbar">
        {/* Cmd+K Search affordance */}
        {!collapsed && (
          <div style={{ padding: '0 12px', marginBottom: 14 }}>
            <button
              onClick={() => setCmdkOpen(true)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                background: 'var(--c-lumi-elevated)',
                border: '1px solid var(--c-lumi-border)',
                borderRadius: 9,
                color: 'var(--c-lumi-muted)',
                cursor: 'pointer',
                transition: 'all 150ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(246,201,69,0.4)'; e.currentTarget.style.background = 'var(--c-lumi-surface)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--c-lumi-border)'; e.currentTarget.style.background = 'var(--c-lumi-elevated)'; }}
            >
              <Icons.Search style={{ fontSize: 13, flexShrink: 0 }} />
              <span className="font-body" style={{ flex: 1, fontSize: 12, textAlign: 'left', color: 'var(--c-lumi-subtle)' }}>
                Search decisions…
              </span>
              <span className="font-mono" style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, border: '1px solid var(--c-lumi-border)', background: 'var(--c-lumi-surface)', color: 'var(--c-lumi-muted)', letterSpacing: '0.06em' }}>
                ⌘K
              </span>
            </button>
          </div>
        )}
        {collapsed && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <button
              onClick={() => setCmdkOpen(true)}
              title="Search (⌘K)"
              style={{
                width: 36, height: 36, borderRadius: 9,
                background: 'var(--c-lumi-elevated)',
                border: '1px solid var(--c-lumi-border)',
                color: 'var(--c-lumi-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Icons.Search style={{ fontSize: 14 }} />
            </button>
          </div>
        )}

        {/* Workspace HQ */}
        {!collapsed && (
          <div style={{ padding: '0 12px', marginBottom: 14 }}>
            <div className="section-label" style={{ paddingLeft: 4, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Workspace</span>
              <button
                onClick={() => setWsOpen((p) => !p)}
                title="Switch workspace"
                style={{ background: 'transparent', border: 'none', color: 'var(--c-lumi-subtle)', padding: 2, display: 'flex', cursor: 'pointer', borderRadius: 4 }}
              >
                <Icons.ChevronDown style={{ fontSize: 11, transform: wsOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 150ms' }} />
              </button>
            </div>
            <div
              style={{
                borderRadius: 14,
                border: wsOpen ? '1px solid rgba(246,201,69,0.4)' : '1px solid var(--c-lumi-border)',
                background: 'var(--c-lumi-elevated)',
                padding: 12,
                position: 'relative',
                overflow: 'hidden',
                transition: 'border-color 150ms',
              }}
            >
              {/* Subtle gold glow corner */}
              <div
                style={{
                  position: 'absolute',
                  top: -40, right: -40,
                  width: 80, height: 80,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(246,201,69,0.18), transparent 70%)',
                  pointerEvents: 'none',
                }}
              />

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, position: 'relative' }}>
                <div
                  style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: 'linear-gradient(135deg, var(--c-gold), var(--c-gold-deep))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: 'var(--sh-gold-glow)',
                    flexShrink: 0,
                  }}
                >
                  <span className="font-display" style={{ fontWeight: 700, fontSize: 13, color: '#2b2b2b' }}>{workspace.initials}</span>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="font-display" style={{ fontWeight: 600, fontSize: 13, color: 'var(--c-lumi-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {workspace.name}
                  </div>
                  <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-lumi-subtle)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {workspace.tag}
                  </div>
                </div>
              </div>

              {/* WATCHING status */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: 'rgba(16,185,129,0.08)',
                  border: '1px solid rgba(16,185,129,0.2)',
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--c-scale)',
                    boxShadow: '0 0 6px var(--c-scale)',
                    animation: 'intel-pulse 1.6s ease-in-out infinite',
                    flexShrink: 0,
                  }}
                />
                <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-scale-text)', fontWeight: 600 }}>
                  Watching
                </span>
                <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-lumi-muted)' }}>
                  · 14 ad sets
                </span>
              </div>

              {/* Spend + channels */}
              <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-lumi-subtle)', marginBottom: 8 }}>
                Spend tier: <span style={{ color: 'var(--c-lumi-muted)' }}>{workspace.spendTier}</span>
              </div>
              <ChannelHealth channels={workspace.channels} />

              {/* Next sweep countdown */}
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px dashed var(--c-lumi-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icons.Radar style={{ fontSize: 12, color: 'var(--c-gold-deep)' }} />
                  <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-lumi-muted)' }}>Next sweep</span>
                </div>
                <span className="font-mono tabular-nums" style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-lumi-text)' }}>
                  {String(Math.floor(secs / 60)).padStart(1, '0')}:{String(secs % 60).padStart(2, '0')}
                </span>
              </div>
            </div>

            {/* Workspace switcher dropdown */}
            {wsOpen && personas && (
              <WorkspaceSwitcher
                personas={personas}
                currentPersona={currentPersona}
                onPick={(p) => { setWsOpen(false); onSwitchPersona?.(p); }}
              />
            )}
          </div>
        )}

        {collapsed && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }} title={workspace.name}>
            <div
              style={{
                position: 'relative',
                width: 36, height: 36, borderRadius: 9,
                background: 'linear-gradient(135deg, var(--c-gold), var(--c-gold-deep))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <span className="font-display" style={{ fontWeight: 700, fontSize: 12, color: '#2b2b2b' }}>{workspace.initials}</span>
              {alertCount > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 14, height: 14, borderRadius: '50%',
                  background: 'var(--c-kill)', color: 'white',
                  fontSize: 9, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 6px var(--c-kill)',
                  border: '2px solid var(--c-lumi-surface)',
                }} className="font-mono">{alertCount}</span>
              )}
            </div>
          </div>
        )}

        {/* Core tools */}
        <div style={{ padding: collapsed ? '0 8px' : '0 12px' }}>
          {!collapsed && (
            <div className="section-label" style={{ paddingLeft: 4, marginBottom: 6 }}>Navigation</div>
          )}
          {coreTools.map((t) => (
            <NavItem
              key={t.key}
              tool={t}
              collapsed={collapsed}
              isActive={activeNav === t.key}
              badge={alertsByKey[t.key]}
              onClick={() => onNav(t.key)}
            />
          ))}
        </div>

        {/* Pro modules — removed; all tools now in Core */}

        {/* Recent decisions */}
        {!collapsed && (
          <div style={{ padding: '20px 12px 0' }}>
            <div className="section-label" style={{ paddingLeft: 4, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Recent Decisions</span>
              <DecisionSparkline />
            </div>
            {sessions.slice(0, 4).map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 8px',
                  borderRadius: 8,
                  marginBottom: 2,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--c-lumi-elevated)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <VerdictPill verdict={s.verdict} size="sm" showIcon={false} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="font-display" style={{ fontWeight: 500, fontSize: 12, color: 'var(--c-lumi-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.label}
                  </div>
                  <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-lumi-subtle)', marginTop: 1 }}>
                    {s.ts}
                  </div>
                </div>
              </div>
            ))}
            <button
              style={{
                width: '100%',
                marginTop: 4,
                padding: '8px',
                background: 'transparent',
                border: '1px dashed var(--c-lumi-border)',
                borderRadius: 8,
                color: 'var(--c-lumi-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                fontSize: 11,
              }}
              className="font-mono"
            >
              <Icons.History style={{ fontSize: 11 }} />
              View all 47 decisions
            </button>
          </div>
        )}
      </div>

      {/* ── Footer (sticky at viewport bottom) ─────────────── */}
      <div
        style={{
          marginTop: 'auto',
          position: 'sticky',
          bottom: 0,
          borderTop: '1px solid var(--c-lumi-border)',
          padding: 10,
          background: 'var(--c-lumi-surface)',
          zIndex: 1,
        }}
      >
        <button
          onClick={() => onNav('settings')}
          title={collapsed ? 'Settings' : undefined}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: collapsed ? 10 : '8px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderRadius: 10,
            background: 'transparent',
            border: 'none',
            color: 'var(--c-lumi-muted)',
            fontSize: 13,
            marginBottom: 4,
          }}
        >
          <Icons.Settings style={{ fontSize: 16 }} />
          {!collapsed && <span className="font-body">Settings</span>}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? 0 : '8px 12px', justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div
              style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'rgba(246,201,69,0.2)',
                border: '1px solid rgba(246,201,69,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <span className="font-display" style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-lumi-accent)' }}>O</span>
            </div>
            <span
              style={{
                position: 'absolute',
                bottom: 0, right: 0,
                width: 9, height: 9, borderRadius: '50%',
                background: 'var(--c-scale)',
                border: '2px solid var(--c-lumi-surface)',
              }}
            />
          </div>
          {!collapsed && (
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="font-display" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-lumi-text)' }}>Omar Ellam</div>
              <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-lumi-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Operator · {workspace.market}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cmd+K command palette */}
      {cmdkOpen && (
        <CmdKPalette
          onClose={() => setCmdkOpen(false)}
          sessions={sessions}
          radarAlerts={radarAlerts}
          onNav={onNav}
          onStartFlow={() => { setCmdkOpen(false); onNav('feed'); }}
        />
      )}
    </aside>
  );
}

// ── NavItem (extracted for reuse + gold-rail active state) ───
function NavItem({ tool, collapsed, isActive, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={tool.locked}
      title={collapsed ? tool.label : undefined}
      style={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: collapsed ? 10 : '10px 12px',
        paddingLeft: collapsed ? 10 : isActive ? 16 : 12,
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderRadius: 10,
        background: isActive ? 'var(--c-lumi-elevated)' : 'transparent',
        border: 'none',
        color: isActive ? 'var(--c-lumi-text)' : 'var(--c-lumi-muted)',
        marginBottom: 2,
        textAlign: 'left',
        cursor: tool.locked ? 'not-allowed' : 'pointer',
        opacity: tool.locked ? 0.55 : 1,
        transition: 'all 150ms',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => { if (!isActive && !tool.locked) e.currentTarget.style.background = 'rgba(246,201,69,0.04)'; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Gold left rail for active */}
      {isActive && !collapsed && (
        <span
          style={{
            position: 'absolute',
            left: 0, top: '50%',
            width: 3, height: 24,
            marginTop: -12,
            background: 'var(--c-gold)',
            borderRadius: '0 3px 3px 0',
            boxShadow: '0 0 8px rgba(246,201,69,0.5)',
          }}
        />
      )}
      {isActive && collapsed && (
        <span
          style={{
            position: 'absolute',
            left: 0, top: '50%',
            width: 3, height: 18,
            marginTop: -9,
            background: 'var(--c-gold)',
            borderRadius: '0 3px 3px 0',
          }}
        />
      )}

      <tool.Icon style={{ fontSize: collapsed ? 18 : 16, flexShrink: 0, color: isActive ? 'var(--c-gold-deep)' : 'inherit' }} />
      {!collapsed && (
        <>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="font-display" style={{ fontWeight: isActive ? 600 : 500, fontSize: 13, lineHeight: '16px' }}>{tool.label}</div>
            <div style={{ fontSize: 10, color: 'var(--c-lumi-subtle)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tool.sub}
            </div>
          </div>
          {badge && badge > 0 && (
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: 10, fontWeight: 700,
                padding: '2px 7px',
                borderRadius: 999,
                background: 'var(--c-kill)',
                color: 'white',
                boxShadow: '0 0 8px rgba(239,68,68,0.4)',
              }}
            >
              {badge}
            </span>
          )}
          {tool.locked && !badge && <Icons.Lock style={{ fontSize: 11, color: 'var(--c-lumi-subtle)' }} />}
        </>
      )}
    </button>
  );
}

// ── Notifications popover ────────────────────────────────────
function NotificationsPopover({ alerts, onClose, onPick }) {
  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }}
      />
      <div
        className="anim-slide-up"
        style={{
          position: 'fixed',
          top: 64,
          left: 14,
          zIndex: 50,
          width: 240,
          maxWidth: 'calc(100vw - 28px)',
          background: 'var(--c-surface-card)',
          border: '1px solid var(--c-surface-border)',
          borderRadius: 14,
          padding: 12,
          boxShadow: 'var(--sh-panel)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="section-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-kill)', animation: 'intel-pulse 1.6s ease-in-out infinite' }} />
            {alerts.length} High-priority alerts
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--c-text-muted)', display: 'flex', padding: 2 }}
          >
            <Icons.X style={{ fontSize: 13 }} />
          </button>
        </div>
        {alerts.map((a) => (
          <button
            key={a.id}
            onClick={() => onPick(a)}
            style={{
              width: '100%',
              display: 'block',
              textAlign: 'left',
              padding: '10px 10px',
              marginBottom: 4,
              background: 'var(--c-surface-elevated)',
              border: '1px solid var(--c-surface-border)',
              borderLeft: `3px solid var(--c-${a.verdict === 'KILL' ? 'kill' : a.verdict === 'SCALE' ? 'scale' : 'hold'})`,
              borderRadius: 8,
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span className="font-display" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {a.campaign}
              </span>
              <span className="font-mono" style={{ fontSize: 9, color: 'var(--c-text-subtle)', flexShrink: 0 }}>{a.time}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-text-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.signal}{a.bleed !== '—' ? ` · ${a.bleed}` : ''}
            </div>
          </button>
        ))}
        {alerts.length === 0 && (
          <div style={{ padding: '20px 16px', textAlign: 'center' }}>
            <img
              src={(typeof window !== "undefined" && window.__resources && window.__resources.lumiMascot) || "assets/lumi-mascot.png"}
              alt="Lumi"
              style={{ width: 56, height: 56, objectFit: 'contain', objectPosition: 'top', opacity: 0.9, marginBottom: 8 }}
            />
            <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>
              All systems nominal.
            </div>
            <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginTop: 4 }}>
              Lumi will ping you when something starts bleeding.
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── 7-day decisions sparkline ────────────────────────────────
function DecisionSparkline() {
  // Static demo data: decisions per day for the last 7 days
  const data = [2, 4, 1, 3, 5, 2, 3];
  const max = Math.max(...data);
  const w = 64, h = 16;
  const bw = (w - 6) / data.length;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {data.map((d, i) => {
        const bh = Math.max(2, (d / max) * (h - 2));
        const isLast = i === data.length - 1;
        return (
          <rect
            key={i}
            x={i * bw + 1}
            y={h - bh}
            width={bw - 1.5}
            height={bh}
            rx={1}
            fill={isLast ? 'var(--c-gold)' : 'var(--c-lumi-border-strong)'}
          />
        );
      })}
    </svg>
  );
}

// ── Bottom context bar (status / health) ─────────────────────
function ContextBar({ workspace, lastSync = '14 sec ago' }) {
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        background: 'var(--c-surface-card)',
        borderTop: '1px solid var(--c-surface-border)',
        padding: '8px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        fontSize: 11,
        flexWrap: 'wrap',
      }}
      className="font-mono context-bar"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GlowDot color="var(--c-scale)" size={6} />
          <span style={{ color: 'var(--c-text-muted)' }}>LUMI ONLINE</span>
        </div>
        <span style={{ color: 'var(--c-text-subtle)' }}>·</span>
        <span style={{ color: 'var(--c-text-muted)' }}>
          Last radar sweep <span style={{ color: 'var(--c-text-base)' }}>{lastSync}</span>
        </span>
        <span style={{ color: 'var(--c-text-subtle)' }}>·</span>
        <span style={{ color: 'var(--c-text-muted)' }}>
          Meta API <span style={{ color: 'var(--c-scale-text)' }}>connected</span>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--c-text-subtle)' }}>
        <a
          href="MARCOM%20Onboarding.html"
          style={{ color: 'var(--c-text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--c-gold-deep)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--c-text-muted)'}
          title="Re-run workspace setup"
        >
          <Icons.Settings style={{ fontSize: 10 }} />
          Setup
        </a>
        <span>·</span>
        <a
          href="MARCOM%20Landing.html"
          style={{ color: 'var(--c-text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--c-gold-deep)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--c-text-muted)'}
        >
          <Icons.ChevronLeft style={{ fontSize: 10 }} />
          Landing
        </a>
        <span>·</span>
        <span>{workspace.market}</span>
        <span>·</span>
        <span>v4.3.0</span>
      </div>
    </div>
  );
}

// ── ChannelHealth — Meta/TikTok/Google status row ───────────
function ChannelHealth({ channels }) {
  // Demo data: most channels healthy, one with throttling
  const states = {
    Meta:     { tone: 'ok',    label: 'connected · 412ms' },
    TikTok:   { tone: 'warn',  label: 'rate-limited' },
    Snap:     { tone: 'ok',    label: 'connected · 280ms' },
    Google:   { tone: 'ok',    label: 'connected · 196ms' },
    LinkedIn: { tone: 'ok',    label: 'connected · 320ms' },
  };
  const toneColor = (t) => t === 'ok' ? 'var(--c-scale)' : t === 'warn' ? 'var(--c-hold)' : 'var(--c-kill)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {channels.map((c) => {
        const s = states[c] || { tone: 'ok', label: 'connected' };
        return (
          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
            <span
              style={{
                width: 5, height: 5, borderRadius: '50%',
                background: toneColor(s.tone),
                boxShadow: s.tone === 'ok' ? `0 0 6px ${toneColor(s.tone)}` : undefined,
                flexShrink: 0,
              }}
            />
            <span className="font-mono" style={{ fontSize: 10, fontWeight: 500, color: 'var(--c-lumi-text)', letterSpacing: '0.04em', minWidth: 50 }}>
              {c.toUpperCase()}
            </span>
            <span className="font-mono" style={{ fontSize: 9, color: 'var(--c-lumi-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Workspace switcher dropdown ──────────────────────────────
function WorkspaceSwitcher({ personas, currentPersona, onPick }) {
  return (
    <div
      className="anim-slide-up"
      style={{
        marginTop: 6,
        padding: 6,
        background: 'var(--c-surface-card)',
        border: '1px solid var(--c-lumi-border)',
        borderRadius: 12,
        boxShadow: 'var(--sh-panel)',
      }}
    >
      <div className="section-label" style={{ padding: '6px 8px 4px' }}>Switch workspace</div>
      {Object.values(personas).map((p) => {
        const isCurrent = p.id === currentPersona;
        return (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 8px',
              background: isCurrent ? 'var(--c-lumi-elevated)' : 'transparent',
              border: 'none',
              borderRadius: 8,
              textAlign: 'left',
              cursor: 'pointer',
              marginBottom: 2,
            }}
            onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'var(--c-lumi-elevated)'; }}
            onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
          >
            <div
              style={{
                width: 28, height: 28, borderRadius: 7,
                background: 'linear-gradient(135deg, var(--c-gold), var(--c-gold-deep))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: '#2b2b2b' }}>{p.initials}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="font-display" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-lumi-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
              <div className="font-mono" style={{ fontSize: 9, color: 'var(--c-lumi-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.tag}</div>
            </div>
            {isCurrent && <Icons.Check style={{ fontSize: 12, color: 'var(--c-gold-deep)' }} />}
          </button>
        );
      })}
      <button
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 8px',
          background: 'transparent',
          border: '1px dashed var(--c-lumi-border)',
          borderRadius: 8,
          color: 'var(--c-lumi-muted)',
          fontSize: 11,
          marginTop: 4,
          cursor: 'pointer',
        }}
        className="font-mono"
      >
        <Icons.Plus style={{ fontSize: 11 }} />
        New workspace
      </button>
    </div>
  );
}

// ── Cmd+K Palette ────────────────────────────────────────────
function CmdKPalette({ onClose, sessions, radarAlerts, onNav, onStartFlow }) {
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef(null);
  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const lower = query.toLowerCase();
  const navItems = [
    { id: 'n-feed',    label: 'Command Hub',       sub: 'OS launchpad',         Icon: Icons.Layout,    action: () => { onNav('feed'); onClose(); } },
    { id: 'n-camp',    label: 'Campaign Analysis', sub: 'KILL / SCALE / HOLD',  Icon: Icons.BarChart,  action: () => { onNav('campaigns'); onClose(); } },
    { id: 'n-upload',  label: 'Upload CSV',        sub: 'Run intelligence scan', Icon: Icons.Upload,   action: () => onStartFlow() },
    { id: 'n-set',     label: 'Settings',          sub: 'Workspace, API, billing', Icon: Icons.Settings, action: () => { onNav('settings'); onClose(); } },
  ];

  const filteredNav = navItems.filter((i) => !lower || (i.label + i.sub).toLowerCase().includes(lower));
  const filteredAlerts = (radarAlerts || []).filter((a) => !lower || a.campaign.toLowerCase().includes(lower));
  const filteredSessions = (sessions || []).filter((s) => !lower || s.label.toLowerCase().includes(lower));

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 99,
          background: 'rgba(15,15,20,0.4)',
          backdropFilter: 'blur(2px)',
          animation: 'fade-in 180ms ease-out both',
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: '18%', left: '50%',
          zIndex: 100,
          transform: 'translateX(-50%)',
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--c-surface-card)',
          border: '1px solid var(--c-surface-border)',
          borderRadius: 16,
          boxShadow: 'var(--sh-modal)',
          overflow: 'hidden',
          animation: 'slide-up 260ms cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--c-surface-border)' }}>
          <Icons.Search style={{ fontSize: 16, color: 'var(--c-text-muted)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search decisions, campaigns, alerts…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 15,
              fontFamily: 'var(--f-body)',
              color: 'var(--c-text-base)',
            }}
          />
          <span className="font-mono" style={{ fontSize: 10, padding: '3px 6px', borderRadius: 4, background: 'var(--c-surface-elevated)', color: 'var(--c-text-muted)', letterSpacing: '0.06em' }}>
            ESC
          </span>
        </div>

        <div style={{ maxHeight: 420, overflowY: 'auto', padding: 8 }}>
          {filteredNav.length > 0 && (
            <CmdKGroup title="Jump to">
              {filteredNav.map((i) => (
                <CmdKRow key={i.id} Icon={i.Icon} label={i.label} sub={i.sub} onClick={i.action} />
              ))}
            </CmdKGroup>
          )}
          {filteredAlerts.length > 0 && (
            <CmdKGroup title="Active radar alerts">
              {filteredAlerts.slice(0, 4).map((a) => (
                <CmdKRow
                  key={a.id}
                  Icon={Icons.AlertTriangle}
                  iconColor={a.verdict === 'KILL' ? 'var(--c-kill)' : a.verdict === 'SCALE' ? 'var(--c-scale)' : 'var(--c-hold)'}
                  label={a.campaign}
                  sub={`${a.signal} · ${a.time}`}
                  right={<VerdictPill verdict={a.verdict} size="sm" showIcon={false} />}
                  onClick={() => { onNav('feed'); onClose(); }}
                />
              ))}
            </CmdKGroup>
          )}
          {filteredSessions.length > 0 && (
            <CmdKGroup title="Recent decisions">
              {filteredSessions.map((s) => (
                <CmdKRow
                  key={s.id}
                  Icon={Icons.History}
                  label={s.label}
                  sub={`${s.verdict} · ${s.impact} · ${s.ts}`}
                  right={<VerdictPill verdict={s.verdict} size="sm" showIcon={false} />}
                  onClick={() => { onNav('campaigns'); onClose(); }}
                />
              ))}
            </CmdKGroup>
          )}
          {filteredNav.length === 0 && filteredAlerts.length === 0 && filteredSessions.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <img src={(typeof window !== "undefined" && window.__resources && window.__resources.lumiMascot) || "assets/lumi-mascot.png"} alt="" style={{ width: 56, height: 56, objectFit: 'contain', objectPosition: 'top', opacity: 0.7, marginBottom: 6 }} />
              <div className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
                Nothing matches "{query}"
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderTop: '1px solid var(--c-surface-border)', background: 'var(--c-surface-elevated)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 10, color: 'var(--c-text-muted)' }} className="font-mono">
            <span>↑↓ to navigate</span>
            <span>↵ to open</span>
            <span>esc to close</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--c-text-muted)' }} className="font-mono">
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--c-scale)', boxShadow: '0 0 6px var(--c-scale)' }} />
            Lumi listening
          </div>
        </div>
      </div>
    </>
  );
}

function CmdKGroup({ title, children }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="section-label" style={{ padding: '8px 8px 4px' }}>{title}</div>
      {children}
    </div>
  );
}

function CmdKRow({ Icon, iconColor, label, sub, right, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 8px',
        background: 'transparent',
        border: 'none',
        borderRadius: 8,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--c-surface-elevated)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <Icon style={{ fontSize: 14, color: iconColor || 'var(--c-text-muted)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
      </div>
      {right}
    </button>
  );
}

Object.assign(window, { Sidebar, ContextBar });
