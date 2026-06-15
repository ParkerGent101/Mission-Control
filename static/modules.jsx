/* Mission Control — module cards */
const { useState, useMemo, useEffect, useRef, useCallback } = React;

// Subscribe to the global 'mc:refresh' event so a card re-fetches without a page reload.
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

// Show a red error toast when a save fails (reuses window.__toast from app.jsx).
const toastErr = (m = "Couldn’t save — check your connection and try again") =>
  (window.__toast ? window.__toast(m, "error") : console.error(m));

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

// 3D bar-graph variant of the sparkline: extruded (isometric) bars standing on a
// receding grid floor. The three faces use stepped lightness so the faceting still
// reads after the app's amber monochrome filter (which preserves luminance, not hue).
const BarGraph3D = ({ data, color = "var(--accent-2)", height = 58 }) => {
  if (!data || data.length < 2) return null;
  const w = 200, h = height;
  const padX = 7, padTop = 9, padBot = 5;
  const dx = 7, dy = 6;                       // isometric depth offset
  const baseY = h - padBot;
  const topLimit = padTop + dy;
  const min = Math.min(...data), max = Math.max(...data);
  const range = (max - min) || 1;
  const n = data.length;
  const slot = (w - padX * 2 - dx) / n;
  const barW = Math.max(5, slot * 0.58);
  const minBarH = 7, maxBarH = baseY - topLimit;
  const bars = data.map((v, i) => {
    const x = padX + i * slot + (slot - barW) / 2;
    const bh = minBarH + ((v - min) / range) * (maxBarH - minBarH);
    return { x, topY: baseY - bh, bh };
  });
  const gridN = 4;
  const gridYs = Array.from({ length: gridN + 1 }, (_, k) => baseY - (k / gridN) * maxBarH);
  return (
    <svg className="spark spark-3d" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      {/* receding grid floor */}
      <g stroke={color} fill="none" strokeWidth="0.6">
        {gridYs.map((y, k) => (
          <g key={k}>
            <line x1={padX} y1={y} x2={w - padX} y2={y} strokeOpacity="0.24" />
            <line x1={w - padX} y1={y} x2={w - padX + dx} y2={y - dy} strokeOpacity="0.16" />
            <line x1={padX + dx} y1={y - dy} x2={w - padX + dx} y2={y - dy} strokeOpacity="0.10" />
          </g>
        ))}
        {Array.from({ length: n + 1 }, (_, k) => (
          <line key={'v' + k} x1={padX + k * slot} y1={baseY} x2={padX + k * slot + dx} y2={baseY - dy} strokeOpacity="0.12" />
        ))}
      </g>
      {/* extruded bars: side (dark) + top (bright) + front (mid) so the facets read in monochrome */}
      {bars.map((b, k) => (
        <g key={k}>
          <path d={`M${b.x + barW},${b.topY} l${dx},${-dy} l0,${b.bh} l${-dx},${dy} Z`} fill={color} fillOpacity="0.30" />
          <path d={`M${b.x},${b.topY} l${dx},${-dy} l${barW},0 l${-dx},${dy} Z`} fill={color} fillOpacity="0.92" />
          <rect x={b.x} y={b.topY} width={barW} height={b.bh} fill={color} fillOpacity="0.58" />
          <rect x={b.x} y={b.topY} width={barW} height={b.bh} fill="none" stroke={color} strokeOpacity="0.9" strokeWidth="0.5" />
        </g>
      ))}
    </svg>
  );
};

const Checkbox = ({ checked, onClick }) => (
  <span className={"checkbox" + (checked ? " checked" : "")} onClick={onClick}>
    {checked && <Icon name="check" size={11} stroke={2.5} />}
  </span>
);

// Deterministic per-day world: a string seed (a date) hashes to a fixed PRNG stream, so a
// given day always renders the same land/ocean layout but consecutive days differ.
const hashStr = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const todayStr = () => { try { return new Date().toISOString().slice(0, 10); } catch { return 'world'; } };

