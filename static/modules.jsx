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
          <div className="hairline"/>
          <div>
            <div className="muted-2 mono" style={{ fontSize: 10.5, letterSpacing: ".08em", marginBottom: 6 }}>REHAB · TENNIS ELBOW</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <div className="row" style={{ gap: 8 }}><Checkbox /><span>Eccentric wrist curls — 3×15</span></div>
              <div className="row" style={{ gap: 8 }}><Checkbox /><span>Pronator stretch — 3×30s</span></div>
              <div className="row" style={{ gap: 8 }}><Checkbox /><span>Ice 10 min post-lift</span></div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

// =========================================================
// FINANCE
// =========================================================
const FinanceCard = () => {
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const defaultCategories = [
    { name: "Housing",       budget: 987,  actual: 0, color: "var(--info)" },
    { name: "Utilities",     budget: 450,  actual: 0, color: "var(--violet)" },
    { name: "Subscriptions", budget: 125,  actual: 0, color: "var(--accent-2)" },
    { name: "Food / Grocer", budget: 400,  actual: 0, color: "var(--accent)" },
    { name: "Gas",           budget: 120,  actual: 0, color: "oklch(0.7 0.13 200)" },
    { name: "Fun",           budget: 500,  actual: 0, color: "var(--danger)" },
    { name: "Loans",         budget: 500,  actual: 0, color: "oklch(0.65 0.10 30)" },
  ];

  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [txns, setTxns] = useState([]);
  const [savings, setSavings] = useState([]);
  const [subs, setSubs] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddSub, setShowAddSub] = useState(false);
  const [desc, setDesc] = useState(""); const [amt, setAmt] = useState(""); const [type, setType] = useState("expense"); const [cat, setCat] = useState("personal");
  const [subName, setSubName] = useState(""); const [subAcct, setSubAcct] = useState(""); const [subAmt, setSubAmt] = useState(""); const [subDue, setSubDue] = useState("");

  const loadFinances = (m) => {
    fetch(`/api/finances?month=${m}`).then(r=>r.json()).then(data => {
      setTxns(data.map(t => ({
        merchant: t.description, cat: t.category,
        amount: t.type === 'expense' ? -t.amount : t.amount,
        date: new Date(t.date + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}),
        color: t.type === 'income' ? 'var(--accent-2)' : 'var(--ink-4)',
        pending: false, id: t.id
      })));
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

  const totalIn  = txns.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount, 0);
  const totalEx  = txns.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount), 0);
  const net = totalIn - totalEx;
  const totalBudget = defaultCategories.reduce((s,c)=>s+c.budget,0);
  const [my, mm] = month.split('-');
  const monthLabel = MONTH_NAMES[parseInt(mm)-1] + ' ' + my;

  const catMap = { personal: "Fun", IT: "Housing", band: "Fun", coding: "Fun" };
  const categories = defaultCategories.map(c => ({
    ...c,
    actual: txns.filter(t=>t.amount<0).filter(t => (catMap[t.cat]||t.cat) === c.name).reduce((s,t)=>s+Math.abs(t.amount),0)
  }));

  const acctMap = {};
  savings.forEach(s => { if (!acctMap[s.account] || s.date > acctMap[s.account].date) acctMap[s.account] = s; });
  const subTotal = subs.reduce((s,c)=>s+c.amt, 0);
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
          <select className="input" value={cat} onChange={e=>setCat(e.target.value)} style={{width:96}}>
            <option value="personal">Personal</option><option value="IT">IT/GLS</option>
            <option value="band">Band</option><option value="coding">Freelance</option>
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
          <div className="section-h" style={{marginTop:12}}><span>Budget vs Actual</span><span className="line"/><span className="muted-2">{Math.round((totalEx/totalBudget)*100)}% of budget</span></div>
          <div>
            {categories.map((c,i) => {
              const pct = Math.min(180,(c.actual/Math.max(c.budget,1))*100);
              const over = c.actual > c.budget;
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
          <div className="section-h"><span>Recent Transactions</span><span className="line"/></div>
          {txns.length === 0 && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 0'}}>No transactions this month.</div>}
          {[...txns].slice(0,8).map((t,i) => (
            <div key={i} className="txn" style={{gridTemplateColumns:"18px 1fr auto auto"}}>
              <span className="cat-dot" style={{background:t.amount>0?"var(--accent-2)":"var(--ink-4)"}}/>
              <div><div className="merchant">{t.merchant}</div><div className="meta">{t.date} · {t.cat}</div></div>
              <span className="amount" style={{color:t.amount>0?"var(--accent-2)":"var(--ink)"}}>
                {t.amount>0?"+":""}{fmtMoney(Math.abs(t.amount))}
              </span>
              <span style={{cursor:"pointer",color:"var(--ink-4)",padding:"0 2px",lineHeight:1}} title="Remove"
                onClick={async()=>{ await fetch(`/api/finances/${t.id}`,{method:"DELETE"}); loadFinances(month); }}>
                ×
              </span>
            </div>
          ))}
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
const MiniCal = ({ gigs, trips }) => {
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
      while (d <= end) {
        tripDates.add(d.toISOString().slice(0,10));
        d.setDate(d.getDate()+1);
      }
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
          const isShow = showDates.has(ds);
          const isTrip = tripDates.has(ds);
          const isToday = d===today.getDate() && cal.m===today.getMonth() && cal.y===today.getFullYear();
          const dow = new Date(cal.y,cal.m,d).getDay();
          const isPot = (dow===5||dow===6) && !isShow; // Fri/Sat = good content days
          return (
            <div key={i} style={{
              textAlign:'center', padding:'4px 2px', borderRadius:4, fontSize:11,
              fontFamily:'var(--font-mono)',
              background: isShow ? 'color-mix(in oklch,var(--violet) 30%,var(--surface-2))'
                        : isTrip ? 'color-mix(in oklch,var(--accent) 20%,var(--surface-2))'
                        : isToday ? 'var(--surface-3)' : 'transparent',
              color: isShow ? 'var(--violet)' : isTrip ? 'var(--accent)' : isToday ? 'var(--ink)' : 'var(--ink-2)',
              border: isToday ? '1px solid var(--line)' : '1px solid transparent',
              fontWeight: isShow||isToday ? 600 : 400,
              position:'relative',
            }}>
              {d}
              {isPot && <span style={{position:'absolute',bottom:1,left:'50%',transform:'translateX(-50%)',width:4,height:4,borderRadius:'50%',background:'var(--accent-2)',display:'block'}}/>}
            </div>
          );
        })}
      </div>
      <div className="row" style={{gap:10,marginTop:6,flexWrap:'wrap'}}>
        <div className="row" style={{gap:4}}><span style={{width:8,height:8,borderRadius:2,background:'color-mix(in oklch,var(--violet) 30%,var(--surface-2))',border:'1px solid var(--violet)'}}/><span className="muted-2 mono" style={{fontSize:9.5}}>Show</span></div>
        <div className="row" style={{gap:4}}><span style={{width:8,height:8,borderRadius:2,background:'color-mix(in oklch,var(--accent) 20%,var(--surface-2))',border:'1px solid var(--accent)'}}/><span className="muted-2 mono" style={{fontSize:9.5}}>Trip</span></div>
        <div className="row" style={{gap:4}}><span style={{width:4,height:4,borderRadius:'50%',background:'var(--accent-2)'}}/><span className="muted-2 mono" style={{fontSize:9.5}}>Post day</span></div>
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
  const [newIdea, setNewIdea] = useState("");
  const [showAddContact, setShowAddContact] = useState(false);
  const [showAddShow, setShowAddShow] = useState(false);
  const [newContact, setNewContact] = useState({name:'',venue:'',city:'',status:'not contacted'});
  const [newShow, setNewShow] = useState({date:'',venue:'',city:'Fayetteville, AR',notes:''});

  useEffect(() => {
    fetch('/api/shows').then(r=>r.json()).then(data => {
      const today = new Date();
      const upcoming = data
        .filter(s => new Date(s.date+'T12:00:00') >= today)
        .sort((a,b) => new Date(a.date)-new Date(b.date));
      setGigs(upcoming.map(s => ({
        venue: s.venue, city: s.city, rawDate: s.date,
        date: new Date(s.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),
        days: Math.round((new Date(s.date+'T12:00:00')-today)/86400000),
        status: 'confirmed', notes: s.notes
      })));
    }).catch(()=>{});
    fetch('/api/band/content').then(r=>r.json()).then(data => {
      setContentQueue(data.filter(c=>c.status!=='done'));
    }).catch(()=>{});
    fetch('/api/band/contacts').then(r=>r.json()).then(setContacts).catch(()=>{});
    fetch('/api/holidays').then(r=>r.json()).then(setTrips).catch(()=>{});
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
    await fetch('/api/shows', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({date:newShow.date,event:'CUA Live',venue:newShow.venue,city:newShow.city,notes:newShow.notes})});
    const today = new Date();
    const sd = new Date(newShow.date+'T12:00:00');
    if (sd >= today) {
      setGigs(gs => [...gs, {venue:newShow.venue, city:newShow.city, rawDate:newShow.date,
        date:sd.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),
        days:Math.round((sd-today)/86400000), status:'confirmed', notes:newShow.notes}]
        .sort((a,b)=>new Date(a.rawDate)-new Date(b.rawDate)));
    }
    setNewShow({date:'',venue:'',city:'Fayetteville, AR',notes:''});
    setShowAddShow(false);
  };

  const addContact = async () => {
    if (!newContact.venue) return;
    const res = await fetch('/api/band/contacts', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(newContact)}).then(r=>r.json());
    setContacts(cs => [...cs, {...newContact, id:res.id}]);
    setNewContact({name:'',venue:'',city:'',status:'not contacted'});
    setShowAddContact(false);
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
        <span className="tag violet">{gigs.length} gigs</span>
        <button className="btn" onClick={()=>setShowAddShow(s=>!s)}><Icon name="plus" size={13}/>Show</button>
        <button className="btn primary" onClick={pushSite} disabled={pushing}>{pushing?'pushing…':'Push live'}</button>
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
      <MiniCal gigs={gigs} trips={trips} />

      <div className="section-h"><span>Next Show</span><span className="line"/></div>
      {nextGig ? (
        <div style={{
          background:"linear-gradient(135deg,color-mix(in oklch,var(--violet) 14%,var(--surface-2)),var(--surface-2))",
          border:"1px solid color-mix(in oklch,var(--violet) 30%,var(--line))",
          borderRadius:"var(--r)",padding:10,display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center",marginBottom:8
        }}>
          <div>
            <div className="serif" style={{fontSize:17,lineHeight:1.15}}>{nextGig.venue}</div>
            <div className="muted mono" style={{fontSize:11}}>{nextGig.city} · {nextGig.date}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="mono" style={{fontSize:26,fontWeight:500}}>{Math.max(0,nextGig.days)}</div>
            <div className="muted-2 mono" style={{fontSize:10,letterSpacing:".08em"}}>DAYS</div>
          </div>
        </div>
      ) : (
        <div className="muted mono" style={{fontSize:11,padding:'8px 0'}}>No upcoming shows.</div>
      )}

      {gigs.slice(1,4).map((g,i) => (
        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto",padding:"5px 0",borderBottom:"1px solid var(--line-soft)"}}>
          <div><div style={{fontSize:12.5}}>{g.venue}</div><div className="muted mono" style={{fontSize:10.5}}>{g.city} · {g.date}</div></div>
          <span className="tag mint">{g.status}</span>
        </div>
      ))}

      <div className="section-h"><span>Content Queue</span><span className="line"/></div>
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <input className="input" placeholder="Add idea (clip, reel, post)…" value={newIdea} onChange={e=>setNewIdea(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')addIdea();}} style={{flex:1,fontSize:12}}/>
        <button className="btn" onClick={addIdea}>+</button>
      </div>
      {contentQueue.slice(0,4).map((c,i) => (
        <div key={i} className="row" style={{padding:"4px 0",borderBottom:"1px solid var(--line-soft)",fontSize:12.5}}>
          <span style={{flex:1}}>{c.title}</span>
          <span className="tag muted" style={{fontSize:10}}>{c.status}</span>
        </div>
      ))}
      {contentQueue.length===0 && <div className="muted-2 mono" style={{fontSize:11,padding:'4px 0'}}>Queue empty</div>}

      <div className="section-h">
        <span>Venues / Contacts</span><span className="line"/>
        <span className="muted-2 num" style={{fontSize:10.5}}>{overdue} to reach</span>
        <button className="btn ghost" style={{padding:'2px 6px',fontSize:10.5}} onClick={()=>setShowAddContact(s=>!s)}>+</button>
      </div>
      {showAddContact && (
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:8,padding:'8px',background:'var(--surface-2)',borderRadius:'var(--r)',border:'1px solid var(--line)'}}>
          <div style={{display:'flex',gap:6}}>
            <input className="input" placeholder="Contact name" value={newContact.name} onChange={e=>setNewContact(c=>({...c,name:e.target.value}))} style={{flex:1,fontSize:12}}/>
            <input className="input" placeholder="Venue" value={newContact.venue} onChange={e=>setNewContact(c=>({...c,venue:e.target.value}))} style={{flex:1,fontSize:12}}/>
          </div>
          <div style={{display:'flex',gap:6}}>
            <input className="input" placeholder="City" value={newContact.city} onChange={e=>setNewContact(c=>({...c,city:e.target.value}))} style={{flex:1,fontSize:12}}/>
            <select className="input" value={newContact.status} onChange={e=>setNewContact(c=>({...c,status:e.target.value}))} style={{width:130,fontSize:12}}>
              <option value="not contacted">Not contacted</option>
              <option value="EPK sent">EPK sent</option>
              <option value="follow up">Follow up</option>
              <option value="responded">Responded</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </div>
          <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
            <button className="btn primary" onClick={addContact} style={{fontSize:11}}>Add contact</button>
            <button className="btn ghost" onClick={()=>setShowAddContact(false)} style={{fontSize:11}}>✕</button>
          </div>
        </div>
      )}
      {contacts.map((c,i) => (
        <div key={c.id||i} className="row" style={{padding:"5px 0",borderBottom:"1px solid var(--line-soft)",gap:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.venue}</div>
            <div className="muted mono" style={{fontSize:10.5}}>{c.city && c.city+' · '}{c.name&&c.name!=='—'?c.name:'—'} · last {c.last}</div>
          </div>
          <span className={"tag "+(c.status==="confirmed"?"mint":c.status==="responded"?"mint":c.status==="follow up"?"amber":c.status==="EPK sent"?"info":"")}>
            {c.status}
          </span>
          <button className="btn ghost" style={{padding:'2px 6px',fontSize:10,whiteSpace:'nowrap'}} onClick={()=>markContacted(c)} title="Mark contacted today">✓</button>
          <button className="btn ghost" style={{padding:'2px 4px',fontSize:12,color:'var(--ink-4)'}} onClick={()=>deleteContact(c.id)} title="Remove">×</button>
        </div>
      ))}
    </Card>
  );
};

