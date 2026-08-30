/* Finance — shared primitives.
   Loaded first (after icons.jsx); every finance-*.jsx view and app.jsx reads the
   helpers declared here. No build step: these are top-level consts in a classic
   script, so later scripts see them directly. */

const { useState, useMemo, useEffect, useRef, useCallback } = React;

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// ── small helpers ─────────────────────────────────────────────────────────────

// Subscribe to the global 'mc:refresh' event so a view re-fetches without a reload.
// loadFn is captured fresh on every render via a ref, so it sees current state.
const useRefreshListener = (loadFn) => {
  const ref = useRef(loadFn);
  ref.current = loadFn;
  useEffect(() => {
    const handler = () => ref.current && ref.current();
    window.addEventListener('mc:refresh', handler);
    return () => window.removeEventListener('mc:refresh', handler);
  }, []);
};

const toastErr = (m = "Couldn’t save — check your connection and try again") =>
  (window.__toast ? window.__toast(m, "error") : console.error(m));

const toastOk = (m) => window.__toast && window.__toast(m, "success");

// Container-level Enter-to-submit for multi-field forms.
const submitOnEnter = (fn) => (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); fn(); }
};

const fmtMoney = (n, opts = {}) => {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(Number(n) || 0);
  const s = v.toLocaleString("en-US", {
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  });
  return sign + "$" + s;
};

// Signed money for deltas — the sign is the point, so it is always shown.
const fmtDelta = (n, opts = {}) => (n >= 0 ? "+" : "−") + fmtMoney(Math.abs(n), opts);

const fmtPct = (n) => (isFinite(n) ? Math.round(n) : 0) + "%";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const currentMonth = () => todayISO().slice(0, 7);

const monthLabel = (m) => {
  const [y, mm] = String(m).split('-');
  return (MONTH_NAMES[parseInt(mm, 10) - 1] || '') + ' ' + y;
};

const shiftMonth = (m, dir) => {
  const [y, mm] = m.split('-').map(Number);
  let nm = mm + dir, ny = y;
  if (nm > 12) { nm = 1; ny++; }
  if (nm < 1)  { nm = 12; ny--; }
  return `${ny}-${String(nm).padStart(2,'0')}`;
};

const daysInMonth = (m) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm, 0).getDate();
};

/* How far through the month are we? 1.0 for any month that has already ended,
   so a past month is judged on its final numbers rather than "on pace". */
const monthProgress = (m) => {
  const total = daysInMonth(m);
  const now = new Date();
  const cur = currentMonth();
  if (m < cur) return 1;
  if (m > cur) return 0;
  return Math.min(1, now.getDate() / total);
};

const daysLeft = (m) => {
  if (m !== currentMonth()) return 0;
  return Math.max(0, daysInMonth(m) - new Date().getDate());
};

// ── categories ────────────────────────────────────────────────────────────────
// Names + fallback budgets only. Categories are identified by their label, never
// by colour — see paceStatus() for the one colour axis this app uses.
const FIN_CATS = [
  { name: "Utilities",         budget: 1437 },
  { name: "Subscriptions",     budget: 125  },
  { name: "Groceries",         budget: 400  },
  { name: "Dining and Drinks", budget: 250  },
  { name: "Fun",               budget: 500  },
  { name: "Gas",               budget: 300  },
  { name: "Shopping",          budget: 0    },
  { name: "Band",              budget: 0    },
  { name: "Loans",             budget: 500  },
  { name: "Other",             budget: 0    },
];
const FIN_CAT_NAMES = FIN_CATS.map(c => c.name);

// Categories a transaction can actually LIVE in inside the Google Sheet (the
// Fun/Gas/Groceries/Dining-and-Drinks detail tables + Utilities budget rows).
// The Sheet has nowhere to put the rest, so the picker for sheet-sourced txns is limited to these.
const SHEET_CAT_NAMES = ["Utilities", "Groceries", "Dining and Drinks", "Fun", "Gas"];

