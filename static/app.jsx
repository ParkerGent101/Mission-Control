/* Mission Control — App shell */
const { useState: useStateApp, useEffect: useEffectApp } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#e0a857",
  "accent2": "#6ed3b6",
  "density": "balanced",
  "sidebar": "full",
  "modules": {
    "finance": true, "band": true, "health": true, "tcpg": true, "practice": true, "recurring": true, "mealprep": true
  }
}/*EDITMODE-END*/;

const ACCENT_OPTIONS = ["#e0a857", "#6ed3b6", "#e07a5f", "#b69cf0", "#8fb3e0"];

const SIDEBAR_NAV = [
  { id: "dashboard", icon: "home",       label: "Dashboard", key: "D" },
  { id: "finance",   icon: "wallet",     label: "Finance",   key: "F" },
  { id: "band",      icon: "music",      label: "Band",      key: "B" },
  { id: "health",    icon: "heart",      label: "Health",    key: "H" },
  { id: "practice",  icon: "target",     label: "Practice",  key: "P" },
  { id: "calendar",  icon: "calendar",   label: "Calendar",  key: "C" },
  { id: "recurring", icon: "clock",      label: "Routines",  key: "R" },
  { id: "mealprep",  icon: "bowl",       label: "Meal Prep", key: "M" },
];

const MOBILE_NAV = [
  { id: "dashboard", icon: "home",   label: "Home"    },
  { id: "finance",   icon: "wallet", label: "Finance" },
  { id: "band",      icon: "music",  label: "Band"    },
  { id: "health",    icon: "heart",  label: "Health"  },
];

const MODULE_LABELS = [
  ["finance","Finance","wallet"],
  ["band","Band","music"],
  ["health","Health","heart"],
  ["practice","Practice","target"],
  ["recurring","Routines","clock"],
  ["mealprep","Meal Prep","bowl"],
];

// Statusbar flavor: rotating machine-cult litanies + the date in Imperial dating format.
const LITANIES = [
  "THE OMNISSIAH WATCHES",
  "PRAISE THE MACHINE-SPIRIT",
  "ALL SYSTEMS SANCTIFIED",
  "RITES OF MAINTENANCE OBSERVED",
  "01001111 01001011",
  "AUSPEX SWEEP NOMINAL",
  "GELLER FIELD HOLDING",
  "COGITATION WITHIN TOLERANCES",
];
// Imperial dating: check digit 0 + year-fraction (3 digits) + last 3 digits of year + .M3
const imperialDate = (d) => {
  const start = new Date(d.getFullYear(), 0, 1);
  const end = new Date(d.getFullYear() + 1, 0, 1);
  const frac = String(Math.floor(((d - start) / (end - start)) * 1000)).padStart(3, "0");
  const yy = String(d.getFullYear() % 1000).padStart(3, "0");
  return "0 " + frac + " " + yy + ".M3";
};

const DASHBOARD_MINIMIZED_KEY = "mc_dashboard_minimized";

