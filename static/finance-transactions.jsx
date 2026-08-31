/* Finance — Transactions tab.
   The month's ledger: add, re-categorise, edit and delete, plus the Rocket Money
   import and the month/year sheet rollovers. */

const TransactionsTab = ({ month, setMonth, data }) => {
  const { txns, setTxns, categories, loading, error, reload, catOverrides } = data;

  const [showAdd, setShowAdd] = useState(false);
  const [desc, setDesc] = useState("");
  const [amt, setAmt]   = useState("");
  const [type, setType] = useState("expense");
  const [cat, setCat]   = useState("Utilities");
  const [collapsed, setCollapsed] = useState({});
  const [txnEdit, setTxnEdit] = useState(null);   // {id, field:'amount'|'desc', val}
  const [rolling, setRolling] = useState(false);

  const toggleGroup = (name) => setCollapsed(s => ({ ...s, [name]: !s[name] }));

  const logExpense = async () => {
    if (!desc.trim() || !amt) return;
    try {
      const res = await fetch('/api/finances', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, amount: parseFloat(amt), type, category: cat, date: todayISO() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toastErr(body.error || `Couldn’t add that — try again (${res.status}).`);
        return;
      }
    } catch { toastErr("Couldn’t add that — check your connection."); return; }
    toastOk(`${type === 'income' ? 'Income' : 'Expense'} logged — ${desc.trim()} ${fmtMoney(parseFloat(amt) || 0)}`);
    setDesc(''); setAmt(''); setShowAdd(false);
    reload(month);
  };

  const editTxn = async (t, changes) => {
    const newCat = catOverrides.current[t.id] ?? normFinCat(t.cat, t.merchant);
    const prev = txns;
    setTxns(ts => ts.map(x => x.id === t.id ? {
      ...x,
      amount: changes.amount !== undefined ? -Math.abs(changes.amount) : x.amount,
      merchant: changes.description !== undefined ? changes.description : x.merchant,
    } : x));
    try {
      const res = await fetch(`/api/finances/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: newCat,
          description: changes.description !== undefined ? changes.description : t.merchant,
          ...(changes.amount !== undefined ? { amount: changes.amount } : {}),
          sheet_tab: t.sheet_tab, sheet_row: t.sheet_row,
          sheet_col: t.sheet_col, sheet_cols: t.sheet_cols, sheet_kind: t.sheet_kind,
        }),
      });
      if (!res.ok) throw 0;
      reload(month);
    } catch { toastErr("Couldn’t save that change — reverting."); setTxns(prev); }
  };

  // Inline edit: click swaps the value for an input; Enter or blur commits, Escape cancels.
  const commitTxnEdit = () => {
    setTxnEdit(te => {
      if (!te) return null;
      const t = txns.find(x => x.id === te.id);
      if (!t) return null;
      if (te.field === 'amount') {
        const n = parseFloat(te.val);
        if (isNaN(n) || n < 0) { toastErr("Enter a valid amount."); return null; }
        if (n !== Math.abs(t.amount)) editTxn(t, { amount: n });
      } else {
        const v = (te.val || '').trim();
        if (v && v !== t.merchant) editTxn(t, { description: v });
      }
      return null;
    });
  };

  const changeCategory = (t, newCat) => {
    catOverrides.current[t.id] = newCat;
    setTxns(ts => ts.map(x => x.id === t.id ? { ...x, cat: newCat } : x));
    fetch(`/api/finances/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: newCat,
        sheet_tab: t.sheet_tab, sheet_row: t.sheet_row,
        sheet_col: t.sheet_col, sheet_cols: t.sheet_cols, sheet_kind: t.sheet_kind,
      }),
    }).then(async res => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toastErr(err.error || "Couldn’t change the category.");
        delete catOverrides.current[t.id]; reload(month);
      }
    }).catch(() => {
      toastErr("Couldn’t change the category.");
      delete catOverrides.current[t.id]; reload(month);
    });
  };

  const deleteTxn = async (t) => {
    const warn = t.source === 'sheet' ? ' This also clears it from the Sheet.' : '';
    if (!confirm(`Delete "${t.merchant}" (${fmtMoney(Math.abs(t.amount))})?${warn}`)) return;
    if (t.source === 'sheet') {
      if (t.sheet_tab == null || t.sheet_row == null || t.sheet_col == null) return;
      const qs = new URLSearchParams({ tab: t.sheet_tab, row: t.sheet_row, col: t.sheet_col });
      if (t.sheet_cols) qs.set("cols", t.sheet_cols);
      const res = await fetch(`/api/finances/sheet?${qs}`, { method: "DELETE" });
      if (!res.ok) { toastErr("Couldn’t delete from the Google Sheet — check the OAuth scope."); return; }
    } else {
      await fetch(`/api/finances/${t.id}`, { method: "DELETE" });
    }
    delete catOverrides.current[t.id];
    window.__toast && window.__toast('Transaction deleted', 'info');
    reload(month);
  };

  const rolloverMonth = async () => {
    const [my, mm] = month.split('-').map(Number);
    const nextLabel = MONTH_NAMES[mm % 12] + ' ' + (mm === 12 ? my + 1 : my);
    if (!confirm(`Create the ${nextLabel} sheet? Your budgeted amounts, income and GLS payments carry over; actual spending and one-off transactions start empty for you to fill in.`)) return;
    setRolling(true);
    try {
      const res = await fetch('/api/finances/rollover/month', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toastErr(body.error || `Rollover failed (${res.status})`); return; }
      if (body.month) setMonth(body.month);
      toastOk(`Created the ${body.tab} sheet.`);
    } finally { setRolling(false); }
  };

  const rolloverYear = async () => {
    const yr = Number(month.split('-')[0]) + 1;
    if (!confirm(`Create a new ${yr} finances file? A fresh spreadsheet with 12 month tabs is generated from this month's template for you to fill out.`)) return;
    setRolling(true);
    try {
      const res = await fetch('/api/finances/rollover/year', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toastErr(body.error || `Year rollover failed (${res.status})`); return; }
      if (body.url && confirm(`Created "Finances ${body.year}". Open it now?`)) window.open(body.url, '_blank');
    } finally { setRolling(false); }
  };

  // Group by category (income first), each group ordered as the Sheet returned it.
  const groups = useMemo(() => {
    const byName = {};
    txns.forEach(t => {
      const key = t.amount > 0 ? 'Income' : normFinCat(t.cat);
      (byName[key] = byName[key] || []).push(t);
    });
    const order = [];
    if (byName['Income']) order.push('Income');
    categories.forEach(c => { if (byName[c.name] && !order.includes(c.name)) order.push(c.name); });
    Object.keys(byName).forEach(k => { if (!order.includes(k)) order.push(k); });
    return order.map(name => ({ name, items: byName[name] }));
  }, [txns, categories]);

  const expenseCount = txns.filter(t => t.amount < 0).length;

  return (
    <>
      <Panel
        title="Transactions"
        right={<>
          <button className="btn" disabled={rolling} onClick={rolloverMonth}
                  title="Create next month's sheet from this one"><Icon name="file" size={13} />New month</button>
          <button className="btn" disabled={rolling} onClick={rolloverYear}
                  title="Create a new year's finances file to fill out"><Icon name="calendar" size={13} />New year</button>
          <button className="btn primary" onClick={() => setShowAdd(s => !s)}>
            <Icon name="plus" size={13} />Add
          </button>
        </>}
      >
        {showAdd && (
          <div className="add-form" onKeyDown={submitOnEnter(logExpense)}>
            <input className="input" placeholder="Description *" autoFocus value={desc}
                   onChange={e => setDesc(e.target.value)} style={{ flex: 2, minWidth: 140 }} />
            <input className="input num" placeholder="Amount *" type="number" value={amt}
                   onChange={e => setAmt(e.target.value)} style={{ width: 96 }} />
            <select className="input" value={type} onChange={e => setType(e.target.value)} style={{ width: 104 }}>
              <option value="expense">Expense</option><option value="income">Income</option>
            </select>
            <select className="input" value={cat} onChange={e => setCat(e.target.value)} style={{ width: 150 }}>
              {FIN_CAT_NAMES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn primary" onClick={logExpense} disabled={!desc.trim() || !amt}>Log</button>
            <button className="btn ghost icon-only" onClick={() => setShowAdd(false)} aria-label="Cancel">
              <Icon name="x" size={13} />
            </button>
          </div>
        )}

        <div className="txn-count muted-2">
          {expenseCount} expense{expenseCount === 1 ? '' : 's'} in {monthLabel(month)}
        </div>

        {(loading || error)
          ? <LoadState loading={loading} error={error} onRetry={() => reload(month)} what="transactions" />
          : txns.length === 0
            ? <Empty>No transactions for {monthLabel(month)} yet.</Empty>
            : groups.map(({ name, items }) => {
                const isShut = !!collapsed[name];
                const total = items.reduce((s, t) => s + Math.abs(t.amount), 0);
                const income = name === 'Income';
                return (
                  <div key={name} className="txn-group">
                    <button className="txn-group-head" onClick={() => toggleGroup(name)}
                            aria-expanded={!isShut} title={isShut ? 'Expand' : 'Collapse'}>
                      <span className={"caret" + (isShut ? " shut" : "")} aria-hidden="true" />
                      <span className="txn-group-name">{name}</span>
                      <span className="muted-2 num">{items.length}</span>
                      <span className="spacer" />
                      <span className={"num " + (income ? "pos" : "")}>
                        {income ? '+' : ''}{fmtMoney(total)}
                      </span>
                    </button>

                    {!isShut && items.map((t, i) => {
                      const nc = t.amount > 0 ? null : normFinCat(t.cat);
                      const editing = txnEdit && txnEdit.id === t.id;
                      return (
                        <div key={t.id || i} className="txn">
                          <div className="txn-main">
                            {editing && txnEdit.field === 'desc'
                              ? <input className="input" autoFocus value={txnEdit.val}
                                       onChange={e => setTxnEdit(x => ({ ...x, val: e.target.value }))}
                                       onKeyDown={e => { if (e.key === 'Enter') commitTxnEdit(); if (e.key === 'Escape') setTxnEdit(null); }}
                                       onBlur={commitTxnEdit} style={{ height: 26, width: '100%', maxWidth: 260 }} />
                              : <div className={"txn-name" + (t.amount < 0 ? " editable" : "")}
                                     {...(t.amount < 0 ? {
                                       onClick: () => setTxnEdit({ id: t.id, field: 'desc', val: t.merchant || '' }),
                                       title: "Edit description",
                                     } : {})}>{t.merchant}</div>}
                            <div className="txn-date muted-2">{t.date}</div>
                          </div>

                          {t.amount < 0
                            ? <select className="txn-cat" value={nc}
                                      onChange={e => changeCategory(t, e.target.value)}
                                      aria-label={`Category for ${t.merchant}`}>
                                {(t.source === 'sheet'
                                  ? (SHEET_CAT_NAMES.includes(nc) ? SHEET_CAT_NAMES : [nc, ...SHEET_CAT_NAMES])
                                  : FIN_CAT_NAMES
                                ).map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            : <span className="txn-cat-static muted-2">income</span>}

                          {editing && txnEdit.field === 'amount'
                            ? <input className="input num" autoFocus type="number" value={txnEdit.val}
                                     onChange={e => setTxnEdit(x => ({ ...x, val: e.target.value }))}
                                     onKeyDown={e => { if (e.key === 'Enter') commitTxnEdit(); if (e.key === 'Escape') setTxnEdit(null); }}
                                     onBlur={commitTxnEdit} style={{ width: 90, height: 26 }} />
                            : <span className={"num txn-amt " + (t.amount > 0 ? "pos" : "editable")}
                                    {...(t.amount < 0 ? {
                                      onClick: () => setTxnEdit({ id: t.id, field: 'amount', val: Math.abs(t.amount).toFixed(2) }),
                                      title: "Edit amount",
                                    } : {})}>
                                {t.amount > 0 ? '+' : ''}{fmtMoney(Math.abs(t.amount))}
                              </span>}

                          <button className="btn ghost icon-only" onClick={() => deleteTxn(t)}
                                  aria-label={`Delete ${t.merchant}`} title="Delete">
                            <Icon name="x" size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
      </Panel>
    </>
  );
};

/* The Rocket Money import. Rocket Money is the point of truth: the server
   reconciles the month tab against the newest CSV export in the configured Drive
   folder — adding new charges, updating changed amounts in place, and dropping
   rows a previous sync wrote that the export no longer has. Lives here rather
   than inside the tab so the header button can trigger it from any tab. */
/* How far the export actually reaches. Sync results are otherwise ambiguous: a month
   with no recent spending looks identical to a sync that dropped rows, which is exactly
   the confusion that sent us digging through Drive by hand. */
const coverageNote = (d) => {
  const c = d && d.coverage;
  if (!c || !c.last_charge) return '';
  const day = (iso) => {
    const dt = new Date(iso + 'T12:00:00');
    return isNaN(dt) ? iso : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const bits = [`through ${day(c.last_charge)}`];
  if (!c.reconciled) bits.push('add-only');
  return ` (${bits.join(', ')})`;
};

const useDriveSync = (month, reload, reloadStatic) => {
  const [syncing, setSyncing] = useState(false);
  const [ready, setReady] = useState(null);   // null = unknown, false = not configured

  useEffect(() => {
    fetch('/api/finance/import/status').then(r => r.json())
      .then(d => setReady(!!(d.connected && d.folder_configured)))
      .catch(() => setReady(null));
  }, []);

  const sync = useCallback(async (opts = {}) => {
    if (ready === false) {
      if (opts.manual) window.__toast && window.__toast('Set your Rocket Money Drive folder in drive_config.json first', 'info');
      return;
    }
    setSyncing(true);
    try {
      const r = await fetch('/api/finance/import/drive');
      const d = await r.json();
      if (!r.ok || d.error) {
        if (opts.manual) toastErr(d.error || 'Drive sync failed');
        return;
      }
      const changed = (d.added || 0) + (d.updated || 0) + (d.removed || 0);
      if (changed > 0) {
        reload(month); reloadStatic();
        const bits = [];
        if (d.added)   bits.push(`${d.added} added`);
        if (d.updated) bits.push(`${d.updated} updated`);
        if (d.removed) bits.push(`${d.removed} removed`);
        const total = typeof d.csv_total === 'number' ? ` — ${fmtMoney(d.csv_total)} this month` : '';
        toastOk(`Synced with Rocket Money: ${bits.join(', ')}${total}${coverageNote(d)}`);
      } else if (opts.manual) {
        window.__toast && window.__toast(typeof d.csv_total === 'number'
          ? `Already matches Rocket Money — ${fmtMoney(d.csv_total)} this month${coverageNote(d)}`
          : `Already up to date${coverageNote(d)}`, 'info');
      }
      if (opts.manual && d.warnings && d.warnings.length) {
        window.__toast && window.__toast(d.warnings[0], 'info');
        console.warn('Drive sync warnings:', d.warnings);
      }
      if (opts.manual && d.failed) {
        const why = (d.errors && d.errors.length) ? ` — ${d.errors[0]}` : '';
        toastErr(`${d.failed} month${d.failed === 1 ? '' : 's'} couldn’t be synced${why}`);
        if (d.errors && d.errors.length) console.warn('Drive sync errors:', d.errors);
      }
    } catch {
      if (opts.manual) toastErr('Drive sync failed');
    } finally {
      setSyncing(false);
    }
  }, [ready, month, reload, reloadStatic]);

  // Silent catch-up on load once we know it's configured, throttled to once / 10 min
  // so revisiting the app doesn't re-hit Drive and the Sheet.
  useEffect(() => {
    if (ready !== true) return;
    let last = 0;
    try { last = +(localStorage.getItem('mc_drive_import_ts') || 0); } catch {}
    if (Date.now() - last < 10 * 60 * 1000) return;
    try { localStorage.setItem('mc_drive_import_ts', String(Date.now())); } catch {}
    sync();
  }, [ready, sync]);

  return { syncing, ready, sync };
};
