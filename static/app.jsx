/* Mission Control — App shell */
const { useState: useStateApp, useEffect: useEffectApp } = React;

const TalkBar = ({ onNavigate }) => {
  const [val, setVal] = useStateApp('');
  const [busy, setBusy] = useStateApp(false);
  const [listening, setListening] = useStateApp(false);

  const submit = async (text) => {
    const t = (text || '').trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/talk', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text: t})
      });
      const d = await r.json();
      const raw = d.reply || '';
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      const msg = parsed?.summary || parsed?.reply || raw;
      if (window.__toast) window.__toast(msg.slice(0, 90), 'success');
      if (parsed?.module && onNavigate) onNavigate(parsed.module);
      window.dispatchEvent(new CustomEvent('mc:refresh', {detail: {module: parsed?.module}}));
    } catch {
      if (window.__toast) window.__toast('Could not reach Mission Control', 'error');
    }
    setVal('');
    setBusy(false);
  };

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { window.__toast?.('Voice input not supported in this browser', 'error'); return; }
    const rec = new SR();
    rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (e) => { const t = e.results[0][0].transcript; setVal(t); submit(t); };
    rec.start();
  };

  return (
    <div className="talk-bar">
      <Icon name="sparkles" size={13} style={{color: 'var(--accent)', flexShrink: 0}}/>
      <input className="talk-bar-input" placeholder="Tell Mission Control anything…"
        value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit(val)}
        disabled={busy}/>
      <button className={"talk-bar-btn" + (listening ? " listening" : "")}
        onClick={startVoice} disabled={busy} title="Voice input">
        <Icon name={listening ? "x" : "mic"} size={13}/>
      </button>
      <button className="talk-bar-btn accent" onClick={() => submit(val)}
        disabled={busy || !val.trim()} title="Send">
        <Icon name={busy ? "loader" : "send"} size={13}/>
      </button>
    </div>
  );
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#e0a857",
  "density": "balanced",
  "sidebar": "full",
  "modules": {
    "agenda": true, "finance": true, "band": true, "health": true,
    "work": true, "study": true, "reading": true,
    "holidays": true, "journal": true
  }
}/*EDITMODE-END*/;

const ACCENT_OPTIONS = ["#e0a857", "#6ed3b6", "#e07a5f", "#b69cf0", "#8fb3e0"];

const SIDEBAR_NAV = [
  { id: "dashboard", icon: "home",      label: "Dashboard", badge: "" },
  { id: "agenda",    icon: "calendar",  label: "Agenda",    badge: "" },
  { id: "finance",    icon: "wallet",     label: "Finance",     badge: "" },
  { id: "band",       icon: "music",      label: "Band",        badge: "" },
  { id: "health",     icon: "heart",      label: "Health",      badge: "" },
  { id: "work",       icon: "briefcase",  label: "Work",        badge: "" },
  { id: "study",      icon: "graduation", label: "Studying",    badge: "" },
  { id: "reading",    icon: "book",       label: "Reading",     badge: "" },
  { id: "holidays",   icon: "plane",      label: "Holidays",    badge: "" },
  { id: "journal",    icon: "feather",    label: "Journal",     badge: "" },
];

// Bottom nav items for mobile (most important ones)
const MOBILE_NAV = [
  { id: "dashboard", icon: "home",      label: "Home" },
  { id: "agenda",    icon: "calendar",  label: "Today" },
  { id: "work",      icon: "briefcase", label: "Work" },
  { id: "band",      icon: "music",     label: "Band" },
  { id: "finance",   icon: "wallet",    label: "Finance" },
];

const MODULE_LABELS = [
  ["agenda","Today","calendar"],["finance","Finance","wallet"],
  ["band","Band","music"],["health","Health","heart"],["work","Work","briefcase"],
  ["study","Study","graduation"],["reading","Reading","book"],
  ["holidays","Travel","plane"],["journal","Journal","feather"],
];