const readDashboardMinimized = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(DASHBOARD_MINIMIZED_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const App = () => {
  const [t, setTweak] = useTweaks(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('mc_tweaks') || 'null');
      return saved ? { ...TWEAK_DEFAULTS, ...saved } : TWEAK_DEFAULTS;
    } catch { return TWEAK_DEFAULTS; }
  });
  const [active, setActive] = useStateApp("dashboard");
  const [now, setNow] = useStateApp(new Date());
  const [toasts, setToasts] = useStateApp([]);
  const [showSheet, setShowSheet] = useStateApp(false);
  const [sheetDragY, setSheetDragY] = useStateApp(0);
  const sheetTouchRef = React.useRef({startY:0, startT:0, lastY:0, dragging:false});
  const sheetScrollRef = React.useRef(null);
  const onSheetTouchStart = (e) => {
    const t = e.touches[0];
    const sc = sheetScrollRef.current;
    // Only start a dismiss-drag when the scrollable content is at the top.
    // Otherwise let the user scroll the sheet content normally.
    const atTop = !sc || sc.scrollTop <= 0;
    sheetTouchRef.current = {
      startY: t.clientY, startT: Date.now(),
      lastY: t.clientY, dragging: atTop,
    };
  };
  const onSheetTouchMove = (e) => {
    const st = sheetTouchRef.current;
    if (!st.dragging) return;
    const y = e.touches[0].clientY;
    const dy = y - st.startY;
    st.lastY = y;
    if (dy > 0) {
      setSheetDragY(dy);
    } else {
      setSheetDragY(0);
    }
  };
  const onSheetTouchEnd = () => {
    const st = sheetTouchRef.current;
    if (!st.dragging) return;
    const dy = st.lastY - st.startY;
    const dt = Date.now() - st.startT;
    const velocity = dy / Math.max(dt, 1); // px/ms
    if (dy > 100 || velocity > 0.6) {
      setShowSheet(false);
    }
    setSheetDragY(0);
    sheetTouchRef.current.dragging = false;
  };
  useEffectApp(() => {
    if (!showSheet) setSheetDragY(0);
  }, [showSheet]);
  const [needsOnboarding, setNeedsOnboarding] = useStateApp(null);
  const [showSettings, setShowSettings] = useStateApp(false);
  const [userName, setUserName] = useStateApp(() => localStorage.getItem('mc_name') || 'Parker');
  const [dashboardMinimized, setDashboardMinimized] = useStateApp(readDashboardMinimized);

  useEffectApp(() => {
    fetch('/api/onboarding').then(r => r.json()).then(d => setNeedsOnboarding(d.needed)).catch(() => setNeedsOnboarding(false));
  }, []);

  useEffectApp(() => {
    window.__toast = (msg, type = "success") => {
      const id = Date.now() + Math.random();
      setToasts(ts => [...ts, { id, msg, type }]);
      setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 2800);
    };
  }, []);

  useEffectApp(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Auto-refresh all cards every 3 min when the tab is visible, plus immediately
  // when the tab becomes visible after being hidden (so returning to it is fresh).
  // The interval is deliberately slow: a backgrounded tab never polls, so this also
  // lets the Cloud Run instance scale to zero when you walk away. Cards subscribe
  // via useRefreshListener.
  useEffectApp(() => {
    const fire = () => window.dispatchEvent(new CustomEvent('mc:refresh'));
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') fire();
    }, 180_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') fire(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffectApp(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setShowSettings(false);
        return;
      }
      // Sidebar hotkeys ([D]ashboard, [F]inance, … [T]weaks) — skip while typing or with modifiers.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const k = e.key.length === 1 ? e.key.toUpperCase() : "";
      if (k === "T") { setShowSettings(true); return; }
      const nav = SIDEBAR_NAV.find(n => n.key === k);
      if (nav) setActive(nav.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffectApp(() => {
    document.documentElement.style.setProperty("--accent", t.accent);
    document.documentElement.style.setProperty("--accent-2", t.accent2 || "#6ed3b6");
  }, [t.accent, t.accent2]);

  useEffectApp(() => {
    localStorage.setItem('mc_tweaks', JSON.stringify(t));
  }, [t]);

  useEffectApp(() => {
    localStorage.setItem(DASHBOARD_MINIMIZED_KEY, JSON.stringify(dashboardMinimized));
  }, [dashboardMinimized]);

  const handleOnboardingComplete = ({ name, modules: newModules, theme }) => {
    if (name && name.trim()) {
      const first = name.trim().split(' ')[0];
      setUserName(first);
      localStorage.setItem('mc_name', first);
    }
    if (newModules && Object.keys(newModules).length) {
      setTweak('modules', newModules);
    }
    if (theme) {
      setTweak('accent', theme.accent);
      setTweak('accent2', theme.accent2);
    }
    setNeedsOnboarding(false);
  };

  const handleReEnroll = async () => {
    await fetch('/api/user/reset-onboarding', { method: 'POST' });
    setNeedsOnboarding(true);
  };

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const date = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const weekNum = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 604800000);

  const minimizeDashboardCard = (id) => {
    setDashboardMinimized(xs => xs.includes(id) ? xs : [...xs, id]);
  };
  const restoreDashboardCard = (id) => {
    setDashboardMinimized(xs => xs.filter(x => x !== id));
  };
  const restoreAllDashboardCards = () => setDashboardMinimized([]);
  const dashboardCardProps = (id, span) => active === "dashboard"
    ? { span, onDashboardMinimize: () => minimizeDashboardCard(id) }
    : {};

  const M = window.MissionModules;
  const cards = [
    { id: "health",   label: "Health & Fitness", icon: "heart",      el: <M.HealthCard cardProps={dashboardCardProps("health", 12)} /> },
    { id: "calendar", label: "Calendar",         icon: "calendar",   el: <M.CalendarCard cardProps={dashboardCardProps("calendar", 12)} /> },
    { id: "finance",  label: "Finance",          icon: "wallet",     el: <M.FinanceCard cardProps={dashboardCardProps("finance", 7)} /> },
    { id: "band",     label: "Band",             icon: "music",      el: <M.BandCard cardProps={dashboardCardProps("band", 5)} /> },
    { id: "practice", label: "Piano Practice",   icon: "target",     el: <M.PracticeCard cardProps={dashboardCardProps("practice", 6)} /> },
    { id: "recurring",label: "Routines",         icon: "clock",      el: <M.RecurringTasksCard cardProps={dashboardCardProps("recurring", 12)} /> },
    { id: "mealprep", label: "Meal Prep",        icon: "bowl",       el: <M.MealPrepCard cardProps={dashboardCardProps("mealprep", 12)} /> },
  ];

  const visibleDashboardCards = cards.filter(c => t.modules[c.id] !== false && !dashboardMinimized.includes(c.id));
  const minimizedDashboardCards = cards.filter(c => t.modules[c.id] !== false && dashboardMinimized.includes(c.id));

  // Dashboard shows no title — just the date line below. Other pages keep their section label.
  const pageTitle = active === "dashboard"
    ? null
    : SIDEBAR_NAV.find(n => n.id === active)?.label || "Mission Control";

  return (
    <div className="app" data-density={t.density} data-sidebar={t.sidebar}>
      {/* Top bar */}
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark"/>
          <span className="brand-name">MISSION CONTROL</span>
          <span className="mobile-section-label">
            {active === 'dashboard' ? 'Mission Control' : (SIDEBAR_NAV.find(n => n.id === active)?.label || 'Mission Control')}
          </span>
        </div>
        <div className="topbar-center"></div>
        <div className="topbar-right">
          <span className="mono topbar-date" style={{ padding: "0 10px", color: "var(--ink-2)" }}>{date}</span>
          <button className="icon-btn" title="Settings" onClick={() => setShowSettings(true)}>
            <Icon name="settings" size={15}/>
          </button>
          <button className="icon-btn" title="Sign out" onClick={logout}>
            <Icon name="logout" size={15}/>
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <nav className="sidebar">
        <div className="sb-section">Workspace</div>
        {SIDEBAR_NAV.slice(0, 1).map((n) => (
          <div key={n.id} className={"sb-item" + (active === n.id ? " active" : "")} onClick={() => setActive(n.id)}>
            <span className="sb-key">[{n.key}]</span>
            <span className="sb-label">{n.label}</span>
          </div>
        ))}
        <div className="sb-section">Modules</div>
        {SIDEBAR_NAV.slice(1).map((n) => (
          <div key={n.id} className={"sb-item" + (active === n.id ? " active" : "")} onClick={() => setActive(n.id)}>
            <span className="sb-key">[{n.key}]</span>
            <span className="sb-label">{n.label}</span>
          </div>
        ))}
        <div style={{ flex: 1 }}/>
        <div className="sb-section">Shortcuts</div>
        <div className="sb-item" onClick={() => setShowSettings(true)}>
          <span className="sb-key">[T]</span>
          <span className="sb-label">Tweaks</span>
        </div>
      </nav>

      {/* Main */}
      <main>
        <div className="page-head">
          {pageTitle && <h1>{pageTitle}</h1>}
          <span className="date">{date} — week {weekNum} of {now.getFullYear()}</span>
          <div className="spacer"/>
        </div>
        {active === "dashboard" ? (
          <div className="grid">
            {minimizedDashboardCards.length > 0 && (
              <div className="dashboard-minimized span-12">
                <div className="dashboard-minimized-title">
                  <span className="muted-2 mono">Minimized</span>
                  <span className="tag">{minimizedDashboardCards.length}</span>
                </div>
                <div className="dashboard-minimized-list">
                  {minimizedDashboardCards.map(c => (
                    <button key={c.id} className="dashboard-minimized-btn" onClick={() => restoreDashboardCard(c.id)}
                      title={`Restore ${c.label}`}>
                      <Icon name={c.icon} size={14} />
                      <span>{c.label}</span>
                      <Icon name="plus" size={11} />
                    </button>
                  ))}
                </div>
                <button className="btn ghost" onClick={restoreAllDashboardCards}>Restore all</button>
              </div>
            )}
            {visibleDashboardCards.map((c) => (
              <React.Fragment key={c.id}>
                {c.el}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div className="grid">
            {cards.filter(c => c.id === active).map(c => (
              <React.Fragment key={c.id}>{c.el}</React.Fragment>
            ))}
          </div>
        )}
      </main>

      {/* Status bar */}
      <div className="statusbar">
        <span><span className="dot" style={{ display: "inline-block", marginRight: 6 }}/>online</span>
        <span className="sep"/>
        <span>mission control</span>
        <span className="sep"/>
        <span>claude · connected</span>
        <span className="sep"/>
        <span className="litany">{LITANIES[Math.floor(now.getTime() / 45000) % LITANIES.length]}</span>
        <span className="spacer"/>
        <span className="mono litany-date">{imperialDate(now)}</span>
        <span className="sep"/>
        <span className="mono">{date} · {time}</span>
      </div>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav">
        {MOBILE_NAV.map(n => (
          <div key={n.id} className={"mobile-nav-item" + (active === n.id ? " active" : "")} onClick={() => setActive(n.id)}>
            <Icon name={n.icon} size={20}/>
            <span>{n.label}</span>
          </div>
        ))}
        <div className="mobile-nav-item" onClick={() => setShowSheet(true)}>
          <Icon name="more" size={20}/>
          <span>More</span>
        </div>
      </nav>

      {/* Mobile bottom sheet */}
      {showSheet && (
        <div className="sheet-overlay" onClick={() => setShowSheet(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}
            ref={sheetScrollRef}
            onTouchStart={onSheetTouchStart}
            onTouchMove={onSheetTouchMove}
            onTouchEnd={onSheetTouchEnd}
            onTouchCancel={onSheetTouchEnd}
            style={{
              transform: sheetDragY ? `translateY(${sheetDragY}px)` : undefined,
              transition: sheetDragY ? 'none' : 'transform .2s cubic-bezier(.32,.72,0,1)',
            }}>
            <div style={{position:'sticky',top:0,zIndex:2,background:'var(--bg-2)',
                         margin:'-12px -16px 0',padding:'10px 12px 6px',
                         display:'flex',alignItems:'center',gap:8}}>
              <div className="sheet-handle" style={{margin:'0 auto',flex:'0 0 auto'}}/>
              <button className="btn ghost" aria-label="Close"
                onClick={() => setShowSheet(false)}
                style={{position:'absolute',right:10,top:6,padding:'4px 10px',fontSize:16,lineHeight:1}}>
                ✕
              </button>
            </div>
            <div className="sheet-section-label">Go to</div>
            <div className="sheet-nav-grid">
              {SIDEBAR_NAV.map(n => (
                <div key={n.id} className={"sheet-nav-item" + (active === n.id ? " active" : "")}
                  onClick={() => { setActive(n.id); setShowSheet(false); }}>
                  <Icon name={n.icon} size={15} style={{color:"var(--accent)",flexShrink:0}}/>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12}}>{n.label}</span>
                </div>
              ))}
            </div>
            <div className="sheet-section-label">Show on dashboard</div>
            <div className="module-grid">
              {MODULE_LABELS.map(([k, label, icon]) => (
                <div key={k} className={"module-tile" + (t.modules[k] !== false ? " enabled" : "")}
                  onClick={() => setTweak("modules", { ...t.modules, [k]: t.modules[k] === false })}>
                  <Icon name={icon} size={16}/>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              <button className="btn" style={{flex:1}} onClick={() => { setShowSettings(true); setShowSheet(false); }}>
                <Icon name="settings" size={13}/>Settings
              </button>
              <button className="btn" style={{flex:1}} onClick={logout}>
                <Icon name="logout" size={13}/>Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div style={{ position:"fixed", bottom:120, right:16, display:"flex", flexDirection:"column", gap:6, zIndex:200, pointerEvents:"none" }}>
          {toasts.map(t => (
            <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
          ))}
        </div>
      )}

      {needsOnboarding === true && window.OnboardingWizard && (
        <window.OnboardingWizard onComplete={handleOnboardingComplete} />
      )}

      {window.SettingsPanel && (
        <window.SettingsPanel
          open={showSettings}
          onClose={() => setShowSettings(false)}
          tweaks={t}
          setTweak={setTweak}
          userName={userName}
          setUserName={setUserName}
          onReEnroll={handleReEnroll}
          onLogout={logout}
        />
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
