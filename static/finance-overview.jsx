/* Finance — Overview tab.
   The month at a glance: totals, anything about to blow its budget, and every
   category's spend measured against where an even spend rate would have it today. */

const OverviewTab = ({ month, data }) => {
  const { categories, totalIn, totalEx, totalBudget, net, roommate, loading, error, reload } = data;

  const [hideStats, setHideStats] = useState(() => {
    try { return localStorage.getItem('finance-hide-stats') === '1'; } catch { return false; }
  });
  const toggleStats = () => setHideStats(s => {
    const nv = !s;
    try { localStorage.setItem('finance-hide-stats', nv ? '1' : '0'); } catch {}
    return nv;
  });

  const progress = monthProgress(month);
  const left = daysLeft(month);
  const isCurrent = month === currentMonth();

  // Spend-first ordering: the biggest line is the one worth looking at.
  const rows = useMemo(
    () => [...categories].sort((a, b) => (b.actual || 0) - (a.actual || 0)),
    [categories]
  );

  /* Anything projected to finish over budget, worst overshoot first. Only
     meaningful mid-month — a finished month is a fact, not a forecast. */
  const alerts = useMemo(() => {
    if (!isCurrent) return [];
    return rows
      .map(c => ({ c, st: paceStatus(c.actual, c.budget, progress) }))
      .filter(x => x.st.key === 'serious' || x.st.key === 'critical')
      .sort((a, b) => (b.st.projected - b.c.budget) - (a.st.projected - a.c.budget));
  }, [rows, progress, isCurrent]);

  const pctOfBudget = totalBudget > 0 ? (totalEx / totalBudget) * 100 : 0;

  return (
    <>
      <Panel
        title={`${monthLabel(month)} at a glance`}
        right={
          <button className="btn" onClick={toggleStats}
                  title={hideStats ? "Show income & totals" : "Hide income & totals"}>
            <Icon name={hideStats ? "eye-off" : "eye"} size={13} />{hideStats ? "Show totals" : "Hide totals"}
          </button>
        }
      >
        {hideStats ? (
          <div className="stat-strip" style={{ opacity: .55 }}>
            <div className="stat"><span className="l">Totals</span><span className="v num">•••• hidden</span></div>
          </div>
        ) : (
          <div className="stat-strip">
            <div className="stat">
              <span className="l">Income</span>
              <span className="v num pos">{fmtMoney(totalIn, { cents: false })}</span>
            </div>
            <div className="stat">
              <span className="l">Spent</span>
              <span className="v num">{fmtMoney(totalEx, { cents: false })}</span>
            </div>
            <div className="stat">
              <span className="l">Budget</span>
              <span className="v num muted">{fmtMoney(totalBudget, { cents: false })}</span>
            </div>
            <div className="stat">
              <span className="l">Net</span>
              <span className={"v num " + (net >= 0 ? "pos" : "neg")}>{fmtMoney(net, { cents: false })}</span>
            </div>
          </div>
        )}
        {isCurrent && (
          <p className="pace-summary">
            {left === 0
              ? "Last day of the month."
              : <>{left} day{left === 1 ? '' : 's'} left · {fmtPct(progress * 100)} through the month
                  {totalBudget > 0 && <> · {fmtPct(pctOfBudget)} of budget spent</>}</>}
          </p>
        )}
      </Panel>

      {alerts.length > 0 && (
        <Panel title="Needs attention" className="panel-alerts">
          <ul className="alert-list">
            {alerts.map(({ c, st }) => (
              <li key={c.name} className="alert-row" style={{ '--alert-color': st.color }}>
                <Icon name={st.icon} size={14} />
                <span className="alert-text">
                  <strong>{c.name}</strong>{' '}
                  {st.key === 'critical' ? (
                    <>is already over — {fmtMoney(c.actual, { cents: false })} spent of {fmtMoney(c.budget, { cents: false })},{' '}
                      {fmtMoney(c.actual - c.budget, { cents: false })} past budget with {left} day{left === 1 ? '' : 's'} to go.</>
                  ) : (
                    <>{fmtMoney(c.actual, { cents: false })} of {fmtMoney(c.budget, { cents: false })} with {left} day{left === 1 ? '' : 's'} left —
                      on track for {fmtMoney(st.projected, { cents: false })}.</>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Budget vs actual"
        right={<span className="muted-2" style={{ fontSize: 11.5 }}>
          {totalBudget > 0 ? `${fmtPct(pctOfBudget)} of budget` : 'no budget set'}
        </span>}
      >
        {(loading || error)
          ? <LoadState loading={loading} error={error} onRetry={() => reload(month)} what="the budget" />
          : rows.length === 0
            ? <Empty>Nothing logged for {monthLabel(month)} yet. Add an expense from the Transactions tab, or sync from Drive.</Empty>
            : (
              <>
                <div className="pace-legend">
                  <span className="pace-tick static" /> where an even spend rate would be today
                </div>
                <div className="pace-list">
                  {rows.map(c => (
                    <PaceBar key={c.name} name={c.name} actual={c.actual} budget={c.budget}
                             progress={progress}
                             share={totalIn > 0 ? (c.actual / totalIn) * 100 : null} />
                  ))}
                </div>
              </>
            )}
      </Panel>

      <RoommatePanel data={data} />
    </>
  );
};

/* The roommate's half of the shared utilities. Entered in the app rather than read
   from the Sheet so it survives the Sheet being unreachable; counted as income. */
const RoommatePanel = ({ data }) => {
  const { roommate, setRoommate } = data;
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState([]);

  const open = () => {
    setRows((roommate && roommate.items && roommate.items.length)
      ? roommate.items.map(it => ({ label: it.label, amount: String(it.full) }))
      : [{ label: 'Electricity', amount: '' }, { label: 'Internet', amount: '' }, { label: 'Water', amount: '' }]);
    setEditing(true);
  };
  const setRow = (i, field, val) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [field]: val } : r));
  const addRow = () => setRows(rs => [...rs, { label: '', amount: '' }]);
  const removeRow = (i) => setRows(rs => rs.filter((_, j) => j !== i));

  const save = async () => {
    const items = rows.map(r => ({ label: (r.label || '').trim(), amount: r.amount }))
                      .filter(r => r.label && r.amount !== '' && !isNaN(parseFloat(r.amount)));
    try {
      const res = await fetch('/api/finances/roommate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw 0;
      setRoommate(d.total > 0 ? d : null);
      setEditing(false);
      toastOk(items.length ? 'Roommate payment updated' : 'Roommate payment cleared');
    } catch { toastErr("Couldn’t save the roommate payment."); }
  };

  const pending = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  return (
    <Panel title="Roommate payment">
      {roommate && roommate.total > 0 ? (
        <div className="line-item">
          <div>
            <div className="line-item-name pos">Roommate owes</div>
            <div className="line-item-meta">
              half of {(roommate.items || []).map(it => it.label).join(' + ')}
            </div>
          </div>
          <span className="num pos">{fmtDelta(roommate.total)}</span>
          <button className="btn ghost icon-only" onClick={open}
                  aria-label="Edit roommate payment" title="Edit roommate payment">
            <Icon name="settings" size={13} />
          </button>
        </div>
      ) : !editing && (
        <Empty>
          No roommate split set up.{' '}
          <button className="btn ghost inline" onClick={open}><Icon name="plus" size={12} />Set one up</button>
        </Empty>
      )}

      {editing && (
        <div className="editor">
          <div className="editor-label">Full bills — the roommate is billed half of each</div>
          {rows.map((r, i) => (
            <div key={i} className="editor-row">
              <input className="input" placeholder="Utility (e.g. Electricity)" value={r.label}
                     onChange={e => setRow(i, 'label', e.target.value)} style={{ flex: 1 }} />
              <input className="input num" placeholder="Full bill" type="number" value={r.amount}
                     onChange={e => setRow(i, 'amount', e.target.value)} style={{ width: 96 }} />
              <button className="btn ghost icon-only" onClick={() => removeRow(i)}
                      aria-label="Remove row" title="Remove"><Icon name="x" size={12} /></button>
            </div>
          ))}
          <button className="btn ghost inline" onClick={addRow}><Icon name="plus" size={11} />Add utility</button>
          {pending > 0 && (
            <div className="muted-2" style={{ fontSize: 11.5 }}>
              Roommate owes {fmtMoney(pending / 2)} of {fmtMoney(pending)}
            </div>
          )}
          <div className="editor-actions">
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </Panel>
  );
};