// Pie as territory on a 3D planet. In `war` mode it's a LIVE rotating globe whose WORLD is
// fixed for the day: the land:ocean ratio is seeded from `seed` (a date), so each day looks
// different, and the land is present from the START of the day as dim "unclaimed" terrain.
// As the factions (macros / expense categories in `data`) are logged, they CONQUER that land
// — the conquered fraction of all land = total / `whole` (goal / income), split among the
// factions by their share of the day's total. A battle front creeps across the frontier
// continent so the fill grows smoothly. Once the land is fully taken (at/over the goal,
// `alert`) the whole planet washes red. The non-war branch is a static smooth-globe fallback.
// Honors prefers-reduced-motion. Both the Finance and Health cards use `war`.
const DonutChart = ({ data, size = 110, war = false, labels = true, alert = false, whole = 0, ocean, landNeutral, seed, landRatio: landRatioProp }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  const [tick, setTick] = useState(0);   // animation clock (ms), war globe only
  useEffect(() => {
    if (!war) return;   // the war world exists (and spins) from day start, before anything is logged
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf, prev = null, acc = 0, last = 0;
    const loop = (t) => {
      if (prev !== null) acc += t - prev;
      prev = t;
      if (t - last > 33) { last = t; setTick(acc); }   // throttle to ~30fps
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [war, total]);

  // Non-war charts still need data to draw; the war planet renders its world even at zero logged.
  if (!total && !war) return <div style={{width:size,height:size,display:'flex',alignItems:'center',justifyContent:'center'}}><span className="muted-2 mono" style={{fontSize:10}}>no data</span></div>;
  const cx = size/2, cy = size/2, r = size * (war ? 0.38 : 0.44);   // war globe sits a touch smaller so a ring of space shows around it
  const uid = (war ? 'warplanet' : 'planet') + Math.round(size);
  const D = Math.PI/180, N = 16;
  const project = (lat, lon) => [cx + r*Math.cos(lat*D)*Math.sin(lon*D), cy - r*Math.sin(lat*D)];
  const toPath = (pts) => pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ');
  const rev = (pts) => pts.slice().reverse().map(p=>'L'+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ');
  const HATCH = ['-h0','-h1','-h2','-h3','-h4'];
  const FONT = Math.max(6.5, size*0.052);
  const labelOf = (s) => (s.label || '').split(/[ /]/)[0].slice(0,9).toUpperCase();
  const lats = [45,0,-45].map(a => ({ rx: r*Math.cos(a*D), ry: Math.max(0.6, r*Math.cos(a*D)*0.18), yc: cy - r*Math.sin(a*D) }));
  const mk = Math.max(2, size*0.03);
  // sawtooth front-line teeth (FEBA symbol) along a boundary, as one path string
  const teeth = (pts) => {
    let dstr = '';
    for (let k = 1; k < pts.length-2; k += 2) {
      const a = pts[k], b = pts[k+1];
      const dx=b[0]-a[0], dy=b[1]-a[1], len=Math.hypot(dx,dy)||1, ux=dx/len, uy=dy/len, nx=uy, ny=-ux;
      const mxp=(a[0]+b[0])/2, myp=(a[1]+b[1])/2, tH=Math.max(2.4,size*0.032), tW=len*0.5;
      dstr += `M${(mxp-ux*tW).toFixed(2)} ${(myp-uy*tW).toFixed(2)} L${(mxp+ux*tW).toFixed(2)} ${(myp+uy*tW).toFixed(2)} L${(mxp+nx*tH).toFixed(2)} ${(myp+ny*tH).toFixed(2)} Z `;
    }
    return dstr;
  };

  // Shared sphere shading + atmosphere, reused by both modes.
  const baseDefs = (
    <React.Fragment>
      <radialGradient id={uid+'-atmo'} cx="50%" cy="50%" r="50%">
        <stop offset="74%"  stopColor="var(--accent-2)" stopOpacity="0"/>
        <stop offset="95%"  stopColor="var(--accent-2)" stopOpacity="0.22"/>
        <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0"/>
      </radialGradient>
      <radialGradient id={uid+'-hi'} cx="33%" cy="26%" r="75%">
        <stop offset="0%"   stopColor="#fff" stopOpacity="0.34"/>
        <stop offset="40%"  stopColor="#fff" stopOpacity="0.07"/>
        <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
      </radialGradient>
      <radialGradient id={uid+'-limb'} cx="50%" cy="50%" r="50%">
        <stop offset="55%"  stopColor="#000" stopOpacity="0"/>
        <stop offset="86%"  stopColor="#000" stopOpacity="0.30"/>
        <stop offset="100%" stopColor="#000" stopOpacity="0.60"/>
      </radialGradient>
      <filter id={uid+'-ds'} x="-30%" y="-30%" width="160%" height="170%">
        <feDropShadow dx="0" dy={(size*0.05).toFixed(1)} stdDeviation={(size*0.05).toFixed(1)} floodColor="#000" floodOpacity="0.55"/>
      </filter>
      <clipPath id={uid+'-clip'}><circle cx={cx} cy={cy} r={r}/></clipPath>
    </React.Fragment>
  );
  const shading = (
    <React.Fragment>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-limb)`}/>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-hi)`}/>
    </React.Fragment>
  );
  const atmosphere = <circle cx={cx} cy={cy} r={(r*1.08).toFixed(2)} fill={`url(#${uid}-atmo)`}/>;
  const latRings = (
    <g fill="none" stroke="var(--accent-2)" strokeWidth="0.6" strokeOpacity="0.2">
      {lats.map((l,i)=><ellipse key={'la'+i} cx={cx} cy={l.yc.toFixed(2)} rx={l.rx.toFixed(2)} ry={l.ry.toFixed(2)}/>)}
    </g>
  );
  const outline = <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--accent)" strokeOpacity="0.9" strokeWidth="1.2"/>;

  // ===== WAR: a fixed world (set for the day) whose land gets conquered as you log =====
  // The land/ocean layout is seeded from the date, so each day's world differs — and the land
  // is there from the START of the day as dim "unclaimed" terrain. As the factions in `data`
  // are logged they conquer that land (conquered fraction of all land = total / goal), split
  // among factions by share of the day's total; a front creeps across the frontier continent
  // so the fill grows smoothly. At/over the goal (`alert`) the whole planet washes red.
  if (war) {
    const rot = tick * (360 / 60000);     // slow, steady spin (~60s/rev) — the map turns, it doesn't churn
    const noise = (x) => Math.sin(x);
    const loop = (pts) => toPath(pts) + ' Z';
    const denom = whole > 0 ? whole : total;                  // the full goal / income
    const conq = denom > 0 ? Math.max(0, Math.min(1, total / denom)) : 0;   // fraction of land taken
    const OCEAN = ocean || 'oklch(0.52 0.11 245)';            // default simple blue sea; cards may override
    const LANDN = landNeutral || 'var(--surface-3)';          // dim unclaimed terrain, present from day start
    const ROCK  = 'oklch(0.27 0.022 55)';                     // bare basalt — a rock world's backdrop, no real ocean
    const LAT = [12, -10, 22, -18, 6, -24, 16, -14];          // kept near the equator so land fills the visible face

    // ---- the world: continents seeded from the date, fixed for the day ----
    const wr = mulberry32(hashStr('mc-world|' + (seed || todayStr())));
    // World type, seeded per day: a rare "water world" (~1 in 20) where oceans dominate; a good
    // share of "rock worlds" (~1 in 3.5) that are essentially all land — the backdrop is bare rock,
    // not sea, so there's no real ocean (some get a small inland sea, some none at all); and the
    // rest land-heavy with a few seas/lakes.
    const u = wr();
    let baseLandRatio, rockWorld = false;
    if (u < 0.05) {                                           // water world: oceans dominate
      baseLandRatio = 0.30 + (u / 0.05) * 0.18;
    } else if (u < 0.33) {                                    // rock world: land on land, rock backdrop
      rockWorld = true;
      baseLandRatio = 0.97 + ((u - 0.05) / 0.28) * 0.03;      // 0.97 .. 1.0
    } else {                                                  // land-heavy with a few seas/lakes
      baseLandRatio = 0.90 + ((u - 0.33) / 0.67) * 0.09;      // 0.90 .. 0.99
    }
    const landRatio = landRatioProp != null ? landRatioProp : baseLandRatio;   // preview can override
    const K = 6 + Math.floor(wr() * 4);                       // 6–9 continents — tile the globe so land stays dominant at any rotation
    const weights = []; for (let k = 0; k < K; k++) weights.push(0.55 + wr());
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    const lonOff = wr() * 360;
    const world = [];
    for (let k = 0; k < K; k++) {
      const frac = weights[k] / wSum;                         // this continent's share of all land
      // Size blobs so the VISIBLE land fraction ≈ landRatio. Only the front hemisphere shows,
      // edge continents foreshorten, and blobs overlap — so nominal sphere-area runs ~3.0× the
      // target disc fraction. Higher ⇒ land-dominant; the cap keeps any one continent off-limb.
      const R = Math.min(r * 1.05, r * Math.sqrt(landRatio * frac * 4.4));
      world.push({ k, frac, R, blobSeed: 0.7 + k * 1.3,
        baseLon: (k / K) * 360 + lonOff + (wr() - 0.5) * 16,
        lat: LAT[Math.floor(wr() * LAT.length) % LAT.length] });
    }
    world.sort((a, b) => a.baseLon - b.baseLon);              // stable layout (by longitude)
    // A rock world may host a small inland sea or two — or none at all (truly zero ocean).
    const seas = [];
    if (rockWorld && wr() < 0.55) {
      const n = 1 + (wr() < 0.3 ? 1 : 0);
      for (let i = 0; i < n; i++) seas.push({ i, R: r * (0.11 + wr() * 0.13), blobSeed: 3.1 + i * 2.7,
        baseLon: wr() * 360, lat: LAT[Math.floor(wr() * LAT.length) % LAT.length] });
    }
    // Conquer in a scattered (low-discrepancy) order, NOT one contiguous longitude arc, so the
    // taken fraction is readable at any rotation instead of hiding on the planet's far side.
    const order = world.map((_, j) => j).sort((x, y) => ((x * 0.61803) % 1) - ((y * 0.61803) % 1));
    let acc = 0; order.forEach(j => { world[j].a = acc; acc += world[j].frac; world[j].b = acc; });

    // ---- factions (macros / expense categories) packed into the conquered span [0, conq] ----
    const facs = data.filter(d => !d.neutral && d.value > 0);
    const facTotal = facs.reduce((s, d) => s + d.value, 0) || 1;
    let fc = 0; const facSpans = facs.map((d, i) => {
      const seg = { d, start: fc, end: fc + (d.value / facTotal) * conq, hatch: HATCH[i % HATCH.length] };
      fc = seg.end; return seg;
    });
    const ownerAt = (pos) => facSpans.find(s => pos >= s.start && pos < s.end) || null;   // null ⇒ unclaimed

    // organic blob outline (closed loop) in local coords — a FIXED lobed shape per continent
    // (seeded only by bseed, no time term), so coastlines stay put and the globe's rotation is
    // the only thing that moves them. Stable borders that read like a real map.
    const blob = (R, bseed) => {
      const pts = [], M = 36;
      for (let q = 0; q < M; q++) {
        const a = (q / M) * Math.PI * 2;
        const w = 1 + 0.17*noise(3*a + bseed) + 0.11*noise(5*a + bseed*1.7) + 0.07*noise(8*a + bseed*2.3);
        pts.push([Math.cos(a) * R * w, Math.sin(a) * R * w]);
      }
      return pts;
    };
    // project each continent to the current view; cull the back hemisphere; resolve ownership
    const drawn = world.map(c => {
      const vlon = c.baseLon + rot;
      const f = Math.cos(vlon*D) * Math.cos(c.lat*D);          // >0 ⇒ front hemisphere
      const [px, py] = project(c.lat, vlon);
      const sx = Math.max(0.06, Math.abs(Math.cos(vlon*D)));   // horizontal foreshortening near limb
      const alpha = Math.max(0, Math.min(1, (f - 0.05) / 0.22));
      const pts = blob(c.R, c.blobSeed).map(([lx,ly]) => [px + lx*sx, py + ly]);
      const mid = (c.a + c.b) / 2;
      const owner = c.b <= conq ? ownerAt(Math.min(mid, conq - 1e-6)) : null;   // fully-conquered continent
      const straddles = c.a < conq && c.b > conq;              // the frontier continent (partly taken)
      const localConq = straddles ? (conq - c.a) / (c.b - c.a) : 0;   // 0..1 of this continent that's taken
      const frontOwner = straddles ? (ownerAt(Math.min(conq - 1e-6, c.b)) || facSpans[facSpans.length-1] || null) : null;
      // frontier conquest grows as a stable island from the continent's heart outward (area ∝ taken
      // fraction), centred on the land so it rotates WITH it — no screen-space curtain.
      const fsc = straddles ? Math.sqrt(Math.max(0, Math.min(1, localConq))) : 0;
      const frontPts = straddles ? pts.map(p => [px + (p[0]-px)*fsc, py + (p[1]-py)*fsc]) : null;
      return { ...c, f, alpha, px, py, sx, pts, owner, straddles, localConq, frontOwner, frontPts };
    }).filter(c => c.alpha > 0.02).sort((a,b) => a.f - b.f);   // far continents drawn first

    const named = drawn.filter(c => c.owner && c.alpha > 0.6 && c.R > r*0.14)
      .map(c => ({ ...c, text: labelOf(c.owner.d) }));
    // inland seas projected to the current view (rock worlds only); culled on the back hemisphere
    const seasDrawn = seas.map(sea => {
      const vlon = sea.baseLon + rot, f = Math.cos(vlon*D) * Math.cos(sea.lat*D);
      const [px, py] = project(sea.lat, vlon), sx = Math.max(0.06, Math.abs(Math.cos(vlon*D)));
      return { i: sea.i, alpha: Math.max(0, Math.min(1, (f - 0.05) / 0.22)),
        pts: blob(sea.R, sea.blobSeed).map(([lx,ly]) => [px + lx*sx, py + ly]) };
    }).filter(sea => sea.alpha > 0.02);

    // ===== orbital bombardment: tracer fire across a world at total war ==========
    // A deterministic salvo (seeded from the day, so it's stable per render yet differs day to
    // day) of ballistic missiles arcing over the globe. The number of launch tracks and their
    // tempo climb with how much land is conquered, and the whole barrage turns red and heaviest
    // once the goal is breached (`alert`). prefers-reduced-motion gets static arcs (no tick).
    const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const fr = mulberry32(hashStr('mc-war-fire|' + (seed || todayStr())));
    const intensity = (alert ? 1.0 : 0.45) + conq * 0.9;            // ~0.45 (idle) .. 1.9 (total war)
    const SLOTS = Math.round(2 + intensity * 2.2);                  // ~3 (idle) .. 6 (total war) — calmer skies
    const bez = (A, B, C, p) => { const u = 1 - p; return [u*u*A[0] + 2*u*p*B[0] + p*p*C[0], u*u*A[1] + 2*u*p*B[1] + p*p*C[1]]; };
    const arcStr = (A, B, C, p0, p1, n) => { let d = ''; for (let i = 0; i <= n; i++) { const pp = p0 + (p1 - p0) * (i / n), q = bez(A, B, C, pp); d += (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + ' '; } return d; };
    const IMPACT = 560;   // ms an impact flash lingers
    // Each tracer is colour-coded to the faction (macro / expense category) it fights for, picked
    // weighted by that faction's share of the day — so the lines read apart at a glance. Over the
    // goal the whole barrage burns red; with nothing logged yet, a calm amber ambient fire holds.
    const facHues = facs.map(f => f.color).filter(Boolean);
    const pickHue = (u) => { let c = 0; for (let i = 0; i < facs.length; i++) { c += facs[i].value / facTotal; if (u < c) return facs[i].color; } return facHues[facHues.length - 1]; };
    const colorFor = (u) => alert ? 'var(--danger)' : (facHues.length ? pickHue(u) : 'var(--warn)');
    const fire = [];
    for (let s = 0; s < SLOTS; s++) {
      const a0 = fr() * Math.PI * 2, rad0 = (0.22 + fr() * 0.6) * r;            // launch site on the visible disc
      const a1 = a0 + (0.55 + fr() * 0.7) * Math.PI * (fr() < 0.5 ? 1 : -1);    // strike a good arc away
      const rad1 = (0.22 + fr() * 0.6) * r;
      const S = [cx + Math.cos(a0) * rad0, cy + Math.sin(a0) * rad0];
      const T = [cx + Math.cos(a1) * rad1, cy + Math.sin(a1) * rad1];
      const mx2 = (S[0] + T[0]) / 2, my2 = (S[1] + T[1]) / 2;
      const chord = Math.hypot(T[0] - S[0], T[1] - S[1]) || 1;
      // bow the trajectory outward, away from the planet centre (lobbed into low orbit)
      let ox = mx2 - cx, oy = my2 - cy, ol = Math.hypot(ox, oy);
      if (ol < 1e-3) { ox = -(T[1] - S[1]); oy = T[0] - S[0]; ol = chord; }     // ~antipodal shot → bow off the chord
      const lift = chord * 0.22 + r * 0.14;
      const P = [mx2 + (ox / ol) * lift, my2 + (oy / ol) * lift];
      const beam = fr() < 0.30;                                                 // ~3 in 10 tracks fire a straight beam
      const flight = 1150 + fr() * 850;                                         // ms a warhead is airborne (slower, deliberate)
      // tempo: gaps shrink as the war intensifies, but stay long enough to feel deliberate, not frantic
      const period = Math.max(beam ? 2600 : flight + IMPACT + 600,
                              (5200 + fr() * 4200) / (0.55 + intensity * 0.55));
      fire.push({ s, S, P, T, period, phase: fr() * period, flight, beam, beamDur: 260 + fr() * 170, col: colorFor(fr()) });
    }

    // ===== 3D wireframe deck: the world sits on a green perspective grid that recedes for depth =====
    // No dark "space" fill — the card shows through and the receding grid alone carries the 3D illusion.
    // A ground plane below a horizon at hY: depth rows bunch toward the horizon and columns fan out to a
    // vanishing point behind the globe (which rests its lower third on the deck). Same green (--accent-2)
    // as the app's other grids; framed by a hard boundary with corner brackets.
    const pad = Math.max(2, size * 0.022);
    const inX0 = pad, inY0 = pad, inX1 = size - pad, inY1 = size - pad;   // inner panel rect
    const bezR = Math.max(2, size * 0.02);                               // slight corner round on the boundary
    const hY = cy + r * 0.52;                                            // horizon: the globe's lower third rests on the deck
    const VP = [cx, hY];                                                 // vanishing point for the floor grid
    // receding floor grid (perspective): depth rows bunch toward the horizon; columns fan out to the VP
    const ROWS = 7, COLS = 12;
    const gridRows = [];
    for (let i = 1; i <= ROWS; i++) { const tt = i / ROWS; gridRows.push(hY + (inY1 - hY) * (tt * tt)); }
    const gridCols = [];
    for (let j = 0; j <= COLS; j++) gridCols.push(inX0 + (inX1 - inX0) * (j / COLS));   // each fans from (x, inY1) → VP

    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{overflow:'visible'}}>
        <defs>
          {baseDefs}
          <pattern id={uid+'-h0'} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--bg)" strokeWidth="1.3" strokeOpacity="0.5"/></pattern>
          <pattern id={uid+'-h1'} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--bg)" strokeWidth="1.3" strokeOpacity="0.5"/></pattern>
          <pattern id={uid+'-h2'} width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 0H5M0 0V5" fill="none" stroke="var(--bg)" strokeWidth="0.9" strokeOpacity="0.45"/></pattern>
          <pattern id={uid+'-h3'} width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.1" fill="var(--bg)" fillOpacity="0.5"/></pattern>
          <pattern id={uid+'-h4'} width="6" height="6" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="6" y2="0" stroke="var(--bg)" strokeWidth="1.3" strokeOpacity="0.5"/></pattern>
          {/* ocean wave lines (read on both blue and white seas) */}
          <pattern id={uid+'-hn'} width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 3 Q1.75 1.4 3.5 3 T7 3" fill="none" stroke="var(--ink-3)" strokeWidth="0.6" strokeOpacity="0.25"/></pattern>
          {/* over-budget alert: red atmosphere halo */}
          <radialGradient id={uid+'-atmoR'} cx="50%" cy="50%" r="50%">
            <stop offset="58%"  stopColor="var(--danger)" stopOpacity="0"/>
            <stop offset="92%"  stopColor="var(--danger)" stopOpacity="0.55"/>
            <stop offset="100%" stopColor="var(--danger)" stopOpacity="0"/>
          </radialGradient>
          {/* soft glow for tracer fire + impact flashes */}
          <filter id={uid+'-glow'} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={(size*0.016).toFixed(1)}/>
          </filter>
          <clipPath id={uid+'-box'}><rect x={inX0.toFixed(1)} y={inY0.toFixed(1)} width={(inX1-inX0).toFixed(1)} height={(inY1-inY0).toFixed(1)} rx={bezR.toFixed(1)} ry={bezR.toFixed(1)}/></clipPath>
        </defs>
        {/* ===== 3D wireframe deck: a green receding grid that gives the depth (no space fill) ===== */}
        <g clipPath={`url(#${uid}-box)`}>
          {/* receding floor grid: a soft bloom under a crisp green wireframe (lines converge to the VP) */}
          <g fill="none" stroke="var(--accent-2)" strokeLinecap="round">
            <g strokeOpacity="0.18" strokeWidth="1.6" filter={`url(#${uid}-glow)`}>
              {gridRows.map((gy,i)=><line key={'rb'+i} x1={inX0.toFixed(1)} y1={gy.toFixed(1)} x2={inX1.toFixed(1)} y2={gy.toFixed(1)}/>)}
              {gridCols.map((xb,j)=><line key={'cb'+j} x1={xb.toFixed(1)} y1={inY1.toFixed(1)} x2={VP[0].toFixed(1)} y2={VP[1].toFixed(1)}/>)}
            </g>
            <g strokeOpacity="0.55" strokeWidth="0.7">
              {gridRows.map((gy,i)=><line key={'r'+i} x1={inX0.toFixed(1)} y1={gy.toFixed(1)} x2={inX1.toFixed(1)} y2={gy.toFixed(1)}/>)}
              {gridCols.map((xb,j)=><line key={'c'+j} x1={xb.toFixed(1)} y1={inY1.toFixed(1)} x2={VP[0].toFixed(1)} y2={VP[1].toFixed(1)}/>)}
            </g>
          </g>
          {/* horizon: where the deck recedes out of view */}
          <line x1={inX0.toFixed(1)} y1={hY.toFixed(1)} x2={inX1.toFixed(1)} y2={hY.toFixed(1)} stroke="var(--accent-2)" strokeWidth="0.8" strokeOpacity="0.5"/>
        </g>
        {alert ? <circle cx={cx} cy={cy} r={(r*1.08).toFixed(2)} fill={`url(#${uid}-atmoR)`}/> : atmosphere}
        <g filter={`url(#${uid}-ds)`}>
          <g clipPath={`url(#${uid}-clip)`}>
            {/* backdrop: open sea, or — on a rock world — bare rock with no real ocean */}
            <circle cx={cx} cy={cy} r={r} fill={rockWorld ? ROCK : OCEAN}/>
            {!rockWorld && <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-hn)`}/>}
            {latRings}
            {/* continents: unclaimed terrain (present from day start), then conquered faction colors */}
            {drawn.map(c => (
              <g key={'c'+c.k} opacity={c.alpha.toFixed(2)}>
                {/* base land = unclaimed territory (savings / not yet spent), dark border between countries */}
                <path d={loop(c.pts)} fill={LANDN} stroke="var(--bg)" strokeWidth="1" strokeLinejoin="round"/>
                {/* fully conquered: whole-continent faction colour + hatch */}
                {c.owner && <React.Fragment>
                  <path d={loop(c.pts)} fill={c.owner.d.color}/>
                  <path d={loop(c.pts)} fill={`url(#${uid}${c.owner.hatch})`}/>
                </React.Fragment>}
                {/* frontier: the faction's hold grows as a centred island with its own crisp border */}
                {c.straddles && c.frontOwner && c.localConq > 0.004 && (
                  <React.Fragment>
                    <path d={loop(c.frontPts)} fill={c.frontOwner.d.color}/>
                    <path d={loop(c.frontPts)} fill={`url(#${uid}${c.frontOwner.hatch})`}/>
                    <path d={loop(c.frontPts)} fill="none" stroke="var(--bone)" strokeWidth="1.1" strokeOpacity="0.9" strokeLinejoin="round"/>
                  </React.Fragment>
                )}
                {/* coastline / national border — always defined so every country reads clearly */}
                <path d={loop(c.pts)} fill="none" stroke={(c.owner || c.straddles) ? 'var(--bone)' : 'var(--ink-3)'}
                  strokeWidth={(c.owner || c.straddles) ? 1.4 : 1.0} strokeOpacity={(c.owner || c.straddles) ? 0.95 : 0.8} strokeLinejoin="round"/>
                {/* battle teeth mark only the active front line (the frontier island's edge) */}
                {c.straddles && c.frontPts && c.localConq > 0.03 && <path d={teeth(c.frontPts.filter((_,q)=>q%2===0))} fill="var(--bone)" fillOpacity="0.8"/>}
              </g>
            ))}
            {/* inland seas / lakes nestled in the rock (rock worlds only — the "little water") */}
            {seasDrawn.map(sea => (
              <g key={'sea'+sea.i} opacity={sea.alpha.toFixed(2)}>
                <path d={loop(sea.pts)} fill={OCEAN}/>
                <path d={loop(sea.pts)} fill={`url(#${uid}-hn)`}/>
                <path d={loop(sea.pts)} fill="none" stroke="var(--ink-4)" strokeWidth="0.7" strokeOpacity="0.55" strokeLinejoin="round"/>
              </g>
            ))}
            {/* at/over the goal: wash the whole world red (under the shading so it stays spherical) */}
            {alert && <circle cx={cx} cy={cy} r={r} fill="var(--danger)" opacity="0.45"/>}
            {shading}
          </g>
          {alert
            ? <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--danger)" strokeOpacity="0.95" strokeWidth="1.6"/>
            : outline}
          {labels && named.map(c => (
            <text key={'t'+c.k} x={c.px.toFixed(2)} y={c.py.toFixed(2)} textAnchor="middle" dominantBaseline="middle" opacity={c.alpha.toFixed(2)}
              fontFamily="var(--font-mono)" fontSize={FONT.toFixed(1)} fontWeight="700" letterSpacing="0.5"
              fill="var(--bone)" stroke="var(--bg)" strokeWidth={(FONT*0.32).toFixed(1)} paintOrder="stroke" strokeLinejoin="round">{c.text}</text>
          ))}
        </g>
        {/* ===== orbital bombardment: tracer fire over the war world ===== */}
        <g>
          {fire.map(m => {
            // --- static fallback (no animation clock under prefers-reduced-motion) ---
            if (reduced) {
              return (
                <g key={'f' + m.s}>
                  {m.beam
                    ? <line x1={m.S[0].toFixed(1)} y1={m.S[1].toFixed(1)} x2={m.T[0].toFixed(1)} y2={m.T[1].toFixed(1)}
                        stroke={m.col} strokeWidth={Math.max(0.8, size*0.008)} strokeOpacity="0.5" strokeDasharray="1 3" strokeLinecap="round"/>
                    : <path d={arcStr(m.S, m.P, m.T, 0, 1, 18)} fill="none" stroke={m.col} strokeWidth={Math.max(0.8, size*0.008)} strokeOpacity="0.5" strokeDasharray="2 3" strokeLinecap="round"/>}
                  <circle cx={m.T[0].toFixed(1)} cy={m.T[1].toFixed(1)} r={Math.max(1.4, size*0.014)} fill={m.col} fillOpacity="0.8"/>
                </g>
              );
            }
            const t = (tick + m.phase) % m.period;

            // --- straight beam strike: snap on bright, then fade, flashes at both ends ---
            if (m.beam) {
              if (t >= m.beamDur) return null;
              const k = t / m.beamDur, op = 1 - k;                          // 0..1 across the strike
              const muzzle = Math.max(0, 1 - k * 1.6);
              const flash = Math.max(1.5, size*0.02) * op;
              return (
                <g key={'f' + m.s}>
                  <line x1={m.S[0].toFixed(1)} y1={m.S[1].toFixed(1)} x2={m.T[0].toFixed(1)} y2={m.T[1].toFixed(1)}
                    stroke={m.col} strokeWidth={Math.max(2, size*0.03)} strokeOpacity={(op*0.2).toFixed(2)} strokeLinecap="round" filter={`url(#${uid}-glow)`}/>
                  <line x1={m.S[0].toFixed(1)} y1={m.S[1].toFixed(1)} x2={m.T[0].toFixed(1)} y2={m.T[1].toFixed(1)}
                    stroke={m.col} strokeWidth={Math.max(1, size*0.012*op).toFixed(1)} strokeOpacity={(0.5 + op*0.45).toFixed(2)} strokeLinecap="round"/>
                  {/* thin white-hot core keeps the bolt crisp even over a same-hue sea */}
                  <line x1={m.S[0].toFixed(1)} y1={m.S[1].toFixed(1)} x2={m.T[0].toFixed(1)} y2={m.T[1].toFixed(1)}
                    stroke="var(--bone)" strokeWidth={Math.max(0.5, size*0.004).toFixed(1)} strokeOpacity={(op*0.85).toFixed(2)} strokeLinecap="round"/>
                  <circle cx={m.S[0].toFixed(1)} cy={m.S[1].toFixed(1)} r={(flash*0.7).toFixed(1)} fill={m.col} fillOpacity={muzzle.toFixed(2)}/>
                  <circle cx={m.T[0].toFixed(1)} cy={m.T[1].toFixed(1)} r={flash.toFixed(1)} fill="var(--bone)" fillOpacity={op.toFixed(2)} filter={`url(#${uid}-glow)`}/>
                </g>
              );
            }

            // --- arcing ballistic missile: comet trail brightening toward a glowing warhead ---
            if (t < m.flight) {
              const p = t / m.flight, tail = Math.max(0, p - 0.45), h = bez(m.S, m.P, m.T, p);
              const hr = Math.max(1.3, size * 0.014);
              return (
                <g key={'f' + m.s}>
                  <path d={arcStr(m.S, m.P, m.T, tail, p, 14)} fill="none" stroke={m.col} strokeWidth={Math.max(2, size*0.026)} strokeOpacity="0.16" strokeLinecap="round" filter={`url(#${uid}-glow)`}/>
                  <path d={arcStr(m.S, m.P, m.T, tail, p, 14)} fill="none" stroke={m.col} strokeWidth={Math.max(0.8, size*0.008)} strokeOpacity="0.42" strokeLinecap="round"/>
                  <path d={arcStr(m.S, m.P, m.T, tail + (p - tail) * 0.55, p, 9)} fill="none" stroke={m.col} strokeWidth={Math.max(1, size*0.012)} strokeOpacity="0.9" strokeLinecap="round"/>
                  {/* thin white-hot core on the leading length — refined tracer, always legible */}
                  <path d={arcStr(m.S, m.P, m.T, tail + (p - tail) * 0.72, p, 5)} fill="none" stroke="var(--bone)" strokeWidth={Math.max(0.5, size*0.0045).toFixed(1)} strokeOpacity="0.85" strokeLinecap="round"/>
                  <circle cx={h[0].toFixed(1)} cy={h[1].toFixed(1)} r={(hr*1.9).toFixed(1)} fill={m.col} fillOpacity="0.35" filter={`url(#${uid}-glow)`}/>
                  <circle cx={h[0].toFixed(1)} cy={h[1].toFixed(1)} r={hr.toFixed(1)} fill={m.col}/>
                  <circle cx={h[0].toFixed(1)} cy={h[1].toFixed(1)} r={(hr*0.42).toFixed(1)} fill="var(--bone)"/>
                </g>
              );
            }

            // --- impact flash where the warhead lands: expanding ring + fading bloom ---
            const it = t - m.flight;
            if (it < IMPACT) {
              const k = it / IMPACT, rad = Math.max(1.5, size*0.012) + k * size * 0.07;
              return (
                <g key={'f' + m.s} opacity={(1 - k).toFixed(2)}>
                  <circle cx={m.T[0].toFixed(1)} cy={m.T[1].toFixed(1)} r={rad.toFixed(1)} fill="none" stroke={m.col} strokeWidth={Math.max(1, size*0.012*(1-k)).toFixed(1)}/>
                  <circle cx={m.T[0].toFixed(1)} cy={m.T[1].toFixed(1)} r={(Math.max(1.6, size*0.022)*(1-k)).toFixed(1)} fill="var(--bone)" filter={`url(#${uid}-glow)`}/>
                </g>
              );
            }
            return null;
          })}
        </g>
        {/* ===== boundary: a hard green frame + corner brackets containing the deck ===== */}
        <rect x={inX0.toFixed(1)} y={inY0.toFixed(1)} width={(inX1-inX0).toFixed(1)} height={(inY1-inY0).toFixed(1)} rx={bezR.toFixed(1)} ry={bezR.toFixed(1)}
          fill="none" stroke="var(--accent-2)" strokeOpacity="0.4" strokeWidth="1"/>
        {(() => {
          const b = Math.max(7, size * 0.085);     // corner bracket arm length
          const C = (x, y, sx, sy) => `M${(x+sx*b).toFixed(1)} ${y.toFixed(1)}H${x.toFixed(1)}V${(y+sy*b).toFixed(1)}`;
          return (
            <path d={[C(inX0+2, inY0+2, 1, 1), C(inX1-2, inY0+2, -1, 1), C(inX0+2, inY1-2, 1, -1), C(inX1-2, inY1-2, -1, -1)].join(' ')}
              fill="none" stroke="var(--accent-2)" strokeOpacity="0.8" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          );
        })()}
      </svg>
    );
  }

  // ===== Non-war: static smooth globe (fallback for non-themed charts) =====
  const cuts = [0]; { let a = 0; data.forEach(d => { a += d.value; cuts.push(a / total); }); }
  const bnd = cuts.map(f => { const lon = -90 + f*180; const pts = []; for (let k=0;k<=N;k++){ const lat = 90-(k/N)*180; pts.push(project(lat, lon)); } return pts; });
  const bands = data.map((d, i) => {
    const pc = -90 + ((cuts[i]+cuts[i+1])/2)*180; const [mx,my] = project(8, pc);
    return {...d, path: toPath(bnd[i+1]) + ' ' + rev(bnd[i]) + ' Z', mx, my, share: d.value/total };
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{overflow:'visible'}}>
      <defs>{baseDefs}</defs>
      {atmosphere}
      <g filter={`url(#${uid}-ds)`}>
        <g clipPath={`url(#${uid}-clip)`}>
          {bands.map((s,i)=><path key={i} d={s.path} fill={s.color} stroke="var(--bg)" strokeWidth="1.4"/>)}
          {latRings}
          {shading}
        </g>
        {outline}
        {bands.map((s,i)=> s.share < 0.06 ? null : (
          <path key={'m'+i} d={`M${s.mx.toFixed(2)} ${(s.my-mk).toFixed(2)} L${(s.mx+mk).toFixed(2)} ${(s.my+mk*0.8).toFixed(2)} L${(s.mx-mk).toFixed(2)} ${(s.my+mk*0.8).toFixed(2)} Z`}
            fill="var(--bone)" stroke="var(--bg)" strokeWidth="0.4"/>
        ))}
      </g>
    </svg>
  );
};

