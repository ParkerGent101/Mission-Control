/* Mission Control — Onboarding Wizard */
const { useState: useOB, useEffect: useEffectOB } = React;

const PERSONAS = [
  { id: "it",         label: "IT / Tech",    icon: "briefcase",  modules: ["agenda","work","finance","health","activity"] },
  { id: "musician",   label: "Musician",      icon: "music",      modules: ["agenda","band","finance","health","activity"] },
  { id: "freelancer", label: "Freelancer",    icon: "briefcase",  modules: ["agenda","work","finance","health","activity"] },
  { id: "student",    label: "Student",       icon: "graduation", modules: ["agenda","health","finance","activity"] },
  { id: "all",        label: "Everything",    icon: "sparkles",   modules: ["agenda","finance","band","health","work","activity"] },
];

const ALL_MODULES = [
  { id: "agenda",   label: "Agenda",   icon: "calendar",   desc: "Daily schedule & tasks" },
  { id: "finance",  label: "Finance",  icon: "wallet",     desc: "Expenses & income" },
  { id: "band",     label: "Band",     icon: "music",      desc: "Shows, content, contacts" },
  { id: "health",   label: "Health",   icon: "heart",      desc: "Habits, weight, calories" },
  { id: "work",     label: "Work",     icon: "briefcase",  desc: "Work tasks & projects" },
  { id: "activity", label: "Activity", icon: "clock",      desc: "Action history" },
];

const PROGRAMS = [
  { id: "strength", label: "Strength",    icon: "zap",       desc: "Lifting & resistance" },
  { id: "cardio",   label: "Cardio",      icon: "heart",     desc: "Running, cycling, HIIT" },
  { id: "hybrid",   label: "Hybrid",      icon: "sparkles",  desc: "Strength + cardio mix" },
  { id: "yoga",     label: "Yoga / Flex", icon: "feather",   desc: "Flexibility & mindfulness" },
  { id: "none",     label: "Not yet",     icon: "clock",     desc: "Set this up later" },
];

const SPLITS = [
  { id: "ppl",         label: "Push / Pull / Legs" },
  { id: "upper_lower", label: "Upper / Lower" },
  { id: "full_body",   label: "Full Body" },
  { id: "bro",         label: "Bro Split" },
  { id: "custom",      label: "Custom / Other" },
];

const WEEK_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const TXN_CATS = [
  { id: "housing",       label: "Housing" },
  { id: "food",          label: "Food & Dining" },
  { id: "transport",     label: "Transport" },
  { id: "entertainment", label: "Entertainment" },
  { id: "shopping",      label: "Shopping" },
  { id: "health",        label: "Health" },
  { id: "income",        label: "Income" },
  { id: "other",         label: "Other" },
];