// =========================================================
// HEALTH
// =========================================================
const HealthCard = () => {
  const defaultHabits = [
    { name: "Lift",    states: ["done","done","done","miss","done","done","done"] },
    { name: "Walk 8k", states: ["done","done","done","done","done","done","done"] },
    { name: "Sleep 7h",states: ["done","miss","done","done","miss","done","done"] },
    { name: "Water",   states: ["done","done","done","done","done","done","done"] },
  ];
  const [habits, setHabits] = useState(defaultHabits);
  const [stats, setStats] = useState({ weight: 182.4, steps: 9420, sleep: "7h 12m", weightLog: [188,187,186.5,185.4,184.8,184,183.1,182.4] });
  const [newWeight, setNewWeight] = useState("");
  const days = ["M","T","W","T","F","S","S"];

  useEffect(() => {
    fetch('/api/health').then(r=>r.json()).then(data => {
      if (data.weight_log && data.weight_log.length) {
        const wl = data.weight_log.slice(-8).map(w=>w.weight);
        setStats(s => ({ ...s, weight: wl[wl.length-1], weightLog: wl }));
      }
      if (data.habits_weekly) {
        const days7 = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
        const mapped = Object.entries(data.habits_weekly).map(([name, dayMap]) => ({
          name, states: days7.map(d => dayMap[d] ? "done" : "future")
        }));
        if (mapped.length) setHabits(mapped);
      }
    }).catch(()=>{});
  }, []);

  const toggleHabit = async (habitName, dayIdx) => {
    const today = new Date();
    const dow = today.getDay(); // 0=Sun
    const monOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + monOffset);
    const target = new Date(monday);
    target.setDate(monday.getDate() + dayIdx);
    const dateStr = target.toISOString().slice(0, 10);
    await fetch('/api/health/habit', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ habit: habitName, date: dateStr }) }).catch(()=>{});
    setHabits(hs => hs.map(h => h.name === habitName
      ? { ...h, states: h.states.map((s,i) => i===dayIdx ? (s==="done"?"miss":"done") : s) }
      : h));
  };

  const logWeight = async () => {
    const w = parseFloat(newWeight);
    if (!w || w < 80 || w > 500) return;
    const today = new Date().toISOString().slice(0, 10);
    await fetch('/api/health/weight',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({weight:w,date:today})}).catch(()=>{});
    setStats(s => ({ ...s, weight: w, weightLog: [...s.weightLog.slice(-7), w] }));
    setNewWeight('');
    if (window.__toast) window.__toast(`Weight ${w} lb logged`);
  };

  const workout = [
    ["Bench press","4 × 8","165 lb"],["Incline DB press","3 × 10","55 lb"],
    ["Cable fly","3 × 12","30 lb"],["Overhead tri ext","3 × 12","60 lb"],
  ];

  return (
    <Card num="04" title="Health & Fitness" span={4}
      right={<><span className="tag mint">active</span></>}
    >
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
        <div className="stat-block">
          <span className="l">Weight</span>
          <span className="v">{stats.weight}<span className="muted-2" style={{fontSize:11,marginLeft:4}}>lb</span></span>
          <Sparkline data={stats.weightLog} color="var(--accent-2)" height={24}/>
          <div style={{display:'flex',gap:4,marginTop:3}}>
            <input className="input" type="number" placeholder="log lb" value={newWeight}
              onChange={e=>setNewWeight(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')logWeight();}}
              style={{fontSize:11,padding:'3px 6px'}}/>
            <button className="btn ghost" style={{padding:'3px 7px',fontSize:11}} onClick={logWeight}>+</button>
          </div>
        </div>
        <div className="stat-block">
          <span className="l">Steps avg</span>
          <span className="v">{stats.steps.toLocaleString()}</span>
          <Sparkline data={[7400,9800,11200,8200,9100,12000,10100]} color="var(--accent)" height={24} fill={false}/>
        </div>
        <div className="stat-block">
          <span className="l">Sleep avg</span>
          <span className="v">{stats.sleep}</span>
          <Sparkline data={[6.8,7.4,7.1,6.5,7.8,7.2,7.0]} color="var(--info)" height={24} fill={false}/>
        </div>
      </div>
      <div className="section-h"><span>This week</span><span className="line"/></div>
      <div className="habit-week">
        <div></div>
        {days.map((d,i)=><div key={i} className="h-head">{d}</div>)}
        {habits.map((h,i) => (
          <React.Fragment key={i}>
            <div className="h-name">{h.name}</div>
            {h.states.map((s,j) => (
              <div key={j} className={"habit-cell "+(s==="done"?"done":s==="miss"?"miss":"")} onClick={()=>toggleHabit(h.name,j)}>
                {s==="done"&&<Icon name="check" size={10} stroke={2.5}/>}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
      <div className="section-h"><span>Today's program</span><span className="line"/><span className="muted-2 mono" style={{fontSize:10.5}}>PUSH · 52 min</span></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",rowGap:4,columnGap:8,fontSize:12}}>
        {workout.map((r,i)=>(
          <React.Fragment key={i}>
            <span>{r[0]}</span><span className="muted mono">{r[1]}</span><span className="mono">{r[2]}</span>
          </React.Fragment>
        ))}
      </div>
    </Card>
  );
};

// =========================================================
// WORK
// =========================================================
const WorkCard = () => {
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState("");
  const priMap = {high:"P0", normal:"P1", low:"P2"};

  useEffect(() => {
    fetch('/api/work').then(r=>r.json()).then(data => {
      if (data && data.length) {
        setTasks(data.filter(t=>!t.done).map(t=>({
          ...t,
          label: t.title || t.label || '',
          priority: priMap[t.priority] || t.priority || 'P2'
        })));
      }
    }).catch(()=>{});
  }, []);

  const toggle = async (id) => {
    await fetch(`/api/work/${id}/done`,{method:'POST'}).catch(()=>{});
    setTasks(xs => xs.filter(x => x.id !== id));
  };

  const addTask = async (e) => {
    if (e.key !== 'Enter' || !newTask.trim()) return;
    const parts = newTask.match(/P[0-3]/);
    const priority = parts ? parts[0] : "P2";
    const label = newTask.replace(/P[0-3]/,'').trim();
    const res = await fetch('/api/work',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({title:label,priority:priority==='P0'?'high':priority==='P1'?'normal':'low',project:''})}).then(r=>r.json()).catch(()=>({id:Date.now()}));
    setTasks(xs=>[...xs,{id:res.id||Date.now(),label,priority,project:'',done:false}]);
    setNewTask('');
  };

  const pcolor = (p) => p==="P0"?"red":p==="P1"?"amber":p==="P2"?"info":"";

  const byProject = tasks.reduce((acc,t) => {
    const p = t.project||'Other';
    (acc[p] = acc[p]||[]).push(t);
    return acc;
  }, {});

  return (
    <Card num="05" title="Work" span={4}
      right={<><span className="muted mono" style={{fontSize:11}}>{tasks.length} open</span></>}
    >
      {Object.entries(byProject).map(([proj, ptasks]) => (
        <div key={proj} style={{marginBottom:8}}>
          <div className="muted-2 mono" style={{fontSize:10,letterSpacing:'.06em',padding:'4px 0 2px',textTransform:'uppercase'}}>{proj}</div>
          {ptasks.map((t) => (
            <div key={t.id} style={{display:"grid",gridTemplateColumns:"22px 1fr auto",gap:"6px 8px",alignItems:"start",padding:"5px 4px",borderRadius:"var(--r)"}}>
              <Checkbox checked={false} onClick={()=>toggle(t.id)} style={{marginTop:2}}/>
              <div>
                <div style={{fontSize:12.5}}>{t.label||t.title}</div>
                {t.notes && <div className="muted-2 mono" style={{fontSize:10,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.notes}</div>}
              </div>
              <span className={"tag "+pcolor(t.priority)} style={{fontSize:10,marginTop:1}}>{t.priority}</span>
            </div>
          ))}
        </div>
      ))}
      {tasks.length===0 && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 0',textAlign:'center'}}>No open tasks 🎉</div>}
      <div className="row" style={{marginTop:10,gap:6}}>
        <input className="input" placeholder="Add task… (try 'Fix auth bug P1')" value={newTask}
          onChange={e=>setNewTask(e.target.value)} onKeyDown={addTask} style={{fontSize:12}}/>
        <button className="btn primary" onClick={()=>addTask({key:'Enter'})}><Icon name="plus" size={13}/></button>
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
      right={<><span className="tag info">cert track</span><span className="muted mono" style={{fontSize:11}}>{daysOut}d out</span></>}
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
            <div className="muted mono" style={{fontSize:11,marginTop:2}}>exam · {study.exam_date}</div>
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
      if (data && data.current) setReading(data);
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

  const daysOut = Math.round((new Date(next.start+'T12:00:00')-new Date())/86400000);
  const done = (next.checklist||[]).filter(c=>c.done).length;

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
// TALK TO MISSION CONTROL
// =========================================================
const MODULE_LIST = ["agenda","finance","band","health","work","study","reading","holidays","journal"];

const TalkCard = () => {
  const [log, setLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mc_talk_log") || "[]"); }
    catch { return []; }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("mc_talk_log", JSON.stringify(log.slice(-40)));
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [log]);

  const submit = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setLog((l) => [...l, { role: "user", text, ts: Date.now() }]);

    try {
      const res = await fetch('/api/talk', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      const raw = data.reply || "";

      let parsed;
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : null;
      } catch (e) { parsed = null; }

      if (parsed) {
        setLog((l) => [...l, { role: "mc", ...parsed, ts: Date.now() }]);
      } else {
        setLog((l) => [...l, { role: "mc", module: "none", action: "note", summary: "(see reply)", reply: raw.slice(0, 300), ts: Date.now() }]);
      }
    } catch (e) {
      setLog((l) => [...l, { role: "mc", module: "none", action: "note", summary: "offline", reply: "Couldn't reach Mission Control — saved your note locally.", ts: Date.now() }]);
    }
    setBusy(false);
  };

  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } };
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
  const modColor = (m) => ({agenda:"amber",finance:"mint",band:"violet",health:"amber",work:"info",study:"info",reading:"amber",holidays:"info",journal:"mint",none:""}[m]||"");
  const clear = () => { setLog([]); localStorage.removeItem("mc_talk_log"); };

  return (
    <Card num="00" title="Talk to Mission Control" span={12}
      right={<>
        <span className="ai-chip"><Icon name="sparkles" size={11}/>claude</span>
        <span className="muted mono" style={{fontSize:11}}>{log.length} captured</span>
        {log.length > 0 && <button className="btn ghost" onClick={clear} style={{padding:"3px 8px",fontSize:11}}>clear</button>}
      </>}
      bodyClass="flush"
    >
      <div className="talk-grid">
        <div style={{padding:14,borderRight:"1px solid var(--line-soft)",display:"flex",flexDirection:"column",gap:10}}>
          <div className="serif" style={{fontSize:15,color:"var(--ink-2)",fontStyle:"italic"}}>
            Talk to me. I'll route it to the right module and log it here.
          </div>
          <textarea className="input" rows="3"
            placeholder={"e.g. 'spent $42 at trader joes' · 'gig at George's June 25' · 'finished chapter 7' · 'bench PR 175'"}
            value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={onKey}
            style={{resize:"vertical",fontFamily:"var(--font-sans)",fontSize:13}}
          />
          <div className="row" style={{justifyContent:"space-between",flexWrap:'wrap',gap:6}}>
            <div className="row" style={{gap:6,flexWrap:"wrap"}}>
              {["Spent $14 at Trader Joe's","Bench PR today — 175×6","Gig at Smith's Jun 21","Log 30min CISM study"].map((s,i)=>(
                <span key={i} className="tag" style={{cursor:"pointer"}} onClick={()=>setInput(s)}>{s}</span>
              ))}
            </div>
            <button className="btn primary" onClick={submit} disabled={busy}>
              {busy?<><Icon name="circle" size={12}/>thinking…</>:<><Icon name="send" size={12}/>Send</>}
            </button>
          </div>
          <div className="muted-2 mono" style={{fontSize:10.5}}>⏎ to send · shift+⏎ for newline</div>
        </div>
        <div ref={listRef} style={{padding:14,maxHeight:280,overflowY:"auto",display:"flex",flexDirection:"column",gap:8}}>
          {log.length===0 && (
            <div className="muted-2 mono" style={{fontSize:11,textAlign:"center",padding:"28px 0"}}>— nothing captured yet —</div>
          )}
          {log.map((e,i)=>(
            e.role==="user"?(
              <div key={i} style={{alignSelf:"flex-end",maxWidth:"85%",background:"var(--surface-2)",border:"1px solid var(--line)",borderRadius:6,padding:"6px 10px",fontSize:12.5}}>
                <div>{e.text}</div>
                <div className="muted-2 mono" style={{fontSize:10,marginTop:2,textAlign:"right"}}>{fmtTime(e.ts)}</div>
              </div>
            ):(
              <div key={i} style={{alignSelf:"flex-start",maxWidth:"92%"}}>
                <div className="row" style={{gap:6,marginBottom:3}}>
                  {e.module&&e.module!=="none"&&<span className={"tag "+modColor(e.module)}>→ {e.module}</span>}
                  {e.action&&<span className="muted-2 mono" style={{fontSize:10.5}}>{e.action}</span>}
                </div>
                {e.summary&&(
                  <div style={{background:"color-mix(in oklch,var(--accent) 8%,var(--surface-2))",border:"1px solid color-mix(in oklch,var(--accent) 25%,var(--line))",borderRadius:6,padding:"5px 9px",fontFamily:"var(--font-mono)",fontSize:11.5,color:"var(--ink)",marginBottom:4}}>
                    + {e.summary}
                  </div>
                )}
                {e.reply&&<div className="serif" style={{fontSize:13,color:"var(--ink-2)",fontStyle:"italic"}}>{e.reply}</div>}
                <div className="muted-2 mono" style={{fontSize:10,marginTop:2}}>{fmtTime(e.ts)}</div>
              </div>
            )
          ))}
        </div>
      </div>
    </Card>
  );
};

window.MissionModules = {
  TalkCard, AgendaCard, FinanceCard, BandCard, HealthCard, WorkCard,
  StudyCard, ReadingCard, HolidayCard, JournalCard
};
