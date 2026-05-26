/* Mission Control — module cards */
const { useState, useMemo, useEffect, useRef, useCallback } = React;

const fmtMoney = (n, opts = {}) => {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  const s = v.toLocaleString("en-US", { minimumFractionDigits: opts.cents === false ? 0 : 2, maximumFractionDigits: 2 });
  return sign + "$" + s;
};

const Sparkline = ({ data, color = "var(--accent-2)", fill = true, height = 36 }) => {
  if (!data || data.length < 2) return null;
  const w = 200, h = height, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const range = (max - min) || 1;
  const step = (w - pad * 2) / (data.length - 1);
  const pts = data.map((v, i) => [pad + i * step, h - pad - ((v - min) / range) * (h - pad * 2)]);
  const d = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = d + ` L${pts[pts.length-1][0]},${h} L${pts[0][0]},${h} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && <path d={area} fill={color} fillOpacity="0.12" />}
      <path d={d} stroke={color} strokeWidth="1.5" fill="none" />
    </svg>
  );
};

const Checkbox = ({ checked, onClick }) => (
  <span className={"checkbox" + (checked ? " checked" : "")} onClick={onClick}>
    {checked && <Icon name="check" size={11} stroke={2.5} />}
  </span>
);

const DonutChart = ({ data, size = 110 }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <div style={{width:size,height:size,display:'flex',alignItems:'center',justifyContent:'center'}}><span className="muted-2 mono" style={{fontSize:10}}>no data</span></div>;
  const cx = size/2, cy = size/2, r = size*0.42, inner = size*0.25;
  let cum = -Math.PI/2;
  const slices = data.map(d => {
    const angle = (d.value/total)*2*Math.PI;
    const start = cum; cum += angle; const end = cum;
    const x1=cx+r*Math.cos(start), y1=cy+r*Math.sin(start);
    const x2=cx+r*Math.cos(end),   y2=cy+r*Math.sin(end);
    const ix1=cx+inner*Math.cos(start), iy1=cy+inner*Math.sin(start);
    const ix2=cx+inner*Math.cos(end),   iy2=cy+inner*Math.sin(end);
    const large = angle>Math.PI?1:0;
    return {...d, path:`M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L${ix2.toFixed(2)} ${iy2.toFixed(2)} A${inner} ${inner} 0 ${large} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)}Z`};
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.map((s,i)=><path key={i} d={s.path} fill={s.color} stroke="var(--surface)" strokeWidth={1.5}/>)}
    </svg>
  );
};

const Card = ({ id, num, title, right, children, span = 6, hidden, bodyClass = "" }) => (
  <div className={`span-${span}`} style={{ display: "flex" }}>
    <div className="card" data-hidden={hidden ? "true" : undefined} style={{ flex: 1 }}>
      <div className="card-head">
        <div className="title"><span className="num">{num}</span>{title}</div>
        <div className="right">{right}</div>
      </div>
      <div className={"card-body " + bodyClass}>{children}</div>
    </div>
  </div>
);

// =========================================================
// TODAY / AGENDA
// =========================================================
const TAG_COLOR = { Work:"info", IT:"info", Cal:"mint", Read:"amber", Journal:"mint", band:"violet", study:"info", Personal:"mint", default:"" };

const AgendaCard = () => {
  const [items, setItems] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calories, setCalories] = useState({ target: 2200, consumed: 0, burned: 0 });
  const [macros, setMacros] = useState([
    { l: "Protein", v: 0, g: 165, c: "var(--accent-2)" },
    { l: "Carbs",   v: 0, g: 220, c: "var(--accent)" },
    { l: "Fat",     v: 0, g: 70,  c: "var(--info)" },
  ]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    fetch('/api/agenda').then(r => r.json()).then(data => {
      if (data && data.length) {
        const sorted = data
          .filter(i => !i.done)
          .sort((a,b) => (a.date||'').localeCompare(b.date||'') || (a.time||'').localeCompare(b.time||''));
        setItems(sorted.map(i => ({ ...i, color: i.color || TAG_COLOR[i.tag] || TAG_COLOR.default })));
      }
      setLoading(false);
    }).catch(() => { setLoading(false); });
    fetch('/api/health').then(r => r.json()).then(data => {
      if (data.calories && data.calories[today]) setCalories(c => ({ ...c, ...data.calories[today] }));
      if (data.calories_target) setCalories(c => ({ ...c, target: data.calories_target }));
    }).catch(() => {});
    fetch('/api/reminders').then(r => r.json()).then(data => {
      const today2 = new Date().toISOString().slice(0, 10);
      const upcoming = data
        .filter(r => r.next_due)
        .sort((a,b) => a.next_due.localeCompare(b.next_due))
        .slice(0, 6);
      setReminders(upcoming);
    }).catch(() => {});
  }, []);

  const toggle = (id) => {
    setItems(xs => xs.filter(x => x.id !== id));
    fetch(`/api/agenda/${id}/toggle`, { method: 'POST' }).catch(() => {});
  };

  const snoozeReminder = async (rid) => {
    await fetch(`/api/reminders/${rid}/snooze`, { method:'POST' }).catch(()=>{});
    setReminders(rs => rs.filter(r => r.id !== rid));
  };

  const calNet  = calories.consumed - calories.burned;
  const calLeft = calories.target - calNet;
  const today = new Date().toISOString().slice(0, 10);
  const morning   = items.filter(i => parseInt(i.time) < 12);
  const afternoon = items.filter(i => parseInt(i.time) >= 12);

  return (
    <Card num="01" title={`Today — ${new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}`} span={12}
      right={<>
        <span className="mono muted-2" style={{ fontSize: 11 }}>{items.length} left</span>
        <button className="btn" onClick={async () => {
          const label = prompt("Add agenda item:");
          if (!label) return;
          const time = prompt("Time (HH:MM):", "09:00") || "09:00";
          const res = await fetch('/api/agenda', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({label, time, tag:"Personal", color:"mint", date:today}) });
          const d = await res.json();
          setItems(xs => [...xs, { id: d.id, time, label, tag: "Personal", color: "mint", done: false, date: today }]);
        }}><Icon name="plus" size={13}/>Add</button>
      </>}
      bodyClass="flush"
    >
      <div className="agenda-grid">
        <div style={{ padding: "10px 14px", borderRight: "1px solid var(--line-soft)" }}>
          <div className="muted-2 mono" style={{ fontSize: 10.5, letterSpacing: ".08em", padding: "0 4px 6px" }}>MORNING</div>
          {loading && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 4px'}}>loading…</div>}
          {!loading && morning.length === 0 && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 4px'}}>— all clear —</div>}
          {morning.map((it) => {
            const overdue = it.date && it.date < today;
            return (
              <div key={it.id} className="agenda-row">
                <span className="agenda-time" style={{color:overdue?"var(--danger)":undefined}}>{it.time}</span>
                <Checkbox checked={false} onClick={() => toggle(it.id)} />
                <span className="agenda-label">{it.label}</span>
                <span className={"tag " + it.color}>{it.tag}</span>
              </div>
            );
          })}
        </div>
        <div style={{ padding: "10px 14px", borderRight: "1px solid var(--line-soft)" }}>
          <div className="muted-2 mono" style={{ fontSize: 10.5, letterSpacing: ".08em", padding: "0 4px 6px" }}>AFTERNOON · EVENING</div>
          {!loading && afternoon.length === 0 && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 4px'}}>— all clear —</div>}
          {afternoon.map((it) => {
            const overdue = it.date && it.date < today;
            return (
              <div key={it.id} className="agenda-row">
                <span className="agenda-time" style={{color:overdue?"var(--danger)":undefined}}>{it.time}</span>
                <Checkbox checked={false} onClick={() => toggle(it.id)} />
                <span className="agenda-label">{it.label}</span>
                <span className={"tag " + it.color}>{it.tag}</span>
              </div>
            );
          })}
        </div>
        <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
              <span className="muted-2 mono" style={{ fontSize: 10.5, letterSpacing: ".08em" }}>CALORIES</span>
              <span className="mono muted" style={{ fontSize: 10.5 }}>target {calories.target}</span>
            </div>
            <div className="row" style={{ alignItems: "baseline", gap: 6 }}>
              <span className="num" style={{ fontSize: 24, fontWeight: 500 }}>{calLeft}</span>
              <span className="muted mono" style={{ fontSize: 11 }}>kcal left</span>
            </div>
            <div className="progress" style={{ marginTop: 6 }}>
              <div className="bar amber" style={{ width: `${Math.min(100,(calNet/calories.target)*100)}%` }} />
            </div>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
              <span className="muted mono" style={{ fontSize: 10.5 }}>+{calories.consumed} food</span>
              <span className="muted mono" style={{ fontSize: 10.5 }}>−{calories.burned} exercise</span>
            </div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
              {macros.map((m, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "48px 1fr 60px", gap: 6, alignItems: "center", fontSize: 11 }}>
                  <span className="mono muted">{m.l}</span>
                  <div className="progress"><div className="bar" style={{ width: `${Math.min(100,(m.v/m.g)*100)}%`, background: m.c }}/></div>
                  <span className="mono" style={{ textAlign: "right", color: "var(--ink-2)" }}>{m.v}/{m.g}g</span>
                </div>
              ))}
            </div>
          </div>
          {reminders.length > 0 && <>
            <div className="hairline"/>
            <div>
              <div className="muted-2 mono" style={{ fontSize: 10.5, letterSpacing: ".08em", marginBottom: 6 }}>REMINDERS</div>
              {reminders.map(r => {
                const daysOut = Math.round((new Date(r.next_due+'T12:00:00') - new Date()) / 86400000);
                const overdue = daysOut < 0;
                return (
                  <div key={r.id} style={{ display:"grid", gridTemplateColumns:"auto 1fr auto", gap:8, alignItems:"center", padding:"4px 0", borderBottom:"1px solid var(--line-soft)" }}>
                    <span className={"tag "+(overdue?"red":daysOut===0?"amber":daysOut<=7?"info":"")} style={{fontSize:9.5,padding:"1px 5px"}}>
                      {overdue ? `${Math.abs(daysOut)}d late` : daysOut===0 ? "today" : `${daysOut}d`}
                    </span>
                    <span style={{fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</span>
                    <button className="btn ghost" style={{padding:"1px 5px",fontSize:10,color:"var(--ink-4)"}} title="Snooze/done"
                      onClick={()=>snoozeReminder(r.id)}>✓</button>
                  </div>
                );
              })}
            </div>
          </>}
        </div>
      </div>
    </Card>
  );
};

// =========================================================
// FINANCE
// =========================================================
const FIN_CATS = [
  { name: "Housing",       budget: 987,  color: "var(--info)" },
  { name: "Utilities",     budget: 450,  color: "var(--violet)" },
  { name: "Subscriptions", budget: 125,  color: "var(--accent-2)" },
  { name: "Food / Grocer", budget: 400,  color: "var(--accent)" },
  { name: "Fun",           budget: 500,  color: "var(--danger)" },
  { name: "Gas",           budget: 300,  color: "oklch(0.7 0.13 200)" },
  { name: "Shopping",      budget: 0,    color: "oklch(0.72 0.12 160)" },
  { name: "Band",          budget: 0,    color: "oklch(0.68 0.18 320)" },
  { name: "Loans",         budget: 500,  color: "oklch(0.65 0.10 30)" },
  { name: "Other",         budget: 0,    color: "var(--ink-3)" },
];
const FIN_CAT_NAMES = FIN_CATS.map(c => c.name);
const FIN_CAT_COLOR = Object.fromEntries(FIN_CATS.map(c => [c.name, c.color]));
const normFinCat = (raw) => {
  if (!raw) return "Other";
  const key = String(raw).trim();
  const map = {
    Housing: "Housing", Utilities: "Utilities", Subscriptions: "Subscriptions",
    "Food / Grocer": "Food / Grocer", Fun: "Fun", Gas: "Gas",
    Shopping: "Shopping", Band: "Band", Loans: "Loans", Other: "Other",
    // Sheet typos / variants → canonical
    Utilites: "Utilities", Utilties: "Utilities",
    "Water, Sewer, Trash": "Utilities", Electricity: "Utilities", Internet: "Utilities",
    Water: "Utilities", Sewer: "Utilities", Trash: "Utilities",
    Food: "Food / Grocer", Groceries: "Food / Grocer", Grocer: "Food / Grocer",
    Restaurants: "Fun", Dining: "Fun",
    Streaming: "Subscriptions", Subscription: "Subscriptions",
    Transportation: "Gas", Auto: "Gas", Fuel: "Gas",
    Rent: "Housing", Mortgage: "Housing",
    Loan: "Loans",
    // lowercase fallbacks
    housing: "Housing", utilities: "Utilities", subscriptions: "Subscriptions",
    food: "Food / Grocer", dining: "Fun", transport: "Gas",
    shopping: "Shopping", band: "Band", loans: "Loans",
    gaming: "Fun", entertainment: "Fun", health: "Other", personal: "Other",
    IT: "Other", coding: "Other", gift: "Other", tax_refund: "Other", freelance: "Other",
  };
  return map[key] || map[key.toLowerCase()] || "Other";
};

const FinanceCard = () => {
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const defaultCategories = FIN_CATS.filter(c => c.budget > 0).map(c => ({ ...c, actual: 0 }));

  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [txns, setTxns] = useState([]);
  const [savings, setSavings] = useState([]);
  const [subs, setSubs] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddSub, setShowAddSub] = useState(false);
  const [desc, setDesc] = useState(""); const [amt, setAmt] = useState(""); const [type, setType] = useState("expense"); const [cat, setCat] = useState("Housing");
  const [subName, setSubName] = useState(""); const [subAcct, setSubAcct] = useState(""); const [subAmt, setSubAmt] = useState(""); const [subDue, setSubDue] = useState("");
  const catOverrides = React.useRef({});
  const [budget, setBudget] = React.useState(null);

  const loadFinances = (m) => {
    fetch(`/api/finances?month=${m}`).then(r=>r.json()).then(data => {
      setTxns((Array.isArray(data) ? data : []).map(t => ({
        merchant: t.description,
        cat: catOverrides.current[t.id] ?? normFinCat(t.category),
        amount: t.type === 'expense' ? -t.amount : t.amount,
        date: t.date ? new Date(t.date + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '',
        color: t.type === 'income' ? 'var(--accent-2)' : 'var(--ink-4)',
        pending: false, id: t.id, source: t.source
      })));
    }).catch(()=>{});
    fetch(`/api/finances/budget?month=${m}`).then(r=>r.json()).then(data => {
      if (!data.error) setBudget(data);
    }).catch(()=>{});
    fetch('/api/savings').then(r=>r.json()).then(setSavings).catch(()=>{});
  };

  useEffect(() => { loadFinances(month); }, [month]);
  useEffect(() => {
    fetch('/api/finances/subscriptions').then(r=>r.json()).then(setSubs).catch(()=>{});
  }, []);
  const changeMonth = (dir) => {
    const [y, m] = month.split('-').map(Number);
    let nm = m + dir, ny = y;
    if (nm > 12) { nm = 1; ny++; } if (nm < 1) { nm = 12; ny--; }
    setMonth(`${ny}-${String(nm).padStart(2,'0')}`);
  };

  const logExpense = async () => {
    if (!desc || !amt) return;
    await fetch('/api/finances', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ description: desc, amount: parseFloat(amt), type, category: cat, date: new Date().toISOString().slice(0,10) }) });
    setDesc(''); setAmt(''); setShowAdd(false);
    loadFinances(month);
  };

  const addSub = async () => {
    if (!subName || !subAmt) return;
    const res = await fetch('/api/finances/subscriptions', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name: subName, acct: subAcct, amt: parseFloat(subAmt), due: subDue }) }).then(r=>r.json());
    setSubs(s => [...s, { id: res.id, name: subName, acct: subAcct, amt: parseFloat(subAmt), due: subDue }]);
    setSubName(''); setSubAcct(''); setSubAmt(''); setSubDue('');
    setShowAddSub(false);
  };

  const deleteSub = async (sid) => {
    await fetch(`/api/finances/subscriptions/${sid}`, { method:'DELETE' });
    setSubs(s => s.filter(x => x.id !== sid));
  };

  const totalIn  = budget ? budget.income  : txns.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount, 0);
  const totalEx  = budget ? budget.expense : txns.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount), 0);
  const net = totalIn - totalEx;
  const [my, mm] = month.split('-');
  const monthLabel = MONTH_NAMES[parseInt(mm)-1] + ' ' + my;

  const subTotal = subs.reduce((s,c)=>s+c.amt, 0);

  const categories = budget && budget.categories && budget.categories.length > 0
    ? budget.categories.map(c => ({
        ...c,
        name: normFinCat(c.name),
        color: FIN_CAT_COLOR[normFinCat(c.name)] || 'var(--ink-4)',
        budget: c.budgeted,
      }))
    : defaultCategories.map(c => ({
        ...c,
        actual: c.name === 'Subscriptions'
          ? subTotal
          : txns.filter(t=>t.amount<0 && normFinCat(t.cat) === c.name).reduce((s,t)=>s+Math.abs(t.amount),0)
      }));

  const totalBudget = categories.reduce((s,c)=>s+(c.budget||c.budgeted||0), 0);

  const acctMap = {};
  savings.forEach(s => { if (!acctMap[s.account] || s.date > acctMap[s.account].date) acctMap[s.account] = s; });
  const donutData = categories.filter(c=>c.actual>0).map(c=>({value:c.actual, color:c.color, label:c.name}));

  return (
    <Card num="02" title={`Finance — ${monthLabel}`} span={7}
      right={<>
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          <button className="btn" style={{padding:'4px 8px'}} onClick={()=>changeMonth(-1)}>‹</button>
          <button className="btn" style={{padding:'4px 8px'}} onClick={()=>changeMonth(1)}>›</button>
        </div>
        <button className="btn primary" onClick={() => setShowAdd(s=>!s)}><Icon name="plus" size={13}/>Add expense</button>
      </>}
    >
      {showAdd && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'flex-end', padding:'0 0 12px', borderBottom:'1px solid var(--line-soft)', marginBottom:12 }}>
          <input className="input" placeholder="Description" value={desc} onChange={e=>setDesc(e.target.value)} style={{flex:2,minWidth:120}} />
          <input className="input" placeholder="Amount" type="number" value={amt} onChange={e=>setAmt(e.target.value)} style={{width:80}} />
          <select className="input" value={type} onChange={e=>setType(e.target.value)} style={{width:96}}>
            <option value="expense">Expense</option><option value="income">Income</option>
          </select>
          <select className="input" value={cat} onChange={e=>setCat(e.target.value)} style={{width:130}}>
            {FIN_CAT_NAMES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn primary" onClick={logExpense}>LOG</button>
          <button className="btn ghost" onClick={()=>setShowAdd(false)}>✕</button>
        </div>
      )}

      <div className="finance-body">
        <div>
          <div className="finance-stats">
            <div className="stat-block"><span className="l">Income</span><span className="v serif" style={{color:"var(--accent-2)"}}>{fmtMoney(totalIn,{cents:false})}</span></div>
            <div className="stat-block"><span className="l">Spent</span><span className="v serif">{fmtMoney(totalEx,{cents:false})}</span></div>
            <div className="stat-block"><span className="l">Budget</span><span className="v serif muted">{fmtMoney(totalBudget,{cents:false})}</span></div>
            <div className="stat-block"><span className="l">Net</span><span className="v serif" style={{color:net>=0?"var(--accent)":"var(--danger)"}}>{fmtMoney(net,{cents:false})}</span></div>
          </div>
          <div className="section-h" style={{marginTop:12}}><span>Budget vs Actual</span><span className="line"/><span className="muted-2">{totalBudget > 0 ? Math.round((totalEx/totalBudget)*100) + '% of budget' : 'no budget set'}</span></div>
          <div>
            {categories.map((c,i) => {
              const pct = c.budget > 0 ? Math.min(180,(c.actual/c.budget)*100) : 0;
              const over = c.budget > 0 && c.actual > c.budget;
              return (
                <div key={i} className="bar-row">
                  <div className="cat"><span className="swatch" style={{background:c.color}}/><span className="cat-name">{c.name}</span></div>
                  <div className="amt">{fmtMoney(c.actual)}</div>
                  <div className="amt muted-2">/ {fmtMoney(c.budget,{cents:false})}</div>
                  <div className="pct" style={{color:over?"var(--danger)":"var(--ink-3)"}}>{Math.round(pct)}%</div>
                  <div className="mini-bar"><div className="fill" style={{width:Math.min(100,pct)+"%",background:over?"var(--danger)":c.color}}/></div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6,paddingTop:4}}>
          <DonutChart data={donutData} size={110}/>
          {donutData.length>0 && (
            <div style={{display:'flex',flexDirection:'column',gap:3}}>
              {donutData.slice(0,4).map((d,i)=>(
                <div key={i} className="row" style={{gap:5,fontSize:10.5}}>
                  <span style={{width:8,height:8,borderRadius:2,background:d.color,flexShrink:0}}/>
                  <span className="muted mono" style={{fontSize:10}}>{d.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="finance-detail">
        <div>
          <div className="section-h"><span>Transactions</span><span className="line"/><span className="muted-2" style={{fontSize:10.5}}>{txns.filter(t=>t.amount<0).length} expenses</span></div>
          {txns.length === 0 && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 0'}}>No transactions this month.</div>}
          <div style={{maxHeight:480,overflowY:'auto',marginRight:-4,paddingRight:4}}>
          {txns.map((t,i) => {
            const nc = t.amount > 0 ? null : normFinCat(t.cat);
            return (
              <div key={t.id||i} className="txn" style={{gridTemplateColumns:"10px 1fr auto auto auto",gap:6,alignItems:'center'}}>
                <span className="cat-dot" style={{background:t.amount>0?"var(--accent-2)":FIN_CAT_COLOR[nc]||"var(--ink-4)"}}/>
                <div>
                  <div className="merchant">{t.merchant}</div>
                  <div className="meta">{t.date}</div>
                </div>
                {t.amount < 0 && t.source !== 'sheet'
                  ? <select
                      value={nc}
                      onChange={e => {
                        const newCat = e.target.value;
                        catOverrides.current[t.id] = newCat;
                        setTxns(ts => ts.map(x => x.id===t.id ? {...x, cat: newCat} : x));
                        fetch(`/api/finances/${t.id}`, {
                          method:'PATCH', headers:{'Content-Type':'application/json'},
                          body: JSON.stringify({category: newCat})
                        }).catch(()=>{});
                      }}
                      style={{fontSize:10,padding:'2px 4px',height:22,width:116,
                        background:'var(--surface-2)',border:'1px solid var(--line)',
                        borderRadius:'var(--r)',color:FIN_CAT_COLOR[nc]||'var(--ink-3)',
                        cursor:'pointer',fontFamily:'var(--font-mono)'}}
                    >
                      {FIN_CAT_NAMES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  : <span style={{fontSize:10,color:'var(--ink-4)',fontFamily:'var(--font-mono)'}}>
                      {t.amount > 0 ? 'income' : normFinCat(t.cat)}
                    </span>
                }
                <span className="amount" style={{color:t.amount>0?"var(--accent-2)":"var(--ink)"}}>
                  {t.amount>0?"+":""}{fmtMoney(Math.abs(t.amount))}
                </span>
                {t.source !== 'sheet' && (
                  <span style={{cursor:"pointer",color:"var(--ink-4)",padding:"0 2px",lineHeight:1}} title="Remove"
                    onClick={async()=>{
                      await fetch(`/api/finances/${t.id}`,{method:"DELETE"});
                      delete catOverrides.current[t.id];
                      setTxns(ts => ts.filter(x => x.id !== t.id));
                    }}>
                    ×
                  </span>
                )}
              </div>
            );
          })}
          </div>
        </div>
        <div>
          <div className="section-h"><span>Savings</span><span className="line"/></div>
          {Object.values(acctMap).map((s,i) => (
            <div key={i} className="txn" style={{gridTemplateColumns:"1fr auto",padding:"6px 4px"}}>
              <div><div className="merchant">{s.account}</div><div className="meta">updated {s.date}</div></div>
              <span className="amount" style={{color:"var(--accent-2)"}}>{fmtMoney(s.balance,{cents:false})}</span>
            </div>
          ))}
          <div className="section-h" style={{marginTop:12}}>
            <span>Subscriptions</span><span className="line"/>
            <span className="muted-2 num" style={{fontSize:10.5}}>{fmtMoney(subTotal)}/mo</span>
            <button className="btn ghost" style={{padding:'2px 6px',fontSize:10.5}} onClick={()=>setShowAddSub(s=>!s)}>+</button>
          </div>
          {showAddSub && (
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:8,padding:'8px',background:'var(--surface-2)',borderRadius:'var(--r)',border:'1px solid var(--line)'}}>
              <input className="input" placeholder="Name (e.g. Netflix)" value={subName} onChange={e=>setSubName(e.target.value)} style={{fontSize:12}}/>
              <div style={{display:'flex',gap:6}}>
                <input className="input" placeholder="Account" value={subAcct} onChange={e=>setSubAcct(e.target.value)} style={{flex:1,fontSize:12}}/>
                <input className="input" placeholder="$0.00" type="number" value={subAmt} onChange={e=>setSubAmt(e.target.value)} style={{width:72,fontSize:12}}/>
              </div>
              <div style={{display:'flex',gap:6}}>
                <input className="input" placeholder="Due (e.g. 15th)" value={subDue} onChange={e=>setSubDue(e.target.value)} style={{flex:1,fontSize:12}}/>
                <button className="btn primary" onClick={addSub} style={{fontSize:11}}>Add</button>
                <button className="btn ghost" onClick={()=>setShowAddSub(false)} style={{fontSize:11}}>✕</button>
              </div>
            </div>
          )}
          {subs.map((s,i) => (
            <div key={s.id||i} className="txn" style={{gridTemplateColumns:"1fr auto auto",padding:"5px 4px"}}>
              <div><div className="merchant">{s.name}</div><div className="meta">{s.acct} · due {s.due}</div></div>
              <span className="amount muted">{fmtMoney(s.amt)}</span>
              <span style={{cursor:"pointer",color:"var(--ink-4)",padding:"0 4px",fontSize:13,lineHeight:1}} onClick={()=>deleteSub(s.id)}>×</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

// =========================================================
// BAND
// =========================================================
const MiniCal = ({ gigs, trips, practiceMap, busyDates, onDayClick, selectedDay }) => {
  const today = new Date();
  const [cal, setCal] = useState({ y: today.getFullYear(), m: today.getMonth() });

  const firstDay = new Date(cal.y, cal.m, 1).getDay();
  const daysInMonth = new Date(cal.y, cal.m + 1, 0).getDate();
  const prevMonth = () => { let m=cal.m-1, y=cal.y; if(m<0){m=11;y--;} setCal({y,m}); };
  const nextMonth = () => { let m=cal.m+1, y=cal.y; if(m>11){m=0;y++;} setCal({y,m}); };

  const pad = (n) => String(n).padStart(2,'0');
  const showDates = new Set((gigs||[]).map(g=>g.rawDate).filter(Boolean));
  const tripDates = new Set();
  (trips||[]).forEach(t => {
    if (t.start && t.end) {
      let d = new Date(t.start+'T12:00:00');
      const end = new Date(t.end+'T12:00:00');
      while (d <= end) { tripDates.add(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
    }
  });

  const cells = [];
  for (let i=0; i<firstDay; i++) cells.push(null);
  for (let d=1; d<=daysInMonth; d++) cells.push(d);

  const mName = new Date(cal.y,cal.m,1).toLocaleDateString('en-US',{month:'short',year:'numeric'});

  return (
    <div style={{marginBottom:2}}>
      <div className="row" style={{justifyContent:'space-between',marginBottom:6}}>
        <span className="muted-2 mono" style={{fontSize:10.5,letterSpacing:'.06em'}}>{mName.toUpperCase()}</span>
        <div className="row" style={{gap:4}}>
          <button className="btn ghost" style={{padding:'2px 6px',fontSize:11}} onClick={prevMonth}>‹</button>
          <button className="btn ghost" style={{padding:'2px 6px',fontSize:11}} onClick={nextMonth}>›</button>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,fontSize:10.5}}>
        {['S','M','T','W','T','F','S'].map((d,i)=>(
          <div key={i} style={{textAlign:'center',color:'var(--ink-4)',fontFamily:'var(--font-mono)',paddingBottom:3}}>{d}</div>
        ))}
        {cells.map((d,i)=>{
          if (!d) return <div key={i}/>;
          const ds = `${cal.y}-${pad(cal.m+1)}-${pad(d)}`;
          const isShow     = showDates.has(ds);
          const isTrip     = tripDates.has(ds);
          const isToday    = d===today.getDate() && cal.m===today.getMonth() && cal.y===today.getFullYear();
          const isSelected = ds === selectedDay;
          const dow        = new Date(cal.y,cal.m,d).getDay();
          const isPractice = dow===1 || dow===4;
          const isPracticeOn = practiceMap && practiceMap[ds];
          const isPot      = (dow===5||dow===6) && !isShow;
          const isBusy     = busyDates && busyDates.has(ds) && !isShow && !isTrip;
          return (
            <div key={i} onClick={() => onDayClick && onDayClick(ds)} style={{
              textAlign:'center', padding:'4px 2px', borderRadius:4, fontSize:11,
              fontFamily:'var(--font-mono)', cursor: onDayClick ? 'pointer' : 'default',
              background: isSelected ? 'color-mix(in oklch,var(--info) 25%,var(--surface-2))'
                        : isShow    ? 'color-mix(in oklch,var(--violet) 30%,var(--surface-2))'
                        : isTrip    ? 'color-mix(in oklch,var(--accent) 20%,var(--surface-2))'
                        : isToday   ? 'var(--surface-3)' : 'transparent',
              color: isSelected ? 'var(--info)'
                   : isShow     ? 'var(--violet)'
                   : isTrip     ? 'var(--accent)'
                   : isToday    ? 'var(--ink)' : 'var(--ink-2)',
              border: isSelected ? '1px solid var(--info)' : isToday ? '1px solid var(--line)' : '1px solid transparent',
              fontWeight: isShow||isToday||isSelected ? 600 : 400,
              position:'relative',
            }}>
              {d}
              {isPractice && (
                <span style={{position:'absolute',bottom:1,left:'50%',transform:'translateX(-50%)',
                  width:4,height:4,borderRadius:'50%',display:'block',
                  background: isPracticeOn ? 'var(--info)' : 'color-mix(in oklch,var(--info) 45%,var(--surface-2))'
                }}/>
              )}
              {isPot && !isPractice && <span style={{position:'absolute',bottom:1,left:'50%',transform:'translateX(-50%)',width:4,height:4,borderRadius:'50%',background:'var(--accent-2)',display:'block'}}/>}
              {isBusy && <span style={{position:'absolute',bottom:1,right:2,width:4,height:4,borderRadius:'50%',background:'var(--ink-4)',display:'block'}}/>}
            </div>
          );
        })}
      </div>
      <div className="row" style={{gap:10,marginTop:6,flexWrap:'wrap'}}>
        <div className="row" style={{gap:4}}><span style={{width:8,height:8,borderRadius:2,background:'color-mix(in oklch,var(--violet) 30%,var(--surface-2))',border:'1px solid var(--violet)'}}/><span className="muted-2 mono" style={{fontSize:9.5}}>Show</span></div>
        <div className="row" style={{gap:4}}><span style={{width:8,height:8,borderRadius:2,background:'color-mix(in oklch,var(--accent) 20%,var(--surface-2))',border:'1px solid var(--accent)'}}/><span className="muted-2 mono" style={{fontSize:9.5}}>Trip</span></div>
        <div className="row" style={{gap:4}}><span style={{width:4,height:4,borderRadius:'50%',background:'var(--accent-2)'}}/><span className="muted-2 mono" style={{fontSize:9.5}}>Post day</span></div>
        <div className="row" style={{gap:4}}><span style={{width:4,height:4,borderRadius:'50%',background:'var(--info)'}}/><span className="muted-2 mono" style={{fontSize:9.5}}>Practice</span></div>
        <div className="row" style={{gap:4}}><span style={{width:4,height:4,borderRadius:'50%',background:'var(--ink-4)'}}/><span className="muted-2 mono" style={{fontSize:9.5}}>Busy</span></div>
      </div>
    </div>
  );
};

const BandCard = () => {
  const [gigs, setGigs] = useState([]);
  const [trips, setTrips] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [pushing, setPushing] = useState(false);
  const [contentQueue, setContentQueue] = useState([]);
  const [songs, setSongs] = useState({setlists:[],repertoire:[],future_songs:[]});
  const [bandTab, setBandTab] = useState('shows');
  const [newIdea, setNewIdea] = useState("");
  const [showAddContact, setShowAddContact] = useState(false);
  const [showAddShow, setShowAddShow] = useState(false);
  const [newContact, setNewContact] = useState({name:'',venue:'',city:'',type:'',phone:'',email:'',website:'',status:'not contacted',next_step:'',notes:''});
  const [editContactId, setEditContactId] = useState(null);
  const [editContact, setEditContact] = useState({});
  const [newShow, setNewShow] = useState({date:'',venue:'',city:'Fayetteville, AR',notes:''});
  const [practiceMap, setPracticeMap] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [busyDates, setBusyDates] = useState(new Set());

  const practiceDates = (() => {
    const dates = [];
    const d = new Date(); d.setHours(12,0,0,0);
    while (dates.length < 8) {
      const dow = d.getDay();
      if (dow === 1 || dow === 4) dates.push(d.toISOString().slice(0,10));
      d.setDate(d.getDate() + 1);
    }
    return dates;
  })();

  const loadPractice = () => {
    fetch('/api/agenda').then(r=>r.json()).then(items => {
      const map = {};
      items.forEach(it => {
        if ((it.tag||'').toLowerCase()==='band' && (it.label||'').toLowerCase().includes('practice')) {
          map[it.date] = it.id;
        }
      });
      setPracticeMap(map);
    }).catch(()=>{});
  };

  const addPractice = async (date) => {
    const res = await fetch('/api/agenda', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({label:'Band Practice', time:'19:00', tag:'band', date})
    }).then(r=>r.json());
    setPracticeMap(m => ({...m, [date]: res.id}));
  };

  const removePractice = async (date) => {
    const id = practiceMap[date];
    if (!id) return;
    await fetch(`/api/agenda/${id}`, {method:'DELETE'});
    setPracticeMap(m => { const n={...m}; delete n[date]; return n; });
  };


  const loadShows = () => {
    return fetch('/api/shows').then(r=>r.json()).then(data => {
      const today = new Date();
      const upcoming = data
        .map((s, i) => ({...s, originalIdx: i}))
        .filter(s => new Date(s.date+'T12:00:00') >= today)
        .sort((a,b) => new Date(a.date)-new Date(b.date));
      setGigs(upcoming.map(s => ({
        venue: s.venue, city: s.city, rawDate: s.date, originalIdx: s.originalIdx,
        date: new Date(s.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),
        days: Math.round((new Date(s.date+'T12:00:00')-today)/86400000),
        status: 'confirmed', notes: s.notes
      })));
    }).catch(()=>{});
  };

  const removeShow = async (g) => {
    await fetch(`/api/shows/${g.originalIdx}`, {method:'DELETE'}).catch(()=>{});
    loadShows();
    if (window.__toast) window.__toast('Show removed — pushing to site…');
    setPushing(true);
    const res = await fetch('/api/site/push', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({message:`Remove show: ${g.venue} on ${g.rawDate}`})})
      .then(r=>r.json()).catch(()=>({message:'Push failed'}));
    setPushing(false);
    if (window.__toast) window.__toast(res.message);
  };

  useEffect(() => {
    loadShows();
    fetch('/api/band/content').then(r=>r.json()).then(data => {
      setContentQueue((Array.isArray(data)?data:[]).filter(c=>c.status!=='done'));
    }).catch(()=>{});
    fetch('/api/band/contacts').then(r=>r.json()).then(setContacts).catch(()=>{});
    fetch('/api/band/songs').then(r=>r.json()).then(setSongs).catch(()=>{});
    loadPractice();
    fetch('/api/holidays').then(r=>r.json()).then(setTrips).catch(()=>{});
    fetch('/api/calendar/events').then(r=>r.json()).then(events => {
      const bandKeywords = ['show','gig','practice','band','cua','coming up aces'];
      const busy = new Set();
      (events||[]).forEach(ev => {
        const title = (ev.summary||'').toLowerCase();
        if (bandKeywords.some(k => title.includes(k))) return;
        const ds = (ev.start?.date || ev.start?.dateTime || '').slice(0,10);
        if (ds) busy.add(ds);
      });
      setBusyDates(busy);
    }).catch(()=>{});
  }, []);

  const pushSite = async () => {
    setPushing(true);
    const d = await fetch('/api/site/push', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Update shows and content'})}).then(r=>r.json());
    alert(d.message);
    setPushing(false);
  };

  const addIdea = async () => {
    if (!newIdea.trim()) return;
    await fetch('/api/band/content', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:newIdea})});
    setContentQueue(q => [...q, {id:Date.now(),title:newIdea,status:'queued',created:new Date().toISOString().slice(0,10)}]);
    setNewIdea('');
  };

  const addShow = async () => {
    if (!newShow.date || !newShow.venue) return;
    const added = {...newShow};
    await fetch('/api/shows', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({date:added.date,event:'CUA Live',venue:added.venue,city:added.city,notes:added.notes})});
    setNewShow({date:'',venue:'',city:'Fayetteville, AR',notes:''});
    setShowAddShow(false);
    await loadShows();
    if (window.__toast) window.__toast('Show added — pushing to site…');
    setPushing(true);
    const res = await fetch('/api/site/push', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:`Add show: ${added.venue}, ${added.city} on ${added.date}`})})
      .then(r=>r.json()).catch(()=>({message:'Push failed'}));
    setPushing(false);
    if (window.__toast) window.__toast(res.message);
  };

  const addContact = async () => {
    if (!newContact.venue) return;
    const res = await fetch('/api/band/contacts', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(newContact)}).then(r=>r.json());
    setContacts(cs => [...cs, {...newContact, id:res.id}]);
    setNewContact({name:'',venue:'',city:'',type:'',phone:'',email:'',website:'',status:'not contacted',next_step:'',notes:''});
    setShowAddContact(false);
  };

  const saveContact = async () => {
    await fetch(`/api/band/contacts/${editContactId}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(editContact)});
    setContacts(cs => cs.map(x => x.id===editContactId ? {...x, ...editContact} : x));
    setEditContactId(null);
    setEditContact({});
  };

  const markContacted = async (c) => {
    const today = new Date().toISOString().slice(0,10);
    await fetch(`/api/band/contacts/${c.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({last:today,status:'follow up'})});
    setContacts(cs => cs.map(x => x.id===c.id ? {...x, last:today, status:'follow up'} : x));
  };

  const deleteContact = async (id) => {
    await fetch(`/api/band/contacts/${id}`, {method:'DELETE'});
    setContacts(cs => cs.filter(x => x.id !== id));
  };

  const nextGig = gigs[0];
  const overdue = contacts.filter(c=>c.status==='follow up'||c.status==='not contacted').length;

  return (
    <Card num="03" title="Band — Coming Up Aces" span={5}
      right={<>
        <span className="tag violet mobile-hide">{gigs.length} gigs</span>
        <button className="btn" onClick={()=>setShowAddShow(s=>!s)}><Icon name="plus" size={13}/>Show</button>
        <button className="btn primary mobile-hide" onClick={pushSite} disabled={pushing}>{pushing?'pushing…':'Push live'}</button>
      </>}
    >
      {showAddShow && (
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:10,padding:'10px',background:'var(--surface-2)',borderRadius:'var(--r)',border:'1px solid var(--line)'}}>
          <div className="muted-2 mono" style={{fontSize:10.5,letterSpacing:'.06em'}}>ADD SHOW</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <input className="input" type="date" value={newShow.date} onChange={e=>setNewShow(s=>({...s,date:e.target.value}))} style={{width:140,fontSize:12}}/>
            <input className="input" placeholder="Venue name" value={newShow.venue} onChange={e=>setNewShow(s=>({...s,venue:e.target.value}))} style={{flex:1,minWidth:120,fontSize:12}}/>
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <input className="input" placeholder="City, State" value={newShow.city} onChange={e=>setNewShow(s=>({...s,city:e.target.value}))} style={{flex:1,fontSize:12}}/>
            <input className="input" placeholder="Notes" value={newShow.notes} onChange={e=>setNewShow(s=>({...s,notes:e.target.value}))} style={{flex:1,fontSize:12}}/>
          </div>
          <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
            <button className="btn primary" onClick={addShow} style={{fontSize:11}}>Add show</button>
            <button className="btn ghost" onClick={()=>setShowAddShow(false)} style={{fontSize:11}}>✕</button>
          </div>
        </div>
      )}
      <MiniCal gigs={gigs} trips={trips} practiceMap={practiceMap} busyDates={busyDates} selectedDay={selectedDay}
        onDayClick={ds => setSelectedDay(s => s === ds ? null : ds)} />

      {selectedDay && (() => {
        const label = new Date(selectedDay+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
        const hasPractice = !!practiceMap[selectedDay];
        return (
          <div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center',padding:'8px 10px',
            background:'color-mix(in oklch,var(--info) 12%,var(--surface-2))',
            border:'1px solid color-mix(in oklch,var(--info) 30%,var(--line))',
            borderRadius:'var(--r)',marginBottom:8}}>
            <span className="mono" style={{fontSize:11,color:'var(--info)',flex:'1 1 100%'}}>{label}</span>
            <button className="btn primary" style={{fontSize:10.5,padding:'3px 10px'}}
              onClick={()=>{ setNewShow(s=>({...s,date:selectedDay})); setShowAddShow(true); setSelectedDay(null); }}>
              + Show
            </button>
            <button className={'btn '+(hasPractice?'ghost':'primary')} style={{fontSize:10.5,padding:'3px 10px'}}
              onClick={()=>{ hasPractice ? removePractice(selectedDay) : addPractice(selectedDay); setSelectedDay(null); }}>
              {hasPractice ? 'Remove Practice' : '+ Practice'}
            </button>
            <button className="btn ghost" style={{fontSize:10.5,padding:'3px 8px',marginLeft:'auto'}}
              onClick={()=>setSelectedDay(null)}>✕</button>
          </div>
        );
      })()}

      {/* ── Tab bar ── */}
      <div style={{display:'flex',gap:2,marginBottom:10,borderBottom:'1px solid var(--line-soft)',paddingBottom:6}}>
        {['shows','setlists','venues'].map(t => (
          <button key={t} className={'btn'+(bandTab===t?' primary':' ghost')}
            style={{fontSize:10.5,padding:'3px 10px',textTransform:'capitalize'}}
            onClick={()=>setBandTab(t)}>{t}</button>
        ))}
      </div>

      {/* ── Shows tab ── */}
      {bandTab==='shows' && <>
      <div className="section-h"><span>Next Show</span><span className="line"/></div>
      {nextGig ? (
        <div style={{
          background:"linear-gradient(135deg,color-mix(in oklch,var(--violet) 14%,var(--surface-2)),var(--surface-2))",
          border:"1px solid color-mix(in oklch,var(--violet) 30%,var(--line))",
          borderRadius:"var(--r)",padding:10,display:"grid",gridTemplateColumns:"1fr auto auto",gap:8,alignItems:"center",marginBottom:8
        }}>
          <div>
            <div className="serif" style={{fontSize:17,lineHeight:1.15}}>{nextGig.venue}</div>
            <div className="muted mono" style={{fontSize:11}}>{nextGig.city} · {nextGig.date}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="mono" style={{fontSize:26,fontWeight:500}}>{Math.max(0,nextGig.days)}</div>
            <div className="muted-2 mono" style={{fontSize:10,letterSpacing:".08em"}}>DAYS</div>
          </div>
          <button onClick={()=>removeShow(nextGig)} title="Remove show"
            style={{background:'transparent',border:'none',cursor:'pointer',color:'var(--ink-4)',padding:'4px',display:'flex',alignItems:'center',borderRadius:'var(--r-sm)'}}>
            <Icon name="x" size={14}/>
          </button>
        </div>
      ) : (
        <div className="muted mono" style={{fontSize:11,padding:'8px 0'}}>No upcoming shows.</div>
      )}

      {gigs.slice(1,4).map((g,i) => (
        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:6,padding:"5px 0",borderBottom:"1px solid var(--line-soft)",alignItems:"center"}}>
          <div><div style={{fontSize:12.5}}>{g.venue}</div><div className="muted mono" style={{fontSize:10.5}}>{g.city} · {g.date}</div></div>
          <span className="tag mint">{g.status}</span>
          <button onClick={()=>removeShow(g)} title="Remove show"
            style={{background:'transparent',border:'none',cursor:'pointer',color:'var(--ink-4)',padding:'2px',display:'flex',alignItems:'center',borderRadius:'var(--r-sm)'}}>
            <Icon name="x" size={12}/>
          </button>
        </div>
      ))}

      </>}

      {/* ── Setlists tab ── */}
      {bandTab==='setlists' && <>
        {(songs.setlists||[]).map((sl,i) => (
          <div key={i} style={{marginBottom:14}}>
            <div className="section-h">
              <span style={{fontWeight:600}}>{sl.name}</span><span className="line"/>
              <span className="muted-2 mono" style={{fontSize:10}}>{sl.songs.length} songs · ~{Math.round(sl.songs.length * 5)} min</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'2px 12px'}}>
              {sl.songs.map((s,j) => (
                <div key={j} style={{fontSize:11.5,padding:'2px 0',borderBottom:'1px solid var(--line-soft)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {j+1}. {s}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="section-h"><span>All Songs Ever Played</span><span className="line"/>
          <span className="muted-2 mono" style={{fontSize:10}}>{(songs.repertoire||[]).length} songs</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'2px 12px',marginBottom:14}}>
          {(songs.repertoire||[]).map((s,i) => (
            <div key={i} style={{fontSize:11,padding:'2px 0',borderBottom:'1px solid var(--line-soft)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{i+1}. {s}</div>
          ))}
        </div>
        <div className="section-h"><span>Learn / Next Up</span><span className="line"/>
          <span className="muted-2 mono" style={{fontSize:10}}>{(songs.future_songs||[]).length} songs</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'2px 12px'}}>
          {(songs.future_songs||[]).map((s,i) => (
            <div key={i} style={{fontSize:11,padding:'2px 0',borderBottom:'1px solid var(--line-soft)',color:'var(--ink-3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{i+1}. {s}</div>
          ))}
        </div>
      </>}

      {/* ── Venues tab ── */}
      {bandTab==='venues' && <>
      <div className="section-h">
        <span>Venues / Contacts</span><span className="line"/>
        <span className="muted-2 num" style={{fontSize:10.5}}>{overdue} to reach</span>
        <button className="btn ghost" style={{padding:'2px 6px',fontSize:10.5}} onClick={()=>setShowAddContact(s=>!s)}>+</button>
      </div>
      {showAddContact && (
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:8,padding:'8px',background:'var(--surface-2)',borderRadius:'var(--r)',border:'1px solid var(--line)'}}>
          <div className="muted-2 mono" style={{fontSize:10,letterSpacing:'.06em'}}>ADD VENUE</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
            <input className="input" placeholder="Venue name *" value={newContact.venue} onChange={e=>setNewContact(c=>({...c,venue:e.target.value}))} style={{fontSize:11}}/>
            <input className="input" placeholder="Contact name" value={newContact.name} onChange={e=>setNewContact(c=>({...c,name:e.target.value}))} style={{fontSize:11}}/>
            <input className="input" placeholder="City, State" value={newContact.city} onChange={e=>setNewContact(c=>({...c,city:e.target.value}))} style={{fontSize:11}}/>
            <input className="input" placeholder="Type (Brewery, Bar…)" value={newContact.type} onChange={e=>setNewContact(c=>({...c,type:e.target.value}))} style={{fontSize:11}}/>
            <input className="input" placeholder="Phone" value={newContact.phone} onChange={e=>setNewContact(c=>({...c,phone:e.target.value}))} style={{fontSize:11}}/>
            <input className="input" placeholder="Email" value={newContact.email} onChange={e=>setNewContact(c=>({...c,email:e.target.value}))} style={{fontSize:11}}/>
            <input className="input" placeholder="Website" value={newContact.website} onChange={e=>setNewContact(c=>({...c,website:e.target.value}))} style={{fontSize:11}}/>
            <select className="input" value={newContact.status} onChange={e=>setNewContact(c=>({...c,status:e.target.value}))} style={{fontSize:11}}>
              <option value="not contacted">Not contacted</option>
              <option value="emailed">Emailed</option>
              <option value="EPK sent">EPK sent</option>
              <option value="waiting">Waiting</option>
              <option value="follow up">Follow up</option>
              <option value="responded">Responded</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </div>
          <input className="input" placeholder="↳ Next step / action note" value={newContact.next_step} onChange={e=>setNewContact(c=>({...c,next_step:e.target.value}))} style={{fontSize:11}}/>
          <input className="input" placeholder="Notes" value={newContact.notes} onChange={e=>setNewContact(c=>({...c,notes:e.target.value}))} style={{fontSize:11}}/>
          <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
            <button className="btn primary" onClick={addContact} style={{fontSize:11}}>Add venue</button>
            <button className="btn ghost" onClick={()=>setShowAddContact(false)} style={{fontSize:11}}>✕</button>
          </div>
        </div>
      )}
      {contacts.map((c,i) => {
        const statusColor = c.status==='confirmed'||c.status==='responded' ? 'mint'
          : c.status==='follow up' ? 'amber'
          : c.status==='waiting' ? 'info'
          : c.status==='emailed'||c.status==='EPK sent' ? 'violet'
          : '';
        const isEditing = editContactId === c.id;
        return (
          <div key={c.id||i} style={{borderBottom:'1px solid var(--line-soft)'}}>
            <div className="row" style={{gap:8,padding:'5px 0'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.venue||c.name}</div>
                <div className="muted mono" style={{fontSize:10}}>
                  {c.city && c.city}
                  {c.type && ` · ${c.type}`}
                  {c.phone && ` · ${c.phone}`}
                </div>
                {c.next_step && c.next_step !== 'wait' && c.next_step !== 'Wait' && (
                  <div style={{fontSize:10,color:'var(--warn)',marginTop:1}}>↳ {c.next_step}</div>
                )}
              </div>
              <span className={"tag "+statusColor} style={{whiteSpace:'nowrap'}}>{c.status}</span>
              <button className="btn ghost" style={{padding:'2px 6px',fontSize:10}} onClick={()=>markContacted(c)} title="Mark contacted today">✓</button>
              <button className="btn ghost" style={{padding:'2px 5px',fontSize:11,color:'var(--ink-3)'}} title="Edit"
                onClick={()=>{ if(isEditing){setEditContactId(null);}else{setEditContactId(c.id);setEditContact({...c});} }}>✎</button>
              <button className="btn ghost" style={{padding:'2px 4px',fontSize:12,color:'var(--ink-4)'}} onClick={()=>deleteContact(c.id)} title="Remove">×</button>
            </div>
            {isEditing && (
              <div style={{display:'flex',flexDirection:'column',gap:5,padding:'8px',margin:'0 0 6px',background:'var(--surface-2)',borderRadius:'var(--r)',border:'1px solid var(--line)'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
                  <input className="input" placeholder="Venue name" value={editContact.venue||''} onChange={e=>setEditContact(x=>({...x,venue:e.target.value}))} style={{fontSize:11}}/>
                  <input className="input" placeholder="Contact name" value={editContact.name||''} onChange={e=>setEditContact(x=>({...x,name:e.target.value}))} style={{fontSize:11}}/>
                  <input className="input" placeholder="City, State" value={editContact.city||''} onChange={e=>setEditContact(x=>({...x,city:e.target.value}))} style={{fontSize:11}}/>
                  <input className="input" placeholder="Type (Brewery, Bar…)" value={editContact.type||''} onChange={e=>setEditContact(x=>({...x,type:e.target.value}))} style={{fontSize:11}}/>
                  <input className="input" placeholder="Phone" value={editContact.phone||''} onChange={e=>setEditContact(x=>({...x,phone:e.target.value}))} style={{fontSize:11}}/>
                  <input className="input" placeholder="Email" value={editContact.email||''} onChange={e=>setEditContact(x=>({...x,email:e.target.value}))} style={{fontSize:11}}/>
                  <input className="input" placeholder="Website" value={editContact.website||''} onChange={e=>setEditContact(x=>({...x,website:e.target.value}))} style={{fontSize:11}}/>
                  <select className="input" value={editContact.status||'not contacted'} onChange={e=>setEditContact(x=>({...x,status:e.target.value}))} style={{fontSize:11}}>
                    <option value="not contacted">Not contacted</option>
                    <option value="emailed">Emailed</option>
                    <option value="EPK sent">EPK sent</option>
                    <option value="waiting">Waiting</option>
                    <option value="follow up">Follow up</option>
                    <option value="responded">Responded</option>
                    <option value="confirmed">Confirmed</option>
                  </select>
                </div>
                <input className="input" placeholder="↳ Next step / action note" value={editContact.next_step||''} onChange={e=>setEditContact(x=>({...x,next_step:e.target.value}))} style={{fontSize:11}}/>
                <input className="input" placeholder="Notes" value={editContact.notes||''} onChange={e=>setEditContact(x=>({...x,notes:e.target.value}))} style={{fontSize:11}}/>
                <div style={{display:'flex',gap:5,justifyContent:'flex-end'}}>
                  <button className="btn primary" style={{fontSize:11}} onClick={saveContact}>Save</button>
                  <button className="btn ghost" style={{fontSize:11}} onClick={()=>setEditContactId(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      </>}
    </Card>
  );
};

// =========================================================
// HEALTH
// =========================================================
const HealthCard = () => {
  const [weight, setWeight]           = useState(null);
  const [weightLog, setWeightLog]     = useState([]);
  const [height, setHeight]           = useState(null);
  const [streak, setStreak]           = useState(0);
  const [dots, setDots]               = useState([]);
  const [newWeight, setNewWeight]     = useState('');
  const [newHeight, setNewHeight]     = useState('');
  const [editHeight, setEditHeight]   = useState(false);
  const [todayPlan, setTodayPlan]     = useState(null);
  const [program, setProgram]         = useState(null);
  const [workoutOffset, setWorkoutOffset] = useState(0);
  const [rawHealth, setRawHealth]     = useState(null);

  // Local-timezone date string (NOT toISOString() which converts to UTC and
  // would roll over to tomorrow during the evening for users west of UTC).
  const localDateStr = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // The date currently being viewed (today + offset days), in YYYY-MM-DD local
  const viewDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + workoutOffset);
    return localDateStr(d);
  })();
  const [rehabDone, setRehabDone]     = useState({});
  const [habitList, setHabitList]     = useState([]);
  const [todayHabits, setTodayHabits] = useState({});
  const [foodLog, setFoodLog]         = useState([]);
  const [foodName, setFoodName]       = useState('');
  const [foodCal, setFoodCal]         = useState('');
  const [foodProtein, setFoodProtein] = useState('');
  const [foodCarbs, setFoodCarbs]     = useState('');
  const [foodFat, setFoodFat]         = useState('');

  const getTodayPlan = (prog) => {
    if (!prog || !prog.start_date) return null;
    const start = new Date(prog.start_date + 'T12:00:00');
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const diff = Math.floor((now - start) / 86400000);
    if (diff < 0) return { upcoming: true, daysUntil: -diff };
    return prog.schedule[diff % 7] || null;
  };

  const calcStreak = (habitsLog) => {
    const localStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const today = localStr(new Date());
    let count = 0;
    const d = new Date();
    const todayLogged = (habitsLog[today] || {})['lift'] || (habitsLog[today] || {})['cardio'];
    if (!todayLogged) d.setDate(d.getDate() - 1);
    while (true) {
      const ds = localStr(d);
      if (!(habitsLog[ds] || {})['lift'] && !(habitsLog[ds] || {})['cardio']) break;
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  };

  const load = () => {
    fetch('/api/health').then(r => r.json()).then(data => {
      setRawHealth(data);
      const wlog = (data.weight_log || []).slice(-12);
      setWeightLog(wlog.map(e => e.weight));
      const h = data.height_in || null;
      setHeight(h);
      if (h) setNewHeight(String(h));

      const habitsLog = data.habits || {};
      setStreak(calcStreak(habitsLog));

      const prog = data.workout_program || null;
      setProgram(prog);

      // Workout is fetched separately via useEffect on workoutOffset (see below)
      // Weight / habits / food / calories are derived from rawHealth + viewDate in a separate effect

      const today = new Date();
      const grid = [];
      for (let i = 27; i >= 0; i--) {
        const d = new Date(today); d.setDate(today.getDate() - i);
        const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const worked = (habitsLog[ds] || {})['lift'] || (habitsLog[ds] || {})['cardio'];
        grid.push({ ds, worked, isFuture: d > today, dow: d.toLocaleDateString('en-US', { weekday: 'short' }) });
      }
      setDots(grid);
      setHabitList(data.habit_list || []);
    }).catch(() => {});
  };

  // Re-derive per-day state (weight / habits / food / calories) when day or data changes
  useEffect(() => {
    if (!rawHealth) return;
    // Weight: use viewDate's entry if present, else most recent entry on or before viewDate
    const weights = rawHealth.weight || {};
    const dates = Object.keys(weights).sort();
    let pickedW = null;
    for (const d of dates) { if (d <= viewDate) pickedW = weights[d]; }
    setWeight(pickedW);
    // Habits: that day's row, or empty
    setTodayHabits((rawHealth.habits || {})[viewDate] || {});
    // Food log: that day's foods, or empty
    const foods = ((rawHealth.food_log || {})[viewDate]) || [];
    setFoodLog(foods);
  }, [rawHealth, viewDate]);

  useEffect(() => { load(); }, []);

  // Refetch the displayed workout when the user navigates day-by-day
  useEffect(() => {
    const ds = viewDate;
    fetch(`/api/health/workout?date=${ds}`).then(r => r.json()).then(w => {
      if (!w.connected) {
        setTodayPlan({ notConnected: true, error: w.error, weekday: '', date: ds });
      } else if (w.rest_day) {
        setTodayPlan({ restDay: true, weekday: w.weekday, date: w.date });
      } else {
        setTodayPlan({
          label: `Day ${w.day} · ${w.weekday}`,
          focus: w.focus,
          exercises: w.exercises || [],
          intensity: '', note: '',
          date: w.date, weekday: w.weekday,
        });
      }
    }).catch(() => setTodayPlan({ notConnected: true, error: 'fetch failed', date: ds }));
  }, [workoutOffset]);

  const logWeight = async () => {
    const w = parseFloat(newWeight);
    if (!w || w < 80 || w > 500) return;
    await fetch('/api/health/weight', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight: w, date: viewDate }) }).catch(() => {});
    window.__toast?.(`Weight ${w} lb logged for ${viewDate}`, 'success');
    setNewWeight(''); load();
  };

  const saveHeight = async () => {
    const h = parseFloat(newHeight);
    if (!h || h < 48 || h > 96) return;
    await fetch('/api/health/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ height_in: h }) }).catch(() => {});
    window.__toast?.('Height saved', 'success');
    setEditHeight(false); load();
  };

  const logFood = () => {
    if (!foodCal) return;
    const item = {
      name: foodName.trim() || `${foodCal} kcal`,
      calories: parseInt(foodCal)     || 0,
      protein:  parseInt(foodProtein) || 0,
      carbs:    parseInt(foodCarbs)   || 0,
      fat:      parseInt(foodFat)     || 0,
    };
    setFoodLog(prev => [...prev, item]);
    setFoodName(''); setFoodCal(''); setFoodProtein(''); setFoodCarbs(''); setFoodFat('');
    window.__toast?.(`${item.name} logged`, 'success');
    fetch('/api/health/food', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...item, date: viewDate }) }).catch(() => load());
    setTimeout(load, 300);  // refresh raw data so subsequent ops see the new food
  };

  const deleteFood = (idx) => {
    setFoodLog(prev => prev.filter((_, i) => i !== idx));
    fetch('/api/health/food', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: idx, date: viewDate }) }).catch(() => {});
    setTimeout(load, 300);
  };

  const toggleHabit = async (habitId) => {
    const newVal = !todayHabits[habitId];
    setTodayHabits(h => ({ ...h, [habitId]: newVal }));
    await fetch('/api/health/habit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ habit: habitId, date: viewDate }) }).catch(() => {});
    load();
  };

  const totalCal     = foodLog.reduce((s, f) => s + f.calories, 0);
  const totalProtein = foodLog.reduce((s, f) => s + f.protein,  0);
  const totalCarbs   = foodLog.reduce((s, f) => s + f.carbs,    0);
  const totalFat     = foodLog.reduce((s, f) => s + f.fat,      0);
  const macroData    = [
    { value: totalProtein, color: 'var(--accent)', label: 'Protein', grams: totalProtein },
    { value: totalCarbs,   color: 'var(--warn)',   label: 'Carbs',   grams: totalCarbs   },
    { value: totalFat,     color: 'var(--info)',   label: 'Fat',     grams: totalFat     },
  ];
  const calGoal = 3000;
  const calPct  = Math.min(100, (totalCal / calGoal) * 100);

  const bmi    = (weight && height) ? +(weight / (height * height) * 703).toFixed(1) : null;
  const bmiCat = bmi == null ? '' : bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
  const bmiClr = bmi == null ? 'var(--ink-3)' : bmi < 18.5 ? 'var(--info)' : bmi < 25 ? 'var(--accent-2)' : bmi < 30 ? 'var(--warn)' : 'var(--danger)';
  const ftIn   = height ? `${Math.floor(height / 12)}'${height % 12}"` : null;
  const streakLabel = streak === 0 ? 'Start today' : streak < 7 ? 'Keep going' : streak < 14 ? 'Strong week' : streak < 30 ? 'On a roll' : 'Unstoppable';

  return (
    <Card num="03" title="Health & Fitness" span={4}
      right={<span className="tag mint">active</span>}
    >
      {/* ── 3 stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
        <div className="stat-block">
          <span className="l">Weight</span>
          <span className="v">{weight ?? '—'}<span className="muted-2" style={{ fontSize: 11, marginLeft: 3 }}>lb</span></span>
          {weightLog.length > 1 && <Sparkline data={weightLog} color="var(--accent-2)" height={26} />}
          <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
            <input className="input" type="number" placeholder="log lb" value={newWeight}
              onChange={e => setNewWeight(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && logWeight()}
              style={{ fontSize: 11, padding: '3px 6px' }} />
            <button className="btn ghost" style={{ padding: '3px 7px', fontSize: 11 }} onClick={logWeight}>+</button>
          </div>
        </div>
        <div className="stat-block">
          <span className="l">BMI</span>
          <span className="v" style={{ color: bmiClr }}>{bmi ?? '—'}</span>
          {bmi && <span className="mono" style={{ fontSize: 10, color: bmiClr }}>{bmiCat}</span>}
          {height && !editHeight
            ? <span className="muted-2 mono" style={{ fontSize: 10, cursor: 'pointer' }} onClick={() => setEditHeight(true)}>{ftIn} · tap to edit</span>
            : <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                <input className="input" type="number" placeholder="height (in)" value={newHeight}
                  onChange={e => setNewHeight(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveHeight()}
                  style={{ fontSize: 11, padding: '3px 6px' }} />
                <button className="btn ghost" style={{ padding: '3px 7px', fontSize: 11 }} onClick={saveHeight}>set</button>
              </div>}
        </div>
        <div className="stat-block">
          <span className="l">Workout streak</span>
          <span className="v" style={{ color: streak > 0 ? 'var(--accent)' : 'var(--ink-4)' }}>
            {streak}<span className="muted-2" style={{ fontSize: 11, marginLeft: 3 }}>days</span>
          </span>
          <span className="muted-2 mono" style={{ fontSize: 10 }}>{streakLabel}</span>
        </div>
      </div>

      {/* ── Nutrition ── */}
      <div style={{ marginBottom: 14 }}>
        <div className="section-h" style={{ marginBottom: 8 }}>
          <span>Nutrition · Today</span><span className="line" />
        </div>

        {/* Donut + calorie bar */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <DonutChart data={macroData} size={80} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {macroData.map(({ label, grams, color }) => (
                <div key={label} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0 }} />
                  <span className="muted mono" style={{ fontSize: 10 }}>{label} <span style={{ color: 'var(--ink-2)' }}>{grams}g</span></span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, paddingTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
              <span className="muted mono" style={{ fontSize: 10 }}>Daily calories</span>
              <span className="mono" style={{ fontSize: 14, color: totalCal > calGoal ? 'var(--danger)' : 'var(--ink-2)' }}>
                {totalCal}<span className="muted-2" style={{ fontSize: 10 }}> / {calGoal}</span>
              </span>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: 'var(--surface-2)', overflow: 'hidden', border: '1px solid var(--line-soft)' }}>
              <div style={{
                height: '100%', width: calPct + '%', borderRadius: 5,
                background: totalCal > calGoal ? 'var(--danger)' : totalCal > calGoal * 0.85 ? 'var(--warn)' : 'var(--accent-2)',
              }} />
            </div>
            <div className="muted-2 mono" style={{ fontSize: 9.5, marginTop: 4 }}>
              {calPct.toFixed(0)}% · {Math.max(0, calGoal - totalCal)} kcal remaining
            </div>
            {foodLog.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
                {foodLog.map((item, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto auto', gap: 5, fontSize: 10.5, alignItems: 'center', padding: '2px 0', borderBottom: '1px solid var(--line-soft)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    <span className="mono" style={{ fontSize: 10 }}>{item.calories}<span className="muted-2" style={{ fontSize: 9, marginLeft: 1 }}>kcal</span></span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--accent)' }}>P{item.protein}g</span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--warn)' }}>C{item.carbs}g</span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--info)' }}>F{item.fat}g</span>
                    <button className="btn ghost" style={{ padding: '1px 5px', fontSize: 10, lineHeight: 1 }} onClick={() => deleteFood(i)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input className="input" placeholder="Item name" value={foodName}
            onChange={e => setFoodName(e.target.value)}
            style={{ fontSize: 11, padding: '3px 6px' }} />
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="input" type="number" placeholder="kcal" value={foodCal}
              onChange={e => setFoodCal(e.target.value)}
              style={{ fontSize: 11, padding: '3px 6px', flex: '1 1 50px', minWidth: 0 }} />
            <input className="input" type="number" placeholder="P(g)" value={foodProtein}
              onChange={e => setFoodProtein(e.target.value)}
              style={{ fontSize: 11, padding: '3px 6px', flex: '1 1 45px', minWidth: 0 }} />
            <input className="input" type="number" placeholder="C(g)" value={foodCarbs}
              onChange={e => setFoodCarbs(e.target.value)}
              style={{ fontSize: 11, padding: '3px 6px', flex: '1 1 45px', minWidth: 0 }} />
            <input className="input" type="number" placeholder="F(g)" value={foodFat}
              onChange={e => setFoodFat(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && logFood()}
              style={{ fontSize: 11, padding: '3px 6px', flex: '1 1 45px', minWidth: 0 }} />
            <button className="btn ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={logFood}>add</button>
          </div>
        </div>
      </div>

      {/* ── Today's plan ── */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, fontSize:11 }}>
        <button className="btn ghost" style={{padding:'2px 8px', fontSize:11}} onClick={() => setWorkoutOffset(o => o - 1)}>◀</button>
        <button className="btn ghost" style={{padding:'2px 10px', fontSize:11}} onClick={() => setWorkoutOffset(0)}>Today</button>
        <button className="btn ghost" style={{padding:'2px 8px', fontSize:11}} onClick={() => setWorkoutOffset(o => o + 1)}>▶</button>
        <span className="muted-2 mono" style={{fontSize:10.5, marginLeft:'auto'}}>{todayPlan?.date || ''}{workoutOffset !== 0 ? ` (${workoutOffset > 0 ? '+' : ''}${workoutOffset}d)` : ''}</span>
      </div>
      {todayPlan && todayPlan.notConnected && (
        <div style={{ padding: '8px 10px', borderRadius: 'var(--r)', background: 'var(--surface-2)', marginBottom: 12, fontSize: 11 }}>
          <span className="muted-2 mono">Connect Google Sheets to see today's workout. </span>
          <span className="muted-2 mono" style={{ fontSize: 10 }}>{todayPlan.error}</span>
        </div>
      )}
      {todayPlan && todayPlan.restDay && (
        <div style={{ padding: '8px 10px', borderRadius: 'var(--r)', background: 'var(--surface-2)', marginBottom: 12, fontSize: 11 }}>
          <span className="mono" style={{ color: 'var(--accent-2)', fontWeight: 600 }}>Rest day</span>
          <span className="muted-2 mono"> · {todayPlan.weekday} — recovery, light stretching only</span>
        </div>
      )}
      {todayPlan && todayPlan.upcoming && (
        <div style={{ padding: '8px 10px', borderRadius: 'var(--r)', background: 'var(--surface-2)', marginBottom: 12, fontSize: 11 }}>
          <span className="muted-2 mono">Program starts in </span>
          <span style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{todayPlan.daysUntil} days</span>
          <span className="muted-2 mono"> · {program?.start_date}</span>
        </div>
      )}
      {todayPlan && !todayPlan.upcoming && !todayPlan.notConnected && !todayPlan.restDay && (
        <div style={{ marginBottom: 14 }}>
          <div className="section-h" style={{ marginBottom: 6 }}>
            <span style={{ fontWeight: 600 }}>{todayPlan.label} — {todayPlan.focus}</span>
            <span className="line" />
            <span className="tag mint" style={{ fontSize: 9.5 }}>{todayPlan.intensity}</span>
          </div>
          {todayPlan.cardio && todayPlan.cardio !== false && (
            <div style={{ fontSize: 11, color: 'var(--info)', marginBottom: 6 }}>
              Cardio: {todayPlan.cardio}
            </div>
          )}
          {todayPlan.exercises && todayPlan.exercises.length > 0
            ? <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {todayPlan.exercises.map((ex, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, fontSize: 11, alignItems: 'center', padding: '2px 0', borderBottom: '1px solid var(--line-soft)' }}>
                    <span>{ex.name}</span>
                    <span className="mono muted" style={{ fontSize: 10 }}>{ex.sets}×{ex.reps}</span>
                    {ex.rest && <span className="mono muted-2" style={{ fontSize: 9.5, minWidth: 52, textAlign: 'right' }}>{ex.rest}</span>}
                  </div>
                ))}
              </div>
            : <div className="muted-2 mono" style={{ fontSize: 11 }}>Rest / recovery day — elbow rehab still required.</div>
          }
          {todayPlan.note && (
            <div className="muted-2 mono" style={{ fontSize: 10, marginTop: 5 }}>↳ {todayPlan.note}</div>
          )}
        </div>
      )}

      {/* ── Elbow rehab (daily) ── */}
      {program && program.elbow_rehab && (
        <div style={{ marginBottom: 14 }}>
          <div className="section-h" style={{ marginBottom: 6 }}>
            <span>Elbow Rehab · Daily</span><span className="line" />
            <span className="muted-2 mono" style={{ fontSize: 9.5 }}>stay ≤3/10 pain</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {program.elbow_rehab.map((ex, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                <Checkbox checked={!!rehabDone[i]} onClick={() => setRehabDone(p => ({ ...p, [i]: !p[i] }))} />
                <span style={{ textDecoration: rehabDone[i] ? 'line-through' : 'none', color: rehabDone[i] ? 'var(--ink-4)' : 'inherit' }}>
                  {ex.name} — {ex.sets}×{ex.reps}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Today's habits ── */}
      {habitList.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="section-h" style={{ marginBottom: 7 }}>
            <span>Today's Habits</span><span className="line" />
            <span className="muted-2 mono" style={{ fontSize: 10 }}>
              {Object.values(todayHabits).filter(Boolean).length}/{habitList.length} done
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {habitList.map(h => {
              const done = !!todayHabits[h.id];
              return (
                <button key={h.id}
                  className={'btn ' + (done ? 'primary' : 'ghost')}
                  style={{ fontSize: 11, padding: '3px 10px', opacity: done ? 1 : 0.65 }}
                  onClick={() => toggleHabit(h.id)}>
                  {done ? '✓ ' : ''}{h.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 28-day workout grid ── */}
      <div className="section-h" style={{ marginBottom: 5 }}>
        <span>28-day history</span><span className="line" />
        <span className="muted-2 mono" style={{ fontSize: 10 }}>lift or cardio</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {dots.map(({ ds, worked, isFuture, dow }) => (
          <div key={ds} title={`${ds} (${dow})`} style={{
            width: 18, height: 18, borderRadius: 3, flexShrink: 0,
            background: isFuture ? 'transparent' : worked ? 'color-mix(in oklch, var(--accent-2) 30%, var(--surface-2))' : 'var(--surface-2)',
            border: `1px solid ${isFuture ? 'transparent' : worked ? 'color-mix(in oklch, var(--accent-2) 55%, var(--line))' : 'var(--line-soft)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {worked && <Icon name="check" size={9} stroke={2.5} style={{ color: 'var(--accent-2)' }} />}
          </div>
        ))}
      </div>
    </Card>
  );
};

// =========================================================
// WORK
// =========================================================
const GLS_LINKS = [
  { label: "SharePoint Home", url: "https://groundlevel.sharepoint.com",  icon: "briefcase" },
  { label: "Azure Portal",    url: "https://portal.azure.com",            icon: "external"  },
  { label: "Intune / MDM",    url: "https://intune.microsoft.com",        icon: "phone"     },
  { label: "Rightworks",      url: "https://app.rightworks.com",          icon: "briefcase" },
  { label: "GLS Portal",      url: "https://groundlevelservices.com",     icon: "home"      },
];

const CPG_LINKS = [
  { label: "GitHub Repo",     url: "https://github.com/parkergent",        icon: "external", color: "var(--violet)" },
  { label: "Twilio Console",  url: "https://console.twilio.com",           icon: "phone",    color: "var(--info)"   },
  { label: "Twilio Studio",   url: "https://console.twilio.com/us1/studio",icon: "sparkles", color: "var(--info)"   },
  { label: "Mission Control", url: "https://github.com/parkergent/mission-control", icon: "external", color: "var(--violet)" },
];

const GLS_PROJECTS = ["GLS Security","GLS IT","GLS Admin","GLS SharePoint","GLS Projects"];

const WorkCard = () => {
  const [allTasks, setAllTasks] = useState([]);
  const [newTask, setNewTask] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [newTaskProject, setNewTaskProject] = useState("");
  const priMap = {high:"P0", normal:"P1", low:"P2"};

  useEffect(() => {
    fetch('/api/work').then(r=>r.json()).then(data => {
      if (data && data.length) {
        setAllTasks(data.filter(t=>!t.done).map(t=>({
          ...t, label: t.title || t.label || '',
          priority: priMap[t.priority] || t.priority || 'P2'
        })));
      }
    }).catch(()=>{});
  }, []);

  const markDone = async (id) => {
    await fetch(`/api/work/${id}/done`, {method:'POST'}).catch(()=>{});
    setAllTasks(xs => xs.filter(x => x.id !== id));
    if (window.__toast) window.__toast('Task done ✓');
  };
  const deleteTask = async (id) => {
    await fetch(`/api/work/${id}`, {method:'DELETE'}).catch(()=>{});
    setAllTasks(xs => xs.filter(x => x.id !== id));
  };
  const addTask = async (e) => {
    if (e.key !== 'Enter' || !newTask.trim()) return;
    const parts = newTask.match(/P[0-3]/);
    const priority = parts ? parts[0] : "P1";
    const label = newTask.replace(/P[0-3]/,'').trim();
    const body = {title:label, priority:priority==='P0'?'high':priority==='P1'?'normal':'low', project:newTaskProject||''};
    if (newTaskDue) body.due_date = newTaskDue;
    const res = await fetch('/api/work', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})
      .then(r=>r.json()).catch(()=>({id:Date.now()}));
    setAllTasks(xs=>[...xs, {id:res.id||Date.now(), label, priority, project:newTaskProject||'', done:false, due_date:newTaskDue||null}]);
    setNewTask(''); setNewTaskDue('');
    if (window.__toast) window.__toast('Task added');
  };

  const pcolor = (p) => p==="P0"?"red":p==="P1"?"amber":"info";
  const daysUntil = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr); const today = new Date();
    today.setHours(0,0,0,0); d.setHours(0,0,0,0);
    return Math.round((d - today) / 86400000);
  };
  const daysColor = (days) => {
    if (days === null) return 'var(--ink-3)';
    if (days < 0) return 'var(--red,#e07a5f)';
    if (days < 30) return 'var(--amber,#e0a857)';
    return 'var(--ink-2)';
  };
  const fmtDays = (days) => {
    if (days === null) return '';
    if (days < 0) return `${Math.abs(days)}d over`;
    if (days === 0) return 'today';
    return `${days}d`;
  };

  const byProject = allTasks.reduce((acc,t) => { const p = t.project||'General'; (acc[p]=acc[p]||[]).push(t); return acc; }, {});

  return (
    <Card num="05" title="Work" span={6}
      right={<span className="muted mono" style={{fontSize:11}}>{allTasks.length} open</span>}
    >
      {Object.entries(byProject).map(([proj, ptasks]) => (
        <div key={proj} style={{marginBottom:8}}>
          <div className="muted-2 mono" style={{fontSize:10,letterSpacing:'.06em',padding:'4px 0 2px',textTransform:'uppercase'}}>{proj}</div>
          {ptasks.map(t => {
            const days = daysUntil(t.due_date);
            return (
              <div key={t.id} style={{display:'grid',gridTemplateColumns:'22px 1fr auto auto auto',gap:'4px 6px',alignItems:'start',padding:'5px 4px',borderRadius:'var(--r)'}}>
                <Checkbox checked={false} onClick={()=>markDone(t.id)}/>
                <div>
                  <div style={{fontSize:12.5,lineHeight:1.35}}>{t.label||t.title}</div>
                  {t.notes && <div className="muted-2 mono" style={{fontSize:10,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.notes}</div>}
                </div>
                {t.due_date && <span style={{fontSize:10,color:daysColor(days),whiteSpace:'nowrap'}}>{fmtDays(days)}</span>}
                <span className={"tag "+pcolor(t.priority)} style={{fontSize:10}}>{t.priority}</span>
                <button onClick={()=>deleteTask(t.id)} style={{background:'transparent',border:'none',cursor:'pointer',color:'var(--ink-4)',padding:'2px',display:'flex',alignItems:'center',borderRadius:'var(--r-sm)'}} title="Remove">
                  <Icon name="x" size={12}/>
                </button>
              </div>
            );
          })}
        </div>
      ))}
      {allTasks.length===0 && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 0',textAlign:'center'}}>No open tasks</div>}
      <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:6}}>
        <div className="row" style={{gap:6}}>
          <select className="input" value={newTaskProject} onChange={e=>setNewTaskProject(e.target.value)} style={{fontSize:12,width:'auto',minWidth:130}}>
            <option value="">Project…</option>
            {GLS_PROJECTS.map(p=><option key={p} value={p}>{p}</option>)}
          </select>
          <input type="date" className="input" value={newTaskDue} onChange={e=>setNewTaskDue(e.target.value)} style={{fontSize:12,width:130}}/>
        </div>
        <div className="row" style={{gap:6}}>
          <input className="input" placeholder="Add task… P0/P1/P2 prefix for priority" value={newTask}
            onChange={e=>setNewTask(e.target.value)} onKeyDown={addTask} style={{fontSize:12}}/>
          <button className="btn primary" onClick={()=>addTask({key:'Enter'})}><Icon name="plus" size={13}/></button>
        </div>
      </div>
    </Card>
  );
};

// =========================================================
// STUDYING — CISM
// =========================================================
const StudyCard = () => {
  const [study, setStudy] = useState(null);
  const [newScore, setNewScore] = useState("");
  const [sessionTopic, setSessionTopic] = useState("");
  const [sessionMins, setSessionMins] = useState("");

  useEffect(() => {
    fetch('/api/study').then(r=>r.json()).then(data => {
      if (data && data.domains) setStudy(data);
    }).catch(()=>{});
  }, []);

  if (!study) return (
    <Card num="06" title="Studying" span={4} right={<span className="tag info">loading…</span>}>
      <div className="muted-2 mono" style={{fontSize:11,padding:'20px 0',textAlign:'center'}}>Loading study data…</div>
    </Card>
  );

  const daysOut = study.exam_date ? Math.round((new Date(study.exam_date)-new Date())/86400000) : 0;
  const avgPct = study.domains.reduce((s,d)=>s+(d.pct*(d.weight/100)),0);
  const lastScore = study.practice_scores.slice(-1)[0] || 0;

  const logScore = async () => {
    const s = parseInt(newScore);
    if (!s || s<0||s>100) return;
    await fetch('/api/study/score',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score:s})}).catch(()=>{});
    setStudy(st=>({...st, practice_scores:[...st.practice_scores, s]}));
    setNewScore('');
    if (window.__toast) window.__toast(`Practice score ${s}% logged`);
  };

  const logSession = async (mins) => {
    const m = mins || parseInt(sessionMins);
    if (!m || m < 1) return;
    await fetch('/api/study/session',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({minutes:m, topic:sessionTopic, date:new Date().toISOString().slice(0,10)})}).catch(()=>{});
    setStudy(st => ({...st, total_hours: Math.round((((st.total_hours||0)*60) + m) / 60 * 10) / 10}));
    setSessionTopic(''); setSessionMins('');
    if (window.__toast) window.__toast(`${m} min study session logged`);
  };

  return (
    <Card num="06" title={`Studying — ${study.cert}`} span={4}
      right={<><span className="tag info">cert track</span><span className="muted mono" style={{fontSize:11}}>{study.exam_date ? `${daysOut}d out` : "not scheduled"}</span></>}
    >
      <div style={{
        background:"linear-gradient(135deg,color-mix(in oklch,var(--info) 14%,var(--surface-2)),var(--surface-2))",
        border:"1px solid color-mix(in oklch,var(--info) 30%,var(--line))",
        borderRadius:"var(--r)",padding:12,marginBottom:12
      }}>
        <div className="row" style={{justifyContent:"space-between"}}>
          <div>
            <div className="muted-2 mono" style={{fontSize:10.5,letterSpacing:".08em"}}>ISACA · {study.cert}</div>
            <div className="serif" style={{fontSize:16,lineHeight:1.15}}>Certified Info Security Manager</div>
            <div className="muted mono" style={{fontSize:11,marginTop:2}}>{study.exam_date ? `exam · ${study.exam_date}` : study.exam_note || "exam date TBD"}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="mono" style={{fontSize:24,fontWeight:500}}>{Math.round(avgPct)}%</div>
            <div className="muted-2 mono" style={{fontSize:10,letterSpacing:".08em"}}>READY</div>
          </div>
        </div>
        <div className="progress" style={{marginTop:8}}><div className="bar info" style={{width:avgPct+"%"}}/></div>
      </div>

      <div className="section-h"><span>Domains</span><span className="line"/></div>
      {study.domains.map((d) => (
        <div key={d.id} style={{padding:"5px 0",borderBottom:"1px solid var(--line-soft)"}}>
          <div className="row" style={{justifyContent:"space-between"}}>
            <span style={{fontSize:12}}>{d.name}</span>
            <span className="mono" style={{fontSize:11,color:"var(--ink-2)"}}>{d.pct}%<span className="muted-2"> ·{d.weight}w</span></span>
          </div>
          <div className="progress" style={{marginTop:3,height:4}}>
            <div className="bar info" style={{width:d.pct+"%",background:d.pct>60?"var(--accent-2)":d.pct>35?"var(--accent)":"var(--danger)"}}/>
          </div>
        </div>
      ))}

      <div className="section-h"><span>Practice scores</span><span className="line"/><span className="mono muted" style={{fontSize:10.5}}>last {study.practice_scores.length}</span></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 60px auto",gap:6,alignItems:"center"}}>
        <Sparkline data={study.practice_scores} color="var(--info)" height={30}/>
        <span className="mono" style={{fontSize:14,color:"var(--accent-2)",textAlign:'right'}}>{lastScore}%</span>
        <div style={{display:'flex',gap:4,alignItems:'center'}}>
          <input className="input" placeholder="score" type="number" value={newScore} onChange={e=>setNewScore(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter')logScore();}} style={{width:56,fontSize:11,padding:'4px 6px'}}/>
          <button className="btn" style={{padding:'4px 8px',fontSize:11}} onClick={logScore}>+</button>
        </div>
      </div>
      <div className="muted-2 mono" style={{fontSize:10.5,marginTop:4}}>target: 80%+ on 3 consecutive</div>

      <div className="section-h" style={{marginTop:12}}>
        <span>Log session</span><span className="line"/>
        <span className="mono muted-2" style={{fontSize:10.5}}>{study.total_hours || 0}h total</span>
      </div>
      <div style={{display:'flex',gap:5,alignItems:'center',flexWrap:'wrap'}}>
        <input className="input" placeholder="Topic…" value={sessionTopic} onChange={e=>setSessionTopic(e.target.value)}
          style={{flex:1,minWidth:90,fontSize:12}} onKeyDown={e=>{if(e.key==='Enter')logSession();}}/>
        {[30,60,90].map(m=>(
          <button key={m} className="btn ghost" style={{padding:'4px 8px',fontSize:11}} onClick={()=>logSession(m)}>{m}m</button>
        ))}
        <div style={{display:'flex',gap:4}}>
          <input className="input" type="number" placeholder="min" value={sessionMins} onChange={e=>setSessionMins(e.target.value)}
            style={{width:52,fontSize:11,padding:'4px 6px'}}/>
          <button className="btn" style={{padding:'4px 8px',fontSize:11}} onClick={()=>logSession()}>+</button>
        </div>
      </div>
    </Card>
  );
};

// =========================================================
// READING
// =========================================================
const ReadingCard = () => {
  const [reading, setReading] = useState(null);

  useEffect(() => {
    fetch('/api/reading').then(r=>r.json()).then(data => {
      if (data && !Array.isArray(data)) setReading(data);
    }).catch(()=>{});
  }, []);

  const updatePage = async () => {
    if (!reading) return;
    const p = prompt("Current page:", reading.current.page);
    if (!p) return;
    const page = parseInt(p);
    await fetch('/api/reading/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page})}).catch(()=>{});
    setReading(r=>({...r, current:{...r.current,page}}));
    if (window.__toast) window.__toast(`Page updated to ${page}`);
  };

  const finishBook = async () => {
    if (!reading || !reading.current) return;
    if (!confirm(`Mark "${reading.current.title}" as finished?`)) return;
    await fetch('/api/reading',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'complete'})}).catch(()=>{});
    const finished = reading.current;
    const nextCurrent = (reading.queue||[])[0] || null;
    const newQueue = (reading.queue||[]).slice(1);
    setReading(r => ({
      ...r,
      completed_2026: (r.completed_2026||0) + 1,
      current: nextCurrent ? {...nextCurrent, page:0, total_pages: nextCurrent.total_pages||300, started: new Date().toISOString().slice(0,10)} : null,
      queue: newQueue,
    }));
    if (window.__toast) window.__toast(`"${finished.title}" marked finished!`);
  };

  const addToQueue = async () => {
    const title = prompt("Book title:");
    if (!title) return;
    const author = prompt("Author:") || "";
    await fetch('/api/reading',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'add_queue',title,author})}).catch(()=>{});
    setReading(r=>({...r, queue:[...(r.queue||[]),{title,author}]}));
    if (window.__toast) window.__toast(`"${title}" added to queue`);
  };

  if (!reading) return (
    <Card num="07" title="Reading" span={4} right={<span className="muted mono" style={{fontSize:11}}>loading…</span>}>
      <div className="muted-2 mono" style={{fontSize:11,padding:'20px 0',textAlign:'center'}}>Loading…</div>
    </Card>
  );

  const pct = reading.current ? Math.round((reading.current.page/reading.current.total_pages)*100) : 0;

  return (
    <Card num="07" title="Reading" span={4}
      right={<>
        <span className="muted mono" style={{fontSize:11}}>{reading.completed_2026} / {reading.goal_2026} books · 2026</span>
        <button className="btn ghost" style={{padding:'3px 8px',fontSize:11}} onClick={addToQueue}><Icon name="plus" size={12}/>Queue</button>
      </>}
    >
      {reading.current ? (
        <div style={{display:"grid",gridTemplateColumns:"72px 1fr",gap:12}}>
          <div className="media-cover" style={{background:"linear-gradient(160deg,oklch(0.5 0.12 60),oklch(0.3 0.05 60))",color:"#fff"}}>
            {reading.current.title}
          </div>
          <div>
            <div className="muted-2 mono" style={{fontSize:10.5,letterSpacing:".08em"}}>NOW READING</div>
            <div className="serif" style={{fontSize:16,lineHeight:1.15,marginTop:2}}>{reading.current.title}</div>
            <div className="muted" style={{fontSize:12}}>{reading.current.author} · p. {reading.current.page} / {reading.current.total_pages}</div>
            <div className="progress" style={{marginTop:8}}><div className="bar amber" style={{width:pct+"%"}}/></div>
            <div className="row" style={{marginTop:6,justifyContent:"space-between"}}>
              <span className="muted mono" style={{fontSize:10.5}}>{pct}%</span>
              <div className="row" style={{gap:4}}>
                {pct >= 85 && <button className="btn primary" style={{padding:"3px 8px",fontSize:11}} onClick={finishBook}>✓ Finish</button>}
                <button className="btn" style={{padding:"3px 8px",fontSize:11}} onClick={updatePage}>pg {reading.current.page}</button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="muted-2 mono" style={{fontSize:11,padding:'16px 0',textAlign:'center'}}>No current book — start one from the queue.</div>
      )}
      <div className="section-h"><span>Up next</span><span className="line"/>
        <span className="muted-2 mono" style={{fontSize:10.5}}>{(reading.queue||[]).length} queued</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
        {(reading.queue||[]).slice(0,3).map((b,i) => (
          <div key={i}>
            <div className="media-cover" style={{background:[
              "linear-gradient(160deg,oklch(0.4 0.10 30),oklch(0.25 0.05 30))",
              "linear-gradient(160deg,oklch(0.45 0.10 160),oklch(0.28 0.05 160))",
              "linear-gradient(160deg,oklch(0.42 0.10 290),oklch(0.26 0.05 290))"
            ][i%3],color:"#fff"}}>{b.title}</div>
            <div className="muted mono" style={{fontSize:10.5,marginTop:4}}>{b.author}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

// =========================================================
// HOLIDAYS / TRAVEL
// =========================================================
const HolidayCard = () => {
  const [trips, setTrips] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newTrip, setNewTrip] = useState({name:'',location:'',start:'',end:'',budget:'',notes:''});

  useEffect(() => {
    fetch('/api/holidays').then(r=>r.json()).then(data => {
      if (data && data.length) setTrips(data);
    }).catch(()=>{});
  }, []);

  const toggleCheck = async (tripId, idx) => {
    await fetch(`/api/holidays/${tripId}/checklist/${idx}`,{method:'POST'}).catch(()=>{});
    setTrips(ts => ts.map(t => t.id===tripId ? {
      ...t, checklist: t.checklist.map((c,i)=>i===idx?{...c,done:!c.done}:c)
    } : t));
  };

  const addTrip = async () => {
    if (!newTrip.name || !newTrip.start) return;
    const res = await fetch('/api/holidays', {method:'POST',headers:{'Content-Type':'application/json'},
      body: JSON.stringify({...newTrip, budget: parseFloat(newTrip.budget)||0, checklist:[]})}).then(r=>r.json());
    setTrips(ts => [...ts, {...newTrip, id:res.id, budget:parseFloat(newTrip.budget)||0, checklist:[]}]
      .sort((a,b)=>new Date(a.start)-new Date(b.start)));
    setNewTrip({name:'',location:'',start:'',end:'',budget:'',notes:''});
    setShowAdd(false);
  };

  const next = trips.find(t => new Date(t.start+'T12:00:00') > new Date()) || trips[0];
  if (!next && !showAdd) return (
    <Card num="08" title="Holidays / Travel" span={4} right={<button className="btn" onClick={()=>setShowAdd(true)}><Icon name="plus" size={13}/>Trip</button>}>
      <div className="muted-2 mono" style={{fontSize:11,padding:'20px 0',textAlign:'center'}}>No trips planned yet.</div>
    </Card>
  );

  const daysOut = next ? Math.round((new Date(next.start+'T12:00:00')-new Date())/86400000) : 0;
  const done = (next?.checklist||[]).filter(c=>c.done).length;

  return (
    <Card num="08" title="Holidays / Travel" span={4}
      right={<>
        <span className="muted mono" style={{fontSize:11}}>{trips.length} trip{trips.length!==1?"s":""}</span>
        <button className="btn" onClick={()=>setShowAdd(s=>!s)}><Icon name="plus" size={13}/>Trip</button>
      </>}
    >
      {showAdd && (
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12,padding:'10px',background:'var(--surface-2)',borderRadius:'var(--r)',border:'1px solid var(--line)'}}>
          <div className="muted-2 mono" style={{fontSize:10.5,letterSpacing:'.06em'}}>ADD TRIP</div>
          <input className="input" placeholder="Destination (e.g. Nashville, TN)" value={newTrip.name} onChange={e=>setNewTrip(t=>({...t,name:e.target.value}))} style={{fontSize:12}}/>
          <div style={{display:'flex',gap:6}}>
            <input className="input" type="date" value={newTrip.start} onChange={e=>setNewTrip(t=>({...t,start:e.target.value}))} style={{flex:1,fontSize:12}}/>
            <input className="input" type="date" value={newTrip.end} onChange={e=>setNewTrip(t=>({...t,end:e.target.value}))} style={{flex:1,fontSize:12}}/>
            <input className="input" placeholder="Budget $" type="number" value={newTrip.budget} onChange={e=>setNewTrip(t=>({...t,budget:e.target.value}))} style={{width:80,fontSize:12}}/>
          </div>
          <input className="input" placeholder="Notes" value={newTrip.notes} onChange={e=>setNewTrip(t=>({...t,notes:e.target.value}))} style={{fontSize:12}}/>
          <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
            <button className="btn primary" onClick={addTrip} style={{fontSize:11}}>Add trip</button>
            <button className="btn ghost" onClick={()=>setShowAdd(false)} style={{fontSize:11}}>✕</button>
          </div>
        </div>
      )}
      {next && <div style={{position:"relative",padding:12,borderRadius:6,overflow:"hidden",
        background:"linear-gradient(135deg,oklch(0.32 0.06 220),oklch(0.22 0.04 220))",color:"#fff",marginBottom:12}}>
        <div style={{position:"absolute",inset:0,opacity:0.12,background:"repeating-linear-gradient(45deg,#fff 0 1px,transparent 1px 14px)"}}/>
        <div style={{position:"relative"}}>
          <div className="mono" style={{fontSize:10.5,opacity:0.7,letterSpacing:".08em"}}>NEXT TRIP</div>
          <div className="serif" style={{fontSize:20,lineHeight:1.1,marginTop:4}}>{next.name}</div>
          <div className="mono" style={{fontSize:11,opacity:0.8,marginTop:2}}>{next.start} – {next.end} · {next.location}</div>
          <div className="row" style={{marginTop:10,gap:14}}>
            <div><div className="serif" style={{fontSize:26,lineHeight:1}}>{daysOut}</div><div className="mono" style={{fontSize:9.5,opacity:0.7,letterSpacing:".08em"}}>DAYS OUT</div></div>
            {next.budget>0 && <>
              <div style={{width:1,alignSelf:"stretch",background:"rgba(255,255,255,0.25)"}}/>
              <div><div className="mono" style={{fontSize:13}}>${next.budget.toLocaleString()}</div><div className="mono" style={{fontSize:9.5,opacity:0.7,letterSpacing:".08em"}}>BUDGET</div></div>
            </>}
            <div style={{width:1,alignSelf:"stretch",background:"rgba(255,255,255,0.25)"}}/>
            <div><div className="mono" style={{fontSize:13}}>{done}/{(next.checklist||[]).length}</div><div className="mono" style={{fontSize:9.5,opacity:0.7,letterSpacing:".08em"}}>CHECKLIST</div></div>
          </div>
        </div>
      </div>}
      {next && <><div className="section-h"><span>To do</span><span className="line"/></div>
      {(next.checklist||[]).map((c,i)=>(
        <div key={i} className="row" style={{padding:"5px 0",cursor:"pointer"}} onClick={()=>toggleCheck(next.id,i)}>
          <Checkbox checked={c.done}/>
          <span style={{flex:1,color:c.done?"var(--ink-3)":"var(--ink)",textDecoration:c.done?"line-through":"none",fontSize:12.5}}>{c.text||c.label}</span>
        </div>
      ))}</>}
    </Card>
  );
};

// =========================================================
// JOURNAL
// =========================================================
const JournalCard = () => {
  const [text, setText] = useState("");
  const [entries, setEntries] = useState([]);
  const [saving, setSaving] = useState(false);
  const [prompt_text, setPromptText] = useState("What's one thing that worked today — and why?");
  const prompts = [
    "What's one thing that worked today — and why?",
    "What's the next step on your biggest goal?",
    "Who showed up for you today?",
    "What did you learn that surprised you?",
    "What would you do differently tomorrow?",
    "What are you grateful for right now?",
    "What's the one thing only YOU can do this week?",
  ];

  useEffect(() => {
    fetch('/api/journal').then(r=>r.json()).then(data => {
      if (data && data.length) setEntries(data.slice(0,5));
    }).catch(()=>{});
    setPromptText(prompts[new Date().getDay() % prompts.length]);
  }, []);

  const save = async () => {
    if (!text.trim()) return;
    setSaving(true);
    const today = new Date().toISOString().slice(0,10);
    await fetch('/api/journal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:text,date:today})}).catch(()=>{});
    setEntries(es=>[{id:Date.now(),date:today,body:text},...es.filter(e=>e.date!==today).slice(0,4)]);
    setText('');
    setSaving(false);
  };

  const streak = entries.length;

  return (
    <Card num="09" title="Journal" span={4}
      right={<span className="muted mono" style={{fontSize:11}}>{streak}-day streak</span>}
    >
      <div className="muted-2 mono" style={{fontSize:10.5,letterSpacing:".08em",marginBottom:4}}>TONIGHT'S PROMPT</div>
      <div className="serif" style={{fontSize:15,color:"var(--ink-2)",marginBottom:8,fontStyle:"italic"}}>{prompt_text}</div>
      <textarea className="journal-text" placeholder="start writing…" value={text}
        onChange={(e)=>setText(e.target.value)}
        onKeyDown={(e)=>{if(e.ctrlKey&&e.key==='Enter')save();}}
      />
      <div className="hairline" style={{margin:"8px 0"}}/>
      <div className="row" style={{justifyContent:"space-between"}}>
        <span className="muted mono" style={{fontSize:10.5}}>{text.split(/\s+/).filter(Boolean).length} words · ctrl+↵ to save</span>
        <button className="btn primary" onClick={save} disabled={saving}><Icon name="feather" size={12}/>{saving?"saving…":"Save entry"}</button>
      </div>
      <div className="section-h"><span>Recent</span><span className="line"/></div>
      {entries.length===0 && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 0'}}>No entries yet. Start writing!</div>}
      {entries.map((e,i)=>(
        <div key={e.id||i} style={{padding:"6px 0",borderBottom:"1px solid var(--line-soft)"}}>
          <div className="muted mono" style={{fontSize:10.5}}>{e.date}</div>
          <div className="serif" style={{fontSize:12.5,color:"var(--ink-2)"}}>{(e.body||e.text||'').slice(0,120)}{(e.body||e.text||'').length>120?"…":""}</div>
        </div>
      ))}
    </Card>
  );
};

// =========================================================
// PRACTICE — Piano & Guitar
// =========================================================
const PRACTICE_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PRACTICE_ROTATION = {
  piano: [
    {
      day: "Tue",
      title: "Chord fluency",
      minutes: 45,
      blocks: ["10m warmup", "20m chords and inversions", "15m simple song comping"]
    },
    {
      day: "Thu",
      title: "Song and reading",
      minutes: 45,
      blocks: ["10m scales", "25m lesson piece", "10m transitions"]
    },
    {
      day: "Sat",
      title: "Writing keys",
      minutes: 30,
      blocks: ["10m progression", "15m melody ideas", "5m record rough take"]
    },
    {
      day: "Sun",
      title: "Light review",
      minutes: 15,
      blocks: ["5m chords", "5m scales", "5m one weak spot"]
    }
  ],
  guitar: [
    {
      day: "Mon",
      title: "Lead guitar",
      minutes: 55,
      blocks: ["10m warmup", "20m pentatonic and bends", "20m solo section", "5m free jam"]
    },
    {
      day: "Wed",
      title: "Rhythm and tone",
      minutes: 45,
      blocks: ["15m timing", "20m setlist rhythm", "10m tone check"]
    },
    {
      day: "Fri",
      title: "Band prep",
      minutes: 60,
      blocks: ["45m setlist run", "10m trouble spots", "5m notes"]
    },
    {
      day: "Sat",
      title: "Creative guitar",
      minutes: 45,
      blocks: ["15m riffs", "20m improv", "10m record idea"]
    },
    {
      day: "Sun",
      title: "Light maintenance",
      minutes: 15,
      blocks: ["5m bends", "5m transitions", "5m clean review"]
    }
  ]
};

const PracticeCard = () => {
  const [inst, setInst] = useState("piano");
  const [data, setData] = useState({ piano: null, guitar: null });
  const [editFocus, setEditFocus] = useState(false);
  const [focusVal, setFocusVal] = useState("");
  const [editNotes, setEditNotes] = useState(false);
  const [notesVal, setNotesVal] = useState("");
  const [newScale, setNewScale] = useState("");
  const [newReminder, setNewReminder] = useState("");
  const [sessionMin, setSessionMin] = useState("");
  const [sessionNote, setSessionNote] = useState("");

  const load = () =>
    fetch("/api/practice").then(r => r.json()).then(d => setData(d)).catch(() => {});

  useEffect(() => { load(); }, []);

  const cur = data[inst];
  if (!cur) return null;

  const scales    = cur.scales    || [];
  const reminders = cur.reminders || [];
  const sessions  = cur.sessions  || [];
  const schedule  = (cur.schedule && cur.schedule.length ? cur.schedule : PRACTICE_ROTATION[inst]) || [];

  const totalMin  = sessions.reduce((s, x) => s + (x.minutes || 0), 0);
  const todaySess = sessions.filter(s => s.date === new Date().toISOString().slice(0, 10));
  const todayMin  = todaySess.reduce((s, x) => s + (x.minutes || 0), 0);
  const todayIdx = new Date().getDay();
  const todayDay = PRACTICE_DAYS[todayIdx];
  const dayIndex = Object.fromEntries(PRACTICE_DAYS.map((d, i) => [d, i]));
  const upcomingPlans = schedule
    .map(p => ({ ...p, offset: ((dayIndex[p.day] ?? 0) - todayIdx + 7) % 7 }))
    .sort((a, b) => a.offset - b.offset);
  const todayPlan = upcomingPlans.find(p => p.offset === 0);
  const nextPlan = upcomingPlans.find(p => p.offset > 0) || upcomingPlans[0];
  const plannedWeekMin = schedule.reduce((s, p) => s + (p.minutes || 0), 0);

  const saveFocus = async () => {
    await fetch(`/api/practice/${inst}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ this_week_focus: focusVal })
    }).catch(() => {});
    setData(d => ({ ...d, [inst]: { ...d[inst], this_week_focus: focusVal } }));
    setEditFocus(false);
  };

  const saveNotes = async () => {
    await fetch(`/api/practice/${inst}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ last_lesson_notes: notesVal })
    }).catch(() => {});
    setData(d => ({ ...d, [inst]: { ...d[inst], last_lesson_notes: notesVal } }));
    setEditNotes(false);
  };

  const toggleScale = async (id) => {
    await fetch(`/api/practice/${inst}/scale/${id}/toggle`, { method: "POST" }).catch(() => {});
    setData(d => ({ ...d, [inst]: { ...d[inst], scales: d[inst].scales.map(s => s.id === id ? { ...s, done: !s.done } : s) } }));
  };

  const deleteScale = async (id) => {
    await fetch(`/api/practice/${inst}/scale/${id}`, { method: "DELETE" }).catch(() => {});
    setData(d => ({ ...d, [inst]: { ...d[inst], scales: d[inst].scales.filter(s => s.id !== id) } }));
  };

  const addScale = async () => {
    if (!newScale.trim()) return;
    const res = await fetch(`/api/practice/${inst}/scale`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newScale.trim() })
    }).then(r => r.json()).catch(() => []);
    setData(d => ({ ...d, [inst]: { ...d[inst], scales: res } }));
    setNewScale("");
  };

  const toggleReminder = async (id) => {
    await fetch(`/api/practice/${inst}/reminder/${id}/toggle`, { method: "POST" }).catch(() => {});
    setData(d => ({ ...d, [inst]: { ...d[inst], reminders: d[inst].reminders.map(r => r.id === id ? { ...r, done: !r.done } : r) } }));
  };

  const deleteReminder = async (id) => {
    await fetch(`/api/practice/${inst}/reminder/${id}`, { method: "DELETE" }).catch(() => {});
    setData(d => ({ ...d, [inst]: { ...d[inst], reminders: d[inst].reminders.filter(r => r.id !== id) } }));
  };

  const addReminder = async () => {
    if (!newReminder.trim()) return;
    const res = await fetch(`/api/practice/${inst}/reminder`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: newReminder.trim() })
    }).then(r => r.json()).catch(() => []);
    setData(d => ({ ...d, [inst]: { ...d[inst], reminders: res } }));
    setNewReminder("");
  };

  const logSession = async (min, noteOverride = null) => {
    const m = parseInt(min || sessionMin);
    if (!m || m <= 0) return;
    const note = noteOverride === null ? sessionNote.trim() : noteOverride;
    await fetch(`/api/practice/${inst}/session`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: m, note })
    }).catch(() => {});
    setData(d => ({
      ...d, [inst]: {
        ...d[inst],
        sessions: [{ date: new Date().toISOString().slice(0, 10), minutes: m, note }, ...d[inst].sessions].slice(0, 60)
      }
    }));
    setSessionMin(""); setSessionNote("");
    if (window.__toast) window.__toast(`${m} min ${inst} session logged`);
  };

  const doneScales = scales.filter(s => s.done).length;
  const doneRem    = reminders.filter(r => r.done).length;

  const INST_COLOR = { piano: "var(--accent-2)", guitar: "var(--accent)" };

  return (
    <Card num="11" title="Music Practice" span={6}
      right={
        <div style={{ display: "flex", gap: 4 }}>
          {["piano", "guitar"].map(i => (
            <button key={i}
              className={"btn " + (inst === i ? "primary" : "ghost")}
              style={{ fontSize: 11, padding: "3px 10px", textTransform: "capitalize" }}
              onClick={() => setInst(i)}>
              {i === "piano" ? "🎹 Piano" : "🎸 Guitar"}
            </button>
          ))}
        </div>
      }
    >
      {/* ── Stats row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
        <div className="stat-block">
          <span className="l">Today</span>
          <span className="v" style={{ color: todayMin > 0 ? INST_COLOR[inst] : "var(--ink-4)" }}>
            {todayMin}<span className="muted-2" style={{ fontSize: 11, marginLeft: 3 }}>min</span>
          </span>
          <span className="muted-2 mono" style={{ fontSize: 10 }}>{todaySess.length} session{todaySess.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="stat-block">
          <span className="l">Scales done</span>
          <span className="v" style={{ color: scales.length > 0 && doneScales === scales.length ? "var(--accent-2)" : "var(--ink-2)" }}>
            {doneScales}<span className="muted-2" style={{ fontSize: 11 }}>/{scales.length}</span>
          </span>
          <span className="muted-2 mono" style={{ fontSize: 10 }}>this week</span>
        </div>
        <div className="stat-block">
          <span className="l">All-time</span>
          <span className="v">{Math.round(totalMin / 60 * 10) / 10}<span className="muted-2" style={{ fontSize: 11, marginLeft: 3 }}>hrs</span></span>
          <span className="muted-2 mono" style={{ fontSize: 10 }}>{sessions.length} sessions</span>
        </div>
      </div>

      {/* ── Practice schedule POC ── */}
      <div style={{ marginBottom: 14 }}>
        <div className="section-h" style={{ marginBottom: 7 }}>
          <span>Practice Schedule</span><span className="line" />
          <span className="muted-2 mono" style={{ fontSize: 10 }}>{plannedWeekMin} min/wk</span>
        </div>
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--line-soft)", borderRadius: "var(--r)", padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: "1 1 210px" }}>
              <div className="muted-2 mono" style={{ fontSize: 10, marginBottom: 3 }}>{todayPlan ? `${todayDay} plan` : "Next plan"}</div>
              <div className="serif" style={{ fontSize: 15, color: "var(--ink-2)" }}>
                {(todayPlan || nextPlan)?.title || "No schedule yet"}
              </div>
              <div className="muted mono" style={{ fontSize: 10.5, marginTop: 2 }}>
                {todayPlan ? `${todayPlan.minutes} minutes today` : nextPlan ? `${nextPlan.day} - ${nextPlan.minutes} minutes` : "Add a weekly rotation to practice.json"}
              </div>
            </div>
            {todayPlan && (
              <button className="btn primary" style={{ fontSize: 11, padding: "5px 10px" }}
                onClick={() => logSession(todayPlan.minutes, `Planned: ${todayPlan.title}`)}>
                Log planned
              </button>
            )}
          </div>
          {(todayPlan || nextPlan)?.blocks && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(115px, 1fr))", gap: 5, marginTop: 9 }}>
              {(todayPlan || nextPlan).blocks.map((b, i) => (
                <div key={i} className="muted-2 mono" style={{ fontSize: 10.5, border: "1px solid var(--line-soft)", borderRadius: 6, padding: "5px 6px", minWidth: 0 }}>
                  {b}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 6 }}>
          {schedule.map((p, i) => (
            <div key={`${p.day}-${i}`} style={{ border: "1px solid var(--line-soft)", borderRadius: "var(--r)", padding: "7px 8px", background: p.day === todayDay ? "color-mix(in oklch, var(--accent) 9%, transparent)" : "transparent" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 6, marginBottom: 2 }}>
                <span className="mono" style={{ fontSize: 10.5, color: p.day === todayDay ? INST_COLOR[inst] : "var(--ink-3)" }}>{p.day}</span>
                <span className="muted-2 mono" style={{ fontSize: 10 }}>{p.minutes}m</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.25 }}>{p.title}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── This week's focus ── */}
      <div style={{ marginBottom: 14 }}>
        <div className="section-h" style={{ marginBottom: 6 }}>
          <span>This Week's Focus</span><span className="line" />
          <button className="btn ghost" style={{ fontSize: 10, padding: "2px 7px" }}
            onClick={() => { setFocusVal(cur.this_week_focus || ""); setEditFocus(f => !f); }}>
            {editFocus ? "cancel" : "edit"}
          </button>
        </div>
        {editFocus ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <textarea className="journal-text" value={focusVal} onChange={e => setFocusVal(e.target.value)}
              style={{ minHeight: 64, fontSize: 12, resize: "vertical" }}
              placeholder="What are you working on this week?" />
            <button className="btn primary" style={{ fontSize: 11, padding: "4px 12px", alignSelf: "flex-end" }}
              onClick={saveFocus}>Save</button>
          </div>
        ) : (
          <div className="serif" style={{ fontSize: 13, color: cur.this_week_focus ? "var(--ink-2)" : "var(--ink-4)", fontStyle: cur.this_week_focus ? "normal" : "italic" }}>
            {cur.this_week_focus || "No focus set for this week — click edit to add one."}
          </div>
        )}
      </div>

      {/* ── Scales to practice ── */}
      <div style={{ marginBottom: 14 }}>
        <div className="section-h" style={{ marginBottom: 6 }}>
          <span>Scales · This Week</span><span className="line" />
          <span className="muted-2 mono" style={{ fontSize: 10 }}>{doneScales}/{scales.length}</span>
        </div>
        {scales.length === 0 && (
          <div className="muted-2 mono" style={{ fontSize: 11, padding: "4px 0" }}>No scales added — use the input below.</div>
        )}
        {scales.map(s => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <Checkbox checked={s.done} onClick={() => toggleScale(s.id)} />
            <span style={{ flex: 1, fontSize: 12, textDecoration: s.done ? "line-through" : "none", color: s.done ? "var(--ink-4)" : "var(--ink)" }}>{s.name}</span>
            <button className="btn ghost" style={{ fontSize: 10, padding: "1px 6px", opacity: 0.5 }} onClick={() => deleteScale(s.id)}>×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
          <input className="input" placeholder="Add scale or exercise…" value={newScale}
            onChange={e => setNewScale(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addScale()}
            style={{ flex: 1, fontSize: 11 }} />
          <button className="btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={addScale}>+</button>
        </div>
      </div>

      {/* ── Practice reminders ── */}
      <div style={{ marginBottom: 14 }}>
        <div className="section-h" style={{ marginBottom: 6 }}>
          <span>To-Do · Reminders</span><span className="line" />
          <span className="muted-2 mono" style={{ fontSize: 10 }}>{doneRem}/{reminders.length} done</span>
        </div>
        {reminders.length === 0 && (
          <div className="muted-2 mono" style={{ fontSize: 11, padding: "4px 0" }}>No reminders — add things like "rewrite lesson notes" or "record progress clip".</div>
        )}
        {reminders.map(r => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <Checkbox checked={r.done} onClick={() => toggleReminder(r.id)} />
            <span style={{ flex: 1, fontSize: 12, textDecoration: r.done ? "line-through" : "none", color: r.done ? "var(--ink-4)" : "var(--ink)" }}>{r.text}</span>
            <button className="btn ghost" style={{ fontSize: 10, padding: "1px 6px", opacity: 0.5 }} onClick={() => deleteReminder(r.id)}>×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
          <input className="input" placeholder="Add reminder… e.g. rewrite lesson notes" value={newReminder}
            onChange={e => setNewReminder(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addReminder()}
            style={{ flex: 1, fontSize: 11 }} />
          <button className="btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={addReminder}>+</button>
        </div>
      </div>

      {/* ── Last lesson notes ── */}
      <div style={{ marginBottom: 14 }}>
        <div className="section-h" style={{ marginBottom: 6 }}>
          <span>Last Lesson Notes</span><span className="line" />
          <button className="btn ghost" style={{ fontSize: 10, padding: "2px 7px" }}
            onClick={() => { setNotesVal(cur.last_lesson_notes || ""); setEditNotes(n => !n); }}>
            {editNotes ? "cancel" : "edit"}
          </button>
        </div>
        {editNotes ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <textarea className="journal-text" value={notesVal} onChange={e => setNotesVal(e.target.value)}
              style={{ minHeight: 90, fontSize: 12, resize: "vertical" }}
              placeholder="Write or paste your lesson notes here — teacher feedback, things to work on, etc." />
            <button className="btn primary" style={{ fontSize: 11, padding: "4px 12px", alignSelf: "flex-end" }}
              onClick={saveNotes}>Save</button>
          </div>
        ) : (
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--line-soft)", borderRadius: "var(--r)", padding: "9px 11px" }}>
            <div className="serif" style={{ fontSize: 12.5, color: cur.last_lesson_notes ? "var(--ink-2)" : "var(--ink-4)", whiteSpace: "pre-wrap", fontStyle: cur.last_lesson_notes ? "normal" : "italic" }}>
              {cur.last_lesson_notes || "No lesson notes yet — click edit to add them."}
            </div>
          </div>
        )}
      </div>

      {/* ── Log a session ── */}
      <div>
        <div className="section-h" style={{ marginBottom: 7 }}>
          <span>Log Session</span><span className="line" />
          {sessions.length > 0 && (
            <span className="muted-2 mono" style={{ fontSize: 10 }}>
              last: {sessions[0].minutes}min {sessions[0].date === new Date().toISOString().slice(0,10) ? "today" : sessions[0].date}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          {[15, 30, 45, 60].map(m => (
            <button key={m} className="btn ghost" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => logSession(m)}>{m}m</button>
          ))}
          <input className="input" type="number" placeholder="min" value={sessionMin}
            onChange={e => setSessionMin(e.target.value)}
            onKeyDown={e => e.key === "Enter" && logSession()}
            style={{ width: 58, fontSize: 11, padding: "4px 6px" }} />
          <input className="input" placeholder="note (optional)" value={sessionNote}
            onChange={e => setSessionNote(e.target.value)}
            onKeyDown={e => e.key === "Enter" && logSession()}
            style={{ flex: 1, minWidth: 80, fontSize: 11 }} />
          <button className="btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => logSession()}>+</button>
        </div>
      </div>
    </Card>
  );
};

const MODULE_LIST = ["agenda","finance","band","health","work","study","reading","holidays","journal"];

// ── Activity Log ─────────────────────────────────────────────────────────────
const MODULE_META = {
  agenda:  { icon:"calendar",   color:"var(--info)"     },
  finance: { icon:"wallet",     color:"var(--accent-2)" },
  work:    { icon:"briefcase",  color:"var(--accent)"   },
  health:  { icon:"heart",      color:"var(--danger)"   },
  study:   { icon:"graduation", color:"var(--violet)"   },
  reading: { icon:"book",       color:"var(--accent)"   },
  journal: { icon:"feather",    color:"var(--accent-2)" },
  band:    { icon:"music",      color:"var(--accent)"   },
};

const ACTION_LABEL = {
  add:"Added", done:"Completed", delete:"Removed",
  habit:"Habit", weight:"Weight", income:"Income",
  expense:"Expense", session:"Session", progress:"Reading",
  entry:"Journal", snooze:"Snoozed",
};

const ActivityCard = () => {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState("");

  const load = (mod="") => {
    const url = mod ? `/api/activity?limit=150&module=${mod}` : '/api/activity?limit=150';
    fetch(url).then(r=>r.json()).then(setEntries).catch(()=>{});
  };

  useEffect(() => {
    load(filter);
    const onRefresh = () => load(filter);
    window.addEventListener('mc:refresh', onRefresh);
    return () => window.removeEventListener('mc:refresh', onRefresh);
  }, [filter]);

  const today = new Date().toISOString().slice(0,10);
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);

  const byDate = entries.reduce((acc,e) => {
    const d = e.ts.slice(0,10);
    (acc[d] = acc[d]||[]).push(e);
    return acc;
  }, {});

  const clearLog = async () => {
    if (!confirm('Clear all activity history?')) return;
    await fetch('/api/activity',{method:'DELETE'}).catch(()=>{});
    setEntries([]);
  };

  const modules = Object.keys(MODULE_META);

  return (
    <Card num="11" title="Activity Log" span={4}
      right={<>
        <button className="btn" onClick={clearLog} style={{fontSize:10,color:'var(--ink-4)'}}>Clear</button>
      </>}
    >
      {/* Module filter pills */}
      <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:10}}>
        <button onClick={()=>setFilter("")}
          className={"btn"+(filter===""?" active":"")}
          style={{fontSize:10,padding:'2px 8px',background:filter===""?'var(--surface-3)':'transparent'}}>All</button>
        {modules.map(m => (
          <button key={m} onClick={()=>setFilter(filter===m?"":m)}
            className="btn" style={{fontSize:10,padding:'2px 8px',
              background:filter===m?'var(--surface-3)':'transparent',
              borderColor:filter===m?(MODULE_META[m]?.color||'var(--line)'):'var(--line)',
              color:filter===m?(MODULE_META[m]?.color||'var(--ink)'):'var(--ink-3)'}}>
            {m}
          </button>
        ))}
      </div>

      {entries.length === 0 && (
        <div className="muted-2 mono" style={{fontSize:11,padding:'16px 0',textAlign:'center'}}>
          No activity yet — start using modules to build history.
        </div>
      )}

      {Object.entries(byDate).sort((a,b)=>b[0].localeCompare(a[0])).map(([date, items]) => (
        <div key={date} style={{marginBottom:10}}>
          <div className="section-h">
            <span>{date===today?'Today':date===yesterday?'Yesterday':date}</span>
            <span className="muted-2 mono" style={{fontSize:10}}>{items.length}</span>
            <span className="line"/>
          </div>
          {items.map(e => {
            const meta = MODULE_META[e.module] || {icon:'circle', color:'var(--ink-4)'};
            return (
              <div key={e.id} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',borderBottom:'1px solid var(--line-soft)'}}>
                <span className="mono muted-2" style={{fontSize:10,width:42,flexShrink:0}}>{e.ts.slice(11,16)}</span>
                <Icon name={meta.icon} size={12} style={{color:meta.color,flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <span style={{fontSize:11,color:'var(--ink-3)'}}>{ACTION_LABEL[e.action]||e.action} · </span>
                  <span style={{fontSize:11}}>{e.detail}</span>
                  {e.meta && <span className="muted-2 mono" style={{fontSize:10,marginLeft:6}}>{e.meta}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </Card>
  );
};

// ── Today Hub ────────────────────────────────────────────────────────────────
const TodayHub = () => {
  const [data, setData] = React.useState(null);
  const today = new Date().toISOString().slice(0, 10);

  const load = () => fetch('/api/today').then(r => r.json()).then(setData).catch(() => {});

  React.useEffect(() => {
    load();
    window.addEventListener('mc:refresh', load);
    return () => window.removeEventListener('mc:refresh', load);
  }, []);

  if (!data) return null;

  const { agenda, habits, work_priority, trips } = data;
  const habitsToday = habits.today || {};
  const habitList = habits.list || [];
  const doneCount = habitList.filter(h => habitsToday[h.id]).length;

  const toggleHabit = async (hid) => {
    await fetch('/api/health/habit', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({habit: hid, date: today})
    }).catch(() => {});
    setData(d => ({...d, habits: {...d.habits, today: {...d.habits.today, [hid]: !habitsToday[hid]}}}));
  };

  return (
    <Card num="00" title="Today" span={12} right={
      <span className="muted mono" style={{fontSize:11}}>
        {new Date().toLocaleDateString('en-US', {weekday:'long', month:'short', day:'numeric'})}
      </span>
    }>
      <div className="today-grid">
        {/* Schedule */}
        <div>
          <div className="section-h"><span>Schedule</span><span className="line"/></div>
          {agenda.length === 0
            ? <div className="muted" style={{fontSize:12,padding:'6px 0'}}>Nothing scheduled today</div>
            : agenda.map(item => (
              <div key={item.id} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',borderBottom:'1px solid var(--line-soft)'}}>
                <span className="mono muted-2" style={{fontSize:10.5,width:34,flexShrink:0}}>{item.time}</span>
                <span style={{flex:1,fontSize:12}}>{item.label}</span>
                {item.tag && <span className="tag">{item.tag}</span>}
              </div>
            ))
          }
        </div>

        {/* Habits */}
        <div>
          <div className="section-h">
            <span>Habits</span>
            <span className="muted-2 mono" style={{fontSize:10}}>{doneCount}/{habitList.length}</span>
            <span className="line"/>
          </div>
          {habitList.map(h => {
            const done = !!habitsToday[h.id];
            return (
              <div key={h.id} onClick={() => toggleHabit(h.id)}
                style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',cursor:'pointer',borderBottom:'1px solid var(--line-soft)'}}>
                <span style={{
                  width:15, height:15, borderRadius:3, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                  border: `1.5px solid ${done ? 'var(--accent-2)' : 'var(--line)'}`,
                  background: done ? 'color-mix(in oklch,var(--accent-2) 20%,transparent)' : 'transparent'
                }}>
                  {done && <Icon name="check" size={9} style={{color:'var(--accent-2)'}}/>}
                </span>
                <span style={{fontSize:12, color: done ? 'var(--ink-3)' : 'var(--ink)', textDecoration: done ? 'line-through' : 'none'}}>
                  {h.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Priority work + trips */}
        <div>
          {work_priority.length > 0 && <>
            <div className="section-h"><span>Priority</span><span className="line"/></div>
            {work_priority.map(t => (
              <div key={t.id} style={{padding:'3px 0', borderBottom:'1px solid var(--line-soft)'}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span className="dot red" style={{width:5,height:5,flexShrink:0}}/>
                  <span style={{fontSize:12}}>{t.title}</span>
                </div>
                {t.project && <div className="muted-2 mono" style={{fontSize:10,paddingLeft:11}}>{t.project}</div>}
              </div>
            ))}
          </>}
          {trips.length > 0 && <>
            <div className="section-h" style={{marginTop: work_priority.length > 0 ? 14 : 0}}>
              <span>Trips</span><span className="line"/>
            </div>
            {trips.map(trip => (
              <div key={trip.id} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}>
                <Icon name="plane" size={12} style={{color:'var(--accent)',flexShrink:0}}/>
                <span style={{fontSize:12,flex:1}}>{trip.name}</span>
                <span className="mono muted" style={{fontSize:11}}>
                  {trip.days_out < 0 ? 'in progress' : trip.days_out === 0 ? 'today!' : `${trip.days_out}d`}
                </span>
              </div>
            ))}
          </>}
          {work_priority.length === 0 && trips.length === 0 && (
            <div>
              <div className="section-h"><span>Status</span><span className="line"/></div>
              <div className="muted" style={{fontSize:12,padding:'6px 0'}}>All clear — nothing urgent.</div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

// =========================================================
// CALENDAR — unified event timeline
// =========================================================
const CalendarCard = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showAddBd, setShowAddBd] = useState(false);
  const [bdName, setBdName] = useState('');
  const [bdDate, setBdDate] = useState('');
  const [bdRemind, setBdRemind] = useState(14);

  const load = () => {
    setLoading(true);
    fetch('/api/calendar/overview').then(r=>r.json()).then(d=>{
      setEvents(d.events||[]);
      setLoading(false);
    }).catch(()=>setLoading(false));
  };
  useEffect(load, []);

  const addBd = async () => {
    if (!bdName || !bdDate) return;
    await fetch('/api/birthdays',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:bdName,date:bdDate,gift_remind_days:bdRemind})}).catch(()=>{});
    setShowAddBd(false); setBdName(''); setBdDate('');
    window.__toast?.(`Birthday added for ${bdName}`,'success');
    load();
  };

  const FILTERS = [
    {id:'all',label:'All'},{id:'show',label:'Shows'},
    {id:'birthday',label:'Birthdays'},{id:'holiday',label:'Holidays'},
    {id:'work',label:'Work'},{id:'gcal',label:'Cal'},
  ];
  const ICON  = {birthday:'heart',show:'music',holiday:'flag',work:'briefcase',gcal:'calendar',culture:'sparkles'};
  const COLOR = {birthday:'amber',show:'violet',holiday:'mint',work:'info',gcal:'mint',culture:'amber'};
  const LABEL = {birthday:'Birthday',show:'Show',holiday:'Holiday',work:'Work',gcal:'Event',culture:'Event'};

  const todayMs = new Date(new Date().toISOString().slice(0,10)+'T12:00:00').getTime();
  const visible = events.filter(e => filter==='all' || e.type===filter);
  const bucket = (ms) => ms<=7*864e5?0:ms<=30*864e5?1:2;
  const groups = [[],[],[]];
  visible.forEach(e=>{
    const ms = new Date(e.date+'T12:00:00').getTime()-todayMs;
    if (ms>=0) groups[bucket(ms)].push(e);
  });
  const GROUP_LABELS = ['This Week','This Month','Later'];

  const fmtDate = s => {
    const ms = new Date(s+'T12:00:00').getTime()-todayMs;
    const diff = Math.round(ms/864e5);
    if (diff===0) return 'Today';
    if (diff===1) return 'Tomorrow';
    return new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
  };

  return (
    <Card num="0c" title="Calendar" span={6}
      right={<>
        <div style={{display:'flex',gap:2,flexWrap:'wrap'}}>
          {FILTERS.map(f=>(
            <button key={f.id} className="btn ghost" onClick={()=>setFilter(f.id)} style={{
              padding:'2px 7px',fontSize:10.5,fontFamily:'var(--font-mono)',
              color:filter===f.id?'var(--accent)':'var(--ink-4)',
              background:filter===f.id?'var(--surface-2)':'transparent',
              borderColor:filter===f.id?'var(--line)':'transparent',
            }}>{f.label}</button>
          ))}
        </div>
        <button className="btn ghost" style={{padding:'3px 8px',fontSize:11}} onClick={()=>setShowAddBd(s=>!s)}>
          <Icon name="plus" size={12}/> BD
        </button>
      </>}
    >
      {showAddBd && (
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12,padding:10,background:'var(--surface-2)',borderRadius:'var(--r)',border:'1px solid var(--line)'}}>
          <div className="muted-2 mono" style={{fontSize:10.5,letterSpacing:'.06em'}}>ADD BIRTHDAY</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <input className="input" placeholder="Name" value={bdName} onChange={e=>setBdName(e.target.value)} style={{flex:1,minWidth:100,fontSize:12}}/>
            <input className="input" placeholder="MM-DD or YYYY-MM-DD" value={bdDate} onChange={e=>setBdDate(e.target.value)} style={{flex:1,minWidth:120,fontSize:12}}/>
            <input className="input" type="number" value={bdRemind} onChange={e=>setBdRemind(parseInt(e.target.value)||14)}
              style={{width:56,fontSize:12}} title="Days before birthday to remind about gift"/>
          </div>
          <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
            <button className="btn primary" onClick={addBd} style={{fontSize:11}}>Save</button>
            <button className="btn ghost" onClick={()=>setShowAddBd(false)} style={{fontSize:11}}>✕</button>
          </div>
          <div className="muted-2 mono" style={{fontSize:10}}>Third number = days before birthday to get a gift reminder</div>
        </div>
      )}
      {loading && <div className="muted-2 mono" style={{fontSize:11,padding:'16px 0',textAlign:'center'}}>Loading…</div>}
      {!loading && visible.length===0 && <div className="muted-2 mono" style={{fontSize:11,padding:'16px 0',textAlign:'center'}}>No upcoming events.</div>}
      {groups.map((evts, gi) => {
        if (!evts.length) return null;
        return (
          <div key={gi}>
            <div className="section-h"><span>{GROUP_LABELS[gi]}</span><span className="line"/>
              <span className="muted-2 mono" style={{fontSize:10.5}}>{evts.length}</span>
            </div>
            {evts.map((e,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'58px 15px 1fr auto',gap:8,alignItems:'center',padding:'5px 0',borderBottom:'1px solid var(--line-soft)'}}>
                <span className="mono" style={{fontSize:10.5,color:'var(--ink-4)'}}>{fmtDate(e.date)}</span>
                <Icon name={ICON[e.type]||'calendar'} size={12} style={{color:`var(--${COLOR[e.type]||'ink-3'})`}}/>
                <div>
                  <div style={{fontSize:12,color:'var(--ink)',fontWeight:500,lineHeight:1.3}}>{e.title}</div>
                  {e.meta&&<div style={{fontSize:10.5,color:'var(--ink-4)'}}>{e.meta}</div>}
                </div>
                <span className={`tag ${COLOR[e.type]||''}`} style={{fontSize:10,padding:'1px 6px',whiteSpace:'nowrap'}}>{LABEL[e.type]||e.type}</span>
              </div>
            ))}
          </div>
        );
      })}
    </Card>
  );
};

/* ── TCPG Monitor ─────────────────────────────────────────────── */
const TCPGCard = () => {
  const [tab, setTab] = useState('overview');
  const [health, setHealth] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsError, setLogsError] = useState('');
  const [healthError, setHealthError] = useState('');
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [config, setConfig] = useState(null);
  const [editConfig, setEditConfig] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [severity, setSeverity] = useState('DEFAULT');
  const [cpgRevenue, setCpgRevenue] = useState([]);
  const [cpgNotes, setCpgNotes] = useState(() => localStorage.getItem('cpg_notes') || '');

  const loadConfig = () =>
    fetch('/api/tcpg/config').then(r => r.json()).then(d => { setConfig(d); setEditConfig({...d}); });

  const loadHealth = () => {
    setLoadingHealth(true);
    setHealthError('');
    fetch('/api/tcpg/health').then(r => r.json()).then(d => {
      if (d.error) setHealthError(d.error);
      setHealth(d);
    }).catch(() => setHealthError('Request failed')).finally(() => setLoadingHealth(false));
  };

  const loadLogs = (sev) => {
    setLoadingLogs(true);
    setLogsError('');
    fetch(`/api/tcpg/logs?severity=${sev !== undefined ? sev : severity}`).then(r => r.json()).then(d => {
      if (d.error) setLogsError(d.error);
      setLogs(d.entries || []);
    }).catch(() => setLogsError('Request failed')).finally(() => setLoadingLogs(false));
  };

  useEffect(() => { loadConfig(); }, []);

  useEffect(() => {
    if (tab === 'overview') loadHealth();
    if (tab === 'logs') loadLogs();
    if (tab === 'revenue') {
      fetch('/api/finances').then(r=>r.json()).then(data => {
        setCpgRevenue((data||[]).filter(t =>
          t.type === 'income' &&
          (t.category === 'coding' || (t.description||'').toLowerCase().includes('consumer'))
        ));
      }).catch(()=>{});
    }
  }, [tab]);

  const saveConfig = async () => {
    setSavingConfig(true);
    await fetch('/api/tcpg/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editConfig)
    });
    setSavingConfig(false);
    setConfig({...editConfig});
    window.__toast?.('Config saved', 'success');
    loadHealth();
  };

  const STATUS_COLOR = { healthy: 'var(--green)', degraded: 'var(--orange)', error: 'var(--red)', unconfigured: 'var(--ink-4)', no_credentials: 'var(--orange)' };
  const SEV_COLOR = { ERROR: 'var(--red)', CRITICAL: 'var(--red)', WARNING: 'var(--orange)', INFO: 'var(--accent-2)', DEBUG: 'var(--ink-4)', DEFAULT: 'var(--ink-3)' };

  const fmtTs = (ts) => {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
    catch { return ts.slice(11, 19); }
  };

  const configured = config && config.project_id && config.service_name;

  const statusLabel = {
    healthy: 'Service Healthy', degraded: 'Service Degraded',
    unconfigured: 'Not Configured', no_credentials: 'Auth Required',
    error: 'Status Error'
  };

  return (
    <Card num="10" title="TCPG Monitor" span={6} right={
      <div style={{ display: 'flex', gap: 4 }}>
        {config && config.github_url && (
          <a href={config.github_url} target="_blank" rel="noreferrer" className="btn ghost"
            style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <Icon name="external" size={11} /> GitHub
          </a>
        )}
        {config && config.cloud_run_url && (
          <a href={config.cloud_run_url} target="_blank" rel="noreferrer" className="btn ghost"
            style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <Icon name="external" size={11} /> Cloud Run
          </a>
        )}
      </div>
    }>
      <div style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
        {['overview', 'revenue', 'logs', 'config'].map(t => (
          <button key={t} className={'btn' + (tab === t ? ' primary' : ' ghost')}
            style={{ fontSize: 11, padding: '3px 10px', textTransform: 'capitalize' }}
            onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          {!configured && (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-4)', fontSize: 12 }}>
              No service configured —{' '}
              <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setTab('config')}>open Config</button>
              {' '}to set up.
            </div>
          )}
          {configured && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[health && health.status] || 'var(--ink-4)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  {health ? (statusLabel[health.status] || 'Status Unknown') : 'Loading…'}
                </span>
                {loadingHealth
                  ? <Icon name="loader" size={13} style={{ color: 'var(--ink-4)', marginLeft: 'auto' }} />
                  : <button className="btn ghost" style={{ fontSize: 10, marginLeft: 'auto', padding: '2px 8px' }} onClick={loadHealth}>Refresh</button>
                }
              </div>

              {healthError && (
                <div style={{ fontSize: 11, color: 'var(--red)', background: 'var(--surface-2)', padding: '8px 10px', borderRadius: 4, marginBottom: 10, fontFamily: 'var(--font-mono)' }}>
                  {healthError}
                </div>
              )}

              {health && !healthError && health.status !== 'unconfigured' && health.status !== 'no_credentials' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginBottom: 14 }}>
                  {health.latest_revision && (
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>Latest Revision</div>
                      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>{health.latest_revision}</div>
                    </div>
                  )}
                  {health.url && (
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>Service URL</div>
                      <a href={health.url} target="_blank" rel="noreferrer"
                        style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                        {health.url.replace('https://', '').slice(0, 38)}{health.url.length > 46 ? '…' : ''} <Icon name="external" size={10} />
                      </a>
                    </div>
                  )}
                  {health.conditions && health.conditions.length > 0 && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Conditions</div>
                      {health.conditions.map((c, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11, marginBottom: 3 }}>
                          <span style={{ color: c.state === 'CONDITION_SUCCEEDED' ? 'var(--green)' : 'var(--orange)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                            {c.state === 'CONDITION_SUCCEEDED' ? '✓' : '!'}
                          </span>
                          <span style={{ color: 'var(--ink-2)' }}>{c.type}{c.message ? ` — ${c.message}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="section-h" style={{ marginTop: 4 }}><span>Quick Links</span><span className="line"/></div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {config.github_url && (
                  <a href={config.github_url} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: 11, textDecoration: 'none' }}>
                    <Icon name="external" size={11} /> GitHub Repo
                  </a>
                )}
                {config.cloud_run_url && (
                  <a href={config.cloud_run_url} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: 11, textDecoration: 'none' }}>
                    <Icon name="external" size={11} /> Cloud Run Console
                  </a>
                )}
                {health && health.url && (
                  <a href={health.url} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: 11, textDecoration: 'none' }}>
                    <Icon name="external" size={11} /> Live App
                  </a>
                )}
                <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setTab('logs')}>
                  <Icon name="file" size={11} /> View Logs
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'revenue' && (() => {
        const total = cpgRevenue.reduce((s,t) => s + (t.amount||0), 0);
        const byMonth = cpgRevenue.reduce((acc,t) => { const m=(t.date||'').slice(0,7); acc[m]=(acc[m]||0)+t.amount; return acc; }, {});
        const maxAmt = Math.max(...Object.values(byMonth), 1);
        const saveNotes = (v) => { setCpgNotes(v); localStorage.setItem('cpg_notes', v); };
        return (
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div>
              <div className="muted-2 mono" style={{fontSize:10,letterSpacing:'.06em',marginBottom:6}}>QUICK ACCESS</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                {CPG_LINKS.map((l,i) => (
                  <a key={i} href={l.url} target="_blank" rel="noopener"
                    style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:'var(--r)',
                      textDecoration:'none',color:'var(--ink-2)',background:'var(--surface)',border:'1px solid var(--line)'}}>
                    <Icon name={l.icon} size={13} style={{color:l.color,flexShrink:0}}/>
                    <span style={{fontSize:12,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.label}</span>
                    <Icon name="external" size={11} style={{color:'var(--ink-4)'}}/>
                  </a>
                ))}
              </div>
            </div>
            <div>
              <div className="muted-2 mono" style={{fontSize:10,letterSpacing:'.06em',marginBottom:6}}>REVENUE 2026</div>
              {cpgRevenue.length === 0
                ? <div className="muted" style={{fontSize:12}}>No CPG income logged yet</div>
                : (<>
                    <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:8}}>
                      <span className="mono" style={{fontSize:22,fontWeight:500}}>${total.toFixed(0)}</span>
                      <span className="muted-2 mono" style={{fontSize:11}}>total · {cpgRevenue.length} payments</span>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      {Object.entries(byMonth).sort().map(([m,amt]) => (
                        <div key={m} style={{display:'flex',alignItems:'center',gap:8}}>
                          <span className="mono muted-2" style={{fontSize:10,width:52}}>{m}</span>
                          <div style={{flex:1,height:4,background:'var(--surface-3)',borderRadius:2}}>
                            <div style={{height:4,borderRadius:2,background:'var(--accent-2)',width:`${Math.min(100,(amt/maxAmt)*100)}%`}}/>
                          </div>
                          <span className="mono" style={{fontSize:11,color:'var(--accent-2)',width:44,textAlign:'right'}}>${amt.toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  </>)
              }
            </div>
            <div>
              <div className="muted-2 mono" style={{fontSize:10,letterSpacing:'.06em',marginBottom:6}}>NOTES / LOG</div>
              <textarea value={cpgNotes} onChange={e=>saveNotes(e.target.value)}
                placeholder="Project notes, ideas, issues…"
                style={{width:'100%',minHeight:80,background:'var(--surface)',border:'1px solid var(--line)',
                  borderRadius:'var(--r)',color:'var(--ink)',fontFamily:'var(--font-sans)',fontSize:12,
                  padding:'8px 10px',resize:'vertical',outline:'none',lineHeight:1.5}}/>
            </div>
          </div>
        );
      })()}

      {tab === 'logs' && (
        <div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--ink-4)', marginRight: 2 }}>Severity:</span>
            {['DEFAULT', 'INFO', 'WARNING', 'ERROR'].map(s => (
              <button key={s} className={'btn' + (severity === s ? ' primary' : ' ghost')}
                style={{ fontSize: 10, padding: '2px 7px' }}
                onClick={() => { setSeverity(s); loadLogs(s); }}>{s}</button>
            ))}
            <button className="btn ghost" style={{ fontSize: 10, padding: '2px 8px', marginLeft: 'auto' }} onClick={() => loadLogs()}>
              {loadingLogs ? <Icon name="loader" size={11} /> : 'Refresh'}
            </button>
          </div>

          {logsError && (
            <div style={{ fontSize: 11, color: 'var(--red)', background: 'var(--surface-2)', padding: '8px 10px', borderRadius: 4, marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
              {logsError}
            </div>
          )}

          {!logsError && !loadingLogs && logs.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--ink-4)', fontSize: 12 }}>No log entries found.</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {logs.map((entry, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '58px 58px 1fr', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--line-soft)', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--ink-4)', flexShrink: 0 }}>{fmtTs(entry.timestamp)}</span>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: SEV_COLOR[entry.severity] || 'var(--ink-3)', flexShrink: 0 }}>{(entry.severity || 'DEFAULT').slice(0, 7)}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-2)', wordBreak: 'break-word', fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>{entry.message || '(no message)'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'config' && editConfig && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { key: 'project_id',    label: 'GCP Project ID',         placeholder: 'my-gcp-project' },
            { key: 'service_name',  label: 'Cloud Run Service Name',  placeholder: 'my-service' },
            { key: 'region',        label: 'Region',                  placeholder: 'us-central1' },
            { key: 'github_url',    label: 'GitHub Repo URL',         placeholder: 'https://github.com/org/repo' },
            { key: 'cloud_run_url', label: 'Cloud Run Console URL',   placeholder: 'https://console.cloud.google.com/run/detail/…' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <div style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{label}</div>
              <input className="input" style={{ width: '100%', fontSize: 12 }} placeholder={placeholder}
                value={editConfig[key] || ''} onChange={e => setEditConfig(c => ({ ...c, [key]: e.target.value }))} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
            <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setEditConfig({...config})}>Reset</button>
            <button className="btn primary" style={{ fontSize: 11 }} disabled={savingConfig} onClick={saveConfig}>
              {savingConfig ? <Icon name="loader" size={12} /> : 'Save Config'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--ink-4)', lineHeight: 1.5, marginTop: 2 }}>
            Logs and health use Application Default Credentials.
            Run <span style={{ fontFamily: 'var(--font-mono)' }}>gcloud auth application-default login</span> locally if GCP auth fails.
          </div>
        </div>
      )}
    </Card>
  );
};

window.MissionModules = {
  AgendaCard, FinanceCard, BandCard, HealthCard, WorkCard,
  StudyCard, ReadingCard, HolidayCard, JournalCard, TodayHub, ActivityCard, CalendarCard,
  TCPGCard, PracticeCard
};