const normFinCat = (raw, fallback = "") => {
  const map = {
    Utilities: "Utilities", Subscriptions: "Subscriptions",
    Groceries: "Groceries", "Dining and Drinks": "Dining and Drinks", Fun: "Fun", Gas: "Gas",
    Shopping: "Shopping", Band: "Band", Loans: "Loans", Other: "Other",
    // Sheet typos / variants → canonical
    Utilites: "Utilities", Utilties: "Utilities",
    "Water, Sewer, Trash": "Utilities", Electricity: "Utilities", Internet: "Utilities",
    Water: "Utilities", Sewer: "Utilities", Trash: "Utilities", Phone: "Utilities",
    Housing: "Utilities", Rent: "Utilities", Mortgage: "Utilities", "Renters Insurance": "Utilities",
    Food: "Groceries", "Food / Grocery": "Groceries", "Food / Grocer": "Groceries",
    Grocery: "Groceries", Grocer: "Groceries",
    Restaurants: "Dining and Drinks", Dining: "Dining and Drinks",
    "Dining & Drinks": "Dining and Drinks", Drinks: "Dining and Drinks",
    Streaming: "Subscriptions", Subscription: "Subscriptions",
    Transportation: "Gas", Auto: "Gas", Fuel: "Gas",
    Loan: "Loans",
    // lowercase fallbacks
    housing: "Utilities", utilities: "Utilities", subscriptions: "Subscriptions",
    food: "Groceries", groceries: "Groceries", grocery: "Groceries", grocer: "Groceries",
    dining: "Dining and Drinks", "dining & drinks": "Dining and Drinks",
    "dining and drinks": "Dining and Drinks", drinks: "Dining and Drinks",
    transport: "Gas",
    shopping: "Shopping", band: "Band", loans: "Loans",
    entertainment: "Fun", health: "Other", personal: "Other",
    IT: "Other", coding: "Other", gift: "Other", tax_refund: "Other", freelance: "Other",
  };
  const substr = [
    ["renters insurance", "Utilities"], ["rent", "Utilities"], ["mortgage", "Utilities"],
    ["internet", "Utilities"], ["electric", "Utilities"], ["water", "Utilities"],
    ["sewer", "Utilities"], ["trash", "Utilities"], ["phone", "Utilities"],
    ["grocery", "Groceries"], ["grocer", "Groceries"],
    ["dining", "Dining and Drinks"],
  ];
  const resolve = (value) => {
    const key = String(value || "").trim();
    if (!key) return "";
    const exact = map[key] || map[key.toLowerCase()];
    if (exact) return exact;
    const lower = key.toLowerCase();
    const found = substr.find(([needle]) => lower.includes(needle));
    return found ? found[1] : "";
  };
  const primary = resolve(raw);
  if (primary && primary !== "Other") return primary;
  return resolve(fallback) || primary || "Other";
};

// ── budget pace ───────────────────────────────────────────────────────────────
/* The one place this app uses colour to mean something. These are the reserved
   status steps (good / warning / serious / critical), each >= 3:1 on --surface,
   and each ships with an icon + words so the state is never colour-alone. */
/* `color` tints the status chip; `fill` paints the bar. They differ on purpose:
   if every healthy bar were green, a screen of healthy categories would be a wall
   of colour and the one category in trouble would not stand out. So a bar that is
   fine stays recessive ink and only an off-track one lights up — the eye goes
   straight to what needs looking at. The chip still carries an icon and a word, so
   the state never depends on the bar's colour. */
const PACE = {
  none:     { color: 'var(--ink-4)',        fill: 'var(--ink-4)',        icon: 'circle', label: 'no budget' },
  good:     { color: 'var(--pace-good)',    fill: 'var(--ink-3)',        icon: 'check',  label: 'on track' },
  warning:  { color: 'var(--pace-warn)',    fill: 'var(--pace-warn)',    icon: 'clock',  label: 'running hot' },
  serious:  { color: 'var(--pace-serious)', fill: 'var(--pace-serious)', icon: 'flag',   label: 'will overspend' },
  critical: { color: 'var(--pace-crit)',    fill: 'var(--pace-crit)',    icon: 'x',      label: 'over budget' },
};

