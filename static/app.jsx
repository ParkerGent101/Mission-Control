/* Mission Control — App shell */
const { useState: useStateApp, useEffect: useEffectApp } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#e0a857",
  "density": "balanced",
  "sidebar": "full",
  "modules": {
    "talk": true, "agenda": true, "finance": true, "band": true, "health": true,
    "work": true, "study": true, "reading": true, "gaming": true,
    "holidays": true, "journal": true
  }
}/*EDITMODE-END*/;

const ACCENT_OPTIONS = ["#e0a857", "#6ed3b6", "#e07a5f", "#b69cf0", "#8fb3e0"];

const SIDEBAR_NAV = [
  { id: "dashboard",  icon: "home",       label: "Dashboard",   badge: "" },
  { id: "agenda",     icon: "calendar",   label: "Agenda",      badge: "" },
  { id: "finance",    icon: "wallet",     label: "Finance",     badge: "" },
  { id: "band",       icon: "music",      label: "Band",        badge: "" },
  { id: "health",     icon: "heart",      label: "Health",      badge: "" },
  { id: "work",       icon: "briefcase",  label: "Work",        badge: "" },
  { id: "study",      icon: "graduation", label: "Studying",    badge: "" },
  { id: "reading",    icon: "book",       label: "Reading",     badge: "" },
  { id: "gaming",     icon: "gamepad",    label: "Gaming",      badge: "" },
  { id: "holidays",   icon: "plane",      label: "Holidays",    badge: "" },
  { id: "journal",    icon: "feather",    label: "Journal",     badge: "" },
];

const App = () => {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [active, setActive] = useStateApp("dashboard");
  const [cmdOpen, setCmdOpen] = useStateApp(false);
  const [now, setNow] = useStateApp(new Date());

  useEffectApp(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ⌘K
  useEffectApp(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffectApp(() => {
    document.documentElement.style.setProperty("--accent", t.accent);
  }, [t.accent]);

  const onAction = (c) => {
    if (!c?.action) return;
    if (c.action === "open:tweaks") {
      window.postMessage({ type: "__activate_edit_mode" }, "*");
    } else if (c.action.startsWith("go:")) {
      setActive(c.action.split(":")[1]);
    }
  };

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const date = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const weekNum = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 604800000);

  const M = window.MissionModules;
  const cards = [
    { id: "talk",     el: <M.TalkCard /> },
    { id: "agenda",   el: <M.AgendaCard /> },
    { id: "finance",  el: <M.FinanceCard /> },
    { id: "band",     el: <M.BandCard /> },
    { id: "health",   el: <M.HealthCard /> },
    { id: "work",     el: <M.WorkCard /> },
    { id: "study",    el: <M.StudyCard /> },
    { id: "reading",  el: <M.ReadingCard /> },
    { id: "gaming",   el: <M.GamingCard /> },
    { id: "holidays", el: <M.HolidayCard /> },
    { id: "journal",  el: <M.JournalCard /> },
  ];

  return (
    <div className="app" data-density={t.density} data-sidebar={t.sidebar}>
      {/* Top bar */}
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark"/>
          <span className="brand-name">MISSION CONTROL</span>
        </div>
        <div className="topbar-center">
          <div className="cmdk" onClick={() => setCmdOpen(true)}>
            <Icon name="search" size={14}/>
            <span className="cmdk-text">Type a command, or search anything…</span>
            <span className="kbd">⌘K</span>
          </div>
          <span className="pill"><span className="dot"/>localhost:5000</span>
        </div>
        <div className="topbar-right">
          <span className="mono" style={{ padding: "0 10px", color: "var(--ink-2)" }}>{date}</span>
          <button className="icon-btn" title="Settings" onClick={() => window.postMessage({ type: "__activate_edit_mode" }, "*")}>
            <Icon name="settings" size={15}/>
          </button>
          <div title="Logout" onClick={logout} style={{
            width: 28, height: 28, borderRadius: "50%",
            background: "linear-gradient(135deg, var(--accent), var(--violet))",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
            marginLeft: 4, cursor: "pointer"
          }}>P</div>
        </div>
      </div>

      {/* Sidebar */}
      <nav className="sidebar">
        <div className="sb-section">Workspace</div>
        {SIDEBAR_NAV.slice(0, 2).map((n) => (
          <div key={n.id} className={"sb-item" + (active === n.id ? " active" : "")} onClick={() => setActive(n.id)}>
            <Icon name={n.icon} size={16} className="sb-icon" />
            <span className="sb-label">{n.label}</span>
            {n.badge && <span className="sb-badge">{n.badge}</span>}
          </div>
        ))}
        <div className="sb-section">Modules</div>
        {SIDEBAR_NAV.slice(2).map((n) => (
          <div key={n.id} className={"sb-item" + (active === n.id ? " active" : "")} onClick={() => setActive(n.id)}>
            <Icon name={n.icon} size={16} className="sb-icon" />
            <span className="sb-label">{n.label}</span>
          </div>
        ))}
        <div style={{ flex: 1 }}/>
        <div className="sb-section">Shortcuts</div>
        <div className="sb-item" onClick={() => setCmdOpen(true)}>
          <Icon name="command" size={16} className="sb-icon" />
          <span className="sb-label">Command palette</span>
          <span className="sb-badge">⌘K</span>
        </div>
        <div className="sb-item" onClick={() => window.postMessage({ type: "__activate_edit_mode" }, "*")}>
          <Icon name="settings" size={16} className="sb-icon" />
          <span className="sb-label">Tweaks</span>
        </div>
      </nav>

      {/* Main */}
      <main>
        <div className="page-head">
          <h1>Good {now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, Parker.</h1>
          <span className="date">{date} — week {weekNum} of {now.getFullYear()}</span>
          <div className="spacer"/>
        </div>
        {active === "dashboard" ? (
          <div className="grid">
            {cards.map((c) => (
              <React.Fragment key={c.id}>
                {t.modules[c.id] !== false && c.el}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div>
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
        <span>mission control · localhost:5000</span>
        <span className="sep"/>
        <span>claude · connected</span>
        <span className="spacer"/>
        <span className="mono">{date} · {time}</span>
        <span className="sep"/>
        <a onClick={() => setCmdOpen(true)} style={{ cursor: "pointer" }}>⌘K commands</a>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onAction={onAction} />

      <TweaksPanel>
        <TweakSection label="Look">
          <TweakColor label="Accent" value={t.accent} onChange={(v) => setTweak("accent", v)} options={ACCENT_OPTIONS} />
          <TweakRadio label="Density" value={t.density} onChange={(v) => setTweak("density", v)}
            options={[{ value: "compact", label: "Compact" }, { value: "balanced", label: "Balanced" }, { value: "airy", label: "Airy" }]} />
          <TweakRadio label="Sidebar" value={t.sidebar} onChange={(v) => setTweak("sidebar", v)}
            options={[{ value: "full", label: "Full" }, { value: "icons", label: "Icons" }, { value: "hidden", label: "Hidden" }]} />
        </TweakSection>
        <TweakSection label="Modules">
          {[["talk","Talk to Mission Control"],["agenda","Today / Agenda"],["finance","Finance"],["band","Band"],
            ["health","Health & Fitness"],["work","Work"],["study","Studying"],["reading","Reading"],
            ["gaming","Gaming"],["holidays","Holidays"],["journal","Journal"],
          ].map(([k, label]) => (
            <TweakToggle key={k} label={label} value={t.modules[k] !== false}
              onChange={(v) => setTweak("modules", { ...t.modules, [k]: v })} />
          ))}
        </TweakSection>
      </TweaksPanel>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