const App = () => {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [active, setActive] = useStateApp("dashboard");
  const [cmdOpen, setCmdOpen] = useStateApp(false);
  const [now, setNow] = useStateApp(new Date());
  const [toasts, setToasts] = useStateApp([]);
  const [showSheet, setShowSheet] = useStateApp(false);
  const [brief, setBrief] = useStateApp(null);
  const [briefDismissed, setBriefDismissed] = useStateApp(() => {
    const today = new Date().toISOString().slice(0, 10);
    return localStorage.getItem('brief_dismissed') === today;
  });

  useEffectApp(() => {
    if (!briefDismissed) {
      fetch('/api/brief').then(r => r.json()).then(setBrief).catch(() => {});
    }
  }, [briefDismissed]);

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

  const dismissBrief = () => {
    localStorage.setItem('brief_dismissed', new Date().toISOString().slice(0, 10));
    setBriefDismissed(true);
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
    { id: "agenda",   el: <M.AgendaCard /> },
    { id: "finance",  el: <M.FinanceCard /> },
    { id: "band",     el: <M.BandCard /> },
    { id: "health",   el: <M.HealthCard /> },
    { id: "work",     el: <M.WorkCard /> },
    { id: "study",    el: <M.StudyCard /> },
    { id: "reading",  el: <M.ReadingCard /> },
    { id: "holidays", el: <M.HolidayCard /> },
    { id: "journal",  el: <M.JournalCard /> },
  ];

  const pageTitle = active === "dashboard"
    ? `Good ${now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, Parker.`
    : SIDEBAR_NAV.find(n => n.id === active)?.label || "Mission Control";

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
          <span className="mono topbar-date" style={{ padding: "0 10px", color: "var(--ink-2)" }}>{date}</span>
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
          <h1>{pageTitle}</h1>
          <span className="date">{date} — week {weekNum} of {now.getFullYear()}</span>
          <div className="spacer"/>
        </div>
        {active === "dashboard" ? (
          <div className="grid">
            {brief && !briefDismissed && (
              <div className="brief-banner span-12">
                <Icon name="sparkles" size={13} style={{color:'var(--accent)',flexShrink:0,marginTop:1}}/>
                <span className="brief-text">{brief.text}</span>
                <button className="brief-x" onClick={dismissBrief}><Icon name="x" size={11}/></button>
              </div>
            )}
            <M.TodayHub />
            {cards.map((c) => (
              <React.Fragment key={c.id}>
                {t.modules[c.id] !== false && c.el}
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
        <span>mission control · localhost:5000</span>
        <span className="sep"/>
        <span>claude · connected</span>
        <span className="spacer"/>
        <span className="mono">{date} · {time}</span>
        <span className="sep"/>
        <a onClick={() => setCmdOpen(true)} style={{ cursor: "pointer" }}>⌘K commands</a>
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
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle"/>
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
              <button className="btn" style={{flex:1}} onClick={() => { setCmdOpen(true); setShowSheet(false); }}>
                <Icon name="search" size={13}/>Search ⌘K
              </button>
              <button className="btn" style={{flex:1}} onClick={() => { window.postMessage({type:"__activate_edit_mode"},"*"); setShowSheet(false); }}>
                <Icon name="settings" size={13}/>Full settings
              </button>
            </div>
          </div>
        </div>
      )}

      <TalkBar onNavigate={setActive}/>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onAction={onAction} />

      {toasts.length > 0 && (
        <div style={{ position:"fixed", bottom:120, right:16, display:"flex", flexDirection:"column", gap:6, zIndex:200, pointerEvents:"none" }}>
          {toasts.map(t => (
            <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
          ))}
        </div>
      )}

      <TweaksPanel>
        <TweakSection label="Look">
          <TweakColor label="Accent" value={t.accent} onChange={(v) => setTweak("accent", v)} options={ACCENT_OPTIONS} />
          <TweakRadio label="Density" value={t.density} onChange={(v) => setTweak("density", v)}
            options={[{ value: "compact", label: "Compact" }, { value: "balanced", label: "Balanced" }, { value: "airy", label: "Airy" }]} />
          <TweakRadio label="Sidebar" value={t.sidebar} onChange={(v) => setTweak("sidebar", v)}
            options={[{ value: "full", label: "Full" }, { value: "icons", label: "Icons" }, { value: "hidden", label: "Hidden" }]} />
        </TweakSection>
        <TweakSection label="Modules">
          {[["agenda","Today / Agenda"],["finance","Finance"],["band","Band"],
            ["health","Health & Fitness"],["work","Work"],["study","Studying"],["reading","Reading"],
            ["holidays","Holidays"],["journal","Journal"],
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