const OnboardingWizard = ({ onComplete }) => {
  const [step, setStep] = useOB(0);
  const [name, setName] = useOB('');
  const [persona, setPersona] = useOB(null);
  const [modules, setModules] = useOB({});
  const [selectedTheme, setSelectedTheme] = useOB(null);
  const [hoveredTheme, setHoveredTheme] = useOB(null);
  // Fitness
  const [fitnessProgram, setFitnessProgram] = useOB(null);
  const [workoutDays, setWorkoutDays] = useOB([]);
  const [workoutSplit, setWorkoutSplit] = useOB(null);
  // Connect
  const [plaidStatus, setPlaidStatus] = useOB('idle');
  const [calStatus, setCalStatus] = useOB('idle');
  const [transactions, setTransactions] = useOB([]);
  const [txnCats, setTxnCats] = useOB({});
  const [saving, setSaving] = useOB(false);

  // Hover previews live theme; click locks selection
  useEffectOB(() => {
    const themes = window.THEMES || [];
    const activeId = hoveredTheme || selectedTheme;
    const th = themes.find(t => t.id === activeId);
    if (th) {
      document.documentElement.style.setProperty("--accent", th.accent);
      document.documentElement.style.setProperty("--accent-2", th.accent2);
    } else if (!selectedTheme) {
      document.documentElement.style.setProperty("--accent", "#e0a857");
      document.documentElement.style.setProperty("--accent-2", "#6ed3b6");
    }
  }, [hoveredTheme, selectedTheme]);

  const TOTAL = 6;

  const selectPersona = (p) => {
    setPersona(p.id);
    const mods = {};
    ALL_MODULES.forEach(m => { mods[m.id] = p.modules.includes(m.id); });
    setModules(mods);
  };

  const toggleModule = (id) => setModules(prev => ({ ...prev, [id]: !prev[id] }));

  const toggleDay = (d) => setWorkoutDays(prev =>
    prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
  );

  const connectPlaid = async () => {
    if (!window.Plaid) {
      window.__toast?.('Plaid not loaded — add PLAID_CLIENT_ID to .env', 'error');
      return;
    }
    setPlaidStatus('connecting');
    try {
      const r = await fetch('/api/plaid/link_token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }
      });
      const d = await r.json();
      if (d.error) { setPlaidStatus('idle'); window.__toast?.(d.error, 'error'); return; }
      const handler = window.Plaid.create({
        token: d.link_token,
        onSuccess: async (publicToken) => {
          await fetch('/api/plaid/exchange', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token: publicToken })
          });
          setPlaidStatus('connected');
          window.__toast?.('Bank account connected', 'success');
          // Fetch recent transactions for categorization
          try {
            const tr = await fetch('/api/plaid/transactions');
            const td = await tr.json();
            if (td.transactions && td.transactions.length > 0) {
              const txns = td.transactions.slice(0, 20);
              setTransactions(txns);
              const cats = {};
              txns.forEach(t => { cats[t.id] = t.category || 'other'; });
              setTxnCats(cats);
            }
          } catch {}
        },
        onExit: () => { if (plaidStatus !== 'connected') setPlaidStatus('idle'); },
      });
      handler.open();
    } catch {
      setPlaidStatus('idle');
      window.__toast?.('Plaid connection failed', 'error');
    }
  };

  const connectCalendar = async () => {
    setCalStatus('connecting');
    try {
      const r = await fetch('/api/calendar/auth');
      const d = await r.json();
      if (d.auth_url) {
        window.open(d.auth_url, '_blank', 'width=600,height=700');
        setCalStatus('connected');
        window.__toast?.('Calendar auth opened — approve in the new tab', 'success');
      } else {
        setCalStatus('idle');
        window.__toast?.(d.error || 'Calendar not configured — add credentials.json', 'error');
      }
    } catch {
      setCalStatus('idle');
    }
  };

  const finish = async () => {
    setSaving(true);
    const themes = window.THEMES || [];
    const theme = themes.find(t => t.id === selectedTheme) || null;
    if (transactions.length > 0) {
      await fetch('/api/plaid/categorize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: txnCats })
      }).catch(() => {});
    }
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, persona, modules, theme: theme?.id,
        fitness: { program: fitnessProgram, days: workoutDays, split: workoutSplit }
      })
    }).catch(() => {});
    onComplete({ name, modules, theme });
  };

  const canAdvance = [
    name.trim().length > 0 && persona !== null,  // 0: profile
    true,                                          // 1: theme
    Object.values(modules).some(Boolean),         // 2: modules
    true,                                          // 3: fitness
    true,                                          // 4: connect
  ];

  /* ── Step 0: Profile ──────────────────────────────────── */
  const step0 = (
    <div className="ob-step">
      <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
        <div className="ob-hero-ring">
          <Icon name="sparkles" size={24} style={{ color: 'var(--accent)' }} />
        </div>
        <h2 className="ob-title">Welcome to Mission Control</h2>
        <p className="ob-sub">Your personal command center. Set it up in a few quick steps.</p>
      </div>
      <label className="ob-label">Your name</label>
      <input className="input" value={name} onChange={e => setName(e.target.value)}
        placeholder="e.g. Parker" autoFocus style={{ marginTop: 6 }}
        onKeyDown={e => e.key === 'Enter' && name.trim() && persona && setStep(1)} />
      <div style={{ marginTop: 20 }}>
        <label className="ob-label">What describes you?</label>
        <div className="ob-persona-grid">
          {PERSONAS.map(p => (
            <div key={p.id} className={"ob-persona-tile" + (persona === p.id ? " active" : "")}
              onClick={() => selectPersona(p)}>
              <Icon name={p.icon} size={16} style={{ color: persona === p.id ? 'var(--accent)' : 'var(--ink-3)', flexShrink: 0 }} />
              <span>{p.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  /* ── Step 1: Theme ───────────────────────────────────── */
  const step1 = (
    <div className="ob-step">
      <h2 className="ob-title">Choose your look</h2>
      <p className="ob-sub">Hover to preview. Click to lock it in. You can always change this in Settings.</p>
      <div className="ob-theme-grid">
        {(window.THEMES || []).map(th => {
          const isSelected = selectedTheme === th.id;
          return (
            <div key={th.id}
              className={"ob-theme-card" + (isSelected ? " selected" : "")}
              onClick={() => setSelectedTheme(th.id)}
              onMouseEnter={() => setHoveredTheme(th.id)}
              onMouseLeave={() => setHoveredTheme(null)}>
              {/* Color bar */}
              <div style={{
                height: 6, borderRadius: '6px 6px 0 0',
                background: `linear-gradient(90deg, ${th.accent}, ${th.accent2})`,
              }} />
              {/* Mini UI preview */}
              <div style={{ padding: '10px 10px 8px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 8px', borderRadius: 4,
                  background: `color-mix(in oklch, ${th.accent} 18%, var(--surface-2))`,
                  border: `1px solid color-mix(in oklch, ${th.accent} 45%, var(--line))`,
                  width: 'fit-content',
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: th.accent }} />
                  <div style={{ width: 28, height: 5, borderRadius: 2, background: th.accent, opacity: .7 }} />
                </div>
                <div style={{ height: 5, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <div style={{ width: '65%', height: '100%', borderRadius: 999, background: th.accent2 }} />
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {[th.accent, th.accent2].map((c, i) => (
                    <div key={i} style={{
                      height: 14, borderRadius: 999, padding: '0 6px',
                      background: `color-mix(in oklch, ${c} 16%, var(--surface-2))`,
                      border: `1px solid color-mix(in oklch, ${c} 35%, var(--line))`,
                      display: 'flex', alignItems: 'center', gap: 3,
                    }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: c }} />
                      <div style={{ width: i === 0 ? 18 : 14, height: 4, borderRadius: 2, background: c, opacity: .6 }} />
                    </div>
                  ))}
                </div>
              </div>
              {/* Name + checkmark */}
              <div style={{ padding: '0 10px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10.5,
                  color: isSelected ? 'var(--accent)' : 'var(--ink-3)',
                  fontWeight: isSelected ? 600 : 400,
                }}>{th.name}</span>
                {isSelected && (
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: th.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name="check" size={9} style={{ color: '#000', opacity: .8 }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!selectedTheme && (
        <p style={{ color: 'var(--ink-4)', fontSize: 11.5, marginTop: 14, textAlign: 'center' }}>
          No theme selected — defaults to Amber. You can pick one now or later.
        </p>
      )}
    </div>
  );

  /* ── Step 2: Modules ──────────────────────────────────── */
  const step2 = (
    <div className="ob-step">
      <h2 className="ob-title">Your modules</h2>
      <p className="ob-sub">Pre-selected for your profile — toggle any on or off.</p>
      <div className="ob-module-grid">
        {ALL_MODULES.map(m => (
          <div key={m.id} className={"ob-module-tile" + (modules[m.id] ? " on" : "")}
            onClick={() => toggleModule(m.id)}>
            <Icon name={m.icon} size={15} style={{ color: modules[m.id] ? 'var(--accent)' : 'var(--ink-4)', flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontWeight: 500, fontSize: 12, color: modules[m.id] ? 'var(--ink)' : 'var(--ink-2)' }}>{m.label}</div>
              <div style={{ color: 'var(--ink-4)', fontSize: 11, marginTop: 1 }}>{m.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  /* ── Step 3: Fitness ──────────────────────────────────── */
  const step3 = (
    <div className="ob-step">
      <h2 className="ob-title">Fitness & health</h2>
      <p className="ob-sub">Help Mission Control understand your training. Skip anything you don't track yet.</p>

      <div style={{ marginTop: 18 }}>
        <label className="ob-label">What's your primary program?</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
          {PROGRAMS.map(p => (
            <div key={p.id}
              className={"ob-persona-tile" + (fitnessProgram === p.id ? " active" : "")}
              onClick={() => setFitnessProgram(p.id)}
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Icon name={p.icon} size={13} style={{ color: fitnessProgram === p.id ? 'var(--accent)' : 'var(--ink-4)', flexShrink: 0 }} />
                <span style={{ fontWeight: 500, fontSize: 12 }}>{p.label}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.3 }}>{p.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <label className="ob-label">Which days do you train?</label>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {WEEK_DAYS.map(d => (
            <div key={d} onClick={() => toggleDay(d)} style={{
              width: 40, height: 40, borderRadius: 'var(--r)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 500,
              cursor: 'pointer', userSelect: 'none', transition: 'all .12s',
              background: workoutDays.includes(d)
                ? 'color-mix(in oklch, var(--accent) 18%, var(--surface-2))'
                : 'var(--surface)',
              border: workoutDays.includes(d)
                ? '1px solid color-mix(in oklch, var(--accent) 45%, var(--line))'
                : '1px solid var(--line)',
              color: workoutDays.includes(d) ? 'var(--accent)' : 'var(--ink-3)',
            }}>{d}</div>
          ))}
        </div>
      </div>

      {(fitnessProgram === 'strength' || fitnessProgram === 'hybrid') && (
        <div style={{ marginTop: 20 }}>
          <label className="ob-label">What's your split?</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {SPLITS.map(s => (
              <div key={s.id} onClick={() => setWorkoutSplit(s.id)} style={{
                padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 11.5, userSelect: 'none',
                transition: 'all .12s',
                background: workoutSplit === s.id
                  ? 'color-mix(in oklch, var(--accent-2) 18%, var(--surface-2))'
                  : 'var(--surface)',
                border: workoutSplit === s.id
                  ? '1px solid color-mix(in oklch, var(--accent-2) 45%, var(--line))'
                  : '1px solid var(--line)',
                color: workoutSplit === s.id ? 'var(--accent-2)' : 'var(--ink-3)',
              }}>{s.label}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  /* ── Step 4: Connect ──────────────────────────────────── */
  const step4 = (
    <div className="ob-step">
      <h2 className="ob-title">Connect your data</h2>
      <p className="ob-sub">Optional — skip either and connect later from Settings.</p>

      <div className="ob-connect-card" style={{ marginTop: 20 }}>
        <div className="ob-connect-icon">
          <Icon name="wallet" size={18} style={{ color: plaidStatus === 'connected' ? 'var(--accent-2)' : 'var(--accent)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Bank Accounts</div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11.5, marginTop: 2 }}>Auto-import transactions via Plaid</div>
        </div>
        {plaidStatus === 'connected' ? (
          <span className="tag mint">Connected</span>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn primary" onClick={connectPlaid}
              disabled={plaidStatus === 'connecting'}
              style={{ fontSize: 11.5, padding: '5px 10px' }}>
              <Icon name={plaidStatus === 'connecting' ? "loader" : "wallet"} size={12} />
              {plaidStatus === 'connecting' ? 'Opening…' : 'Connect'}
            </button>
            <button className="btn ghost" onClick={() => setPlaidStatus('skipped')}
              style={{ fontSize: 11.5, padding: '5px 10px', color: 'var(--ink-3)' }}>
              Skip
            </button>
          </div>
        )}
      </div>

      {/* Transaction categorization — shown after Plaid connects */}
      {plaidStatus === 'connected' && transactions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            Categorize recent transactions
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
            {transactions.map((t, i) => (
              <div key={t.id} style={{
                display: 'grid', gridTemplateColumns: '1fr auto',
                gap: 10, alignItems: 'center',
                padding: '8px 12px',
                borderBottom: i < transactions.length - 1 ? '1px solid var(--line-soft)' : 'none',
                background: i % 2 === 0 ? 'var(--surface)' : 'var(--bg-2)',
              }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                    ${Math.abs(t.amount).toFixed(2)} · {t.date}
                  </div>
                </div>
                <select className="input"
                  style={{ width: 140, fontSize: 11.5, padding: '4px 8px' }}
                  value={txnCats[t.id] || 'other'}
                  onChange={e => setTxnCats(prev => ({ ...prev, [t.id]: e.target.value }))}>
                  {TXN_CATS.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ob-connect-card" style={{ marginTop: 10 }}>
        <div className="ob-connect-icon">
          <Icon name="calendar" size={18} style={{ color: calStatus === 'connected' ? 'var(--accent-2)' : 'var(--info)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>Google Calendar</div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11.5, marginTop: 2 }}>Pull events into Agenda</div>
        </div>
        {calStatus === 'connected' ? (
          <span className="tag mint">Auth opened</span>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn primary" onClick={connectCalendar}
              disabled={calStatus === 'connecting'}
              style={{ fontSize: 11.5, padding: '5px 10px' }}>
              <Icon name={calStatus === 'connecting' ? "loader" : "calendar"} size={12} />
              {calStatus === 'connecting' ? 'Opening…' : 'Connect'}
            </button>
            <button className="btn ghost" onClick={() => setCalStatus('skipped')}
              style={{ fontSize: 11.5, padding: '5px 10px', color: 'var(--ink-3)' }}>
              Skip
            </button>
          </div>
        )}
      </div>
    </div>
  );

  /* ── Step 5: Done ─────────────────────────────────────── */
  const firstName = name.trim().split(' ')[0];
  const step5 = (
    <div className="ob-step" style={{ textAlign: 'center' }}>
      <div style={{ padding: '12px 0 20px' }}>
        <div className="ob-hero-ring" style={{ background: 'color-mix(in oklch, var(--accent-2) 14%, var(--surface-2))', borderColor: 'color-mix(in oklch, var(--accent-2) 35%, var(--line))' }}>
          <Icon name="check" size={24} style={{ color: 'var(--accent-2)' }} />
        </div>
        <h2 className="ob-title">You're all set{firstName ? `, ${firstName}` : ''}.</h2>
        <p className="ob-sub">Mission Control is ready. Your modules are configured and waiting.</p>
      </div>
      <div style={{ padding: '12px 14px', background: 'var(--surface)', borderRadius: 'var(--r)', border: '1px solid var(--line)', textAlign: 'left' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
          Active modules
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ALL_MODULES.filter(m => modules[m.id]).map(m => (
            <span key={m.id} className="tag amber" style={{ gap: 4 }}>
              <Icon name={m.icon} size={10} />{m.label}
            </span>
          ))}
        </div>
        {fitnessProgram && fitnessProgram !== 'none' && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-soft)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 2 }}>
              Fitness
            </div>
            <span className="tag info" style={{ gap: 4 }}>
              <Icon name="heart" size={10} />{PROGRAMS.find(p => p.id === fitnessProgram)?.label}
            </span>
            {workoutDays.length > 0 && (
              <span className="tag" style={{ gap: 4 }}>{workoutDays.join(', ')}</span>
            )}
            {workoutSplit && (
              <span className="tag" style={{ gap: 4 }}>{SPLITS.find(s => s.id === workoutSplit)?.label}</span>
            )}
          </div>
        )}
        {(plaidStatus === 'connected' || calStatus === 'connected') && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 2, alignSelf: 'center' }}>
              Connected
            </div>
            {plaidStatus === 'connected' && <span className="tag mint" style={{ gap: 4 }}><Icon name="wallet" size={10} />Plaid</span>}
            {calStatus === 'connected' && <span className="tag mint" style={{ gap: 4 }}><Icon name="calendar" size={10} />Calendar</span>}
          </div>
        )}
      </div>
    </div>
  );

  const steps = [step0, step1, step2, step3, step4, step5];
  const stepLabels = ['Profile', 'Theme', 'Modules', 'Fitness', 'Connect', 'Done'];

  return (
    <div className="ob-overlay">
      <div className="ob-panel">
        {/* Progress bar */}
        <div className="ob-progress-track">
          <div className="ob-progress-fill" style={{ width: `${(step / (TOTAL - 1)) * 100}%` }} />
        </div>

        {/* Step header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px 0' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Step {step + 1} of {TOTAL}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {stepLabels.map((label, i) => (
              <span key={i} style={{
                fontFamily: 'var(--font-mono)', fontSize: 10.5,
                color: i === step ? 'var(--accent)' : i < step ? 'var(--ink-3)' : 'var(--ink-4)',
                fontWeight: i === step ? 600 : 400,
              }}>{label}</span>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="ob-content">{steps[step]}</div>

        {/* Navigation */}
        <div className="ob-nav">
          {step > 0 && step < TOTAL - 1 && (
            <button className="btn" onClick={() => setStep(s => s - 1)} style={{ color: 'var(--ink-3)' }}>
              ← Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step < TOTAL - 1 ? (
            <button className="btn primary" onClick={() => setStep(s => s + 1)} disabled={!canAdvance[step]}>
              Continue →
            </button>
          ) : (
            <button className="btn primary" onClick={finish} disabled={saving} style={{ minWidth: 180 }}>
              <Icon name={saving ? "loader" : "sparkles"} size={13} />
              {saving ? 'Setting up…' : 'Launch Mission Control'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

window.OnboardingWizard = OnboardingWizard;
