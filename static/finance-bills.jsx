/* Finance — Bills tab.
   Forward-looking view of the month: what's already gone out, what's still
   committed, and which day each recurring charge lands on. */

const BILL_STATUS = {
  paid:    { label: 'Paid',    icon: 'check',  color: 'var(--pace-good)' },
  posted:  { label: 'Posted',  icon: 'check',  color: 'var(--pace-good)' },
  due:     { label: 'Due',     icon: 'clock',  color: 'var(--ink-3)' },
  overdue: { label: 'Overdue', icon: 'flag',   color: 'var(--pace-crit)' },
};

const BillsTab = ({ month }) => {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/finances/upcoming?month=${month}`)
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .then(d => { setData(d); setLoading(false); setError(false); })
      .catch(() => { setLoading(false); setError(true); });
  }, [month]);

  useEffect(load, [load]);
  useRefreshListener(load);

  const items    = (data && data.items) || [];
  const outgoing = items.filter(i => !i.income);
  const incoming = items.filter(i => i.income);
  const remaining = outgoing.filter(i => i.status === 'due' || i.status === 'overdue');
  const settled   = outgoing.filter(i => i.status === 'paid' || i.status === 'posted');
  const isCurrent = month === currentMonth();
  const today     = new Date().getDate();

  // Bills bucketed onto their due day, for the calendar grid.
  const byDay = useMemo(() => {
    const m = {};
    outgoing.forEach(i => { if (i.due_day) (m[i.due_day] = m[i.due_day] || []).push(i); });
    return m;
  }, [outgoing]);

  const totalDays = (data && data.days_in_month) || daysInMonth(month);
  const firstWeekday = new Date(`${month}-01T12:00:00`).getDay();   // 0 = Sunday

  return (
    <>
      <Panel title={`Bills — ${monthLabel(month)}`}
             right={<button className="btn" onClick={load} title="Refresh"><Icon name="loader" size={13} />Refresh</button>}>
        {(loading || error)
          ? <LoadState loading={loading} error={error} onRetry={load} what="bills" />
          : (
            <>
              <div className="stat-strip">
                <div className="stat">
                  <span className="l">Still committed</span>
                  <span className="v num">{fmtMoney(data.committed_remaining, { cents: false })}</span>
                </div>
                <div className="stat">
                  <span className="l">Already out</span>
                  <span className="v num muted">{fmtMoney(data.paid_total, { cents: false })}</span>
                </div>
                <div className="stat">
                  <span className="l">Bills tracked</span>
                  <span className="v num muted">{outgoing.length}</span>
                </div>
              </div>
              {isCurrent && (
                <p className="pace-summary">
                  {remaining.length === 0
                    ? 'Everything tracked for this month has landed.'
                    : <>{remaining.length} charge{remaining.length === 1 ? '' : 's'} still expected
                        {daysLeft(month) === 0 ? ' before the month is out' :
                         daysLeft(month) === 1 ? ' tomorrow' :
                         ` over the next ${daysLeft(month)} days`}.</>}
                </p>
              )}
            </>
          )}
      </Panel>

      {!loading && !error && outgoing.length === 0 && (
        <Panel title="Nothing to show">
          <Empty>
            No dated bills for {monthLabel(month)}. Bills come from the due-date column of the
            month tab in your finance Sheet, plus whatever the Rocket Money import has seen.
          </Empty>
        </Panel>
      )}

      {!loading && !error && outgoing.length > 0 && (
        <>
          <Panel title="When they land">
            <div className="cal-grid" role="grid" aria-label={`Bill due dates for ${monthLabel(month)}`}>
              {['S','M','T','W','T','F','S'].map((d, i) => (
                <div key={i} className="cal-dow" aria-hidden="true">{d}</div>
              ))}
              {Array.from({ length: firstWeekday }).map((_, i) => <div key={'pad' + i} className="cal-pad" />)}
              {Array.from({ length: totalDays }, (_, i) => i + 1).map(day => {
                const bills = byDay[day] || [];
                const isToday = isCurrent && day === today;
                const dayTotal = bills.reduce((s, b) => s + b.amount, 0);
                return (
                  <div key={day} className={"cal-day" + (isToday ? " today" : "") + (bills.length ? " has-bills" : "")}>
                    <div className="cal-daynum">{day}</div>
                    {bills.map((b, i) => {
                      const st = BILL_STATUS[b.status] || BILL_STATUS.due;
                      return (
                        <div key={i} className="cal-bill" style={{ '--bill-color': st.color }}
                             title={`${b.name} — ${fmtMoney(b.amount)} · ${st.label}`}>
                          <Icon name={st.icon} size={9} />
                          <span className="cal-bill-name">{b.name}</span>
                        </div>
                      );
                    })}
                    {dayTotal > 0 && <div className="cal-total num muted-2">{fmtMoney(dayTotal, { cents: false })}</div>}
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Still to come"
                 right={<span className="num muted-2" style={{ fontSize: 11.5 }}>
                   {fmtMoney(data.committed_remaining, { cents: false })}
                 </span>}>
            {remaining.length === 0
              ? <Empty>Nothing outstanding.</Empty>
              : <BillList items={remaining} />}
            {incoming.length > 0 && (
              <>
                <div className="sub-head">Coming in</div>
                <BillList items={incoming} income />
              </>
            )}
          </Panel>

          {settled.length > 0 && (
            <Panel title="Already out"
                   right={<span className="num muted-2" style={{ fontSize: 11.5 }}>
                     {fmtMoney(data.paid_total, { cents: false })}
                   </span>}>
              <BillList items={settled} />
            </Panel>
          )}
        </>
      )}
    </>
  );
};

const BillList = ({ items, income }) => (
  <div className="bill-list">
    {items.map((b, i) => {
      const st = BILL_STATUS[b.status] || BILL_STATUS.due;
      return (
        <div key={i} className="bill-row">
          <span className="bill-day num muted-2">{b.due_day ? String(b.due_day).padStart(2, '0') : '—'}</span>
          <div className="bill-main">
            <div className="bill-name">{b.name}</div>
            <div className="bill-meta muted-2">
              {[b.category, b.account, b.source === 'subscription' ? 'subscription' : null]
                .filter(Boolean).join(' · ')}
            </div>
          </div>
          <span className="bill-status" style={{ color: income ? 'var(--pace-good)' : st.color }}>
            <Icon name={income ? 'plus' : st.icon} size={11} />
            <span>{income ? 'Incoming' : st.label}</span>
          </span>
          <span className={"num bill-amt" + (income ? " pos" : "")}>
            {income ? fmtDelta(b.amount) : fmtMoney(b.amount)}
          </span>
        </div>
      );
    })}
  </div>
);