// Per-card collapse state, persisted to localStorage keyed by the card's stable id.
const readCollapsed = () => {
  try { return JSON.parse(localStorage.getItem("mc_collapsed") || "{}"); }
  catch { return {}; }
};

const Card = ({ id, num, title, right, children, span = 6, hidden, bodyClass = "", onDashboardMinimize }) => {
  const key = id || num || title;
  const [collapsed, setCollapsed] = useState(() => !!readCollapsed()[key]);
  const dashboardMinimize = typeof onDashboardMinimize === "function";

  const toggle = () => {
    if (dashboardMinimize) {
      onDashboardMinimize(key);
      return;
    }
    setCollapsed(prev => {
      const next = !prev;
      const map = readCollapsed();
      if (next) map[key] = true; else delete map[key];
      try { localStorage.setItem("mc_collapsed", JSON.stringify(map)); } catch {}
      return next;
    });
  };

  return (
    <div className={`span-${span}`} style={{ display: "flex" }}>
      <div className="card" data-hidden={hidden ? "true" : undefined}
        data-collapsed={!dashboardMinimize && collapsed ? "true" : undefined} style={{ flex: 1 }}>
        <div className="card-head">
          <div className="title">{title}</div>
          <div className="right">
            {(!collapsed || dashboardMinimize) && right}
            <button className="icon-btn card-collapse-btn" onClick={toggle}
              title={dashboardMinimize ? "Minimize from dashboard" : collapsed ? "Expand card" : "Minimize card"}
              aria-label={dashboardMinimize ? "Minimize from dashboard" : collapsed ? "Expand card" : "Minimize card"}>
              <Icon name={!dashboardMinimize && collapsed ? "plus" : "x"} size={11} />
            </button>
          </div>
        </div>
        {(!collapsed || dashboardMinimize) && <div className={"card-body " + bodyClass}>{children}</div>}
      </div>
    </div>
  );
};

