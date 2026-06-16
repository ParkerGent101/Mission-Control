/* Mission Control — App shell */
const { useState: useStateApp, useEffect: useEffectApp } = React;

/* ── Command parser ─────────────────────────────────────────── */
const _tok = (text) => {
  const out = [];
  const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] || m[2] || m[3]);
  return out;
};

const _FIN_CATS = ['band','it','coding','personal','food','transport','health','entertainment'];
const _PRIS     = ['high','normal','low'];

const parseCommand = (text) => {
  const toks = _tok(text.trim());
  if (!toks.length) return null;
  const [c, ...rest] = toks;
  const cmd = c.toLowerCase();

  /* ── shortcuts ── */
  if (cmd === 'weight' && rest[0] && !isNaN(+rest[0]))
    return { endpoint: '/api/health/weight', method: 'POST', body: { weight: +rest[0] },
             module: 'health', summary: `Weight: ${rest[0]} lb` };

  if (cmd === 'calories' && rest[0] && !isNaN(+rest[0])) {
    const body = { consumed: +rest[0] };
    const bi = rest.indexOf('burned');
    if (bi !== -1 && rest[bi+1]) body.burned = +rest[bi+1];
    return { endpoint: '/api/health/calories', method: 'POST', body,
             module: 'health', summary: `Calories: ${rest[0]}${body.burned ? `, burned ${body.burned}` : ''}` };
  }

  if (cmd === 'water') {
    const first = rest[0]?.toLowerCase();
    if (!first || first === 'bottle')
      return { endpoint: '/api/health/water', method: 'POST', body: { add_bottles: 1 },
               module: 'health', summary: 'Water: +1 bottle' };
    if (first === 'reset')
      return { endpoint: '/api/health/water', method: 'POST', body: { oz: 0 },
               module: 'health', summary: 'Water reset' };
    if (!isNaN(+rest[0])) {
      const usesBottle = rest.some(t => t.toLowerCase().startsWith('bottle'));
      return { endpoint: '/api/health/water', method: 'POST',
               body: usesBottle ? { add_bottles: +rest[0] } : { add_oz: +rest[0] },
               module: 'health',
               summary: usesBottle ? `Water: +${rest[0]} bottle${+rest[0] === 1 ? '' : 's'}` : `Water: +${rest[0]} oz` };
    }
  }

  /* ── finance ── */
  if (cmd === 'finance' && rest.length >= 2) {
    const [act, amtRaw, ...descParts] = rest;
    const type = act.toLowerCase() === 'income' ? 'income' : 'expense';
    const amt = +(amtRaw?.replace(/[$,]/g, '') || 'x');
    if (isNaN(amt)) return null;
    const lastLow = descParts[descParts.length-1]?.toLowerCase();
    const category = _FIN_CATS.includes(lastLow) ? descParts.pop().toLowerCase() : 'personal';
    const description = descParts.join(' ') || 'Untitled';
    return { endpoint: '/api/finances', method: 'POST',
             body: { description, amount: amt, type, category },
             module: 'finance', summary: `${type} logged: $${amt} — ${description}` };
  }

  /* ── health ── */
  if (cmd === 'health' && rest.length >= 1) {
    const [act, ...args] = rest;
    const a = act.toLowerCase();
    if (a === 'weight' && !isNaN(+args[0]))
      return { endpoint: '/api/health/weight', method: 'POST', body: { weight: +args[0] },
               module: 'health', summary: `Weight: ${args[0]} lb` };
    if (a === 'calories' && !isNaN(+args[0])) {
      const body = { consumed: +args[0] };
      const bi = args.indexOf('burned');
      if (bi !== -1 && args[bi+1]) body.burned = +args[bi+1];
      return { endpoint: '/api/health/calories', method: 'POST', body,
               module: 'health', summary: `Calories: ${args[0]}` };
    }
    if (a === 'water') {
      if (!args[0] || args[0].toLowerCase() === 'bottle')
        return { endpoint: '/api/health/water', method: 'POST', body: { add_bottles: 1 },
                 module: 'health', summary: 'Water: +1 bottle' };
      if (args[0].toLowerCase() === 'reset')
        return { endpoint: '/api/health/water', method: 'POST', body: { oz: 0 },
                 module: 'health', summary: 'Water reset' };
      if (!isNaN(+args[0])) {
        const usesBottle = args.some(t => t.toLowerCase().startsWith('bottle'));
        return { endpoint: '/api/health/water', method: 'POST',
                 body: usesBottle ? { add_bottles: +args[0] } : { add_oz: +args[0] },
                 module: 'health', summary: usesBottle ? `Water: +${args[0]} bottle${+args[0] === 1 ? '' : 's'}` : `Water: +${args[0]} oz` };
      }
    }
    if (a === 'habit' && args.length)
      return { endpoint: '/api/health/habit', method: 'POST', body: { habit: args.join(' ') },
               module: 'health', summary: `Habit toggled: ${args.join(' ')}` };
  }

  /* ── remind ── */
  if (cmd === 'remind' && rest.length >= 2) {
    const onIdx = rest.findIndex(t => t.toLowerCase() === 'on');
    let title, due_date;
    if (onIdx > 0 && rest[onIdx+1]) {
      title    = rest.slice(0, onIdx).join(' ');
      due_date = rest[onIdx+1];
    } else {
      due_date = rest[rest.length-1];
      title    = rest.slice(0, -1).join(' ');
    }
    return { endpoint: '/api/reminders', method: 'POST', body: { title, due_date },
             module: 'agenda', summary: `Reminder: ${title} — ${due_date}` };
  }

  /* ── band ── */
  if (cmd === 'band' && rest.length >= 2) {
    const [act, ...args] = rest;
    const a = act.toLowerCase();
    if (a === 'show') {
      const [date, event, venue, ...cityParts] = args;
      if (!date || !event || !venue) return null;
      return { endpoint: '/api/shows', method: 'POST',
               body: { date, event, venue, city: cityParts.join(' ') },
               module: 'band', summary: `Show: ${event} @ ${venue}` };
    }
    if (a === 'contact') {
      const [name, venue, ...cityParts] = args;
      if (!name) return null;
      return { endpoint: '/api/band/contacts', method: 'POST',
               body: { name, venue: venue || '', city: cityParts.join(' ') },
               module: 'band', summary: `Contact added: ${name}` };
    }
  }

  return null;
};

