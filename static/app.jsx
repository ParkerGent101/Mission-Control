/* Mission Control — app shell.
   One product now: personal finance. The shell owns the month (the app's primary
   control), the shared month fetch, toasts, and the tab router. */

const TABS = [
  { id: "overview",     label: "Overview",     icon: "home"        },
  { id: "transactions", label: "Transactions", icon: "inbox"       },
  { id: "bills",        label: "Bills",        icon: "calendar"    },
  { id: "accounts",     label: "Accounts",     icon: "wallet"      },
  { id: "trends",       label: "Trends",       icon: "trending-up" },
];

const App = () => {
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem('mc_tab');
      return TABS.some(t => t.id === saved) ? saved : 'overview';
    } catch { return 'overview'; }
  });
  const [month, setMonth] = useState(currentMonth());
  const [toasts, setToasts] = useState([]);
  const [showSettings, setShowSettings] = useState(false);

  const data = useFinanceData(month);
  const { syncing, ready: driveReady, sync } = useDriveSync(month, data.reload, data.reloadStatic);

  useEffect(() => { try { localStorage.setItem('mc_tab', tab); } catch {} }, [tab]);

  useEffect(() => {
    window.__toast = (msg, type = "success") => {
      const id = Date.now() + Math.random();
      setToasts(ts => [...ts, { id, msg, type }]);
      setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 3200);
    };
  }, []);

  // 1-5 jump to a tab; Escape closes Settings. Ignored while typing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { setShowSettings(false); return; }
      const el = document.activeElement;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= TABS.length) setTab(TABS[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Refresh every 3 min while the tab is visible, and immediately on becoming
     visible again. A backgrounded tab never polls, which also lets the Cloud Run
     instance scale to zero when you walk away. Views subscribe via useRefreshListener. */
  useEffect(() => {
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

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  const isCurrent = month === currentMonth();
  const monthNeedsStepper = tab === 'overview' || tab === 'transactions' || tab === 'bills' || tab === 'trends';

  const body = {
    overview:     <OverviewTab month={month} data={data} />,
    transactions: <TransactionsTab month={month} setMonth={setMonth} data={data} />,
    bills:        <BillsTab month={month} />,
    accounts:     <AccountsTab />,
    trends:       <TrendsTab month={month} />,
  }[tab];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Finances</span>
        </div>

        {monthNeedsStepper && (
          <div className="month-stepper">
            <button className="icon-btn" onClick={() => setMonth(m => shiftMonth(m, -1))}
                    aria-label="Previous month" title="Previous month">‹</button>
            <span className="month-label">{monthLabel(month)}</span>
            <button className="icon-btn" onClick={() => setMonth(m => shiftMonth(m, 1))}
                    aria-label="Next month" title="Next month">›</button>
            {!isCurrent && (
              <button className="btn ghost inline" onClick={() => setMonth(currentMonth())}>Today</button>
            )}
          </div>
        )}

        <div className="topbar-right">
          {driveReady !== false && (
            <button className="btn" disabled={syncing} onClick={() => sync({ manual: true })}
                    title="Import the newest Rocket Money CSV export from your Google Drive folder">
              <Icon name={syncing ? "loader" : "download"} size={13} />
              <span className="btn-text">{syncing ? "Syncing…" : "Sync"}</span>
            </button>
          )}
          <button className="icon-btn" title="Settings" onClick={() => setShowSettings(true)}>
            <Icon name="settings" size={15} />
          </button>
          <button className="icon-btn" title="Sign out" onClick={logout}>
            <Icon name="logout" size={15} />
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Sections">
        {TABS.map((t, i) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
                  className={"tab" + (tab === t.id ? " on" : "")}
                  onClick={() => setTab(t.id)} title={`${t.label} (${i + 1})`}>
            <Icon name={t.icon} size={15} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main>{body}</main>

      {toasts.length > 0 && (
        <div className="toasts">
          {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>)}
        </div>
      )}

      {window.SettingsPanel && (
        <window.SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} onLogout={logout} />
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