// =========================================================
// TODAY / AGENDA
// =========================================================
const TAG_COLOR = { Work:"info", IT:"info", Cal:"mint", band:"violet", Personal:"mint", default:"" };

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

  const loadAgenda = () => {
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
      const upcoming = data
        .filter(r => r.next_due)
        .sort((a,b) => a.next_due.localeCompare(b.next_due))
        .slice(0, 6);
      setReminders(upcoming);
    }).catch(() => {});
  };
  useEffect(loadAgenda, []);
  useRefreshListener(loadAgenda);

  const toggle = (id) => {
    setItems(xs => xs.filter(x => x.id !== id));
    fetch(`/api/agenda/${id}/toggle`, { method: 'POST' })
      .then(r => { if (!r.ok) throw 0; })
      .catch(() => { toastErr("Couldn’t update that item — reloading."); loadAgenda(); });
  };

  const snoozeReminder = async (rid) => {
    setReminders(rs => rs.filter(r => r.id !== rid));
    try {
      const r = await fetch(`/api/reminders/${rid}/snooze`, { method:'POST' });
      if (!r.ok) throw 0;
    } catch { toastErr("Couldn’t snooze that reminder — reloading."); loadAgenda(); }
  };

  const calNet  = calories.consumed - calories.burned;
  const calLeft = calories.target - calNet;
  const today = new Date().toISOString().slice(0, 10);
  const morning   = items.filter(i => parseInt(i.time) < 12);
  const afternoon = items.filter(i => parseInt(i.time) >= 12);

  return (
    <Card id="agenda" num="01" title={`Today — ${new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}`} span={12}
      right={<>
        <span className="mono muted-2" style={{ fontSize: 11 }}>{items.length} left</span>
        <button className="btn" onClick={async () => {
          const label = prompt("Add agenda item:");
          if (!label) return;
          const time = prompt("Time (HH:MM):", "09:00") || "09:00";
          try {
            const res = await fetch('/api/agenda', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({label, time, tag:"Personal", color:"mint", date:today}) });
            if (!res.ok) throw 0;
            const d = await res.json();
            setItems(xs => [...xs, { id: d.id, time, label, tag: "Personal", color: "mint", done: false, date: today }]);
          } catch { toastErr("Couldn’t add that item — try again."); }
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
// Amber palette (warm hues, stepped lightness) so the donut/swatches stay
// distinguishable while keeping the white + amber-accent theme — no off-hue colors.
const FIN_CATS = [
  { name: "Housing",       budget: 987,  color: "oklch(0.88 0.11 90)" },
  { name: "Utilities",     budget: 450,  color: "oklch(0.58 0.12 66)" },
  { name: "Subscriptions", budget: 125,  color: "oklch(0.92 0.09 98)" },
  { name: "Food / Grocery", budget: 400,  color: "oklch(0.64 0.14 56)" },
  { name: "Fun",           budget: 500,  color: "oklch(0.83 0.12 80)" },
  { name: "Gas",           budget: 300,  color: "oklch(0.54 0.11 46)" },
  { name: "Shopping",      budget: 0,    color: "oklch(0.76 0.11 92)" },
  { name: "Band",          budget: 0,    color: "oklch(0.48 0.10 40)" },
  { name: "Loans",         budget: 500,  color: "oklch(0.70 0.13 70)" },
  { name: "Other",         budget: 0,    color: "oklch(0.40 0.05 82)" },
];
const FIN_CAT_NAMES = FIN_CATS.map(c => c.name);
const FIN_CAT_COLOR = Object.fromEntries(FIN_CATS.map(c => [c.name, c.color]));
const normFinCat = (raw, fallback = "") => {
  const map = {
    Housing: "Housing", Utilities: "Utilities", Subscriptions: "Subscriptions",
    "Food / Grocery": "Food / Grocery", "Food / Grocer": "Food / Grocery", Fun: "Fun", Gas: "Gas",
    Shopping: "Shopping", Band: "Band", Loans: "Loans", Other: "Other",
    // Sheet typos / variants → canonical
    Utilites: "Utilities", Utilties: "Utilities",
    "Water, Sewer, Trash": "Utilities", Electricity: "Utilities", Internet: "Utilities",
    Water: "Utilities", Sewer: "Utilities", Trash: "Utilities", Phone: "Utilities",
    Food: "Food / Grocery", Groceries: "Food / Grocery", Grocery: "Food / Grocery", Grocer: "Food / Grocery",
    Restaurants: "Fun", Dining: "Fun",
    Streaming: "Subscriptions", Subscription: "Subscriptions",
    Transportation: "Gas", Auto: "Gas", Fuel: "Gas",
    Rent: "Housing", Mortgage: "Housing", "Renters Insurance": "Housing",
    Loan: "Loans",
    // lowercase fallbacks
    housing: "Housing", utilities: "Utilities", subscriptions: "Subscriptions",
    food: "Food / Grocery", grocery: "Food / Grocery", grocer: "Food / Grocery", dining: "Fun", transport: "Gas",
    shopping: "Shopping", band: "Band", loans: "Loans",
    entertainment: "Fun", health: "Other", personal: "Other",
    IT: "Other", coding: "Other", gift: "Other", tax_refund: "Other", freelance: "Other",
  };
  const substr = [
    ["renters insurance", "Housing"], ["rent", "Housing"], ["mortgage", "Housing"],
    ["internet", "Utilities"], ["electric", "Utilities"], ["water", "Utilities"],
    ["sewer", "Utilities"], ["trash", "Utilities"], ["phone", "Utilities"],
    ["grocery", "Food / Grocery"], ["grocer", "Food / Grocery"],
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

const FinanceCard = ({ cardProps = {} } = {}) => {
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const defaultCategories = FIN_CATS.filter(c => c.budget > 0).map(c => ({ ...c, actual: 0 }));

  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [txns, setTxns] = useState([]);
  const [subs, setSubs] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddSub, setShowAddSub] = useState(false);
  const [desc, setDesc] = useState(""); const [amt, setAmt] = useState(""); const [type, setType] = useState("expense"); const [cat, setCat] = useState("Housing");
  const [subName, setSubName] = useState(""); const [subAcct, setSubAcct] = useState(""); const [subAmt, setSubAmt] = useState(""); const [subDue, setSubDue] = useState("");
  const [subEditId, setSubEditId] = useState(null);   // id of subscription being edited (reuses the add form)
  const catOverrides = React.useRef({});
  const [budget, setBudget] = React.useState(null);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(null);   // null = idle; [] = synced w/ nothing new; [...] = review queue
  const [bankConnected, setBankConnected] = useState(null);  // null = unknown, false = no Plaid items, true = linked
  const [connecting, setConnecting] = useState(false);
  const [collapsedCats, setCollapsedCats] = useState({});
  const toggleCat = (name) => setCollapsedCats(s => ({...s, [name]: !s[name]}));
  // Mobile: Overview / Transactions / Subscriptions become horizontally swipeable panes.
  const swipeRef = React.useRef(null);
  const [pane, setPane] = useState(0);
  const goPane = (i) => { const el = swipeRef.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' }); setPane(i); };
  const onSwipeScroll = () => { const el = swipeRef.current; if (!el) return; const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth)); setPane(p => p === i ? p : i); };
  const [hideStats, setHideStats] = useState(() => {
    try { return localStorage.getItem('finance-hide-stats') === '1'; } catch { return false; }
  });
  const toggleStats = () => setHideStats(s => {
    const nv = !s;
    try { localStorage.setItem('finance-hide-stats', nv ? '1' : '0'); } catch {}
    return nv;
  });

  const loadFinances = (m) => {
    fetch(`/api/finances?month=${m}`).then(r=>r.json()).then(data => {
      setTxns((Array.isArray(data) ? data : []).map(t => ({
        merchant: t.description,
        cat: catOverrides.current[t.id] ?? normFinCat(t.category, t.description),
        amount: t.type === 'expense' ? -t.amount : t.amount,
        date: t.date ? new Date(t.date + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '',
        color: t.type === 'income' ? 'var(--accent-2)' : 'var(--ink-4)',
        pending: false, id: t.id, source: t.source,
        sheet_tab: t.sheet_tab, sheet_row: t.sheet_row, sheet_col: t.sheet_col,
        sheet_cols: t.sheet_cols, sheet_kind: t.sheet_kind
      })));
    }).catch(()=>{});
    fetch(`/api/finances/budget?month=${m}`).then(r=>r.json()).then(data => {
      if (!data.error) setBudget(data);
    }).catch(()=>{});
  };

  useEffect(() => { loadFinances(month); }, [month]);
  useEffect(() => {
    fetch('/api/finances/subscriptions').then(r=>r.json()).then(setSubs).catch(()=>{});
    fetch('/api/plaid/status').then(r=>r.json()).then(d => setBankConnected(!!d.connected)).catch(()=>setBankConnected(null));
  }, []);
  useRefreshListener(() => {
    loadFinances(month);
    fetch('/api/finances/subscriptions').then(r=>r.json()).then(setSubs).catch(()=>{});
    fetch('/api/plaid/status').then(r=>r.json()).then(d => setBankConnected(!!d.connected)).catch(()=>{});
  });
  const changeMonth = (dir) => {
    const [y, m] = month.split('-').map(Number);
    let nm = m + dir, ny = y;
    if (nm > 12) { nm = 1; ny++; } if (nm < 1) { nm = 12; ny--; }
    setMonth(`${ny}-${String(nm).padStart(2,'0')}`);
  };
  const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  const logExpense = async () => {
    if (!desc || !amt) return;
    const res = await fetch('/api/finances', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ description: desc, amount: parseFloat(amt), type, category: cat, date: todayLocal() }) });
    if (!res.ok) {
      const body = await res.json().catch(()=>({}));
      alert(body.error || `Failed to add expense (${res.status})`);
      return;
    }
    setDesc(''); setAmt(''); setShowAdd(false);
    loadFinances(month);
  };

  // Sheet-tracked expense categories (the only ones Plaid imports can write to).
  const SHEET_CATS = ["Food / Grocery", "Fun", "Gas", "Housing", "Utilities"];

  const syncBank = async () => {
    setSyncing(true);
    try {
      const r = await fetch('/api/plaid/sync');
      const d = await r.json();
      if (!r.ok || d.error) { alert(d.error || 'Bank sync failed'); setSyncing(false); return; }
      const rows = (d.pending || []).map(t => ({ ...t, include: true }));
      setPending(rows);
      if (rows.length === 0) window.__toast?.('No new transactions to import', 'info');
    } catch { alert('Bank sync failed — is Plaid configured?'); }
    setSyncing(false);
  };

  // Link a real bank via Plaid Link (mirrors connectPlaid() in onboarding.jsx) so a
  // bank can be connected outside the first-run onboarding wizard.
  const connectBank = async () => {
    if (!window.Plaid) { window.__toast?.('Plaid not loaded — is PLAID_CLIENT_ID set?', 'error'); return; }
    setConnecting(true);
    try {
      const r = await fetch('/api/plaid/link_token', { method:'POST', headers:{'Content-Type':'application/json'} });
      const d = await r.json();
      if (!r.ok || d.error) { setConnecting(false); window.__toast?.(d.error || 'Could not start Plaid', 'error'); return; }
      // Persist the link_token so an OAuth bank (e.g. Fidelity) can resume after it
      // redirects the page back here — see the OAuth handoff effect in app.jsx.
      localStorage.setItem('mc_plaid_link_token', d.link_token);
      const handler = window.Plaid.create({
        token: d.link_token,
        onSuccess: async (publicToken) => {
          await fetch('/api/plaid/exchange', { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ public_token: publicToken }) });
          localStorage.removeItem('mc_plaid_link_token');
          setBankConnected(true); setConnecting(false);
          window.__toast?.('Bank account connected', 'success');
          syncBank();   // pull the first batch straight into the review queue
        },
        onExit: () => { localStorage.removeItem('mc_plaid_link_token'); setConnecting(false); },
      });
      handler.open();
    } catch { setConnecting(false); window.__toast?.('Plaid connection failed', 'error'); }
  };

  const importPending = async () => {
    const chosen = (pending || []).filter(t => t.include);
    const skip = (pending || []).filter(t => !t.include).map(t => t.id);
    setSyncing(true);
    try {
      if (chosen.length) {
        const r = await fetch('/api/plaid/import', { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ transactions: chosen }) });
        const d = await r.json();
        if (d.written) window.__toast?.(`Imported ${d.written} transaction${d.written===1?'':'s'} to the Sheet`, 'success');
        if (d.failed) alert(`${d.failed} couldn’t be imported:\n` + (d.errors||[]).map(e => typeof e==='string'?e:JSON.stringify(e)).join('\n'));
      }
      if (skip.length) {
        await fetch('/api/plaid/skip', { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ ids: skip }) }).catch(()=>{});
      }
    } catch { alert('Import failed'); }
    setPending(null); setSyncing(false);
    loadFinances(month);
  };

  const addSub = async () => {
    if (!subName || !subAmt) return;
    const editing = subEditId != null;
    const payload = { name: subName, acct: subAcct, amt: parseFloat(subAmt), due: subDue };
    try {
      const r = await fetch(editing ? `/api/finances/subscriptions/${subEditId}` : '/api/finances/subscriptions',
        { method: editing ? 'PATCH' : 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (!r.ok) throw 0;
      const res = await r.json();
      const okStatuses = ['written','updated','not_configured','cleared'];
      if (res.sheet_status && !okStatuses.includes(res.sheet_status)) {
        const msg = res.sheet_status === 'section_full'
          ? "Saved locally — the Subscriptions section in your Sheet has no empty rows. Add a blank row and re-sync."
          : `Saved locally — Sheet write failed (${res.sheet_status}).`;
        alert(msg);
      }
      if (editing) setSubs(s => s.map(x => x.id===subEditId ? { ...x, ...payload } : x));
      else setSubs(s => [...s, { id: res.id, ...payload }]);
    } catch { toastErr("Couldn’t save subscription — try again."); return; }
    setSubName(''); setSubAcct(''); setSubAmt(''); setSubDue('');
    setSubEditId(null); setShowAddSub(false);
    loadFinances(month);
  };

  const startEditSub = (s) => {
    setSubEditId(s.id);
    setSubName(s.name||''); setSubAcct(s.acct||''); setSubAmt(String(s.amt||'')); setSubDue(s.due||'');
    setShowAddSub(true);
  };

  const deleteSub = async (sid) => {
    setSubs(s => s.filter(x => x.id !== sid));
    const res = await fetch(`/api/finances/subscriptions/${sid}`, { method:'DELETE' }).then(r=>r.json()).catch(()=>({}));
    if (res.sheet_status && !['cleared','not_configured','not_found'].includes(res.sheet_status)) {
      alert(`Removed from the app, but the Sheet update failed (${res.sheet_status}). It may reappear on next sync.`);
    }
  };

  // Edit an existing expense transaction (amount / description); category stays the same.
  const editTxn = async (t, changes) => {
    const newCat = catOverrides.current[t.id] ?? normFinCat(t.cat, t.merchant);
    const prev = txns;
    setTxns(ts => ts.map(x => x.id===t.id ? {
      ...x,
      amount: changes.amount!==undefined ? -Math.abs(changes.amount) : x.amount,
      merchant: changes.description!==undefined ? changes.description : x.merchant,
    } : x));
    try {
      const res = await fetch(`/api/finances/${t.id}`, {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          category: newCat,
          description: changes.description!==undefined ? changes.description : t.merchant,
          ...(changes.amount!==undefined ? { amount: changes.amount } : {}),
          sheet_tab: t.sheet_tab, sheet_row: t.sheet_row,
          sheet_col: t.sheet_col, sheet_cols: t.sheet_cols, sheet_kind: t.sheet_kind,
        })
      });
      if (!res.ok) throw 0;
      loadFinances(month);
    } catch { toastErr("Couldn’t save that change — reverting."); setTxns(prev); }
  };
  const promptEditAmount = (t) => {
    const v = prompt("Amount ($):", Math.abs(t.amount).toFixed(2));
    if (v == null) return;
    const n = parseFloat(v);
    if (isNaN(n) || n < 0) { toastErr("Enter a valid amount."); return; }
    editTxn(t, { amount: n });
  };
  const promptEditDesc = (t) => {
    const v = prompt("Description:", t.merchant || "");
    if (v == null) return;
    editTxn(t, { description: v.trim() });
  };

  // Edit a category's monthly budgeted amount (writes column E in the Sheet).
  const editBudget = (c) => {
    const v = prompt(`Monthly budget for ${c.name} ($):`, String(c.budget || c.budgeted || 0));
    if (v == null) return;
    const n = parseFloat(v);
    if (isNaN(n) || n < 0) { toastErr("Enter a valid amount."); return; }
    fetch('/api/finances/budget', { method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ month, category: c.name, budgeted: n }) })
      .then(async r => { if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || 'failed'); } loadFinances(month); })
      .catch(err => toastErr(err.message ? `Couldn’t update budget — ${err.message}` : "Couldn’t update budget."));
  };

  const [rolling, setRolling] = useState(false);
  const rolloverMonth = async () => {
    const [my, mm] = month.split('-').map(Number);
    const nextLabel = MONTH_NAMES[mm % 12] + ' ' + (mm === 12 ? my + 1 : my);
    if (!confirm(`Create the ${nextLabel} sheet? Your budgeted amounts, income and GLS payments carry over; actual spending and one-off transactions start empty for you to fill in.`)) return;
    setRolling(true);
    try {
      const res = await fetch('/api/finances/rollover/month', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ month }) });
      const body = await res.json().catch(()=>({}));
      if (!res.ok) { alert(body.error || `Rollover failed (${res.status})`); return; }
      if (body.month) setMonth(body.month);
      alert(`Created the ${body.tab} sheet.`);
    } finally { setRolling(false); }
  };
  const rolloverYear = async () => {
    const yr = Number(month.split('-')[0]) + 1;
    if (!confirm(`Create a new ${yr} finances file? A fresh spreadsheet with 12 month tabs is generated from this month's template for you to fill out.`)) return;
    setRolling(true);
    try {
      const res = await fetch('/api/finances/rollover/year', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ month }) });
      const body = await res.json().catch(()=>({}));
      if (!res.ok) { alert(body.error || `Year rollover failed (${res.status})`); return; }
      if (body.url && confirm(`Created "Finances ${body.year}". Open it now?`)) window.open(body.url, '_blank');
    } finally { setRolling(false); }
  };

  const totalIn  = budget ? budget.income  : txns.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount, 0);
  const totalEx  = budget ? budget.expense : txns.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount), 0);
  const net = totalIn - totalEx;
  const [my, mm] = month.split('-');
  const monthLabel = MONTH_NAMES[parseInt(mm)-1] + ' ' + my;

  const subTotal = subs.reduce((s,c)=>s+c.amt, 0);

  const categories = budget && budget.categories && budget.categories.length > 0
    ? Object.values(budget.categories.reduce((acc, c) => {
        const name = normFinCat(c.name);
        if (!acc[name]) acc[name] = { name, budgeted: 0, actual: 0, color: FIN_CAT_COLOR[name] || 'var(--ink-4)' };
        acc[name].budgeted += Number(c.budgeted) || 0;
        acc[name].actual   += Number(c.actual)   || 0;
        return acc;
      }, {})).map(c => ({ ...c, budget: c.budgeted }))
    : defaultCategories.map(c => ({
        ...c,
        actual: c.name === 'Subscriptions'
          ? subTotal
          : txns.filter(t=>t.amount<0 && normFinCat(t.cat) === c.name).reduce((s,t)=>s+Math.abs(t.amount),0)
      }));

  const totalBudget = categories.reduce((s,c)=>s+(c.budget||c.budgeted||0), 0);

  // Finance "planet": the whole globe = income. Each expense category is a territory sized as
  // its share of income, so spent income conquers land and the unspent remainder stays as
  // black unclaimed ground. The planet turns red only when expenses exceed income (overspent).
  const donutData = categories.filter(c=>c.actual>0).map(c=>({value:c.actual, color:c.color, label:c.name}));

  return (
    <Card {...cardProps} id="finance" num="02" title={`Finance — ${monthLabel}`} span={cardProps.span || 7}
      right={<>
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          <button className="btn" style={{padding:'4px 8px'}} onClick={()=>changeMonth(-1)}>‹</button>
          <button className="btn" style={{padding:'4px 8px'}} onClick={()=>changeMonth(1)}>›</button>
        </div>
        <button className="btn" disabled={rolling} onClick={rolloverMonth} title="Create next month's sheet from this one"><Icon name="file" size={13}/>New month</button>
        <button className="btn" disabled={rolling} onClick={rolloverYear} title="Create a new year's finances file to fill out"><Icon name="calendar" size={13}/>New year</button>
        <button className="btn" onClick={toggleStats} title={hideStats ? "Show income & totals" : "Hide income & totals"}><Icon name={hideStats ? "eye-off" : "eye"} size={13}/>{hideStats ? "Show totals" : "Hide totals"}</button>
        {bankConnected === false ? (
          <button className="btn" disabled={connecting} onClick={connectBank} title="Link a bank account via Plaid"><Icon name={connecting ? "loader" : "wallet"} size={13}/>{connecting ? "Connecting…" : "Connect bank"}</button>
        ) : (
          <button className="btn" disabled={syncing} onClick={syncBank} title="Pull recent transactions from your connected bank (Plaid) for review"><Icon name={syncing ? "loader" : "wallet"} size={13}/>{syncing ? "Syncing…" : "Sync bank"}</button>
        )}
        <button className="btn primary" onClick={() => setShowAdd(s=>!s)}><Icon name="plus" size={13}/>Add expense</button>
      </>}
    >
      {pending && pending.length > 0 && (
        <div style={{ padding:'0 0 12px', borderBottom:'1px solid var(--line-soft)', marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8, gap:8, flexWrap:'wrap' }}>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:11, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--accent-2)' }}>
              Review — {pending.filter(t=>t.include).length} of {pending.length} from bank
            </div>
            <div style={{ display:'flex', gap:6 }}>
              <button className="btn primary" disabled={syncing} onClick={importPending}>Import {pending.filter(t=>t.include).length} to Sheet</button>
              <button className="btn ghost" onClick={()=>setPending(null)}>Cancel</button>
            </div>
          </div>
          <div style={{ maxHeight:220, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
            {pending.map((t, i) => (
              <div key={t.id} style={{ display:'flex', gap:8, alignItems:'center', fontSize:12.5, opacity: t.include ? 1 : 0.4 }}>
                <input type="checkbox" checked={t.include} onChange={e=>setPending(p=>p.map((x,j)=>j===i?{...x,include:e.target.checked}:x))} />
                <span style={{ width:46, color:'var(--ink-4)', fontFamily:'var(--font-mono)', fontSize:11 }}>{(t.date||'').slice(5)}</span>
                <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={t.name}>{t.name}</span>
                <span style={{ width:72, textAlign:'right', fontFamily:'var(--font-mono)' }}>{fmtMoney(t.amount,{cents:true})}</span>
                <select className="input" value={t.category} onChange={e=>setPending(p=>p.map((x,j)=>j===i?{...x,category:e.target.value}:x))} style={{ width:122, padding:'3px 6px' }}>
                  {SHEET_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ marginTop:6, fontSize:11, color:'var(--ink-4)' }}>Unchecked rows are skipped this time and won’t reappear on the next sync.</div>
        </div>
      )}
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

      <div className="fin-swipe" ref={swipeRef} onScroll={onSwipeScroll}>
        <div className="fin-pane fin-pane-overview">
      <div className="finance-body">
        <div>
          {hideStats ? (
            <div className="finance-stats" style={{opacity:0.55}}>
              <div className="stat-block"><span className="l">Totals</span><span className="v serif muted">•••• hidden</span></div>
            </div>
          ) : (
            <div className="finance-stats">
              <div className="stat-block"><span className="l">Income</span><span className="v serif" style={{color:"var(--accent-2)"}}>{fmtMoney(totalIn,{cents:false})}</span></div>
              <div className="stat-block"><span className="l">Spent</span><span className="v serif">{fmtMoney(totalEx,{cents:false})}</span></div>
              <div className="stat-block"><span className="l">Budget</span><span className="v serif muted">{fmtMoney(totalBudget,{cents:false})}</span></div>
              <div className="stat-block"><span className="l">Net</span><span className="v serif" style={{color:net>=0?"var(--accent)":"var(--danger)"}}>{fmtMoney(net,{cents:false})}</span></div>
            </div>
          )}
          <div className="section-h" style={{marginTop:12}}><span>Budget vs Actual</span><span className="line"/><span className="muted-2">{totalBudget > 0 ? Math.round((totalEx/totalBudget)*100) + '% of budget' : 'no budget set'}</span></div>
          <div>
            {categories.map((c,i) => {
              const pct = c.budget > 0 ? Math.min(180,(c.actual/c.budget)*100) : 0;
              const over = c.budget > 0 && c.actual > c.budget;
              return (
                <div key={i} className="bar-row">
                  <div className="cat"><span className="swatch" style={{background:c.color}}/><span className="cat-name">{c.name}</span></div>
                  <div className="amt">{fmtMoney(c.actual)}</div>
                  <div className="amt muted-2" onClick={()=>editBudget(c)} title="Edit budget" style={{cursor:'pointer'}}>/ {fmtMoney(c.budget,{cents:false})}</div>
                  <div className="pct" style={{color:over?"var(--danger)":"var(--ink-3)"}}>{Math.round(pct)}%</div>
                  <div className="mini-bar"><div className="fill" style={{width:Math.min(100,pct)+"%",background:over?"var(--danger)":"var(--accent-2)"}}/></div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6,paddingTop:4}}>
          <DonutChart data={donutData} size={148} war alert={totalEx > totalIn} whole={totalIn} ocean="var(--bone)" landNeutral="oklch(0.50 0.02 250)" seed={monthLabel}/>
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
        </div>
        <div className="fin-pane fin-pane-txns">
        <div>
          <div className="section-h"><span>Transactions</span><span className="line"/><span className="muted-2" style={{fontSize:10.5}}>{txns.filter(t=>t.amount<0).length} expenses</span></div>
          {txns.length === 0 && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 0'}}>No transactions this month.</div>}
          <div className="scroll-pane" style={{maxHeight:480,marginRight:-4,paddingRight:4}}>
          {(() => {
            const groups = {};
            txns.forEach(t => {
              const key = t.amount > 0 ? 'Income' : normFinCat(t.cat);
              (groups[key] = groups[key] || []).push(t);
            });
            const order = [];
            if (groups['Income']) order.push('Income');
            categories.forEach(c => { if (groups[c.name] && !order.includes(c.name)) order.push(c.name); });
            Object.keys(groups).forEach(k => { if (!order.includes(k)) order.push(k); });
            return order.map(name => {
              const items = groups[name];
              const isCollapsed = !!collapsedCats[name];
              const total = items.reduce((s,t)=>s+Math.abs(t.amount),0);
              const groupColor = name === 'Income' ? 'var(--accent-2)' : (FIN_CAT_COLOR[name] || 'var(--ink-4)');
              return (
                <div key={name}>
                  <div onClick={()=>toggleCat(name)} title={isCollapsed?'Expand':'Collapse'}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'7px 4px',cursor:'pointer',
                            userSelect:'none',borderTop:'1px solid var(--line-soft)',marginTop:2}}>
                    <span style={{display:'inline-block',width:8,fontSize:9,color:'var(--ink-3)',
                                  transform: isCollapsed ? 'rotate(-90deg)' : 'none',
                                  transition:'transform .12s'}}>▼</span>
                    <span style={{width:8,height:8,borderRadius:2,background:groupColor,flexShrink:0}}/>
                    <span style={{fontSize:11,fontFamily:'var(--font-mono)',letterSpacing:'.05em',
                                  textTransform:'uppercase',color:'var(--ink-2)'}}>{name}</span>
                    <span className="muted-2 mono" style={{fontSize:10}}>{items.length}</span>
                    <span style={{flex:1}}/>
                    <span className="amount" style={{fontSize:11,color:name==='Income'?'var(--accent-2)':'var(--ink-3)'}}>
                      {name==='Income'?'+':''}{fmtMoney(total)}
                    </span>
                  </div>
                  {!isCollapsed && items.map((t,i) => {
                    const nc = t.amount > 0 ? null : normFinCat(t.cat);
                    return (
                      <div key={t.id||i} className="txn" style={{gridTemplateColumns:"10px 1fr auto auto auto",gap:6,alignItems:'center',paddingLeft:18}}>
                        <span className="cat-dot" style={{background:t.amount>0?"var(--accent-2)":FIN_CAT_COLOR[nc]||"var(--ink-4)"}}/>
                        <div>
                          <div className="merchant" {...(t.amount<0 ? {onClick:()=>promptEditDesc(t), title:"Edit description", style:{cursor:'pointer'}} : {})}>{t.merchant}</div>
                          <div className="meta">{t.date}</div>
                        </div>
                        {t.amount < 0
                          ? <select
                              value={nc}
                              onChange={e => {
                                const newCat = e.target.value;
                                catOverrides.current[t.id] = newCat;
                                setTxns(ts => ts.map(x => x.id===t.id ? {...x, cat: newCat} : x));
                                fetch(`/api/finances/${t.id}`, {
                                  method:'PATCH', headers:{'Content-Type':'application/json'},
                                  body: JSON.stringify({
                                    category: newCat,
                                    sheet_tab: t.sheet_tab, sheet_row: t.sheet_row,
                                    sheet_col: t.sheet_col, sheet_cols: t.sheet_cols,
                                    sheet_kind: t.sheet_kind
                                  })
                                }).then(res => {
                                  if (!res.ok) { delete catOverrides.current[t.id]; loadFinances(month); }
                                }).catch(()=>{ delete catOverrides.current[t.id]; loadFinances(month); });
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
                        <span className="amount" style={{color:t.amount>0?"var(--accent-2)":"var(--ink)", cursor:t.amount<0?'pointer':'default'}}
                          {...(t.amount<0 ? {onClick:()=>promptEditAmount(t), title:"Edit amount"} : {})}>
                          {t.amount>0?"+":""}{fmtMoney(Math.abs(t.amount))}
                        </span>
                        <span style={{cursor:"pointer",color:"var(--ink-4)",padding:"0 2px",lineHeight:1}} title="Remove"
                          onClick={async()=>{
                            if (t.source === 'sheet') {
                              if (t.sheet_tab == null || t.sheet_row == null || t.sheet_col == null) return;
                              const qs = new URLSearchParams({tab: t.sheet_tab, row: t.sheet_row, col: t.sheet_col});
                              if (t.sheet_cols) qs.set("cols", t.sheet_cols);
                              const res = await fetch(`/api/finances/sheet?${qs}`,{method:"DELETE"});
                              if (!res.ok) { alert("Could not delete from Google Sheet — check OAuth scope."); return; }
                            } else {
                              await fetch(`/api/finances/${t.id}`,{method:"DELETE"});
                            }
                            delete catOverrides.current[t.id];
                            loadFinances(month);
                          }}>
                          ×
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}
          </div>
        </div>
        </div>
        <div className="fin-pane fin-pane-subs">
        <div>
          <div className="section-h">
            <span>Subscriptions</span><span className="line"/>
            <span className="muted-2 num" style={{fontSize:10.5}}>{fmtMoney(subTotal)}/mo</span>
            <button className="btn" style={{padding:'4px 10px',fontSize:11}} onClick={()=>{ if(showAddSub){ setShowAddSub(false); setSubEditId(null); } else { setSubEditId(null); setSubName(''); setSubAcct(''); setSubAmt(''); setSubDue(''); setShowAddSub(true); } }}><Icon name="plus" size={12}/>Add</button>
          </div>
          {showAddSub && (
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:8,padding:'8px',background:'var(--surface-2)',borderRadius:'var(--r)',border:'1px solid var(--line)'}}>
              {subEditId!=null && <div className="muted-2 mono" style={{fontSize:10,letterSpacing:'.06em'}}>EDIT SUBSCRIPTION</div>}
              <input className="input" placeholder="Name (e.g. Netflix)" value={subName} onChange={e=>setSubName(e.target.value)} style={{fontSize:12}}/>
              <div style={{display:'flex',gap:6}}>
                <input className="input" placeholder="Account" value={subAcct} onChange={e=>setSubAcct(e.target.value)} style={{flex:1,fontSize:12}}/>
                <input className="input" placeholder="$0.00" type="number" value={subAmt} onChange={e=>setSubAmt(e.target.value)} style={{width:72,fontSize:12}}/>
              </div>
              <div style={{display:'flex',gap:6}}>
                <input className="input" placeholder="Due (e.g. 15th)" value={subDue} onChange={e=>setSubDue(e.target.value)} style={{flex:1,fontSize:12}}/>
                <button className="btn primary" onClick={addSub} style={{fontSize:11}}>{subEditId!=null?'Save':'Add'}</button>
                <button className="btn ghost" onClick={()=>{ setShowAddSub(false); setSubEditId(null); setSubName(''); setSubAcct(''); setSubAmt(''); setSubDue(''); }} style={{fontSize:11}}>✕</button>
              </div>
            </div>
          )}
          {subs.length === 0 && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 4px'}}>No subscriptions yet — tap “Add”.</div>}
          {subs.map((s,i) => (
            <div key={s.id||i} className="txn" style={{gridTemplateColumns:"1fr auto auto auto",alignItems:"center",padding:"5px 4px"}}>
              <div><div className="merchant">{s.name}</div><div className="meta">{s.acct} · due {s.due}</div></div>
              <span className="amount muted">{fmtMoney(s.amt)}</span>
              <button className="btn ghost" aria-label={`Edit ${s.name}`} title={`Edit ${s.name}`} onClick={()=>startEditSub(s)}
                style={{minWidth:34,minHeight:34,padding:0,fontSize:13,lineHeight:1,color:"var(--ink-3)"}}>✎</button>
              <button className="btn ghost" aria-label={`Remove ${s.name}`} title={`Remove ${s.name}`}
                onClick={()=>{ if (confirm(`Remove subscription “${s.name}”?`)) deleteSub(s.id); }}
                style={{minWidth:34,minHeight:34,padding:0,fontSize:16,lineHeight:1,color:"var(--ink-3)"}}>×</button>
            </div>
          ))}
        </div>
        </div>
      </div>
      <div className="fin-tabs">
        {['Overview','Transactions','Subscriptions'].map((l,i)=>(
          <span key={i} onClick={()=>goPane(i)} style={{cursor:'pointer',paddingBottom:3,
            color: pane===i?'var(--accent)':'var(--ink-4)',
            borderBottom: pane===i?'2px solid var(--accent)':'2px solid transparent'}}>{l}</span>
        ))}
      </div>
    </Card>
  );
};

// =========================================================
// BAND
// =========================================================
const BandCard = ({ cardProps = {} } = {}) => {
  const [gigs, setGigs] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [pushing, setPushing] = useState(false);
  const [songs, setSongs] = useState({setlists:[],repertoire:[],future_songs:[]});
  const [bandTab, setBandTab] = useState('shows');
  const [showAddContact, setShowAddContact] = useState(false);
  const [showAddShow, setShowAddShow] = useState(false);
  const [newContact, setNewContact] = useState({name:'',venue:'',city:'',type:'',phone:'',email:'',website:'',status:'not contacted',next_step:'',notes:''});
  const [editContactId, setEditContactId] = useState(null);
  const [editContact, setEditContact] = useState({});
  const [newShow, setNewShow] = useState({date:'',venue:'',city:'Fayetteville, AR',tickets:'',notes:''});
  const [editShowIdx, setEditShowIdx] = useState(null);
  const [editShow, setEditShow] = useState({date:'',venue:'',city:'',tickets:'',notes:''});

  // Mobile: swipe left/right to move between the Shows / Setlists / Venues tabs.
  const BAND_TABS = ['shows','setlists','venues'];
  const bandTouch = React.useRef(null);
  const onBandTouchStart = (e) => { const t = e.touches[0]; bandTouch.current = { x: t.clientX, y: t.clientY }; };
  const onBandTouchEnd = (e) => {
    const s = bandTouch.current; if (!s) return; bandTouch.current = null;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;  // ignore vertical scrolls / taps
    const i = BAND_TABS.indexOf(bandTab);
    const ni = dx < 0 ? Math.min(BAND_TABS.length - 1, i + 1) : Math.max(0, i - 1);
    if (ni !== i) setBandTab(BAND_TABS[ni]);
  };

  const loadShows = () => {
    return fetch('/api/shows').then(r=>r.json()).then(data => {
      const today = new Date();
      today.setHours(0,0,0,0);
      const upcoming = data
        .map((s, i) => ({...s, originalIdx: i}))
        .filter(s => new Date(s.date+'T12:00:00') >= today)
        .sort((a,b) => new Date(a.date)-new Date(b.date));
      setGigs(upcoming.map(s => ({
        venue: s.venue, city: s.city, tickets: s.tickets, event: s.event, rawDate: s.date, originalIdx: s.originalIdx,
        date: new Date(s.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),
        days: Math.round((new Date(s.date+'T12:00:00')-today)/86400000),
        status: 'confirmed', notes: s.notes
      })));
    }).catch(()=>{});
  };

  const removeShow = async (g) => {
    if (!confirm(`Remove "${g.venue}" on ${g.date}? This also updates comingupaces.net.`)) return;
    setPushing(true);
    try {
      const res = await fetch(`/api/shows/${g.originalIdx}`, {method:'DELETE'});
      const data = await res.json().catch(()=>({message:'Remove failed'}));
      if (!res.ok) throw new Error(data.message || data.error || 'Remove failed');
      await loadShows();
      if (window.__toast) window.__toast(data.message);
    } catch (err) {
      if (window.__toast) window.__toast(err.message || 'Remove failed');
    } finally {
      setPushing(false);
    }
  };

  const loadBandAll = () => {
    loadShows();
    fetch('/api/band/contacts').then(r=>r.json()).then(setContacts).catch(()=>{});
    fetch('/api/band/songs').then(r=>r.json()).then(setSongs).catch(()=>{});
  };
  useEffect(loadBandAll, []);
  useRefreshListener(loadBandAll);

  const pushSite = async () => {
    setPushing(true);
    const d = await fetch('/api/site/push', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Update shows and content'})}).then(r=>r.json());
    alert(d.message);
    setPushing(false);
  };

  const addShow = async () => {
    if (!newShow.date || !newShow.venue) return;
    const added = {...newShow};
    setPushing(true);
    const res = await fetch('/api/shows', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({date:added.date,event:'CUA Live',venue:added.venue,city:added.city,tickets:added.tickets,notes:added.notes})});
    const data = await res.json().catch(()=>({message:'Add show failed'}));
    setPushing(false);
    if (!res.ok) {
      if (window.__toast) window.__toast(data.message || data.error || 'Add show failed');
      return;
    }
    setNewShow({date:'',venue:'',city:'Fayetteville, AR',tickets:'',notes:''});
    setShowAddShow(false);
    await loadShows();
    if (window.__toast) window.__toast(data.message);
  };

  const startEditShow = (g) => {
    setEditShowIdx(g.originalIdx);
    setEditShow({date:g.rawDate||'', venue:g.venue||'', city:g.city||'', tickets:g.tickets||'', notes:g.notes||''});
  };

  const saveEditShow = async () => {
    if (editShowIdx == null) return;
    setPushing(true);
    const res = await fetch(`/api/shows/${editShowIdx}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(editShow)});
    const data = await res.json().catch(()=>({message:'Edit show failed'}));
    setPushing(false);
    if (!res.ok) {
      if (window.__toast) window.__toast(data.message || data.error || 'Edit show failed');
      return;
    }
    setEditShowIdx(null);
    await loadShows();
    if (window.__toast) window.__toast(data.message);
  };

  const addContact = async () => {
    if (!newContact.venue) return;
    try {
      const res = await fetch('/api/band/contacts', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(newContact)});
      if (!res.ok) throw 0;
      const d = await res.json();
      setContacts(cs => [...cs, {...newContact, id:d.id}]);
      setNewContact({name:'',venue:'',city:'',type:'',phone:'',email:'',website:'',status:'not contacted',next_step:'',notes:''});
      setShowAddContact(false);
    } catch { toastErr("Couldn’t add that venue — try again."); }
  };

  const saveContact = async () => {
    const prev = contacts;
    setContacts(cs => cs.map(x => x.id===editContactId ? {...x, ...editContact} : x));
    setEditContactId(null); setEditContact({});
    try {
      const r = await fetch(`/api/band/contacts/${editContactId}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(editContact)});
      if (!r.ok) throw 0;
    } catch { toastErr("Couldn’t save that venue — reverting."); setContacts(prev); }
  };

  const markContacted = async (c) => {
    const today = new Date().toISOString().slice(0,10);
    const prev = contacts;
    setContacts(cs => cs.map(x => x.id===c.id ? {...x, last:today, status:'follow up'} : x));
    try {
      const r = await fetch(`/api/band/contacts/${c.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({last:today,status:'follow up'})});
      if (!r.ok) throw 0;
    } catch { toastErr("Couldn’t update that venue — reverting."); setContacts(prev); }
  };

  const deleteContact = async (id) => {
    if (!confirm("Remove this venue / contact?")) return;
    const prev = contacts;
    setContacts(cs => cs.filter(x => x.id !== id));
    try {
      const r = await fetch(`/api/band/contacts/${id}`, {method:'DELETE'});
      if (!r.ok) throw 0;
    } catch { toastErr("Couldn’t remove that venue — reverting."); setContacts(prev); }
  };

  // ── Setlists / songs CRUD ──
  const [songDraft, setSongDraft] = useState({});   // keyed input text: 'repertoire' | 'future' | 'sl:<name>'
  const [newSetlist, setNewSetlist] = useState('');
  const draftVal = (k) => songDraft[k] || '';
  const setDraft = (k, v) => setSongDraft(d => ({ ...d, [k]: v }));
  const reloadSongs = () => fetch('/api/band/songs').then(r=>r.json()).then(setSongs).catch(()=>{});
  const songReq = async (url, method, body) => {
    try {
      const r = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) throw 0;
      setSongs(await r.json());
    } catch { toastErr("Couldn’t update songs — reloading."); reloadSongs(); }
  };
  const addListSong = (key, url) => { const v = draftVal(key).trim(); if (!v) return; songReq(url, 'POST', { song: v }); setDraft(key, ''); };
  const removeListSong = (url, song) => songReq(url, 'DELETE', { song });
  const addSetlistSong = (name) => { const k = 'sl:'+name, v = draftVal(k).trim(); if (!v) return; songReq('/api/band/songs/setlist/song','POST',{ setlist:name, song:v }); setDraft(k, ''); };
  const removeSetlistSong = (name, song) => songReq('/api/band/songs/setlist/song','DELETE',{ setlist:name, song });
  const createSetlist = () => { const v = newSetlist.trim(); if (!v) return; songReq('/api/band/songs/setlist','POST',{ name:v }); setNewSetlist(''); };
  const renameSetlist = (name) => { const nn = prompt('Rename setlist:', name); if (!nn || !nn.trim() || nn.trim()===name) return; songReq('/api/band/songs/setlist','PATCH',{ name, new_name:nn.trim() }); };
  const deleteSetlist = (name) => { if (!confirm(`Delete setlist "${name}"?`)) return; songReq('/api/band/songs/setlist','DELETE',{ name }); };

  const nextGig = gigs[0];
  const overdue = contacts.filter(c=>c.status==='follow up'||c.status==='not contacted').length;

  return (
    <Card {...cardProps} id="band" num="03" title="Band — Coming Up Aces" span={cardProps.span || 5}
      right={<>
        <span className="tag violet mobile-hide">{gigs.length} gigs</span>
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
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <input className="input" type="url" placeholder="Tickets URL (optional)" value={newShow.tickets} onChange={e=>setNewShow(s=>({...s,tickets:e.target.value}))} style={{flex:1,fontSize:12}}/>
          </div>
          <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
            <button className="btn primary" onClick={addShow} style={{fontSize:11}}>Add show</button>
            <button className="btn ghost" onClick={()=>setShowAddShow(false)} style={{fontSize:11}}>✕</button>
          </div>
        </div>
      )}
      {/* ── Tab bar ── */}
      <div style={{display:'flex',gap:2,marginBottom:10,borderBottom:'1px solid var(--line-soft)',paddingBottom:6}}>
        {BAND_TABS.map(t => (
          <button key={t} className={'btn'+(bandTab===t?' primary':' ghost')}
            style={{fontSize:10.5,padding:'3px 10px',textTransform:'capitalize'}}
            onClick={()=>setBandTab(t)}>{t}</button>
        ))}
      </div>

      {/* Swipe left/right (touch) to switch tabs */}
      <div onTouchStart={onBandTouchStart} onTouchEnd={onBandTouchEnd}>

      {/* ── Shows tab ── */}
      {bandTab==='shows' && <>
      {editShowIdx != null && (
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:10,padding:'10px',background:'var(--surface-2)',borderRadius:'var(--r)',border:'1px solid color-mix(in oklch,var(--violet) 30%,var(--line))'}}>
          <div className="muted-2 mono" style={{fontSize:10.5,letterSpacing:'.06em'}}>EDIT SHOW</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <input className="input" type="date" value={editShow.date} onChange={e=>setEditShow(s=>({...s,date:e.target.value}))} style={{width:140,fontSize:12}}/>
            <input className="input" placeholder="Venue name" value={editShow.venue} onChange={e=>setEditShow(s=>({...s,venue:e.target.value}))} style={{flex:1,minWidth:120,fontSize:12}}/>
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <input className="input" placeholder="City, State" value={editShow.city} onChange={e=>setEditShow(s=>({...s,city:e.target.value}))} style={{flex:1,fontSize:12}}/>
            <input className="input" placeholder="Notes" value={editShow.notes} onChange={e=>setEditShow(s=>({...s,notes:e.target.value}))} style={{flex:1,fontSize:12}}/>
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <input className="input" type="url" placeholder="Tickets URL (optional)" value={editShow.tickets} onChange={e=>setEditShow(s=>({...s,tickets:e.target.value}))} style={{flex:1,fontSize:12}}/>
          </div>
          <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
            <button className="btn primary" onClick={saveEditShow} disabled={pushing} style={{fontSize:11}}>{pushing?'saving…':'Save show'}</button>
            <button className="btn ghost" onClick={()=>setEditShowIdx(null)} style={{fontSize:11}}>✕</button>
          </div>
        </div>
      )}
      <div className="section-h"><span>Next Show</span><span className="line"/></div>
      {nextGig ? (
        <div style={{
          background:"linear-gradient(135deg,color-mix(in oklch,var(--violet) 14%,var(--surface-2)),var(--surface-2))",
          border:"1px solid color-mix(in oklch,var(--violet) 30%,var(--line))",
          borderRadius:"var(--r)",padding:10,display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:8,alignItems:"center",marginBottom:8
        }}>
          <div>
            <div className="serif" style={{fontSize:17,lineHeight:1.15}}>{nextGig.venue}</div>
            <div className="muted mono" style={{fontSize:11}}>{nextGig.city} · {nextGig.date}</div>
            {nextGig.tickets && <a href={nextGig.tickets} target="_blank" rel="noopener noreferrer" className="mono" style={{fontSize:11,color:'var(--violet)',textDecoration:'none'}}>🎟 Tickets</a>}
          </div>
          <div style={{textAlign:"right"}}>
            <div className="mono" style={{fontSize:26,fontWeight:500}}>{Math.max(0,nextGig.days)}</div>
            <div className="muted-2 mono" style={{fontSize:10,letterSpacing:".08em"}}>DAYS</div>
          </div>
          <button onClick={()=>startEditShow(nextGig)} title="Edit show" className="btn ghost"
            style={{fontSize:10.5,padding:'3px 8px'}}>edit</button>
          <button onClick={()=>removeShow(nextGig)} title="Remove show"
            style={{background:'transparent',border:'none',cursor:'pointer',color:'var(--ink-4)',padding:'4px',display:'flex',alignItems:'center',borderRadius:'var(--r-sm)'}}>
            <Icon name="x" size={14}/>
          </button>
        </div>
      ) : (
        <div className="muted mono" style={{fontSize:11,padding:'8px 0'}}>No upcoming shows.</div>
      )}

      {gigs.slice(1,4).map((g,i) => (
        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:6,padding:"5px 0",borderBottom:"1px solid var(--line-soft)",alignItems:"center"}}>
          <div><div style={{fontSize:12.5}}>{g.venue}</div><div className="muted mono" style={{fontSize:10.5}}>{g.city} · {g.date}{g.tickets && <> · <a href={g.tickets} target="_blank" rel="noopener noreferrer" style={{color:'var(--violet)',textDecoration:'none'}}>tickets</a></>}</div></div>
          <span className="tag mint">{g.status}</span>
          <button onClick={()=>startEditShow(g)} title="Edit show" className="btn ghost" style={{fontSize:10,padding:'2px 6px'}}>edit</button>
          <button onClick={()=>removeShow(g)} title="Remove show"
            style={{background:'transparent',border:'none',cursor:'pointer',color:'var(--ink-4)',padding:'2px',display:'flex',alignItems:'center',borderRadius:'var(--r-sm)'}}>
            <Icon name="x" size={12}/>
          </button>
        </div>
      ))}

      </>}

      {/* ── Setlists tab ── */}
      {bandTab==='setlists' && <>
        <div style={{display:'flex',gap:6,marginBottom:10}}>
          <input className="input" placeholder="New setlist name…" value={newSetlist}
            onChange={e=>setNewSetlist(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createSetlist()}
            style={{flex:1,fontSize:12}}/>
          <button className="btn" onClick={createSetlist} style={{fontSize:11}}><Icon name="plus" size={12}/>Setlist</button>
        </div>
        {(songs.setlists||[]).map((sl,i) => (
          <div key={i} style={{marginBottom:14}}>
            <div className="section-h">
              <span style={{fontWeight:600}}>{sl.name}</span><span className="line"/>
              <span className="muted-2 mono" style={{fontSize:10}}>{sl.songs.length} songs · ~{Math.round(sl.songs.length * 5)} min</span>
              <button className="btn ghost" title="Rename setlist" style={{padding:'2px 6px',fontSize:11}} onClick={()=>renameSetlist(sl.name)}>✎</button>
              <button className="btn ghost" title="Delete setlist" style={{padding:'2px 6px',fontSize:12,color:'var(--ink-4)'}} onClick={()=>deleteSetlist(sl.name)}>×</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'2px 12px'}}>
              {sl.songs.map((s,j) => (
                <div key={j} style={{display:'flex',alignItems:'center',gap:4,fontSize:11.5,padding:'2px 0',borderBottom:'1px solid var(--line-soft)'}}>
                  <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{j+1}. {s}</span>
                  <span onClick={()=>removeSetlistSong(sl.name, s)} title="Remove" style={{cursor:'pointer',color:'var(--ink-4)',padding:'0 3px',fontSize:13,lineHeight:1}}>×</span>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6,marginTop:6}}>
              <input className="input" placeholder={`Add song to "${sl.name}"…`} value={draftVal('sl:'+sl.name)}
                onChange={e=>setDraft('sl:'+sl.name, e.target.value)} onKeyDown={e=>e.key==='Enter'&&addSetlistSong(sl.name)}
                style={{flex:1,fontSize:11}}/>
              <button className="btn ghost" onClick={()=>addSetlistSong(sl.name)} style={{fontSize:11}}>+</button>
            </div>
          </div>
        ))}
        <div className="section-h"><span>All Songs Ever Played</span><span className="line"/>
          <span className="muted-2 mono" style={{fontSize:10}}>{(songs.repertoire||[]).length} songs</span>
        </div>
        <div style={{display:'flex',gap:6,margin:'6px 0'}}>
          <input className="input" placeholder="Add song to repertoire…" value={draftVal('repertoire')}
            onChange={e=>setDraft('repertoire', e.target.value)} onKeyDown={e=>e.key==='Enter'&&addListSong('repertoire','/api/band/songs/repertoire')}
            style={{flex:1,fontSize:11}}/>
          <button className="btn ghost" onClick={()=>addListSong('repertoire','/api/band/songs/repertoire')} style={{fontSize:11}}>+</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'2px 12px',marginBottom:14}}>
          {(songs.repertoire||[]).map((s,i) => (
            <div key={i} style={{display:'flex',alignItems:'center',gap:4,fontSize:11,padding:'2px 0',borderBottom:'1px solid var(--line-soft)'}}>
              <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{i+1}. {s}</span>
              <span onClick={()=>removeListSong('/api/band/songs/repertoire', s)} title="Remove" style={{cursor:'pointer',color:'var(--ink-4)',padding:'0 3px',fontSize:12,lineHeight:1}}>×</span>
            </div>
          ))}
        </div>
        <div className="section-h"><span>Learn / Next Up</span><span className="line"/>
          <span className="muted-2 mono" style={{fontSize:10}}>{(songs.future_songs||[]).length} songs</span>
        </div>
        <div style={{display:'flex',gap:6,margin:'6px 0'}}>
          <input className="input" placeholder="Add song to learn…" value={draftVal('future')}
            onChange={e=>setDraft('future', e.target.value)} onKeyDown={e=>e.key==='Enter'&&addListSong('future','/api/band/songs/future')}
            style={{flex:1,fontSize:11}}/>
          <button className="btn ghost" onClick={()=>addListSong('future','/api/band/songs/future')} style={{fontSize:11}}>+</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'2px 12px'}}>
          {(songs.future_songs||[]).map((s,i) => (
            <div key={i} style={{display:'flex',alignItems:'center',gap:4,fontSize:11,padding:'2px 0',borderBottom:'1px solid var(--line-soft)',color:'var(--ink-3)'}}>
              <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{i+1}. {s}</span>
              <span onClick={()=>removeListSong('/api/band/songs/future', s)} title="Remove" style={{cursor:'pointer',color:'var(--ink-4)',padding:'0 3px',fontSize:12,lineHeight:1}}>×</span>
            </div>
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
      </div>
    </Card>
  );
};

// =========================================================
// HEALTH
// =========================================================
const HealthCard = ({ cardProps = {} } = {}) => {
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
  const [coreDone, setCoreDone]       = useState(false);
  const [habitList, setHabitList]     = useState([]);
  const [todayHabits, setTodayHabits] = useState({});
  const [foodLog, setFoodLog]         = useState([]);
  const [foodName, setFoodName]       = useState('');
  const [foodCal, setFoodCal]         = useState('');
  const [foodProtein, setFoodProtein] = useState('');
  const [foodCarbs, setFoodCarbs]     = useState('');
  const [foodFat, setFoodFat]         = useState('');
  const [foodSug, setFoodSug]         = useState([]);   // previously-logged foods for autocomplete
  const [sugOpen, setSugOpen]         = useState(false);
  const [sugShowHidden, setSugShowHidden] = useState(false);
  const [water, setWater]             = useState(0);   // oz of water today
  const [waterBottleOz, setWaterBottleOz] = useState(32);
  const [waterGoalOz, setWaterGoalOz]     = useState(128);
  const [waterBottleInput, setWaterBottleInput] = useState('32');
  const [waterGoalInput, setWaterGoalInput]     = useState('128');
  const [editWater, setEditWater] = useState(false);
  const [nutritionView, setNutritionView] = useState('today');   // 'today' | 'week' — swipe to switch

  // Mobile: swipe left/right to toggle the Nutrition Today / Week views (same gesture as Band tabs).
  const NUTRITION_VIEWS = ['today', 'week'];
  const nutritionTouch = React.useRef(null);
  const onNutritionTouchStart = (e) => { const t = e.touches[0]; nutritionTouch.current = { x: t.clientX, y: t.clientY }; };
  const onNutritionTouchEnd = (e) => {
    const s = nutritionTouch.current; if (!s) return; nutritionTouch.current = null;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;   // ignore vertical scrolls / taps
    const i = NUTRITION_VIEWS.indexOf(nutritionView);
    const ni = dx < 0 ? Math.min(NUTRITION_VIEWS.length - 1, i + 1) : Math.max(0, i - 1);
    if (ni !== i) setNutritionView(NUTRITION_VIEWS[ni]);
  };

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

  // Supplements tracked via the habit endpoint but rendered as standalone boxes
  const SUPPLEMENTS = [
    { id: 'Creatine', label: 'Creatine', sub: '5g daily',     color: 'var(--info)'     },
    { id: 'Vitamins', label: 'Vitamins', sub: 'Multi · daily', color: 'var(--accent-2)' },
  ];
  const SUPPLEMENT_IDS = SUPPLEMENTS.map(s => s.id);

  const calcSupplementStreak = (id) => {
    const habits = (rawHealth && rawHealth.habits) || {};
    const today = localDateStr(new Date());
    let count = 0;
    const d = new Date();
    if (!(habits[today] || {})[id]) d.setDate(d.getDate() - 1);
    while (true) {
      const ds = localDateStr(d);
      if (!(habits[ds] || {})[id]) break;
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  };

  const supplementWeek = (id) => {
    const habits = (rawHealth && rawHealth.habits) || {};
    const today = new Date();
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const ds = localDateStr(d);
      out.push({ ds, taken: !!(habits[ds] || {})[id], dow: d.toLocaleDateString('en-US', { weekday: 'narrow' }) });
    }
    return out;
  };

  const load = () => {
    reloadSuggestions();
    fetch('/api/health').then(r => r.json()).then(data => {
      setRawHealth(data);
      const wlog = (data.weight_log || []).slice(-12);
      setWeightLog(wlog.map(e => e.weight));
      const h = data.height_in || null;
      setHeight(h);
      if (h) setNewHeight(String(h));
      const bottleOz = parseInt(data.water_bottle_oz, 10) || 32;
      const goalOz = parseInt(data.water_goal_oz, 10) || 128;
      setWaterBottleOz(bottleOz);
      setWaterGoalOz(goalOz);
      setWaterBottleInput(String(bottleOz));
      setWaterGoalInput(String(goalOz));

      const prog = data.workout_program || null;
      setProgram(prog);
      setHabitList(data.habit_list || []);

      // Workout is fetched separately via useEffect on workoutOffset (see below).
      // Streak, the 28-day grid, and per-day state (weight/habits/food/water) are all
      // derived from rawHealth in the effect below — so optimistic habit toggles update
      // them instantly without waiting on (and being clobbered by) a full /api/health refetch.
    }).catch(() => {});
  };

  // Re-derive per-day state (weight / habits / food / calories) when day or data changes.
  // Also derives streak + the 28-day grid from rawHealth so optimistic toggles reflect instantly.
  useEffect(() => {
    if (!rawHealth) return;
    const habitsLog = rawHealth.habits || {};
    setStreak(calcStreak(habitsLog));
    // 28-day lift/cardio history grid
    const gridToday = new Date();
    const grid = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(gridToday); d.setDate(gridToday.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const worked = (habitsLog[ds] || {})['lift'] || (habitsLog[ds] || {})['cardio'];
      grid.push({ ds, worked, isFuture: d > gridToday, dow: d.toLocaleDateString('en-US', { weekday: 'short' }) });
    }
    setDots(grid);
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
    // Water: that day's oz, or 0
    setWater((rawHealth.water || {})[viewDate] || 0);
    // Elbow rehab: persisted per viewed day
    setRehabDone((rawHealth.rehab || {})[viewDate] || {});
    // Core (workout section, not a habit): persisted per viewed day
    setCoreDone(!!(rawHealth.core || {})[viewDate]);
  }, [rawHealth, viewDate]);

  useEffect(() => { load(); }, []);
  useRefreshListener(load);

  // Refetch the displayed workout when the user navigates day-by-day, on mount, and on mc:refresh.
  const loadWorkout = () => {
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
  };
  useEffect(loadWorkout, [workoutOffset]);
  useRefreshListener(loadWorkout);

  const logWeight = async () => {
    const w = parseFloat(newWeight);
    if (!w || w < 80 || w > 500) return;
    await fetch('/api/health/weight', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight: w, date: viewDate }) })
      .then(r => { if (!r.ok) throw 0; window.__toast?.(`Weight ${w} lb logged for ${viewDate}`, 'success'); })
      .catch(() => toastErr("Couldn’t save weight — try again."));
    setNewWeight(''); load();
  };

  const saveHeight = async () => {
    const h = parseFloat(newHeight);
    if (!h || h < 48 || h > 96) return;
    await fetch('/api/health/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ height_in: h }) })
      .then(r => { if (!r.ok) throw 0; window.__toast?.('Height saved', 'success'); })
      .catch(() => toastErr("Couldn’t save height — try again."));
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
      body: JSON.stringify({ ...item, date: viewDate }) })
      .then(r => { if (!r.ok) throw 0; })
      .catch(() => { toastErr("Couldn’t log that food — reloading."); load(); });
    setTimeout(load, 300);  // refresh raw data so subsequent ops see the new food
  };

  const reloadSuggestions = (showHidden = sugShowHidden) => {
    const qs = showHidden ? '?include_hidden=1' : '';
    fetch('/api/health/food/suggestions' + qs).then(r => r.json())
      .then(d => setFoodSug(Array.isArray(d) ? d : [])).catch(() => {});
  };

  const hideSuggestion = (name) => {
    fetch('/api/health/food/hide_suggestion', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, hide: true }) })
      .then(() => { window.__toast?.(`"${name}" hidden from search`, 'info'); reloadSuggestions(); })
      .catch(() => {});
  };

  const unhideSuggestion = (name) => {
    fetch('/api/health/food/hide_suggestion', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, hide: false }) })
      .then(() => { window.__toast?.(`"${name}" restored`, 'success'); reloadSuggestions(true); })
      .catch(() => {});
  };

  const pickFood = (s) => {
    setFoodName(s.name);
    setFoodCal(s.calories ? String(s.calories) : '');
    setFoodProtein(s.protein ? String(s.protein) : '');
    setFoodCarbs(s.carbs ? String(s.carbs) : '');
    setFoodFat(s.fat ? String(s.fat) : '');
    setSugOpen(false);
  };

  const deleteFood = (idx) => {
    setFoodLog(prev => prev.filter((_, i) => i !== idx));
    fetch('/api/health/food', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: idx, date: viewDate }) })
      .then(r => { if (!r.ok) throw 0; })
      .catch(() => { toastErr("Couldn’t remove that food — reloading."); });
    setTimeout(load, 300);
  };

  const setWaterOz = async (oz) => {
    const v = Math.max(0, Math.round(oz));
    setWater(v);
    await fetch('/api/health/water', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oz: v, date: viewDate }) })
      .then(r => { if (!r.ok) throw 0; })
      .catch(() => toastErr("Couldn’t save water — reloading."));
    setTimeout(load, 300);  // re-pull so Sheet-synced value is reflected
  };

  const saveWaterConfig = async () => {
    const bottleOz = Math.max(1, parseInt(waterBottleInput, 10) || 32);
    const goalOz = Math.max(1, parseInt(waterGoalInput, 10) || 128);
    setWaterBottleOz(bottleOz);
    setWaterGoalOz(goalOz);
    setWaterBottleInput(String(bottleOz));
    setWaterGoalInput(String(goalOz));
    await fetch('/api/health/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ water_bottle_oz: bottleOz, water_goal_oz: goalOz }) })
      .then(r => { if (!r.ok) throw 0; window.__toast?.('Water settings saved', 'success'); })
      .catch(() => toastErr("Couldn’t save water settings — try again."));
    setEditWater(false);
  };

  // Optimistic toggle. We patch rawHealth (the single source the streak, 28-day grid,
  // supplement streaks/bars and per-day state all derive from) so the whole card updates
  // in one frame, then send the write with the explicit target value (no server-side
  // toggle race). On failure we roll the patch back — no full refetch that would clobber
  // the optimistic state and cause the old "lights up → flicker → deselects" bug.
  const toggleHabit = async (habitId) => {
    const newVal = !todayHabits[habitId];
    const apply = (val) => {
      setTodayHabits(h => ({ ...h, [habitId]: val }));
      setRawHealth(rh => {
        if (!rh) return rh;
        const habits = { ...(rh.habits || {}) };
        habits[viewDate] = { ...(habits[viewDate] || {}), [habitId]: val };
        return { ...rh, habits };
      });
    };
    apply(newVal);
    try {
      const r = await fetch('/api/health/habit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habit: habitId, date: viewDate, value: newVal }) });
      if (!r.ok) throw 0;
    } catch {
      apply(!newVal);
      toastErr("Couldn’t update that habit — try again.");
    }
  };

  const rehabKey = (ex, index) => ex.id || ex.name || String(index);

  const toggleRehab = async (ex, index) => {
    const key = rehabKey(ex, index);
    const done = !rehabDone[key];
    setRehabDone(p => ({ ...p, [key]: done }));
    await fetch('/api/health/rehab', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, done, date: viewDate }) })
      .then(r => { if (!r.ok) throw 0; })
      .catch(() => toastErr("Couldn’t update that exercise — reloading."));
    setTimeout(load, 300);
  };

  const toggleCore = async () => {
    const done = !coreDone;
    setCoreDone(done);
    await fetch('/api/health/core', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done, date: viewDate }) })
      .then(r => { if (!r.ok) throw 0; })
      .catch(() => toastErr("Couldn’t update core — reloading."));
    setTimeout(load, 300);
  };

  const totalCal     = foodLog.reduce((s, f) => s + f.calories, 0);
  const totalProtein = foodLog.reduce((s, f) => s + f.protein,  0);
  const totalCarbs   = foodLog.reduce((s, f) => s + f.carbs,    0);
  const totalFat     = foodLog.reduce((s, f) => s + f.fat,      0);
  const foodQuery    = foodName.trim().toLowerCase();
  const foodMatches  = (foodQuery ? foodSug.filter(s => s.name.toLowerCase().includes(foodQuery)) : foodSug).slice(0, 6);
  // Three clearly-distinct faction colours so the war planet's territories — and the tracer
  // fire colour-coded to them — read apart at a glance: blood red, toxic green, imperial blue.
  const MACRO_COLORS = { protein: 'oklch(0.62 0.20 25)', carbs: 'oklch(0.72 0.16 150)', fat: 'oklch(0.66 0.14 255)' };
  const macroData    = [
    { value: totalProtein, color: MACRO_COLORS.protein, label: 'Protein', grams: totalProtein },
    { value: totalCarbs,   color: MACRO_COLORS.carbs,   label: 'Carbs',   grams: totalCarbs   },
    { value: totalFat,     color: MACRO_COLORS.fat,     label: 'Fat',     grams: totalFat     },
  ];
  const calGoal = 3000;
  const calPct  = Math.min(100, (totalCal / calGoal) * 100);
  // Macro planet (same rotating-continents globe as Finance): the calorie goal is the whole
  // world. Each macro is a continent sized by its CALORIES (4·protein, 4·carbs, 9·fat) as a
  // share of the goal, so calories conquer land and the rest stays as black unclaimed ground.
  // The planet turns red only on a full calorie day (totalCal over the 3000 goal).
  const macroGlobe = [
    { value: totalProtein * 4, color: MACRO_COLORS.protein, label: 'Protein' },
    { value: totalCarbs   * 4, color: MACRO_COLORS.carbs,   label: 'Carbs'   },
    { value: totalFat     * 9, color: MACRO_COLORS.fat,     label: 'Fat'     },
  ].filter(d => d.value > 0);

  // Weekly calorie picture: the 7 days ending on the viewed day, summed from the food log.
  // weekGoal is the daily goal × 7 (e.g. 3000 × 7 = 21,000) — the "whole week" total.
  const weekDays = (() => {
    const log = (rawHealth && rawHealth.food_log) || {};
    const base = new Date(viewDate + 'T12:00:00');
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base); d.setDate(base.getDate() - i);
      const ds = localDateStr(d);
      const foods = log[ds] || [];
      out.push({
        ds,
        dow: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
        cals:    foods.reduce((s, f) => s + (f.calories || 0), 0),
        protein: foods.reduce((s, f) => s + (f.protein  || 0), 0),
        carbs:   foods.reduce((s, f) => s + (f.carbs    || 0), 0),
        fat:     foods.reduce((s, f) => s + (f.fat      || 0), 0),
      });
    }
    return out;
  })();
  const weekTotal     = weekDays.reduce((s, d) => s + d.cals, 0);
  const weekGoal      = calGoal * 7;
  const weekPct       = Math.min(100, (weekTotal / weekGoal) * 100);
  const weekDaysLogged = weekDays.filter(d => d.cals > 0).length;
  const weekAvg       = weekDaysLogged ? Math.round(weekTotal / weekDaysLogged) : 0;
  const weekProtein   = weekDays.reduce((s, d) => s + d.protein, 0);
  const weekCarbs     = weekDays.reduce((s, d) => s + d.carbs,   0);
  const weekFat       = weekDays.reduce((s, d) => s + d.fat,     0);

  const bmi    = (weight && height) ? +(weight / (height * height) * 703).toFixed(1) : null;
  const bmiCat = bmi == null ? '' : bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
  const bmiClr = bmi == null ? 'var(--ink-3)' : bmi < 18.5 ? 'var(--info)' : bmi < 25 ? 'var(--accent-2)' : bmi < 30 ? 'var(--warn)' : 'var(--danger)';
  const ftIn   = height ? `${Math.floor(height / 12)}'${height % 12}"` : null;
  const streakLabel = streak === 0 ? 'Start today' : streak < 7 ? 'Keep going' : streak < 14 ? 'Strong week' : streak < 30 ? 'On a roll' : 'Unstoppable';
  const waterBottle = Math.max(1, parseInt(waterBottleOz, 10) || 32);
  const waterGoal = Math.max(1, parseInt(waterGoalOz, 10) || 128);
  const waterPct = Math.min(100, (water / waterGoal) * 100);
  const waterBottles = water / waterBottle;
  const waterGoalBottles = waterGoal / waterBottle;
  const waterBottlesLeft = Math.max(0, (waterGoal - water) / waterBottle);
  const waterBottleSlots = Math.max(1, Math.min(8, Math.ceil(waterGoalBottles)));
  const fmtBottleCount = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1);

  return (
    <Card {...cardProps} id="health" num="03" title="Health & Fitness" span={cardProps.span || 4}
      right={<span className="tag mint">active</span>}
    >
      {/* ── 3 stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
        <div className="stat-block">
          <span className="l">Weight</span>
          <span className="v">{weight ?? '—'}<span className="muted-2" style={{ fontSize: 11, marginLeft: 3 }}>lb</span></span>
          {weightLog.length > 1 && <BarGraph3D data={weightLog} color="var(--accent-2)" height={56} />}
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
          <span>Nutrition · {nutritionView === 'today' ? 'Today' : 'This week'}</span>
          <span className="line" />
          <div style={{ display: 'flex', gap: 2 }}>
            {NUTRITION_VIEWS.map(v => (
              <button key={v} className={'btn' + (nutritionView === v ? ' primary' : ' ghost')}
                style={{ fontSize: 9.5, padding: '2px 8px', textTransform: 'capitalize' }}
                onClick={() => setNutritionView(v)}>{v}</button>
            ))}
          </div>
        </div>

        {/* Swipe left/right (touch) to switch between the Today and Week views. */}
        <div onTouchStart={onNutritionTouchStart} onTouchEnd={onNutritionTouchEnd}>
        {nutritionView === 'today' ? (<>

        {/* Search + add row sits ABOVE the donut/calorie display so the suggestions
            dropdown opens over the chart area (which is OK to obscure briefly)
            instead of over the calorie bar / food log below. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10, position: 'relative', zIndex: 5 }}>
          <div style={{ position: 'relative' }}>
            <input className="input" placeholder="Search or add food…" value={foodName}
              onChange={e => { setFoodName(e.target.value); setSugOpen(true); }}
              onFocus={() => setSugOpen(true)}
              onBlur={() => setTimeout(() => setSugOpen(false), 200)}
              style={{ fontSize: 11, padding: '3px 6px', width: '100%' }} />
            {sugOpen && (foodMatches.length > 0 || sugShowHidden) && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 2,
                background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6,
                maxHeight: 220, overflowY: 'auto', boxShadow: '0 6px 18px rgba(0,0,0,.28)' }}>
                {foodMatches.map((s, i) => (
                  <div key={i}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                      padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid var(--line-soft)',
                      opacity: s.hidden ? 0.55 : 1 }}
                    onMouseDown={e => { e.preventDefault(); pickFood(s); }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <span style={{ fontSize: 11, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name}
                      {s.count > 1 && <span className="muted-2 mono" style={{ fontSize: 9, marginLeft: 5 }}>×{s.count}</span>}
                      {s.hidden && <span className="muted-2 mono" style={{ fontSize: 9, marginLeft: 5 }}>hidden</span>}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{s.calories} kcal · P{s.protein} C{s.carbs} F{s.fat}</span>
                      {s.hidden ? (
                        <button className="btn ghost"
                          title="Restore to search"
                          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); unhideSuggestion(s.name); }}
                          style={{ padding: '1px 5px', fontSize: 10, lineHeight: 1 }}>↺</button>
                      ) : (
                        <button className="btn ghost"
                          title="Hide from search (food log entries are kept)"
                          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); hideSuggestion(s.name); }}
                          style={{ padding: '1px 5px', fontSize: 10, lineHeight: 1 }}>×</button>
                      )}
                    </span>
                  </div>
                ))}
                <div onMouseDown={e => { e.preventDefault(); const next = !sugShowHidden; setSugShowHidden(next); reloadSuggestions(next); }}
                  style={{ padding: '5px 8px', cursor: 'pointer', textAlign: 'center', background: 'var(--surface-1)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-1)'}>
                  <span className="muted-2 mono" style={{ fontSize: 10 }}>
                    {sugShowHidden ? '× hide hidden items' : '+ show hidden items'}
                  </span>
                </div>
              </div>
            )}
          </div>
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

        {/* Donut + calorie bar (positioned BELOW the search row) */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <DonutChart data={macroGlobe} size={92} war labels={false} alert={totalCal > calGoal} whole={calGoal} seed={viewDate} />
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
            <div className="mini-bar">
              <div className="fill" style={{
                width: calPct + '%',
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

        </>) : (<>

        {/* Week view — the whole week's calories at a glance (swipe left/right or tap "week"). */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span className="muted mono" style={{ fontSize: 10 }}>Weekly calories</span>
          <span className="mono" style={{ fontSize: 18, color: weekTotal > weekGoal ? 'var(--danger)' : 'var(--ink)' }}>
            {weekTotal.toLocaleString()}<span className="muted-2" style={{ fontSize: 11 }}> / {weekGoal.toLocaleString()}</span>
          </span>
        </div>
        <div className="mini-bar">
          <div className="fill" style={{
            width: weekPct + '%',
            background: weekTotal > weekGoal ? 'var(--danger)' : weekTotal > weekGoal * 0.85 ? 'var(--warn)' : 'var(--accent-2)',
          }} />
        </div>
        <div className="muted-2 mono" style={{ fontSize: 9.5, marginTop: 4 }}>
          {weekPct.toFixed(0)}% of weekly goal · avg {weekAvg.toLocaleString()} kcal/day · {weekDaysLogged}/7 days logged
        </div>

        {/* 7-day bar chart — each bar is that day's calories vs the daily goal */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', marginTop: 12 }}>
          {weekDays.map(d => {
            const h = Math.max(3, Math.min(100, (d.cals / calGoal) * 100));
            const over = d.cals > calGoal;
            const isToday = d.ds === viewDate;
            return (
              <div key={d.ds} title={`${d.ds}: ${d.cals.toLocaleString()} kcal`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <span className="mono" style={{ fontSize: 8.5, color: 'var(--ink-4)', height: 11 }}>
                  {d.cals ? (d.cals >= 1000 ? (d.cals / 1000).toFixed(1) + 'k' : d.cals) : ''}
                </span>
                <div style={{ width: '100%', height: 56, display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{
                    width: '100%', height: h + '%', borderRadius: '3px 3px 0 0',
                    background: over ? 'var(--danger)' : d.cals ? 'var(--accent-2)' : 'var(--surface-3)',
                    opacity: d.cals ? (isToday ? 1 : 0.8) : 0.4,
                    outline: isToday ? '1px solid var(--accent)' : 'none',
                  }} />
                </div>
                <span className="mono" style={{ fontSize: 9, color: isToday ? 'var(--accent)' : 'var(--ink-4)' }}>{d.dow}</span>
              </div>
            );
          })}
        </div>

        {/* Weekly macro totals */}
        <div style={{ display: 'flex', gap: 14, marginTop: 12, justifyContent: 'center' }}>
          {[['Protein', weekProtein, 'var(--accent)'], ['Carbs', weekCarbs, 'var(--warn)'], ['Fat', weekFat, 'var(--info)']].map(([label, g, color]) => (
            <div key={label} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span className="muted mono" style={{ fontSize: 10 }}>{label} <span style={{ color: 'var(--ink-2)' }}>{g}g</span></span>
            </div>
          ))}
        </div>

        </>)}
        </div>
      </div>

      {/* ── Hydration ── */}
      <div style={{ marginBottom: 14 }}>
        <div className="section-h" style={{ marginBottom: 8 }}>
          <span>Hydration · Today</span><span className="line" />
          <span className="muted-2 mono" style={{ fontSize: 10 }}>{waterGoal === 128 ? 'goal 1 gal' : `goal ${waterGoal} oz`}</span>
          <button className="btn ghost" style={{ padding: '1px 6px', fontSize: 10 }} onClick={() => setEditWater(v => !v)}>
            {editWater ? 'close' : 'edit'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexWrap: 'wrap', maxWidth: 205 }}>
            {Array.from({ length: waterBottleSlots }).map((_, i) => {
              const fill = Math.max(0, Math.min(1, water / waterBottle - i));
              return (
                <div key={i} title={`Bottle ${i + 1} (${waterBottle} oz)`} style={{
                  width: 20, height: 30, borderRadius: '5px 5px 6px 6px', position: 'relative',
                  overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--surface-2)',
                }}>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: (fill * 100) + '%', background: 'var(--info)' }} />
                </div>
              );
            })}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
              <span className="muted mono" style={{ fontSize: 10 }}>{fmtBottleCount(waterBottles)} of {fmtBottleCount(waterGoalBottles)} Owala bottles</span>
              <span className="mono" style={{ fontSize: 14, color: water >= waterGoal ? 'var(--accent)' : 'var(--ink-2)' }}>
                {water}<span className="muted-2" style={{ fontSize: 10 }}> / {waterGoal} oz</span>
              </span>
            </div>
            <div className="mini-bar">
              <div className="fill" style={{ width: waterPct + '%', background: water >= waterGoal ? 'var(--accent)' : 'var(--info)' }} />
            </div>
            <div className="muted-2 mono" style={{ fontSize: 9.5, marginTop: 4 }}>
              {water >= waterGoal
                ? (waterGoal === 128 ? 'Gallon complete' : 'Goal complete')
                : `${waterGoal - water} oz to go · ${fmtBottleCount(waterBottlesLeft)} bottles left`}
            </div>
          </div>
        </div>
        {editWater && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 5, marginTop: 8 }}>
            <input className="input" type="number" min="1" placeholder="Owala oz" value={waterBottleInput}
              onChange={e => setWaterBottleInput(e.target.value)}
              style={{ fontSize: 11, padding: '3px 6px' }} />
            <input className="input" type="number" min="1" placeholder="Goal oz" value={waterGoalInput}
              onChange={e => setWaterGoalInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveWaterConfig()}
              style={{ fontSize: 11, padding: '3px 6px' }} />
            <button className="btn primary" style={{ padding: '3px 8px', fontSize: 11 }} onClick={saveWaterConfig}>save</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          <button className="btn ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setWaterOz(water - waterBottle)}>- bottle</button>
          <button className="btn primary" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => setWaterOz(water + waterBottle)}>+ bottle ({waterBottle} oz)</button>
          <button className="btn ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setWaterOz(water + Math.round(waterBottle / 2))}>+ 0.5</button>
          {water > 0 && <button className="btn ghost" style={{ padding: '3px 8px', fontSize: 11, marginLeft: 'auto' }} onClick={() => setWaterOz(0)}>reset</button>}
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
          {/* Core tracking — part of the workout, intentionally NOT a habit */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
            <Checkbox checked={coreDone} onClick={toggleCore} />
            <span style={{ fontSize: 11, textDecoration: coreDone ? 'line-through' : 'none', color: coreDone ? 'var(--ink-4)' : 'inherit' }}>
              Core done today
            </span>
            <span className="muted-2 mono" style={{ fontSize: 9.5, marginLeft: 'auto' }}>aim 2–3×/wk</span>
          </div>
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
              <div key={rehabKey(ex, i)} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                <Checkbox checked={!!rehabDone[rehabKey(ex, i)]} onClick={() => toggleRehab(ex, i)} />
                <span style={{ textDecoration: rehabDone[rehabKey(ex, i)] ? 'line-through' : 'none', color: rehabDone[rehabKey(ex, i)] ? 'var(--ink-4)' : 'inherit' }}>
                  {ex.name} — {ex.sets}×{ex.reps}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Supplements ── */}
      <div style={{ marginBottom: 12 }}>
        <div className="section-h" style={{ marginBottom: 7 }}>
          <span>Supplements · Today</span><span className="line" />
          <span className="muted-2 mono" style={{ fontSize: 10 }}>
            {SUPPLEMENTS.filter(s => todayHabits[s.id]).length}/{SUPPLEMENTS.length} taken
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {SUPPLEMENTS.map(s => {
            const taken = !!todayHabits[s.id];
            const streak = calcSupplementStreak(s.id);
            const week = supplementWeek(s.id);
            return (
              <div key={s.id} onClick={() => toggleHabit(s.id)} role="button" tabIndex={0}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleHabit(s.id)}
                style={{
                  cursor: 'pointer', userSelect: 'none', padding: '8px 10px', borderRadius: 'var(--r)',
                  border: '1px solid ' + (taken ? `color-mix(in oklch, ${s.color} 55%, var(--line))` : 'var(--line-soft)'),
                  background: taken ? `color-mix(in oklch, ${s.color} 14%, var(--surface-2))` : 'var(--surface-2)',
                  transition: 'background .15s, border-color .15s',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: taken ? s.color : 'var(--ink-2)' }}>{s.label}</span>
                  <span style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                    border: '1.5px solid ' + (taken ? s.color : 'var(--ink-4)'),
                    background: taken ? s.color : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {taken && <Icon name="check" size={11} stroke={3} style={{ color: 'var(--bg)' }} />}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span className="muted-2 mono" style={{ fontSize: 9.5 }}>{s.sub}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: streak > 0 ? s.color : 'var(--ink-4)' }}>
                    {streak}<span className="muted-2" style={{ fontSize: 9, marginLeft: 2 }}>d streak</span>
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  {week.map(({ ds, taken: dt }) => (
                    <div key={ds} title={ds} style={{
                      flex: 1, height: 5, borderRadius: 2,
                      background: dt ? s.color : 'var(--surface-3)',
                      opacity: dt ? 0.9 : 0.45,
                    }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Today's habits ── */}
      {habitList.filter(h => !SUPPLEMENT_IDS.includes(h.id)).length > 0 && (() => {
        const visibleHabits = habitList.filter(h => !SUPPLEMENT_IDS.includes(h.id));
        const doneCount = visibleHabits.filter(h => todayHabits[h.id]).length;
        return (
          <div style={{ marginBottom: 12 }}>
            <div className="section-h" style={{ marginBottom: 7 }}>
              <span>Today's Habits</span><span className="line" />
              <span className="muted-2 mono" style={{ fontSize: 10 }}>
                {doneCount}/{visibleHabits.length} done
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {visibleHabits.map(h => {
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
        );
      })()}

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

  const loadWork = () => {
    fetch('/api/work').then(r=>r.json()).then(data => {
      if (data && data.length) {
        setAllTasks(data.filter(t=>!t.done).map(t=>({
          ...t, label: t.title || t.label || '',
          priority: priMap[t.priority] || t.priority || 'P2'
        })));
      }
    }).catch(()=>{});
  };
  useEffect(loadWork, []);
  useRefreshListener(loadWork);

  const markDone = async (id) => {
    const prev = allTasks;
    setAllTasks(xs => xs.filter(x => x.id !== id));
    try {
      const r = await fetch(`/api/work/${id}/done`, {method:'POST'});
      if (!r.ok) throw 0;
      if (window.__toast) window.__toast('Task done ✓');
    } catch { toastErr("Couldn’t complete that task — reverting."); setAllTasks(prev); }
  };
  const deleteTask = async (id) => {
    if (!confirm("Delete this task?")) return;
    const prev = allTasks;
    setAllTasks(xs => xs.filter(x => x.id !== id));
    try {
      const r = await fetch(`/api/work/${id}`, {method:'DELETE'});
      if (!r.ok) throw 0;
    } catch { toastErr("Couldn’t delete that task — reverting."); setAllTasks(prev); }
  };
  const addTask = async (e) => {
    if (e.key !== 'Enter' || !newTask.trim()) return;
    const parts = newTask.match(/P[0-3]/);
    const priority = parts ? parts[0] : "P1";
    const label = newTask.replace(/P[0-3]/,'').trim();
    const body = {title:label, priority:priority==='P0'?'high':priority==='P1'?'normal':'low', project:newTaskProject||''};
    if (newTaskDue) body.due_date = newTaskDue;
    let res;
    try {
      const r = await fetch('/api/work', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
      if (!r.ok) throw 0;
      res = await r.json();
    } catch { toastErr("Couldn’t add that task — try again."); return; }
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
    <Card id="work" num="05" title="Work" span={6}
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
// PRACTICE — Piano
// Schedule mirrors Parker's theory notebook (scales → triads →
// 7th chords → progressions → circle of 5ths = current topic).
// Review only — nothing here is past what's been covered.
// =========================================================
const PRACTICE_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PRACTICE_ROTATION = {
  piano: [
    {
      day: "Mon",
      title: "Scales — major & minor",
      minutes: 30,
      blocks: ["5m finger warmup (1-2-3-4-5)", "10m C & G major, hands together (W-W-H-W-W-W-H)", "10m A minor — natural / harmonic / melodic", "5m name the half steps (3-4, 7-8)"]
    },
    {
      day: "Tue",
      title: "Triads & inversions",
      minutes: 30,
      blocks: ["5m warmup", "10m build major / minor / dim / aug triads", "10m root → 1st → 2nd inversion", "5m hear major 3rd vs minor 3rd"]
    },
    {
      day: "Thu",
      title: "7th chords",
      minutes: 30,
      blocks: ["5m triad review", "15m the 5 types (dom7, maj7, min7, dim7, ø7)", "10m diatonic 7ths in a key"]
    },
    {
      day: "Fri",
      title: "Progressions & cadences",
      minutes: 30,
      blocks: ["5m warmup", "15m Tonic → Pre-dominant → Dominant → Tonic", "10m authentic (V-I) & deceptive (V-vi)"]
    },
    {
      day: "Sat",
      title: "Circle of 5ths (current)",
      minutes: 35,
      blocks: ["5m warmup", "15m walk the circle — add a sharp each step (C = 0)", "10m I-IV-V in 3 keys", "5m write the key signature"]
    },
    {
      day: "Sun",
      title: "Light review",
      minutes: 15,
      blocks: ["5m scales", "5m one triad / 7th chord", "5m circle of 5ths weak spot"]
    }
  ]
};

const PracticeCard = ({ cardProps = {} } = {}) => {
  const inst = "piano";
  const [data, setData] = useState({ piano: null });
  const [sessionMin, setSessionMin] = useState("");
  const [sessionNote, setSessionNote] = useState("");

  const load = () =>
    fetch("/api/practice").then(r => r.json()).then(d => setData(d)).catch(() => {});

  useEffect(() => { load(); }, []);
  useRefreshListener(load);

  const cur = data[inst];
  if (!cur) return null;

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

  const INST_COLOR = { piano: "var(--accent-2)" };

  return (
    <Card {...cardProps} id="practice" num="11" title="Piano Practice" span={cardProps.span || 6}
      right={
        <span className="muted-2 mono" style={{ fontSize: 11 }}>🎹 Piano</span>
      }
    >
      {/* ── Stats row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 14 }}>
        <div className="stat-block">
          <span className="l">Today</span>
          <span className="v" style={{ color: todayMin > 0 ? INST_COLOR[inst] : "var(--ink-4)" }}>
            {todayMin}<span className="muted-2" style={{ fontSize: 11, marginLeft: 3 }}>min</span>
          </span>
          <span className="muted-2 mono" style={{ fontSize: 10 }}>{todaySess.length} session{todaySess.length !== 1 ? "s" : ""}</span>
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

const MODULE_LIST = ["agenda","finance","band","health","work"];

// ── Activity Log ─────────────────────────────────────────────────────────────
const MODULE_META = {
  agenda:  { icon:"calendar",   color:"var(--info)"     },
  finance: { icon:"wallet",     color:"var(--accent-2)" },
  work:    { icon:"briefcase",  color:"var(--accent)"   },
  health:  { icon:"heart",      color:"var(--danger)"   },
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
    <Card id="activity" num="11" title="Activity Log" span={4}
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

// Roman numerals for the dashboard schedule — gives the "mission objectives" (PRIMUS/SECUNDUS) feel.
const toRoman = (n) => {
  if (!n || n < 1) return '';
  const map = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let r = '', x = n;
  for (const [v, s] of map) { while (x >= v) { r += s; x -= v; } }
  return r;
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

  const { agenda, habits, work_priority } = data;
  const habitsToday = habits.today || {};
  const habitList = habits.list || [];
  const doneCount = habitList.filter(h => habitsToday[h.id]).length;

  const toggleHabit = async (hid) => {
    const newVal = !habitsToday[hid];
    // Optimistic first so the checkbox responds on the tap, not after the round-trip.
    setData(d => ({...d, habits: {...d.habits, today: {...d.habits.today, [hid]: newVal}}}));
    try {
      const r = await fetch('/api/health/habit', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({habit: hid, date: today, value: newVal})
      });
      if (!r.ok) throw 0;
    } catch {
      setData(d => ({...d, habits: {...d.habits, today: {...d.habits.today, [hid]: !newVal}}}));
    }
  };

  return (
    <Card id="today" num="00" title="Today" span={12} right={
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
            : agenda.map((item, i) => (
              <div key={item.id} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',borderBottom:'1px solid var(--line-soft)'}}>
                <span className="mono" style={{fontSize:9.5,minWidth:26,flexShrink:0,textAlign:'right',letterSpacing:'0.06em',color:'var(--accent)',opacity:0.85}}>{toRoman(i+1)}</span>
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

        {/* Priority work */}
        <div>
          {work_priority.length > 0 ? <>
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
          </> : (
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
const CalendarCard = ({ cardProps = {} } = {}) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const todayObj = new Date();
  const [cal, setCal] = useState({ y: todayObj.getFullYear(), m: todayObj.getMonth() });
  const [vis, setVis] = useState({band:true,work:true,piano:true,show:true,birthday:true,anniversary:true,other:true,holiday:true,culture:true,gcal:true});
  const blankForm = {open:false, id:null, category:'band', date:'', title:'', time:'', end_time:'', meta:'', highlight:false, recurring:'', weekdays:[]};
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [manual, setManual] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);

  const load = () => {
    setLoading(true);
    fetch('/api/calendar/overview').then(r=>r.json()).then(d=>{
      setEvents(d.events||[]);
      setLoading(false);
    }).catch(()=>setLoading(false));
    fetch('/api/calendar/events/manual').then(r=>r.json()).then(d=>setManual(Array.isArray(d)?d:[])).catch(()=>{});
  };
  useEffect(load, []);
  useRefreshListener(load);

  // Each type gets its own distinct hue (oklch around the wheel) so the dots read at a glance.
  // Amber palette — warm hues at stepped lightness so dots stay readable while
  // keeping the white + amber-accent theme (no off-hue blues/greens/reds).
  const COLOR = {
    band:       'oklch(0.80 0.13 80)',   // amber
    show:       'oklch(0.70 0.14 52)',   // deep orange-amber
    work:       'oklch(0.87 0.10 95)',   // pale gold
    piano:      'oklch(0.74 0.11 70)',   // amber
    birthday:   'oklch(0.90 0.12 92)',   // bright gold
    anniversary:'oklch(0.62 0.13 45)',   // dark amber
    holiday:    'oklch(0.83 0.10 100)',  // light gold
    culture:    'oklch(0.78 0.12 60)',   // orange-amber
    other:      'oklch(0.68 0.10 65)',   // mid amber
    gcal:       'oklch(0.78 0.03 80)',   // warm grey / external
  };
  const ICON  = {band:'music',show:'mic',work:'briefcase',piano:'target',birthday:'sparkles',anniversary:'heart',
                 other:'flag',holiday:'flag',culture:'sparkles',gcal:'calendar'};
  const LABEL = {band:'Band',show:'Show',work:'Work',piano:'Piano',birthday:'Birthday',anniversary:'Anniversary',
                 other:'Other',holiday:'Holiday',culture:'Event',gcal:'Event'};
  const cv = t => COLOR[t] || 'var(--ink-3)';

  const CHIPS = [
    {id:'band',label:'Band'},{id:'work',label:'Work'},{id:'piano',label:'Piano'},{id:'show',label:'Shows'},
    {id:'birthday',label:'Bday'},{id:'anniversary',label:'Anniv'},
    {id:'holiday',label:'Holidays'},{id:'other',label:'Other'},{id:'culture',label:'Culture'},{id:'gcal',label:'Google'},
  ];
  const isVisible = e => vis[e.type] !== false;

  const pad = n => String(n).padStart(2,'0');
  const todayMs = new Date(new Date().toISOString().slice(0,10)+'T12:00:00').getTime();
  const dayDiff = s => Math.round((new Date(s+'T12:00:00').getTime()-todayMs)/864e5);
  const fmtCountdown = s => { const d=dayDiff(s); return d===0?'today':d===1?'tomorrow':`in ${d} days`; };
  const fmtDate = s => { const d=dayDiff(s); if(d===0)return'Today'; if(d===1)return'Tomorrow';
    return new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}); };

  // events grouped by date (visible only) — for the grid dots
  const byDate = {};
  events.filter(isVisible).forEach(e=>{ (byDate[e.date] = byDate[e.date]||[]).push(e); });

  const firstDay = new Date(cal.y, cal.m, 1).getDay();
  const daysInMonth = new Date(cal.y, cal.m+1, 0).getDate();
  const prevMonth = () => { let m=cal.m-1,y=cal.y; if(m<0){m=11;y--;} setCal({y,m}); };
  const nextMonth = () => { let m=cal.m+1,y=cal.y; if(m>11){m=0;y++;} setCal({y,m}); };
  const goToday = () => setCal({y:todayObj.getFullYear(),m:todayObj.getMonth()});
  const mName = new Date(cal.y,cal.m,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});

  const cells = [];
  for (let i=0;i<firstDay;i++) cells.push(null);
  for (let d=1;d<=daysInMonth;d++) cells.push(d);

  // These types auto-appear in Highlights; band/work only show if manually highlighted.
  const AUTO_HL = ['show','birthday','anniversary','holiday','other','piano'];
  const isHL = e => e.highlight || AUTO_HL.includes(e.type);
  // Highlights: visible, in viewed month, auto-or-flagged, future only
  const monthPrefix = `${cal.y}-${pad(cal.m+1)}`;
  const highlights = events
    .filter(e => isVisible(e) && e.date.startsWith(monthPrefix) && isHL(e) && dayDiff(e.date) >= 0)
    .sort((a,b)=> a.date < b.date ? -1 : 1);

  const openAdd = (date='') => setForm(f=>({...blankForm, open:true, date: date||f.date}));
  const openEdit = (e) => {
    const rec = manual.find(x=>x.id===e.id) || {};   // use the stored record (true date for recurring)
    setForm({open:true, id:e.id, category: rec.category||e.type||'other',
      title: rec.title!==undefined?rec.title:(e.title||''),
      date: rec.date||e.date||'', time: rec.time||'', end_time: rec.end_time||'',
      meta: rec.meta!==undefined?rec.meta:(e.meta||''),
      highlight: rec.highlight!==undefined?!!rec.highlight:!!e.highlight,
      recurring: rec.recurring||'', weekdays: rec.weekdays||[]});
  };
  const setCat = c => setForm(f=>({...f, category:c}));
  const annual = form.category==='birthday' || form.category==='anniversary';

  const submit = async () => {
    if (!form.title.trim() || !form.date) return;
    setSaving(true);
    const editing = !!form.id;
    const url = editing ? `/api/calendar/events/manual/${form.id}` : '/api/calendar/events/manual';
    let res;
    try {
      res = await fetch(url, {method: editing?'PATCH':'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({category:form.category,title:form.title,date:form.date,time:form.time,end_time:form.end_time,meta:form.meta,highlight:form.highlight,recurring:form.recurring,weekdays:form.weekdays})});
    } catch { setSaving(false); toastErr(editing?'Couldn’t save event — try again.':'Couldn’t add event — try again.'); return; }
    setSaving(false);
    if (!res.ok) { toastErr(editing?'Couldn’t save event — try again.':'Couldn’t add event — try again.'); return; }
    setForm(blankForm);
    load();
    if (window.__toast) window.__toast(editing?'Event updated':'Event added');
  };
  const delEvent = async (id) => {
    if (!id) return;
    if (!confirm("Delete this calendar event?")) return;
    try {
      const r = await fetch(`/api/calendar/events/manual/${id}`, {method:'DELETE'});
      if (!r.ok) throw 0;
    } catch { toastErr("Couldn’t delete that event — try again."); }
    load();
  };
  const toggleHighlight = async (e) => {
    if (!e.id) return;
    const cur = manual.find(x=>x.id===e.id);
    const next = cur ? !cur.highlight : !e.highlight;
    await fetch(`/api/calendar/events/manual/${e.id}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({highlight:next})});
    load();
  };
  const syncGoogle = async () => {
    setSyncing(true);
    const res = await fetch('/api/calendar/sync-google', {method:'POST'}).then(r=>r.json()).catch(()=>({ok:false}));
    setSyncing(false);
    if (window.__toast) {
      if (!res.ok) window.__toast(res.error==='not_connected'||res.error==='auth_required' ? 'Connect Google Calendar in Settings first' : 'Sync failed');
      else window.__toast(res.synced ? `Synced ${res.synced} event${res.synced>1?'s':''} to Google` : 'Already up to date');
    }
    load();
  };

  return (
    <Card {...cardProps} id="calendar" num="0c" title="Calendar" span={cardProps.span || 6}
      right={<>
        <button className="btn ghost" onClick={goToday} style={{padding:'2px 7px',fontSize:10.5,fontFamily:'var(--font-mono)'}}>Today</button>
        <button className="btn ghost" onClick={syncGoogle} disabled={syncing} title="Push events to Google Calendar" style={{padding:'2px 7px',fontSize:10.5,fontFamily:'var(--font-mono)'}}>{syncing?'Syncing…':'Sync'}</button>
        <button className="btn" onClick={()=>openAdd()}><Icon name="plus" size={13}/>Add</button>
      </>}
    >
      {form.open && (
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:10,padding:'10px',background:'var(--surface-2)',borderRadius:'var(--r)',border:'1px solid var(--line)'}}>
          <div className="muted-2 mono" style={{fontSize:10.5,letterSpacing:'.06em'}}>{form.id?'EDIT EVENT':'ADD EVENT'}</div>
          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
            {[['band','Band'],['work','Work'],['piano','Piano'],['birthday','Birthday'],['anniversary','Anniversary'],['other','Other']].map(([id,lbl])=>(
              <button key={id} className="btn ghost" onClick={()=>setCat(id)} style={{padding:'2px 8px',fontSize:10.5,fontFamily:'var(--font-mono)',
                color: form.category===id?cv(id):'var(--ink-4)',
                background: form.category===id?`color-mix(in oklch,${cv(id)} 18%,transparent)`:'transparent',
                borderColor: form.category===id?cv(id):'transparent'}}>{lbl}</button>
            ))}
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <input className="input" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} title={form.recurring==='weekly'?'Repeats start on/after this date':'Date'} style={{width:150,fontSize:12}}/>
            <input className="input" type="time" value={form.time} onChange={e=>setForm(f=>({...f,time:e.target.value}))} title="Start time" style={{width:104,fontSize:12}}/>
            <span className="muted-2" style={{fontSize:12}}>–</span>
            <input className="input" type="time" value={form.end_time} onChange={e=>setForm(f=>({...f,end_time:e.target.value}))} title="End time" style={{width:104,fontSize:12}}/>
          </div>
          <input className="input" placeholder="Title" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} style={{fontSize:12}}/>
          {!annual && (
            <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
              <span className="muted-2 mono" style={{fontSize:10,letterSpacing:'.06em',marginRight:2}}>REPEATS</span>
              {[['','Once'],['weekly','Weekly']].map(([id,lbl])=>(
                <button key={id||'once'} className="btn ghost" onClick={()=>setForm(f=>({...f,recurring:id}))} style={{padding:'2px 9px',fontSize:10.5,fontFamily:'var(--font-mono)',
                  color: form.recurring===id?'var(--accent)':'var(--ink-4)',
                  background: form.recurring===id?'var(--surface-3)':'transparent',
                  borderColor: form.recurring===id?'var(--line)':'transparent'}}>{lbl}</button>
              ))}
              {form.recurring==='weekly' && ['S','M','T','W','T','F','S'].map((lbl,idx)=>{
                const on = (form.weekdays||[]).includes(idx);
                return <button key={idx} className="btn ghost" title={['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][idx]}
                  onClick={()=>setForm(f=>({...f,weekdays: on ? f.weekdays.filter(w=>w!==idx) : [...(f.weekdays||[]), idx]}))}
                  style={{padding:'2px 0',width:22,fontSize:10.5,fontFamily:'var(--font-mono)',
                    color:on?'var(--ink)':'var(--ink-4)', background:on?cv(form.category):'transparent',
                    borderColor:on?cv(form.category):'var(--line-soft)'}}>{lbl}</button>;
              })}
            </div>
          )}
          <input className="input" placeholder="Note (optional)" value={form.meta} onChange={e=>setForm(f=>({...f,meta:e.target.value}))} style={{fontSize:12}}/>
          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--ink-3)',cursor: annual?'default':'pointer'}}>
            <input type="checkbox" checked={form.highlight||annual} disabled={annual} onChange={e=>setForm(f=>({...f,highlight:e.target.checked}))}/>
            Highlight on month agenda (countdown)
          </label>
          {annual && <div className="muted-2 mono" style={{fontSize:10}}>Saved to Google Calendar as a yearly event.</div>}
          {form.recurring==='weekly' && <div className="muted-2 mono" style={{fontSize:10}}>Repeats weekly on the selected days.</div>}
          <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
            <button className="btn primary" onClick={submit} disabled={saving} style={{fontSize:11}}>{saving?'Saving…':(form.id?'Save':'Add event')}</button>
            <button className="btn ghost" onClick={()=>setForm(blankForm)} style={{fontSize:11}}>✕</button>
          </div>
        </div>
      )}

      <div className="row" style={{justifyContent:'space-between',marginBottom:6}}>
        <span className="mono" style={{fontSize:12,color:'var(--ink)',fontWeight:600}}>{mName}</span>
        <div className="row" style={{gap:4}}>
          <button className="btn ghost" style={{padding:'2px 8px',fontSize:12}} onClick={prevMonth}>‹</button>
          <button className="btn ghost" style={{padding:'2px 8px',fontSize:12}} onClick={nextMonth}>›</button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
        {['S','M','T','W','T','F','S'].map((d,i)=>(<div key={'h'+i} style={{textAlign:'center',color:'var(--ink-4)',fontFamily:'var(--font-mono)',fontSize:10.5,paddingBottom:4}}>{d}</div>))}
        {cells.map((d,i)=>{
          if(!d) return <div key={i}/>;
          const ds = `${cal.y}-${pad(cal.m+1)}-${pad(d)}`;
          const evs = byDate[ds]||[];
          const isToday = d===todayObj.getDate() && cal.m===todayObj.getMonth() && cal.y===todayObj.getFullYear();
          const isSel = ds===selectedDay;
          return (
            <div key={i} onClick={()=>setSelectedDay(s=>s===ds?null:ds)} title={evs.map(e=>e.title).join(', ')} style={{
              minHeight:60, padding:'5px 4px', borderRadius:6, cursor:'pointer',
              background: isSel?`color-mix(in oklch,var(--accent) 18%,var(--surface-2))`:isToday?'var(--surface-3)':evs.length?'var(--surface-2)':'transparent',
              border: isSel?'1px solid var(--accent)':isToday?'1px solid var(--line)':'1px solid transparent'}}>
              <div className="mono" style={{fontSize:12,textAlign:'center',color:isSel?'var(--accent)':isToday?'var(--ink)':'var(--ink-3)',fontWeight:(isToday||isSel)?700:500}}>{d}</div>
              <div style={{display:'flex',gap:3,flexWrap:'wrap',justifyContent:'center',marginTop:4}}>
                {evs.slice(0,5).map((e,j)=>(<span key={j} title={e.title} style={{width:7,height:7,borderRadius:'50%',background:cv(e.type)}}/>))}
                {evs.length>5 && <span className="mono" style={{fontSize:8.5,color:'var(--ink-4)'}}>+{evs.length-5}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{display:'flex',gap:3,flexWrap:'wrap',margin:'8px 0 2px'}}>
        {CHIPS.map(c=>{
          const on = vis[c.id]!==false;
          return (
            <button key={c.id} className="btn ghost" onClick={()=>setVis(v=>({...v,[c.id]:!on}))} style={{
              padding:'2px 7px',fontSize:10,fontFamily:'var(--font-mono)',display:'flex',alignItems:'center',gap:4,
              opacity:on?1:0.4, textDecoration:on?'none':'line-through',
              color:on?cv(c.id):'var(--ink-4)', borderColor:'transparent'}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:cv(c.id)}}/>{c.label}
            </button>
          );
        })}
      </div>

      {highlights.length>0 && (
        <div>
          <div className="section-h"><span>Highlights</span><span className="line"/><span className="muted-2 mono" style={{fontSize:10.5}}>{mName.split(' ')[0]}</span></div>
          {highlights.map((e,i)=>(
            <div key={i} style={{display:'grid',gridTemplateColumns:'15px 1fr auto',gap:8,alignItems:'center',padding:'4px 0',borderBottom:'1px solid var(--line-soft)'}}>
              <Icon name={ICON[e.type]||'sparkles'} size={12} style={{color:cv(e.type)}}/>
              <div style={{fontSize:12,color:'var(--ink)',fontWeight:500,lineHeight:1.3}}>{e.title}{e.meta&&<span className="muted-2" style={{fontSize:10.5,marginLeft:5}}>{e.meta}</span>}</div>
              <span className="mono" style={{fontSize:10.5,color:cv(e.type),whiteSpace:'nowrap'}}>{fmtCountdown(e.date)}</span>
            </div>
          ))}
        </div>
      )}

      {selectedDay && (() => {
        const dayEvents = byDate[selectedDay] || [];
        const label = new Date(selectedDay+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
        return (
          <div style={{marginTop:6}}>
            <div className="section-h" style={{alignItems:'center'}}>
              <span>{label}</span><span className="line"/>
              <button className="btn ghost" onClick={()=>openAdd(selectedDay)} title="Add event on this day" style={{padding:'2px 7px',fontSize:10.5,fontFamily:'var(--font-mono)',display:'flex',alignItems:'center',gap:3}}><Icon name="plus" size={11}/>Add</button>
            </div>
            {dayEvents.length===0 && <div className="muted-2 mono" style={{fontSize:11,padding:'8px 0',textAlign:'center'}}>No events — tap Add to create one.</div>}
            {dayEvents.map((e,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'15px 1fr auto',gap:8,alignItems:'center',padding:'5px 0',borderBottom:'1px solid var(--line-soft)'}}>
                <Icon name={ICON[e.type]||'calendar'} size={12} style={{color:cv(e.type)}}/>
                <div>
                  <div style={{fontSize:12,color:'var(--ink)',fontWeight:500,lineHeight:1.3}}>{e.title}</div>
                  {e.meta&&<div style={{fontSize:10.5,color:'var(--ink-4)'}}>{e.meta}</div>}
                </div>
                {e.id
                  ? <div style={{display:'flex',gap:1,alignItems:'center'}}>
                      {AUTO_HL.includes(e.type)
                        ? <span className="icon-btn" title="Always highlighted" style={{color:cv(e.type),cursor:'default'}}><Icon name="sparkles" size={11}/></span>
                        : <button className="icon-btn" onClick={()=>toggleHighlight(e)} title={e.highlight?'Remove highlight':'Highlight on month agenda'} style={{color:e.highlight?cv(e.type):'var(--ink-4)'}}><Icon name="sparkles" size={11}/></button>}
                      <button className="icon-btn" onClick={()=>openEdit(e)} title="Edit event" style={{color:'var(--ink-4)'}}><Icon name="feather" size={11}/></button>
                      <button className="icon-btn" onClick={()=>delEvent(e.id)} title="Delete event" style={{color:'var(--ink-4)'}}><Icon name="x" size={11}/></button>
                    </div>
                  : <span className="tag" style={{fontSize:10,padding:'1px 6px',whiteSpace:'nowrap',color:cv(e.type),borderColor:`color-mix(in oklch,${cv(e.type)} 40%,var(--line))`}}>{LABEL[e.type]||e.type}</span>}
              </div>
            ))}
          </div>
        );
      })()}
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
    <Card id="tcpg" num="10" title="TCPG Monitor" span={6} right={
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

// =========================================================
// RECURRING TASKS — daily / weekly / monthly chores
// Separate from the calendar. Cleared by checking a box; the
// task reappears after its interval elapses (daily = next day,
// weekly = 7 days, monthly = next calendar month).
// =========================================================
const RECURRING_FREQS = [
  { id: "daily",   label: "Daily",   color: "var(--accent-2)" },
  { id: "weekly",  label: "Weekly",  color: "var(--accent)"   },
  { id: "monthly", label: "Monthly", color: "var(--violet)"   },
];

const RecurringTasksCard = ({ cardProps = {} } = {}) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newFreq, setNewFreq] = useState("weekly");

  const load = () => {
    setLoading(true);
    fetch('/api/recurring').then(r => r.json()).then(data => {
      setItems(Array.isArray(data) ? data : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(load, []);
  useRefreshListener(load);

  const addTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    let res = null;
    try {
      const r = await fetch('/api/recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, frequency: newFreq }),
      });
      if (!r.ok) throw 0;
      res = await r.json();
    } catch { toastErr("Couldn’t add that routine — try again."); return; }
    if (res && res.id) {
      setItems(xs => [...xs, { ...res, due: true }]);
      setNewTitle("");
      if (window.__toast) window.__toast(`${RECURRING_FREQS.find(f=>f.id===newFreq)?.label} task added`);
    }
  };

  const markDone = async (id) => {
    const today = new Date().toISOString().slice(0, 10);
    setItems(xs => xs.map(x => x.id === id ? { ...x, last_completed: today, due: false } : x));
    await fetch(`/api/recurring/${id}/done`, { method: 'POST' })
      .then(r => { if (!r.ok) throw 0; })
      .catch(() => { toastErr("Couldn’t update that routine — reloading."); load(); });
  };

  const undo = async (id) => {
    setItems(xs => xs.map(x => x.id === id ? { ...x, last_completed: null, due: true } : x));
    await fetch(`/api/recurring/${id}/undo`, { method: 'POST' })
      .then(r => { if (!r.ok) throw 0; })
      .catch(() => { toastErr("Couldn’t update that routine — reloading."); load(); });
  };

  const remove = async (id) => {
    if (!confirm("Remove this routine?")) return;
    const prev = items;
    setItems(xs => xs.filter(x => x.id !== id));
    await fetch(`/api/recurring/${id}`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw 0; })
      .catch(() => { toastErr("Couldn’t remove that routine — reverting."); setItems(prev); });
  };

  const resetScope = async (scope) => {
    const label = scope === 'week' ? 'week' : 'month';
    if (!confirm(`Start a new ${label}? Completed ${scope === 'week' ? 'weekly' : 'monthly'} routines will reset to do-again.`)) return;
    const res = await fetch('/api/recurring/reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    }).then(r => r.json()).catch(() => null);
    load();
    if (res && window.__toast) window.__toast(`New ${label} — ${res.cleared} routine${res.cleared === 1 ? '' : 's'} reset`);
  };

  const dueCount = items.filter(i => i.due).length;

  const renderColumn = (freq) => {
    const colItems = items.filter(i => i.frequency === freq.id);
    const due = colItems.filter(i => i.due);
    const done = colItems.filter(i => !i.due);
    return (
      <div key={freq.id} style={{ padding: "10px 14px", borderRight: "1px solid var(--line-soft)" }}>
        <div className="row" style={{ justifyContent: "space-between", padding: "0 4px 6px" }}>
          <span className="muted-2 mono" style={{ fontSize: 10.5, letterSpacing: ".08em", color: freq.color }}>
            {freq.label.toUpperCase()}
          </span>
          <span className="mono muted-2" style={{ fontSize: 10.5 }}>
            {due.length}{colItems.length ? `/${colItems.length}` : ''}
          </span>
        </div>

        {colItems.length === 0 && (
          <div className="muted-2 mono" style={{ fontSize: 11, padding: '8px 4px' }}>— none —</div>
        )}

        {due.map(it => (
          <div key={it.id} style={{
            display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 6,
            alignItems: 'center', padding: '5px 4px'
          }}>
            <Checkbox checked={false} onClick={() => markDone(it.id)} />
            <span style={{ fontSize: 12.5, lineHeight: 1.35 }}>{it.title}</span>
            <button onClick={() => remove(it.id)} title="Remove"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--ink-4)', padding: '2px', display: 'flex', alignItems: 'center' }}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}

        {done.length > 0 && (
          <>
            {due.length > 0 && <div className="hairline" style={{ margin: '6px 0' }} />}
            {done.map(it => (
              <div key={it.id} style={{
                display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 6,
                alignItems: 'center', padding: '4px 4px', opacity: 0.55
              }}>
                <Checkbox checked={true} onClick={() => undo(it.id)} />
                <span style={{ fontSize: 12, textDecoration: 'line-through', color: 'var(--ink-3)' }}>{it.title}</span>
                <button onClick={() => remove(it.id)} title="Remove"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--ink-4)', padding: '2px', display: 'flex', alignItems: 'center' }}>
                  <Icon name="x" size={11} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <Card id="recurring" num="12" title="Routines"
      span={cardProps.span || 12}
      onDashboardMinimize={cardProps.onDashboardMinimize}
      right={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn" style={{ padding: '4px 8px' }} onClick={() => resetScope('week')} title="Reset weekly (+ daily) routines">New week</button>
          <button className="btn" style={{ padding: '4px 8px' }} onClick={() => resetScope('month')} title="Reset monthly, weekly & daily routines">New month</button>
          <span className="mono muted-2" style={{ fontSize: 11 }}>
            {loading ? 'loading…' : `${dueCount} due`}
          </span>
        </div>
      }
      bodyClass="flush"
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {RECURRING_FREQS.map(renderColumn)}
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line-soft)',
        display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="input" value={newFreq} onChange={e => setNewFreq(e.target.value)}
          style={{ fontSize: 12, width: 'auto', minWidth: 110 }}>
          {RECURRING_FREQS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <input className="input" placeholder="Add a routine (e.g. vacuum, WIP report)…"
          value={newTitle} onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTask()}
          style={{ fontSize: 12, flex: 1, minWidth: 160 }} />
        <button className="btn primary" onClick={addTask}><Icon name="plus" size={13} /></button>
      </div>
    </Card>
  );
};

window.MissionModules = {
  AgendaCard, FinanceCard, BandCard, HealthCard, WorkCard,
  TodayHub, ActivityCard, CalendarCard,
  TCPGCard, PracticeCard, RecurringTasksCard
};