/* ── Help panel ─────────────────────────────────────────────── */
const HELP_CMDS = [
  { group: 'Shortcuts', items: [
    { cmd: 'weight 185',                  desc: 'log weight (lb)' },
    { cmd: 'calories 2200',               desc: 'log daily intake' },
    { cmd: 'calories 2000 burned 350',    desc: 'with burned kcal' },
    { cmd: 'water',                       desc: 'add one Owala bottle' },
    { cmd: 'page 142  · read 142',        desc: 'update book page' },
    { cmd: 'score 74',                    desc: 'log practice test %' },
  ]},
  { group: 'Finance', items: [
    { cmd: 'finance expense 45 "Guitar strings" band' },
    { cmd: 'finance income 200 "Gig pay" band' },
    { cmd: 'categories: band it coding personal food', desc: '(last word)' },
  ]},
  { group: 'Health', items: [
    { cmd: 'health weight 184' },
    { cmd: 'health calories 1800' },
    { cmd: 'health water 16',             desc: 'add ounces' },
    { cmd: 'health habit Lift',           desc: 'toggle habit done' },
  ]},
  { group: 'Band', items: [
    { cmd: 'band show 2026-07-04 "Show Name" "Venue" "Rogers"' },
    { cmd: 'band contact "John Smith" "The Venue" Fayetteville' },
  ]},
  { group: 'More', items: [
    { cmd: 'remind "Oil change" on 2026-06-15' },
  ]},
];