/* Classify a category against its budget and how much of the month has elapsed.
     expected  — spend if it were perfectly even across the month
     projected — month-end spend if the current rate holds
   A category with no budget can't be judged, so it reports `none`. */
const paceStatus = (actual, budget, progress) => {
  if (!budget || budget <= 0) return { key: 'none', ...PACE.none, expected: 0, projected: actual };
  const expected  = budget * progress;
  const projected = progress > 0.02 ? actual / progress : actual;
  let key;
  if (actual > budget)            key = 'critical';
  else if (projected > budget * 1.05) key = 'serious';
  else if (actual > expected * 1.1)   key = 'warning';
  else                                key = 'good';
  return { key, ...PACE[key], expected, projected };
};

// ── shared UI ─────────────────────────────────────────────────────────────────

const LoadState = ({ loading, error, onRetry, what = "data" }) => {
  if (loading) return <div className="muted-2" style={{fontSize:12,padding:'10px 0'}}>Loading {what}…</div>;
  if (error) return (
    <div style={{fontSize:12,padding:'10px 0',color:'var(--danger)',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
      <span>Couldn’t load {what}.</span>
      {onRetry && <button className="btn ghost" style={{fontSize:11,padding:'2px 8px'}} onClick={onRetry}>Retry</button>}
    </div>
  );
  return null;
};

const Empty = ({ children }) => (
  <div className="muted-2" style={{fontSize:12.5,padding:'14px 2px',lineHeight:1.6}}>{children}</div>
);

// A titled panel. Simpler than the old collapsible dashboard Card — with one
// module left there is nothing to collapse a card *out of*.
const Panel = ({ title, right, children, className = "", style = {} }) => (
  <section className={"panel " + className} style={style}>
    {(title || right) && (
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        <div className="panel-right">{right}</div>
      </div>
    )}
    <div className="panel-body">{children}</div>
  </section>
);

/* One category's budget line: a bar for spend, a tick for where an even spend
   rate would put you today, and a status chip. */
const PaceBar = ({ name, actual, budget, progress, share }) => {
  const st = paceStatus(actual, budget, progress);
  const pctOfBudget = budget > 0 ? (actual / budget) * 100 : 0;
  const tick = budget > 0 ? Math.min(100, progress * 100) : null;
  return (
    <div className="pace-row">
      <div className="pace-name" title={name}>{name}</div>
      <div className="pace-track" role="img"
           aria-label={`${name}: ${fmtMoney(actual)} of ${fmtMoney(budget)}, ${st.label}`}>
        <div className="pace-fill" style={{ width: Math.min(100, pctOfBudget) + '%', background: st.fill }} />
        {tick !== null && <span className="pace-tick" style={{ left: tick + '%' }} title="where an even spend rate would be today" />}
        {pctOfBudget > 100 && <span className="pace-over" title="over budget" />}
      </div>
      <div className="pace-amt num">{fmtMoney(actual, { cents: false })}</div>
      <div className="pace-budget num muted-2">{budget > 0 ? '/ ' + fmtMoney(budget, { cents: false }) : '—'}</div>
      <div className="pace-status" style={{ color: st.color }} title={st.label}>
        <Icon name={st.icon} size={12} />
        <span>{budget > 0 ? fmtPct(pctOfBudget) : (share != null ? fmtPct(share) : '—')}</span>
      </div>
    </div>
  );
};

/* Small-multiple line. One series, one hue — many categories are shown as many
   little panels rather than many colours on one axis. */
const MiniLine = ({ values, width = 132, height = 34, color = "var(--accent-2)" }) => {
  if (!values || values.length < 2) return <div className="mini-line-empty" style={{height}} />;
  const pad = 3;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = (max - min) || 1;
  const x = (i) => pad + (i * (width - pad * 2)) / (values.length - 1);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="mini-line">
      <path d={`${d} L${x(last).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`}
            fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r="3" fill={color} />
    </svg>
  );
};

// ── data ──────────────────────────────────────────────────────────────────────
/* One fetch of everything the month views need, shared by Overview, Transactions
   and Bills so switching tabs doesn't re-hit the Sheet. */
const useFinanceData = (month) => {
  const [txns, setTxns]         = useState([]);
  const [budget, setBudget]     = useState(null);
  const [subs, setSubs]         = useState([]);
  const [roommate, setRoommate] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const catOverrides = useRef({});

  const loadMonth = useCallback((m = month, opts = {}) => {
    if (!opts.silent) setLoading(true);
    fetch(`/api/finances?month=${m}`)
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(data => {
        setTxns((Array.isArray(data) ? data : []).map(t => ({
          merchant: t.description,
          cat: catOverrides.current[t.id] ?? normFinCat(t.category, t.description),
          amount: t.type === 'expense' ? -t.amount : t.amount,
          date: t.date ? new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
          iso: t.date || '',
          id: t.id, source: t.source,
          sheet_tab: t.sheet_tab, sheet_row: t.sheet_row, sheet_col: t.sheet_col,
          sheet_cols: t.sheet_cols, sheet_kind: t.sheet_kind,
        })));
        setLoading(false); setError(false);
      })
      .catch(() => { setLoading(false); setError(true); });

    fetch(`/api/finances/budget?month=${m}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setBudget(d); })
      .catch(() => {});
  }, [month]);

  const loadStatic = useCallback(() => {
    fetch('/api/finances/subscriptions').then(r => r.json()).then(setSubs).catch(() => {});
    fetch('/api/finances/roommate').then(r => r.json())
      .then(d => setRoommate(d && d.ok ? d : null)).catch(() => {});
  }, []);

  useEffect(() => { loadMonth(month); }, [month, loadMonth]);
  useEffect(() => { loadStatic(); }, [loadStatic]);
  useRefreshListener(() => { loadMonth(month, { silent: true }); loadStatic(); });

  /* Categories merged from the Sheet's budget rows when it has them, else derived
     from this month's transactions against the fallback budgets. */
  const categories = useMemo(() => {
    const subTotal = subs.reduce((s, c) => s + (Number(c.amt) || 0), 0);
    if (budget && budget.categories && budget.categories.length) {
      const merged = budget.categories.reduce((acc, c) => {
        const name = normFinCat(c.name);
        if (!acc[name]) acc[name] = { name, budget: 0, actual: 0 };
        acc[name].budget += Number(c.budgeted) || 0;
        acc[name].actual += Number(c.actual) || 0;
        return acc;
      }, {});
      return Object.values(merged);
    }
    return FIN_CATS.filter(c => c.budget > 0).map(c => ({
      name: c.name,
      budget: c.budget,
      actual: c.name === 'Subscriptions'
        ? subTotal
        : txns.filter(t => t.amount < 0 && normFinCat(t.cat) === c.name)
              .reduce((s, t) => s + Math.abs(t.amount), 0),
    }));
  }, [budget, txns, subs]);

  const roomTotal = roommate && roommate.total ? roommate.total : 0;
  const totalIn = (budget ? budget.income : txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)) + roomTotal;
  const totalEx = budget ? budget.expense : txns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalBudget = categories.reduce((s, c) => s + (c.budget || 0), 0);

  return {
    txns, setTxns, budget, subs, roommate, setRoommate, categories,
    totalIn, totalEx, totalBudget, net: totalIn - totalEx,
    loading, error, reload: loadMonth, reloadStatic: loadStatic, catOverrides,
  };
};
