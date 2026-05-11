/* Mission Control — module cards — wired to Flask API */
const { useState, useMemo, useEffect, useRef } = React;

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
const AgendaCard = () => {
  const defaultItems = [
    { id: 1, time: "09:00", label: "Check ASR policies audit status", tag: "Work", color: "info", done: false },
    { id: 2, time: "10:00", label: "Ian MFA on Rightworks — follow up", tag: "IT", color: "info", done: false },
    { id: 3, time: "12:30", label: "Log lunch → target deficit -400", tag: "Calories", color: "mint", done: false },
    { id: 4, time: "19:30", label: "Read — Project Hail Mary", tag: "Reading", color: "amber", done: false },
    { id: 5, time: "21:30", label: "Journal — what worked today", tag: "Journal", color: "mint", done: false },
  ];
  const [items, setItems] = useState(defaultItems);
  const [calories, setCalories] = useState({ target: 2200, consumed: 0, burned: 0 });
  const [macros, setMacros] = useState([
    { l: "Protein", v: 0, g: 165, c: "var(--accent-2)" },
    { l: "Carbs",   v: 0, g: 220, c: "var(--accent)" },
    { l: "Fat",     v: 0, g: 70,  c: "var(--info)" },
  ]);

  useEffect(() => {
    fetch('/api/agenda').then(r => r.json()).then(data => {
      if (data && data.length) setItems(data);
    }).catch(() => {});
    fetch('/api/health').then(r => r.json()).then(data => {
      const today = new Date().toISOString().slice(0, 10);
      if (data.calories && data.calories[today]) {
        setCalories(c => ({ ...c, ...data.calories[today] }));
      }
      if (data.calories_target) setCalories(c => ({ ...c, target: data.calories_target }));
    }).catch(() => {});
  }, []);

  const toggle = (id) => {
    setItems(xs => xs.map(x => x.id === id ? { ...x, done: !x.done } : x));
    fetch(`/api/agenda/${id}/toggle`, { method: 'POST' }).catch(() => {});
  };

  const doneCount = items.filter(i => i.done).length;
  const calNet = calories.consumed - calories.burned;
  const calLeft = calories.target - calNet;
  const morning = items.slice(0, Math.ceil(items.length / 2));
  const afternoon = items.slice(Math.ceil(items.length / 2));

  return (
    <Card num="01" title={`Today — ${new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}`} span={12}
      right={<>
        <span className="mono muted-2" style={{ fontSize: 11 }}>{doneCount}/{items.length}</span>
        <div className="progress" style={{ width: 80, marginLeft: 6 }}>
          <div className="bar" style={{ width: `${items.length ? (doneCount/items.length)*100 : 0}%` }} />
        </div>
        <button className="btn" onClick={async () => {
          const label = prompt("Add agenda item:");
          if (!label) return;
          const time = prompt("Time (HH:MM):", "09:00") || "09:00";
          const res = await fetch('/api/agenda', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({label, time, tag: "Personal", color: "mint"}) });
          const d = await res.json();
          setItems(xs => [...xs, { id: d.id, time, label, tag: "Personal", color: "mint", done: false }]);
        }}><Icon name="plus" size={13}/>Quick add</button>
      </>}
      bodyClass="flush"
    >
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.1fr 1fr", gap: 0 }}>
        <div style={{ padding: "10px 14px", borderRight: "1px solid var(--line-soft)" }}>
          <div className="muted-2 mono" style={{ fontSize: 10.5, letterSpacing: ".08em", padding: "0 4px 6px" }}>MORNING</div>
          {morning.map((it) => (
            <div key={it.id} className={"agenda-row" + (it.done ? " done" : "")}>
              <span className="agenda-time">{it.time}</span>
              <Checkbox checked={it.done} onClick={() => toggle(it.id)} />
              <span className="agenda-label">{it.label}</span>
              <span className={"tag " + it.color}>{it.tag}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "10px 14px", borderRight: "1px solid var(--line-soft)" }}>
          <div className="muted-2 mono" style={{ fontSize: 10.5, letterSpacing: ".08em", padding: "0 4px 6px" }}>AFTERNOON · EVENING</div>
          {afternoon.map((it) => (
            <div key={it.id} className={"agenda-row" + (it.done ? " done" : "")}>
              <span className="agenda-time">{it.time}</span>
              <Checkbox checked={it.done} onClick={() => toggle(it.id)} />
              <span className="agenda-label">{it.label}</span>
              <span className={"tag " + it.color}>{it.tag}</span>
            </div>
          ))}
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
    { name: "Housing",       budget: 1000, actual: 0,  color: "var(--info)" },
    { name: "Utilities",     budget: 448,  actual: 0,  color: "var(--violet)" },
    { name: "Subscriptions", budget: 121,  actual: 0,  color: "var(--accent-2)" },
    { name: "Food / Grocer", budget: 400,  actual: 0,  color: "var(--accent)" },
    { name: "Gas",           budget: 300,  actual: 0,  color: "oklch(0.7 0.13 200)" },
    { name: "Fun",           budget: 600,  actual: 0,  color: "var(--danger)" },
    { name: "Loans",         budget: 500,  actual: 0,  color: "oklch(0.65 0.10 30)" },
  ];
  const defaultSubs = [
    { name: "Realms Minecraft", acct: "Capitol One",   amt: 3.99,  due: "2nd" },
    { name: "Hatch",            acct: "Sofi Checking", amt: 8.77,  due: "3rd" },
    { name: "Rocket Money",     acct: "Sofi Checking", amt: 6.00,  due: "5th" },
    { name: "Google Cloud",     acct: "Sofi Savings",  amt: 2.43,  due: "5th" },
    { name: "Hulu",             acct: "Sofi Checking", amt: 20.84, due: "8th" },
    { name: "MSI Renters Ins.", acct: "Sofi Checking", amt: 24.59, due: "10th" },
    { name: "Apple Music",      acct: "Sofi Checking", amt: 12.06, due: "23rd" },
    { name: "Planet Fitness",   acct: "Sofi Savings",  amt: 27.49, due: "17th" },
  ];

  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [txns, setTxns] = useState([]);
  const [savings, setSavings] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [desc, setDesc] = useState(""); const [amt, setAmt] = useState(""); const [type, setType] = useState("expense"); const [cat, setCat] = useState("personal");

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

  const totalIn  = txns.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount, 0);
  const totalEx  = txns.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount), 0);
  const net = totalIn - totalEx;
  const totalBudget = defaultCategories.reduce((s,c)=>s+c.budget,0);
  const [my, mm] = month.split('-');
  const monthLabel = MONTH_NAMES[parseInt(mm)-1] + ' ' + my;

  // Build category actuals from txns
  const catMap = { personal: "Fun", IT: "Housing", band: "Fun", coding: "Fun" };
  const categories = defaultCategories.map(c => ({
    ...c,
    actual: txns.filter(t=>t.amount<0).filter(t => (catMap[t.cat]||t.cat) === c.name).reduce((s,t)=>s+Math.abs(t.amount),0)
  }));

  const acctMap = {};
  savings.forEach(s => { if (!acctMap[s.account] || s.date > acctMap[s.account].date) acctMap[s.account] = s; });
  const pending = txns.filter(t=>t.pending).length;

  return (
    <Card num="02" title={`Finance — ${monthLabel}`} span={8}
      right={<>
        {pending > 0 && <span className="ai-chip"><Icon name="sparkles" size={11}/>{pending} uncategorized</span>}
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          <button className="btn" style={{padding:'4px 8px'}} onClick={()=>changeMonth(-1)}>‹</button>
          <button className="btn" style={{padding:'4px 8px'}} onClick={()=>changeMonth(1)}>›</button>
        </div>
        <button className="btn primary" onClick={() => setShowAdd(s=>!s)}><Icon name="plus" size={13}/>Add expense</button>
      </>}
    >
      {showAdd && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'flex-end', padding:'0 0 12px', borderBottom:'1px solid var(--line-soft)', marginBottom:12 }}>
          <input className="input" placeholder="Description" value={desc} onChange={e=>setDesc(e.target.value)} style={{flex:2,minWidth:140}} />
          <input className="input" placeholder="Amount" type="number" value={amt} onChange={e=>setAmt(e.target.value)} style={{width:90}} />
          <select className="input" value={type} onChange={e=>setType(e.target.value)} style={{width:100}}>
            <option value="expense">Expense</option><option value="income">Income</option>
          </select>
          <select className="input" value={cat} onChange={e=>setCat(e.target.value)} style={{width:100}}>
            <option value="personal">Personal</option><option value="IT">IT/GLS</option>
            <option value="band">Band</option><option value="coding">Freelance</option>
          </select>
          <button className="btn primary" onClick={logExpense}>LOG</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr) auto", gap: 14, alignItems: "center" }}>
        <div className="stat-block"><span className="l">Income</span><span className="v serif" style={{color:"var(--accent-2)"}}>{fmtMoney(totalIn,{cents:false})}</span></div>
        <div className="stat-block"><span className="l">Spent</span><span className="v serif">{fmtMoney(totalEx,{cents:false})}</span></div>
        <div className="stat-block"><span className="l">Budget</span><span className="v serif muted">{fmtMoney(totalBudget,{cents:false})}</span></div>
        <div className="stat-block"><span className="l">Net / Savings</span><span className="v serif" style={{color:net>=0?"var(--accent)":"var(--danger)"}}>{fmtMoney(net,{cents:false})}</span></div>
        <div style={{width:120}}><Sparkline data={[3950,4200,4080,4300,4150,4307]}/></div>
      </div>

      <div className="section-h"><span>Budget vs Actual</span><span className="line"/><span className="muted-2">{Math.round((totalEx/totalBudget)*100)}% of budget</span></div>
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

      <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr", gap:18, marginTop:14 }}>
        <div>
          <div className="section-h"><span>Recent Transactions</span><span className="line"/></div>
          {txns.length === 0 && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 0'}}>No transactions this month.</div>}
          {[...txns].slice(0,8).map((t,i) => (
            <div key={i} className="txn">
              <span className="cat-dot" style={{background:t.amount>0?"var(--accent-2)":"var(--ink-4)"}}/>
              <div><div className="merchant">{t.merchant}</div><div className="meta">{t.date} · {t.cat}</div></div>
              <span className="amount" style={{color:t.amount>0?"var(--accent-2)":"var(--ink)"}}>
                {t.amount>0?"+":""}{fmtMoney(Math.abs(t.amount))}
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
          <div className="section-h" style={{marginTop:12}}><span>Subscriptions</span><span className="line"/><span className="muted-2 num">{fmtMoney(defaultSubs.reduce((s,c)=>s+c.amt,0))}/mo</span></div>
          {defaultSubs.map((s,i) => (
            <div key={i} className="txn" style={{gridTemplateColumns:"1fr auto",padding:"5px 4px"}}>
              <div><div className="merchant">{s.name}</div><div className="meta">{s.acct} · due {s.due}</div></div>
              <span className="amount muted">{fmtMoney(s.amt)}</span>
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
const BandCard = () => {
  const [gigs, setGigs] = useState([]);
  const [contacts, setContacts] = useState([
    { name: "Marcus Kellan",  venue: "Sound Bar",      last: "—", overdue: false, status: "responded" },
    { name: "J. Pham",        venue: "Eddie's Attic",  last: "—", overdue: true,  status: "follow up" },
    { name: "Sarah at WUOG",  venue: "Radio",          last: "—", overdue: true,  status: "EPK sent" },
  ]);
  const [postText, setPostText] = useState("Friday show at Georges Majestic 🎸 doors 8, we go on at 9:30.");
  const [pushing, setPushing] = useState(false);
  const [contentQueue, setContentQueue] = useState([]);
  const [newIdea, setNewIdea] = useState("");

  useEffect(() => {
    fetch('/api/shows').then(r=>r.json()).then(data => {
      const today = new Date();
      const upcoming = data
        .filter(s => new Date(s.date+'T12:00:00') >= today)
        .sort((a,b) => new Date(a.date)-new Date(b.date));
      setGigs(upcoming.map(s => ({
        venue: s.venue, city: s.city,
        date: new Date(s.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),
        days: Math.round((new Date(s.date+'T12:00:00')-today)/86400000),
        status: 'confirmed', pay: null, notes: s.notes
      })));
    }).catch(()=>{});
    fetch('/api/band/content').then(r=>r.json()).then(data => {
      setContentQueue(data.filter(c=>c.status!=='done'));
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

  const nextGig = gigs[0];

  return (
    <Card num="03" title="Band — Coming Up Aces" span={4}
      right={<>
        <span className="tag violet">{gigs.length} gigs</span>
        <button className="btn primary" onClick={pushSite} disabled={pushing}>{pushing?'pushing…':'Push live'}</button>
      </>}
    >
      <div className="section-h"><span>Next Gig</span><span className="line"/></div>
      {nextGig ? (
        <div style={{
          background:"linear-gradient(135deg,color-mix(in oklch,var(--violet) 14%,var(--surface-2)),var(--surface-2))",
          border:"1px solid color-mix(in oklch,var(--violet) 30%,var(--line))",
          borderRadius:"var(--r)",padding:12,display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center"
        }}>
          <div>
            <div className="serif" style={{fontSize:18,lineHeight:1.15}}>{nextGig.venue}</div>
            <div className="muted mono" style={{fontSize:11}}>{nextGig.city} · {nextGig.date}</div>
            <div className="row" style={{marginTop:6}}>
              <span className="tag mint">confirmed</span>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="mono" style={{fontSize:26,fontWeight:500}}>{Math.max(0,nextGig.days)}</div>
            <div className="muted-2 mono" style={{fontSize:10,letterSpacing:".08em"}}>DAYS</div>
          </div>
        </div>
      ) : (
        <div className="muted mono" style={{fontSize:11,padding:'8px 0'}}>No upcoming shows. Add one in the app.</div>
      )}

      <div className="section-h"><span>Schedule</span><span className="line"/><a href="https://comingupaces.net" target="_blank" className="muted-2" style={{cursor:"pointer",fontSize:10.5}}>comingupaces.net →</a></div>
      {gigs.slice(1,4).map((g,i) => (
        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto",padding:"6px 0",borderBottom:"1px solid var(--line-soft)"}}>
          <div>
            <div style={{fontSize:12.5}}>{g.venue}</div>
            <div className="muted mono" style={{fontSize:10.5}}>{g.city} · {g.date}</div>
          </div>
          <span className="tag mint">{g.status}</span>
        </div>
      ))}

      <div className="section-h"><span>IG Draft</span><span className="line"/></div>
      <div style={{display:"grid",gridTemplateColumns:"90px 1fr",gap:10}}>
        <div className="ig-frame"><span>photo · 4:5</span></div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <textarea className="input" rows="3" value={postText} onChange={(e)=>setPostText(e.target.value)}/>
          <div className="row" style={{justifyContent:"flex-end"}}>
            <button className="btn primary"><Icon name="send" size={12}/>Schedule</button>
          </div>
        </div>
      </div>

      <div className="section-h"><span>Content Queue</span><span className="line"/></div>
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <input className="input" placeholder="Add content idea..." value={newIdea} onChange={e=>setNewIdea(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')addIdea();}} style={{flex:1}}/>
        <button className="btn" onClick={addIdea}>+</button>
      </div>
      {contentQueue.slice(0,4).map((c,i) => (
        <div key={i} style={{padding:"5px 0",borderBottom:"1px solid var(--line-soft)",fontSize:12.5}}>{c.title}</div>
      ))}

      <div className="section-h"><span>Follow up</span><span className="line"/><span className="muted-2 num">{contacts.filter(c=>c.overdue).length} overdue</span></div>
      {contacts.map((c,i) => (
        <div key={i} className="row" style={{padding:"6px 0",borderBottom:"1px solid var(--line-soft)"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12.5}}>{c.name}</div>
            <div className="muted mono" style={{fontSize:10.5}}>{c.venue} · last {c.last}</div>
          </div>
          <span className={"tag "+(c.overdue?"red":c.status==="responded"?"mint":"")}>{c.status}</span>
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
    const dayNames = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    await fetch('/api/health/habit', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ habit: habitName, day: dayNames[dayIdx] }) }).catch(()=>{});
    setHabits(hs => hs.map(h => h.name === habitName
      ? { ...h, states: h.states.map((s,i) => i===dayIdx ? (s==="done"?"miss":"done") : s) }
      : h));
  };

  const workout = [
    ["Bench press","4 × 8","165 lb"],["Incline DB press","3 × 10","55 lb"],
    ["Cable fly","3 × 12","30 lb"],["Overhead tri ext","3 × 12","60 lb"],
  ];

  return (
    <Card num="04" title="Health & Fitness" span={4}
      right={<><span className="tag mint">active</span><button className="icon-btn"><Icon name="more" size={14}/></button></>}
    >
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
        <div className="stat-block">
          <span className="l">Weight</span>
          <span className="v">{stats.weight}<span className="muted-2" style={{fontSize:11,marginLeft:4}}>lb</span></span>
          <Sparkline data={stats.weightLog} color="var(--accent-2)" height={24}/>
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
  const [tasks, setTasks] = useState([
    { id:1, label:"ASR policies audit → block", project:"IT Security", priority:"P0", done:false },
    { id:2, label:"Ian MFA on Rightworks", project:"IT", priority:"P0", done:false },
    { id:3, label:"Ceej renewal", project:"IT/GLS", priority:"P1", done:false },
  ]);
  const [newTask, setNewTask] = useState("");

  useEffect(() => {
    fetch('/api/work').then(r=>r.json()).then(data => {
      if (data && data.length) setTasks(data);
    }).catch(()=>{});
  }, []);

  const toggle = async (id) => {
    await fetch(`/api/work/${id}/done`,{method:'POST'}).catch(()=>{});
    setTasks(xs=>xs.map((x)=>x.id===id?{...x,done:!x.done}:x));
  };

  const addTask = async (e) => {
    if (e.key !== 'Enter' || !newTask.trim()) return;
    const parts = newTask.match(/P[0-3]/);
    const priority = parts ? parts[0] : "P2";
    const label = newTask.replace(/P[0-3]/,'').trim();
    const res = await fetch('/api/work',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({label,priority,project:''})}).then(r=>r.json()).catch(()=>({id:Date.now()}));
    setTasks(xs=>[...xs,{id:res.id||Date.now(),label,priority,project:'',done:false}]);
    setNewTask('');
  };

  const pcolor = (p) => p==="P0"?"red":p==="P1"?"amber":p==="P2"?"info":"";

  return (
    <Card num="05" title="Work" span={4}
      right={<><span className="muted mono" style={{fontSize:11}}>{tasks.filter(t=>!t.done).length} open</span></>}
    >
      {tasks.map((t,i) => (
        <div key={t.id} className={"agenda-row"+(t.done?" done":"")} style={{gridTemplateColumns:"22px 1fr auto auto",padding:"5px 4px"}}>
          <Checkbox checked={t.done} onClick={()=>toggle(t.id)}/>
          <span className="agenda-label">{t.label}</span>
          <span className="muted mono" style={{fontSize:10.5}}>{t.project}</span>
          <span className={"tag "+pcolor(t.priority)}>{t.priority}</span>
        </div>
      ))}
      <div className="row" style={{marginTop:10,gap:6}}>
        <input className="input" placeholder="Add task… (try 'Fix auth bug P1')" value={newTask}
          onChange={e=>setNewTask(e.target.value)} onKeyDown={addTask}/>
        <button className="btn primary" onClick={()=>addTask({key:'Enter'})}><Icon name="plus" size={13}/></button>
      </div>
    </Card>
  );
};

// =========================================================
// STUDYING — CISM
// =========================================================
const StudyCard = () => {
  const [study, setStudy] = useState({
    cert:"CISM", exam_date:"2026-08-16",
    domains:[
      {id:1,name:"1. Info Security Governance",     pct:78,weight:17},
      {id:2,name:"2. Risk Management",              pct:64,weight:20},
      {id:3,name:"3. Security Program Dev. & Mgmt", pct:41,weight:33},
      {id:4,name:"4. Incident Mgmt & Response",     pct:22,weight:30},
    ],
    practice_scores:[54,58,61,59,67,72]
  });

  useEffect(() => {
    fetch('/api/study').then(r=>r.json()).then(data => {
      if (data && data.domains) setStudy(data);
    }).catch(()=>{});
  }, []);

  const daysOut = study.exam_date ? Math.round((new Date(study.exam_date)-new Date())/86400000) : 0;
  const avgPct = study.domains.reduce((s,d)=>s+(d.pct*(d.weight/100)),0);
  const lastScore = study.practice_scores.slice(-1)[0] || 0;

  return (
    <Card num="06" title={`Studying — ${study.cert}`} span={4}
      right={<><span className="tag info">cert track</span><span className="muted mono" style={{fontSize:11}}>{daysOut}d to exam</span></>}
    >
      <div style={{
        background:"linear-gradient(135deg,color-mix(in oklch,var(--info) 14%,var(--surface-2)),var(--surface-2))",
        border:"1px solid color-mix(in oklch,var(--info) 30%,var(--line))",
        borderRadius:"var(--r)",padding:12,marginBottom:12
      }}>
        <div className="row" style={{justifyContent:"space-between"}}>
          <div>
            <div className="muted-2 mono" style={{fontSize:10.5,letterSpacing:".08em"}}>ISACA · {study.cert}</div>
            <div className="serif" style={{fontSize:17,lineHeight:1.15}}>Certified Info Security Manager</div>
            <div className="muted mono" style={{fontSize:11,marginTop:2}}>exam · {study.exam_date} · Prometric</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="mono" style={{fontSize:24,fontWeight:500}}>{Math.round(avgPct)}%</div>
            <div className="muted-2 mono" style={{fontSize:10,letterSpacing:".08em"}}>READY</div>
          </div>
        </div>
        <div className="progress" style={{marginTop:8}}><div className="bar info" style={{width:avgPct+"%"}}/></div>
      </div>

      <div className="section-h"><span>Domains</span><span className="line"/><span className="muted-2 mono" style={{fontSize:10.5}}>weight %</span></div>
      {study.domains.map((d) => (
        <div key={d.id} style={{padding:"5px 0",borderBottom:"1px solid var(--line-soft)"}}>
          <div className="row" style={{justifyContent:"space-between"}}>
            <span style={{fontSize:12.5}}>{d.name}</span>
            <span className="mono" style={{fontSize:11,color:"var(--ink-2)"}}>{d.pct}% <span className="muted-2">· {d.weight}%</span></span>
          </div>
          <div className="progress" style={{marginTop:4,height:4}}>
            <div className="bar info" style={{width:d.pct+"%",background:d.pct>60?"var(--accent-2)":d.pct>35?"var(--accent)":"var(--danger)"}}/>
          </div>
        </div>
      ))}

      <div className="section-h"><span>Practice exam trend</span><span className="line"/><span className="mono muted" style={{fontSize:10.5}}>last {study.practice_scores.length} attempts</span></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center"}}>
        <Sparkline data={study.practice_scores} color="var(--info)" height={32}/>
        <span className="mono" style={{fontSize:14,color:"var(--accent-2)"}}>{lastScore}%</span>
      </div>
      <div className="muted-2 mono" style={{fontSize:10.5,marginTop:4}}>target to schedule: 80%+ on 3 consecutive</div>
    </Card>
  );
};

// =========================================================
// READING
// =========================================================
const ReadingCard = () => {
  const [reading, setReading] = useState({
    current:{ title:"Project Hail Mary", author:"Andy Weir", page:284, total_pages:476, started:"2026-04-22" },
    queue:[
      {title:"The Creative Act",author:"Rick Rubin"},
      {title:"How to Take Smart Notes",author:"S. Ahrens"},
      {title:"Slow Productivity",author:"Cal Newport"},
    ],
    completed_2026:18, goal_2026:30
  });

  useEffect(() => {
    fetch('/api/reading').then(r=>r.json()).then(data => {
      if (data && data.current) setReading(data);
    }).catch(()=>{});
  }, []);

  const updatePage = async () => {
    const p = prompt("Current page:", reading.current.page);
    if (!p) return;
    const page = parseInt(p);
    await fetch('/api/reading/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page})}).catch(()=>{});
    setReading(r=>({...r, current:{...r.current,page}}));
  };

  const pct = reading.current ? Math.round((reading.current.page/reading.current.total_pages)*100) : 0;

  return (
    <Card num="07" title="Reading" span={4}
      right={<span className="muted mono" style={{fontSize:11}}>{reading.completed_2026} / {reading.goal_2026} books · {new Date().getFullYear()}</span>}
    >
      {reading.current && (
        <div style={{display:"grid",gridTemplateColumns:"78px 1fr",gap:14}}>
          <div className="media-cover" style={{background:"linear-gradient(160deg,oklch(0.5 0.12 60),oklch(0.3 0.05 60))",color:"#fff"}}>
            {reading.current.title}
          </div>
          <div>
            <div className="muted-2 mono" style={{fontSize:10.5,letterSpacing:".08em"}}>NOW READING</div>
            <div className="serif" style={{fontSize:17,lineHeight:1.15,marginTop:2}}>{reading.current.title}</div>
            <div className="muted" style={{fontSize:12}}>{reading.current.author} · p. {reading.current.page} / {reading.current.total_pages}</div>
            <div className="progress" style={{marginTop:8}}><div className="bar amber" style={{width:pct+"%"}}/></div>
            <div className="row" style={{marginTop:6,justifyContent:"space-between"}}>
              <span className="muted mono" style={{fontSize:10.5}}>{pct}% complete</span>
              <button className="btn" style={{padding:"3px 8px",fontSize:11}} onClick={updatePage}>Update page</button>
            </div>
          </div>
        </div>
      )}
      <div className="section-h"><span>Up next</span><span className="line"/></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
        {reading.queue.slice(0,3).map((b,i) => (
          <div key={i}>
            <div className="media-cover" style={{background:[
              "linear-gradient(160deg,oklch(0.4 0.10 30),oklch(0.25 0.05 30))",
              "linear-gradient(160deg,oklch(0.45 0.10 160),oklch(0.28 0.05 160))",
              "linear-gradient(160deg,oklch(0.42 0.10 290),oklch(0.26 0.05 290))"
            ][i],color:"#fff"}}>{b.title}</div>
            <div className="muted mono" style={{fontSize:10.5,marginTop:4}}>{b.author}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

// =========================================================
// GAMING
// =========================================================
const GamingCard = () => {
  const [gaming, setGaming] = useState({
    playing:[
      {title:"Elden Ring: SotE",hours:32,pct:64,color:"oklch(0.5 0.12 60)"},
      {title:"Balatro",hours:12,pct:40,color:"oklch(0.45 0.13 0)"},
    ],
    backlog:[
      {title:"Hades II",tag:"next up"},
      {title:"Outer Wilds",tag:"wishlist"},
      {title:"Hollow Knight: Silksong",tag:"wishlist"},
      {title:"Tunic",tag:"owned"},
    ],
    hours_this_week:11
  });

  useEffect(() => {
    fetch('/api/gaming').then(r=>r.json()).then(data => {
      if (data && data.playing) setGaming(data);
    }).catch(()=>{});
  }, []);

  return (
    <Card num="08" title="Gaming" span={4}
      right={<span className="muted mono" style={{fontSize:11}}>{gaming.hours_this_week}h this week</span>}
    >
      <div className="section-h"><span>Playing</span><span className="line"/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {gaming.playing.map((g,i)=>(
          <div key={i} style={{padding:10,borderRadius:6,background:g.color,color:"#fff",display:"flex",flexDirection:"column",justifyContent:"space-between",minHeight:90}}>
            <div className="serif" style={{fontSize:14,lineHeight:1.1}}>{g.title}</div>
            <div>
              <div className="progress" style={{background:"rgba(0,0,0,0.3)",marginBottom:4}}>
                <div className="bar" style={{width:g.pct+"%",background:"rgba(255,255,255,0.85)"}}/>
              </div>
              <div className="mono" style={{fontSize:10.5,opacity:0.85}}>{g.hours}h · {g.pct}%</div>
            </div>
          </div>
        ))}
      </div>
      <div className="section-h"><span>Backlog · {gaming.backlog.length}</span><span className="line"/></div>
      {gaming.backlog.map((b,i)=>(
        <div key={i} className="row" style={{padding:"5px 0",borderBottom:"1px solid var(--line-soft)"}}>
          <span style={{flex:1,fontSize:12.5}}>{b.title}</span>
          <span className={"tag "+(b.tag==="next up"?"amber":b.tag==="owned"?"info":"")}>{b.tag}</span>
        </div>
      ))}
    </Card>
  );
};

// =========================================================
// HOLIDAYS
// =========================================================
const HolidayCard = () => {
  const defaultTrip = {
    id:1, name:"Rocky Mountain NP", location:"Estes Park, CO",
    start:"2026-06-22", end:"2026-06-29", budget:1420,
    checklist:[
      {text:"Book flights ATL → DEN",done:true},
      {text:"Reserve cabin (Estes Park)",done:true},
      {text:"Rent gear — boots, poles",done:false},
      {text:"Time off approved",done:true},
      {text:"Set vacation autoresponder",done:false},
      {text:"Park reservations (RMNP)",done:false},
    ]
  };
  const [trips, setTrips] = useState([defaultTrip]);

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

  const next = trips.find(t => new Date(t.start) > new Date()) || trips[0];
  if (!next) return null;
  const daysOut = Math.round((new Date(next.start)-new Date())/86400000);
  const done = next.checklist.filter(c=>c.done).length;

  return (
    <Card num="09" title="Holidays / Travel" span={4}
      right={<span className="muted mono" style={{fontSize:11}}>{trips.length} trip{trips.length!==1?"s":""} planned</span>}
    >
      <div style={{position:"relative",padding:14,borderRadius:6,overflow:"hidden",
        background:"linear-gradient(135deg,oklch(0.32 0.06 220),oklch(0.22 0.04 220))",color:"#fff",marginBottom:12}}>
        <div style={{position:"absolute",inset:0,opacity:0.12,background:"repeating-linear-gradient(45deg,#fff 0 1px,transparent 1px 14px)"}}/>
        <div style={{position:"relative"}}>
          <div className="mono" style={{fontSize:10.5,opacity:0.7,letterSpacing:".08em"}}>NEXT TRIP</div>
          <div className="serif" style={{fontSize:22,lineHeight:1.1,marginTop:4}}>{next.name}</div>
          <div className="mono" style={{fontSize:11,opacity:0.8,marginTop:2}}>{next.start} – {next.end} · {next.location}</div>
          <div className="row" style={{marginTop:12,gap:16}}>
            <div><div className="serif" style={{fontSize:28,lineHeight:1}}>{daysOut}</div><div className="mono" style={{fontSize:9.5,opacity:0.7,letterSpacing:".08em"}}>DAYS OUT</div></div>
            <div style={{width:1,alignSelf:"stretch",background:"rgba(255,255,255,0.25)"}}/>
            <div><div className="mono" style={{fontSize:14}}>${next.budget.toLocaleString()}</div><div className="mono" style={{fontSize:9.5,opacity:0.7,letterSpacing:".08em"}}>BUDGET</div></div>
            <div style={{width:1,alignSelf:"stretch",background:"rgba(255,255,255,0.25)"}}/>
            <div><div className="mono" style={{fontSize:14}}>{done}/{next.checklist.length}</div><div className="mono" style={{fontSize:9.5,opacity:0.7,letterSpacing:".08em"}}>CHECKLIST</div></div>
          </div>
        </div>
      </div>
      <div className="section-h"><span>To do</span><span className="line"/></div>
      {next.checklist.map((c,i)=>(
        <div key={i} className="row" style={{padding:"5px 0",cursor:"pointer"}} onClick={()=>toggleCheck(next.id,i)}>
          <Checkbox checked={c.done}/>
          <span style={{flex:1,color:c.done?"var(--ink-3)":"var(--ink)",textDecoration:c.done?"line-through":"none",fontSize:12.5}}>{c.text}</span>
        </div>
      ))}
    </Card>
  );
};

// =========================================================
// JOURNAL
// =========================================================
const JournalCard = () => {
  const [text, setText] = useState("");
  const [entries, setEntries] = useState([
    {id:1,date:"2026-05-09",text:"Practice felt sharp. Tighten the bridge on 'Maybe Later' before Friday."},
    {id:2,date:"2026-05-08",text:"Bench PR. Sleep is paying off. Don't skip the warm-up on incline."},
    {id:3,date:"2026-05-07",text:"Spent too long on the deploy. Pair next time — Sam was free."},
  ]);
  const [saving, setSaving] = useState(false);
  const [prompt_text, setPromptText] = useState("What's one thing that worked today — and why?");
  const prompts = [
    "What's one thing that worked today — and why?",
    "What's the next step on your biggest goal?",
    "Who showed up for you today?",
    "What did you learn that surprised you?",
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
    await fetch('/api/journal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}).catch(()=>{});
    const today = new Date().toISOString().slice(0,10);
    setEntries(es=>[{id:Date.now(),date:today,text},...es.filter(e=>e.date!==today).slice(0,4)]);
    setText('');
    setSaving(false);
  };

  const streak = entries.length; // Simplified streak

  return (
    <Card num="10" title="Journal" span={4}
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
      {entries.map((e,i)=>(
        <div key={e.id||i} style={{padding:"6px 0",borderBottom:"1px solid var(--line-soft)"}}>
          <div className="muted mono" style={{fontSize:10.5}}>{e.date}</div>
          <div className="serif" style={{fontSize:12.5,color:"var(--ink-2)"}}>{e.text.slice(0,120)}{e.text.length>120?"…":""}</div>
        </div>
      ))}
    </Card>
  );
};

// =========================================================
// TALK TO MISSION CONTROL
// =========================================================
const MODULE_LIST = ["agenda","finance","band","health","work","study","reading","gaming","holidays","journal"];

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
  const modColor = (m) => ({agenda:"amber",finance:"mint",band:"violet",health:"amber",work:"info",study:"info",reading:"amber",gaming:"",holidays:"info",journal:"mint",none:""}[m]||"");
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
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0}}>
        <div style={{padding:14,borderRight:"1px solid var(--line-soft)",display:"flex",flexDirection:"column",gap:10}}>
          <div className="serif" style={{fontSize:15,color:"var(--ink-2)",fontStyle:"italic"}}>
            Talk to me. I'll route it to the right module and log it here.
          </div>
          <textarea className="input" rows="3"
            placeholder={"e.g. 'spent $42 at trader joes' · 'gig at George's June 25' · 'finished chapter 7' · 'bench PR 175'"}
            value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={onKey}
            style={{resize:"vertical",fontFamily:"var(--font-sans)",fontSize:13}}
          />
          <div className="row" style={{justifyContent:"space-between"}}>
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
  StudyCard, ReadingCard, GamingCard, HolidayCard, JournalCard
};