const HelpPanel = ({ onClose }) => (
  <div className="help-panel">
    <div className="help-panel-head">
      <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--ink-1)' }}>Command Reference</span>
      <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 10 }}>
        Direct commands skip AI — instant &amp; zero token cost
      </span>
      <button className="icon-btn" onClick={onClose} style={{ marginLeft: 'auto', flexShrink: 0, width: 24, height: 24 }}>
        <Icon name="x" size={11} />
      </button>
    </div>
    <div className="help-panel-grid">
      {HELP_CMDS.map(({ group, items }) => (
        <div key={group} className="help-group">
          <div className="help-group-title">{group}</div>
          {items.map(({ cmd, desc }) => (
            <div key={cmd} className="help-row">
              <span className="help-cmd">{cmd}</span>
              {desc && <span className="help-desc">{desc}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
);

/* ── Talk bar ────────────────────────────────────────────────── */
const TalkBar = ({ onNavigate }) => {
  const [val, setVal] = useStateApp('');
  const [busy, setBusy] = useStateApp(false);
  const [listening, setListening] = useStateApp(false);
  const [showHelp, setShowHelp] = useStateApp(false);

  const submit = async (text) => {
    const t = (text || '').trim();
    if (!t || busy) return;

    if (t === '?' || t.toLowerCase() === 'help') {
      setShowHelp(h => !h);
      setVal('');
      return;
    }

    const cmd = parseCommand(t);
    if (cmd) {
      setBusy(true);
      try {
        const r = await fetch(cmd.endpoint, {
          method: cmd.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cmd.body),
        });
        const d = await r.json();
        if (!d.error) {
          window.__toast?.(cmd.summary, 'success');
          if (cmd.module && onNavigate) onNavigate(cmd.module);
          window.dispatchEvent(new CustomEvent('mc:refresh', { detail: { module: cmd.module } }));
        } else {
          window.__toast?.(d.error, 'error');
        }
      } catch {
        window.__toast?.('Could not reach Mission Control', 'error');
      }
      setVal('');
      setBusy(false);
      return;
    }

    // Fall back to Claude
    setBusy(true);
    try {
      const r = await fetch('/api/talk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t }),
      });
      const d = await r.json();
      const raw = d.reply || '';
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      const msg = parsed?.summary || parsed?.reply || raw;
      if (window.__toast) window.__toast(msg.slice(0, 90), 'success');
      if (parsed?.module && onNavigate) onNavigate(parsed.module);
      window.dispatchEvent(new CustomEvent('mc:refresh', { detail: { module: parsed?.module } }));
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
    <>
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      <div className="talk-bar">
        <Icon name="sparkles" size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <input className="talk-bar-input"
          placeholder="Talk to Mission Control… (? for commands)"
          value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit(val)}
          disabled={busy} />
        <button className={"talk-bar-btn" + (showHelp ? " active" : "")}
          onClick={() => setShowHelp(h => !h)}
          title="Command reference (?)"
          style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
          ?
        </button>
        <button className={"talk-bar-btn" + (listening ? " listening" : "")}
          onClick={startVoice} disabled={busy} title="Voice input">
          <Icon name={listening ? "x" : "mic"} size={13} />
        </button>
        <button className="talk-bar-btn accent" onClick={() => submit(val)}
          disabled={busy || !val.trim()} title="Send">
          <Icon name={busy ? "loader" : "send"} size={13} />
        </button>
      </div>
    </>
  );
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#e0a857",
  "accent2": "#6ed3b6",
  "density": "balanced",
  "sidebar": "full",
  "modules": {
    "finance": true, "band": true, "health": true, "tcpg": true, "practice": true, "recurring": true
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
];

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
  const [cmdOpen, setCmdOpen] = useStateApp(false);
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

  // Plaid OAuth handoff: OAuth banks (Fidelity, Chase, etc.) authenticate on the bank's
  // site, then redirect the browser back here with ?oauth_state_id=... . Re-open Plaid
  // Link with the stored link_token + receivedRedirectUri to finish the connection.
  useEffectApp(() => {
    if (!window.location.search.includes('oauth_state_id')) return;
    const clearUrl = () => window.history.replaceState({}, document.title, window.location.pathname);
    const token = localStorage.getItem('mc_plaid_link_token');
    if (!token || !window.Plaid) { clearUrl(); return; }
    try {
      const handler = window.Plaid.create({
        token,
        receivedRedirectUri: window.location.href,
        onSuccess: async (publicToken) => {
          await fetch('/api/plaid/exchange', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token: publicToken }),
          });
          localStorage.removeItem('mc_plaid_link_token');
          clearUrl();
          window.__toast?.('Bank account connected', 'success');
          window.dispatchEvent(new CustomEvent('mc:refresh'));   // flips Finance to "Sync bank"
        },
        onExit: () => { localStorage.removeItem('mc_plaid_link_token'); clearUrl(); },
      });
      handler.open();
    } catch { localStorage.removeItem('mc_plaid_link_token'); clearUrl(); }
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

  // Auto-refresh all cards every 60s when the tab is visible, plus when the
  // tab becomes visible after being hidden. Cards subscribe via useRefreshListener.
  useEffectApp(() => {
    const fire = () => window.dispatchEvent(new CustomEvent('mc:refresh'));
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') fire();
    }, 60_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') fire(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffectApp(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
      if (e.key === "Escape") {
        setCmdOpen(false);
        setShowSettings(false);
      }
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

  const onAction = (c) => {
    if (!c?.action) return;
    if (c.action === "open:tweaks") {
      setShowSettings(true);
    } else if (c.action.startsWith("go:")) {
      setActive(c.action.split(":")[1]);
    }
  };

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
          <button className="icon-btn" title="Settings" onClick={() => setShowSettings(true)}>
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
        <div className="sb-item" onClick={() => setCmdOpen(true)}>
          <span className="sb-key">[K]</span>
          <span className="sb-label">Command palette</span>
          <span className="sb-badge">⌘K</span>
        </div>
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
              <button className="btn" style={{flex:1}} onClick={() => { setCmdOpen(true); setShowSheet(false); }}>
                <Icon name="search" size={13}/>Search ⌘K
              </button>
              <button className="btn" style={{flex:1}} onClick={() => { setShowSettings(true); setShowSheet(false); }}>
                <Icon name="settings" size={13}/>Settings
              </button>
            </div>
          </div>
        </div>
      )}

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onAction={onAction} />

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
