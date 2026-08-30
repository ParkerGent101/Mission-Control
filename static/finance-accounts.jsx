/* Finance — Accounts tab.
   Balances entered by hand (no bank linking) and the net-worth line they trace
   over time. Saving a balance stamps a snapshot, so the history follows the
   numbers without a separate step. */

const ACCOUNT_TYPES = [
  { id: 'cash',      label: 'Cash / savings' },
  { id: 'brokerage', label: 'Brokerage' },
  { id: 'debt',      label: 'Debt' },
];

const AccountsTab = () => {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows]       = useState([]);
  const [saving, setSaving]   = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/accounts')
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(d => { setData(d); setLoading(false); setError(false); })
      .catch(() => { setLoading(false); setError(true); });
  }, []);

  useEffect(load, [load]);
  useRefreshListener(load);

  const accounts  = (data && data.accounts) || [];
  const snapshots = (data && data.snapshots) || [];
  const net       = data ? data.net_worth : 0;
  const prev      = data ? data.previous_net_worth : null;
  const change    = prev != null ? net - prev : null;

  const open = () => {
    setRows(accounts.length
      ? accounts.map(a => ({ id: a.id, name: a.name, type: a.type, balance: String(a.balance) }))
      : [{ name: '', type: 'cash', balance: '' }]);
    setEditing(true);
  };
  const setRow    = (i, f, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [f]: v } : r));
  const addRow    = () => setRows(rs => [...rs, { name: '', type: 'cash', balance: '' }]);
  const removeRow = (i) => setRows(rs => rs.filter((_, j) => j !== i));

  const save = async () => {
    const payload = rows
      .map(r => ({ id: r.id, name: (r.name || '').trim(), type: r.type, balance: r.balance }))
      .filter(r => r.name && r.balance !== '' && !isNaN(parseFloat(r.balance)));
    setSaving(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: payload }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) { toastErr(d.error || 'Couldn’t save the accounts.'); return; }
      setEditing(false);
      toastOk('Balances saved — today’s snapshot recorded.');
      load();
    } catch { toastErr('Couldn’t save the accounts.'); }
    finally { setSaving(false); }
  };

  const snapshotNow = async () => {
    try {
      const res = await fetch('/api/accounts/snapshot', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) { toastErr(d.error || 'Couldn’t record a snapshot.'); return; }
      toastOk('Snapshot recorded.');
      load();
    } catch { toastErr('Couldn’t record a snapshot.'); }
  };

  const series = snapshots.map(s => s.net_worth);
  const pendingNet = rows.reduce((s, r) => {
    const v = parseFloat(r.balance);
    if (isNaN(v)) return s;
    return s + (r.type === 'debt' ? -v : v);
  }, 0);

  return (
    <>
      <Panel
        title="Net worth"
        right={<>
          {accounts.length > 0 && (
            <button className="btn" onClick={snapshotNow} title="Record today's balances in the history">
              <Icon name="target" size={13} />Snapshot
            </button>
          )}
          <button className="btn primary" onClick={open}>
            <Icon name={accounts.length ? "settings" : "plus"} size={13} />
            {accounts.length ? 'Update balances' : 'Add accounts'}
          </button>
        </>}
      >
        {(loading || error)
          ? <LoadState loading={loading} error={error} onRetry={load} what="accounts" />
          : accounts.length === 0 && !editing
            ? <Empty>No accounts yet. Add the accounts you want to track — balances are entered by hand, and each save records a point on the trend.</Empty>
            : (
              <div className="networth">
                <div className="networth-figure">
                  <div className="networth-value num">{fmtMoney(net, { cents: false })}</div>
                  {change != null && (
                    <div className={"networth-change num " + (change >= 0 ? "pos" : "neg")}>
                      {fmtDelta(change, { cents: false })} since last snapshot
                    </div>
                  )}
                  <div className="muted-2" style={{ fontSize: 11.5 }}>
                    {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}
                    {snapshots.length > 0 && <> · latest {snapshots[snapshots.length - 1].date}</>}
                  </div>
                </div>
                {series.length >= 2
                  ? <NetWorthChart snapshots={snapshots} />
                  : <div className="muted-2" style={{ fontSize: 12, alignSelf: 'center' }}>
                      The trend line appears once there are two snapshots.
                    </div>}
              </div>
            )}
      </Panel>

      {editing && (
        <Panel title="Balances">
          <div className="editor">
            <div className="editor-label">
              Debt balances are entered as a positive number and subtracted from net worth.
            </div>
            {rows.map((r, i) => (
              <div key={i} className="editor-row">
                <input className="input" placeholder="Account name" value={r.name}
                       onChange={e => setRow(i, 'name', e.target.value)} style={{ flex: 1, minWidth: 120 }} />
                <select className="input" value={r.type} onChange={e => setRow(i, 'type', e.target.value)}
                        style={{ width: 140 }} aria-label="Account type">
                  {ACCOUNT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <input className="input num" placeholder="Balance" type="number" value={r.balance}
                       onChange={e => setRow(i, 'balance', e.target.value)} style={{ width: 120 }} />
                <button className="btn ghost icon-only" onClick={() => removeRow(i)}
                        aria-label="Remove account" title="Remove"><Icon name="x" size={12} /></button>
              </div>
            ))}
            <button className="btn ghost inline" onClick={addRow}><Icon name="plus" size={11} />Add account</button>
            <div className="muted-2" style={{ fontSize: 11.5 }}>
              Net worth as entered: <span className="num">{fmtMoney(pendingNet, { cents: false })}</span>
            </div>
            <div className="editor-actions">
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save balances'}
              </button>
              <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        </Panel>
      )}

      {!loading && accounts.length > 0 && (
        <Panel title="Accounts">
          <div className="acct-list">
            {accounts.map(a => (
              <div key={a.id} className="acct-row">
                <div className="acct-main">
                  <div className="acct-name">{a.name}</div>
                  <div className="acct-meta muted-2">
                    {(ACCOUNT_TYPES.find(t => t.id === a.type) || {}).label || a.type} · updated {a.updated}
                  </div>
                </div>
                {a.change != null && a.change !== 0 && (
                  /* On a debt account a falling balance is the good direction, so the
                     good/bad colour is inverted against the sign shown. */
                  <span className={"num acct-change " +
                        ((a.type === 'debt' ? a.change < 0 : a.change > 0) ? "pos" : "neg")}
                        title={a.type === 'debt'
                          ? (a.change < 0 ? 'Paid down since the last snapshot' : 'Grown since the last snapshot')
                          : 'Change since the last snapshot'}>
                    {fmtDelta(a.change, { cents: false })}
                  </span>
                )}
                <span className={"num acct-balance" + (a.type === 'debt' ? " neg" : "")}>
                  {a.type === 'debt' ? '−' : ''}{fmtMoney(a.balance)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
};

/* Net worth over time. One series, so no legend and no categorical colour — the
   panel title names it. Hovering a point reads out its date and value. */
const NetWorthChart = ({ snapshots }) => {
  const [hover, setHover] = useState(null);
  const w = 520, h = 140, padX = 8, padY = 12;
  const vals = snapshots.map(s => s.net_worth);
  const max = Math.max(...vals), min = Math.min(...vals);
  // Give a flat line room to breathe instead of pinning it to the top edge.
  const span = (max - min) || Math.max(1, Math.abs(max) * 0.1);
  const lo = min - span * 0.15, hi = max + span * 0.15;
  const x = (i) => padX + (i * (w - padX * 2)) / Math.max(1, snapshots.length - 1);
  const y = (v) => h - padY - ((v - lo) / (hi - lo)) * (h - padY * 2);
  const d = snapshots.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.net_worth).toFixed(1)}`).join(' ');
  const area = `${d} L${x(snapshots.length - 1).toFixed(1)},${h - padY} L${x(0).toFixed(1)},${h - padY} Z`;
  const active = hover != null ? snapshots[hover] : null;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="networth-chart" preserveAspectRatio="none"
           role="img" aria-label={`Net worth across ${snapshots.length} snapshots, ${fmtMoney(vals[0])} to ${fmtMoney(vals[vals.length - 1])}`}
           onMouseLeave={() => setHover(null)}
           onMouseMove={e => {
             const r = e.currentTarget.getBoundingClientRect();
             const rel = ((e.clientX - r.left) / r.width) * w;
             const i = Math.round(((rel - padX) / (w - padX * 2)) * (snapshots.length - 1));
             setHover(Math.max(0, Math.min(snapshots.length - 1, i)));
           }}>
        <path d={area} fill="var(--accent-2)" opacity="0.12" />
        <path d={d} fill="none" stroke="var(--accent-2)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {active && (
          <line x1={x(hover)} y1={padY} x2={x(hover)} y2={h - padY}
                stroke="var(--ink-4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
        <circle cx={x(snapshots.length - 1)} cy={y(vals[vals.length - 1])} r="3.5" fill="var(--accent-2)" />
        {active && <circle cx={x(hover)} cy={y(active.net_worth)} r="4" fill="var(--accent-2)"
                           stroke="var(--surface)" strokeWidth="2" />}
      </svg>
      <div className="chart-caption muted-2">
        {active
          ? <><span className="num">{fmtMoney(active.net_worth)}</span> on {active.date}</>
          : <>{snapshots[0].date} → {snapshots[snapshots.length - 1].date}</>}
      </div>
    </div>
  );
};
