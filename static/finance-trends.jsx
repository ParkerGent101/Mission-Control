/* Finance — Trends tab.
   Month-over-month spend, read from the Sheet's month tabs.

   Deliberately small multiples rather than one many-coloured chart: with ten
   categories, no set of ten hues stays distinguishable under colour-vision
   deficiency once the series can appear in any order. One panel per category —
   each a single-hue line labelled by name — sidesteps that entirely and makes
   "which of these is drifting" a scan down a column instead of a legend hunt. */

const TrendsTab = ({ month }) => {
  const [range, setRange]     = useState(6);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch(`/api/finances/trends?months=${range}&end=${month}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
        return d;
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message || 'Could not load trends'); setLoading(false); });
  }, [range, month]);

  useEffect(load, [load]);

  const months = (data && data.months) || [];
  const labels = months.map(m => MONTH_NAMES[parseInt(m.month.slice(5), 10) - 1].slice(0, 3));

  /* The month in progress is only partly spent, so comparing it to finished
     months reads every category as a huge drop. Hold it out of every comparison
     and mark it on the charts; the numbers quoted are the last COMPLETE month. */
  const partialIdx = months.findIndex(m => m.month === currentMonth());
  const complete = partialIdx === -1 ? months : months.filter((_, i) => i !== partialIdx);
  const hasPartial = partialIdx !== -1;

  /* One row per category with any spend in the window, biggest total first.
     `delta` compares the last complete month against the mean of the ones before
     it — the "up 40% since May" line. */
  const rows = useMemo(() => {
    if (months.length < 2) return [];
    const names = new Set();
    months.forEach(m => Object.keys(m.categories || {}).forEach(n => names.add(n)));
    return [...names].map(name => {
      const values = months.map(m => Number((m.categories || {})[name]) || 0);
      const comp = complete.map(m => Number((m.categories || {})[name]) || 0);
      const latest = comp.length ? comp[comp.length - 1] : 0;
      const earlier = comp.slice(0, -1);
      const baseline = earlier.length ? earlier.reduce((s, v) => s + v, 0) / earlier.length : 0;
      const delta = (baseline > 0 && earlier.length) ? ((latest - baseline) / baseline) * 100 : null;
      return { name, values, latest, baseline, delta,
               total: values.reduce((s, v) => s + v, 0), periods: earlier.length };
    })
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total);
  }, [months, complete]);

  const movers = rows.filter(r => r.delta != null && Math.abs(r.delta) >= 25 && r.latest >= 25)
                     .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
                     .slice(0, 3);
  const compLabel = complete.length
    ? MONTH_NAMES[parseInt(complete[complete.length - 1].month.slice(5), 10) - 1]
    : '';

  return (
    <>
      <Panel
        title="Trends"
        right={
          <div className="seg" role="group" aria-label="Number of months">
            {[3, 6, 12].map(n => (
              <button key={n} className={"seg-btn" + (range === n ? " on" : "")}
                      aria-pressed={range === n} onClick={() => setRange(n)}>{n}m</button>
            ))}
          </div>
        }
      >
        {loading
          ? <LoadState loading what="trends" />
          : error
            ? <Empty>
                Couldn’t load trends — {error}.{' '}
                <button className="btn ghost inline" onClick={load}>Retry</button>
              </Empty>
            : months.length < 2
              ? <Empty>
                  Trends need at least two month tabs in the finance Sheet.
                  {data && data.skipped && data.skipped.length > 0 &&
                    <> Skipped: {data.skipped.join(', ')} — no matching tab.</>}
                </Empty>
              : (
                <>
                  <div className="stat-strip">
                    <div className="stat">
                      <span className="l">Avg income</span>
                      <span className="v num pos">
                        {fmtMoney(complete.reduce((s, m) => s + m.income, 0) / Math.max(1, complete.length), { cents: false })}
                      </span>
                    </div>
                    <div className="stat">
                      <span className="l">Avg spend</span>
                      <span className="v num">
                        {fmtMoney(complete.reduce((s, m) => s + m.expense, 0) / Math.max(1, complete.length), { cents: false })}
                      </span>
                    </div>
                    <div className="stat">
                      <span className="l">Full months</span>
                      <span className="v num muted">{complete.length}</span>
                    </div>
                  </div>
                  <p className="pace-summary">
                    {hasPartial && <>{monthLabel(months[partialIdx].month)} is still in progress, so it is
                      charted but held out of every average and comparison. </>}
                    {data.skipped && data.skipped.length > 0 &&
                      <>Skipped {data.skipped.join(', ')} — no matching tab in the Sheet.</>}
                  </p>
                  {movers.length > 0 && (
                    <ul className="alert-list" style={{ marginTop: 10 }}>
                      {movers.map(r => (
                        <li key={r.name} className="alert-row"
                            style={{ '--alert-color': r.delta > 0 ? 'var(--pace-serious)' : 'var(--pace-good)' }}>
                          <Icon name={r.delta > 0 ? 'flag' : 'check'} size={14} />
                          <span className="alert-text">
                            <strong>{r.name}</strong> is {r.delta > 0 ? 'up' : 'down'} {fmtPct(Math.abs(r.delta))} in {compLabel} vs
                            the previous {r.periods}-month average —{' '}
                            {fmtMoney(r.latest, { cents: false })} against {fmtMoney(r.baseline, { cents: false })}.
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
      </Panel>

      {!loading && !error && months.length >= 2 && (
        <>
          <Panel title="Income vs spend">
            <BarPairs months={months} labels={labels} partialIdx={partialIdx} />
          </Panel>

          <Panel title="By category"
                 right={<span className="muted-2" style={{ fontSize: 11.5 }}>
                   {labels[0]} → {labels[labels.length - 1]}
                 </span>}>
            <div className="sparks">
              {rows.map(r => (
                <div key={r.name} className="spark">
                  <div className="spark-head">
                    <span className="spark-name">{r.name}</span>
                    {r.delta != null && Math.abs(r.delta) >= 5 && (
                      <span className={"spark-delta num " + (r.delta > 0 ? "neg" : "pos")}
                            title={`${compLabel} vs the previous ${r.periods}-month average`}>
                        {r.delta > 0 ? '↑' : '↓'}{fmtPct(Math.abs(r.delta))}
                      </span>
                    )}
                  </div>
                  <MiniLine values={r.values} />
                  <div className="spark-foot muted-2">
                    <span className="num">{fmtMoney(r.latest, { cents: false })}</span> in {compLabel}
                    {r.baseline > 0 && <> · avg <span className="num">{fmtMoney(r.baseline, { cents: false })}</span></>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </>
  );
};

/* Income and spend side by side per month. Two series only, and they are
   labelled directly under the axis, so the pair stays readable without leaning
   on hue: income is the accent, spend is recessive ink. */
const BarPairs = ({ months, labels, partialIdx }) => {
  const max = Math.max(1, ...months.map(m => Math.max(m.income, m.expense)));
  return (
    <div className="bars">
      {months.map((m, i) => {
        const partial = i === partialIdx;
        return (
          <div key={m.month} className={"bar-col" + (partial ? " partial" : "")}
               title={`${monthLabel(m.month)} — in ${fmtMoney(m.income)}, out ${fmtMoney(m.expense)}` +
                      (partial ? ' (month still in progress)' : '')}>
            <div className="bar-pair">
              <div className="bar in"  style={{ height: (m.income  / max) * 100 + '%' }} />
              <div className="bar out" style={{ height: (m.expense / max) * 100 + '%' }} />
            </div>
            <div className="bar-label muted-2">{labels[i]}{partial && '*'}</div>
            <div className={"bar-net num " + (m.income - m.expense >= 0 ? "pos" : "neg")}>
              {fmtDelta(m.income - m.expense, { cents: false })}
            </div>
          </div>
        );
      })}
      <div className="bars-legend">
        <span><i className="swatch in" />Income</span>
        <span><i className="swatch out" />Spend</span>
        {partialIdx !== -1 && <span className="muted-2">* still in progress</span>}
      </div>
    </div>
  );
};
