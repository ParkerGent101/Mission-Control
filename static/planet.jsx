/* Mission Control — WAR PLANET (true 3D globe). Single source of truth for the viz the
   Finance + Health cards render. Replaces the old pure-SVG fake-3D DonutChart in modules.jsx.

   It is a REAL lit sphere (three.js) on the green scanner readout: the planet's land/ocean
   layout is seeded per day from `seed`; logging conquers that land (conquered fraction of all
   land = total / `whole`, split among factions by share of the day's total), a battle front
   creeps as a centred island so the fill grows smoothly, and at/over the goal (`alert`) the
   whole world washes red. The scanner-scope furniture (frame, crosshair, graticule, ticks) is
   a crisp 2D vector overlay; orbital bombardment is an eased 2D tracer overlay; the SPHERE is
   the 3D. Honors prefers-reduced-motion (one static frame, no spin/tracers).

   Layers, back→front:  atmosphere glow (div)  ·  WebGL globe (canvas)  ·  fx tracers + limb
   ring (canvas, drawn imperatively at 60fps)  ·  HUD chrome (static SVG).

   Loaded as a classic <script type="text/babel"> AFTER React and a three.js UMD build, and
   after modules.jsx (so `const DonutChart` is declared once, here). Keeps the exact prop
   contract: ({ data, size, war, labels, alert, whole, ocean, landNeutral, seed, landRatio }). */

const { useState: usePL, useEffect: usePLEffect, useRef: usePLRef } = React;

// Deterministic per-day world: a string seed (a date) hashes to a fixed PRNG stream, so a
// given day always renders the same land/ocean layout but consecutive days differ. (Moved
// here from modules.jsx — the war planet was the only consumer.)
const hashStr = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const todayStr = () => { try { return new Date().toISOString().slice(0, 10); } catch { return 'world'; } };

// ─── colour resolution ───────────────────────────────────────────────────────────────────
// The theme speaks oklch + CSS vars; three.js Color and (portably) canvas fillStyle want hex.
// Resolve `var(--x)` against the document, convert oklch→sRGB ourselves so it works regardless
// of canvas oklch support, and pass hex/rgb through untouched. Cached per-string.
const PL_clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const PL_oklchToRgb = (L, C, h) => {
  const hr = h * Math.PI / 180, a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  let r =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const gam = (x) => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055;
  return [PL_clamp01(gam(r)), PL_clamp01(gam(g)), PL_clamp01(gam(bl))];
};
const PL_hex = (rgb) => '#' + rgb.map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
const PL_colorCache = {};
const PL_resolve = (str, depth = 0) => {
  if (!str) return '#888888';
  str = ('' + str).trim();
  if (PL_colorCache[str]) return PL_colorCache[str];
  let out = '#888888';
  if (str[0] === '#' || str.startsWith('rgb')) { out = str; }
  else if (str.startsWith('var(')) {
    const name = str.slice(4, str.indexOf(')')).split(',')[0].trim();
    let v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) {}
    out = (v && depth < 4) ? PL_resolve(v, depth + 1) : '#cfcfcf';
  } else if (str.startsWith('oklch')) {
    const n = str.slice(str.indexOf('(') + 1, str.indexOf(')')).replace(/\//g, ' ').split(/[ ,]+/).filter(Boolean);
    const L = parseFloat(n[0]) * (n[0] && n[0].indexOf('%') >= 0 ? 0.01 : 1);
    out = PL_hex(PL_oklchToRgb(L, parseFloat(n[1]) || 0, parseFloat(n[2]) || 0));
  }
  PL_colorCache[str] = out;
  return out;
};
// mix two hex colours (t: 0→a .. 1→b), used for the eased alert wash
const PL_mix = (aHex, bHex, t) => {
  const p = (h) => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const A = p(aHex), B = p(bHex);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
};

// ─── geometry helpers ────────────────────────────────────────────────────────────────────
const PL_D = Math.PI / 180;
// A smooth closed coastline through `pts` (quadratic curves via segment midpoints) — this is
// what turns the old 36-gon polygons into clean curves. `dx` shifts the whole path (seam wrap).
const PL_coast = (ctx, pts, dx) => {
  const n = pts.length; if (n < 3) return;
  const mid = (i, j) => [(pts[i][0] + pts[j][0]) / 2 + dx, (pts[i][1] + pts[j][1]) / 2];
  let m = mid(n - 1, 0);
  ctx.beginPath();
  ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) { const m2 = mid(i, (i + 1) % n); ctx.quadraticCurveTo(pts[i][0] + dx, pts[i][1], m2[0], m2[1]); }
  ctx.closePath();
};
// FEBA front-line teeth (small sawtooth triangles) along a boundary loop, as canvas fills
const PL_teeth = (ctx, pts, dx, tH, color) => {
  ctx.fillStyle = color;
  for (let k = 1; k < pts.length - 2; k += 2) {
    const a = pts[k], b = pts[k + 1];
    const ddx = b[0] - a[0], ddy = b[1] - a[1], len = Math.hypot(ddx, ddy) || 1, ux = ddx / len, uy = ddy / len, nx = uy, ny = -ux;
    const mx = (a[0] + b[0]) / 2 + dx, my = (a[1] + b[1]) / 2, w = len * 0.5;
    ctx.beginPath();
    ctx.moveTo(mx - ux * w, my - uy * w); ctx.lineTo(mx + ux * w, my + uy * w); ctx.lineTo(mx + nx * tH, my + ny * tH);
    ctx.closePath(); ctx.fill();
  }
};
// concentric inset rings (each polygon scaled toward the continent centroid) — the terrace
// levels that double as topographic contour lines (in the colour texture) and elevation steps
// (in the heightmap). Outermost (1.0) is the coastline itself.
const PL_LEVELS = [1.0, 0.80, 0.62, 0.45, 0.28];
const PL_insets = (pts, cx, cy) => PL_LEVELS.map(f => pts.map(p => [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f]));

// grayscale equirectangular HEIGHTMAP (built ONCE per world — relief is fixed for the day, only
// the conquest COLOUR changes): ocean/rock black, each continent a terraced massif rising toward
// its centre. Drives the sphere's displacement so the land literally stands up off the globe.
const PL_paintHeight = (ctx, W, H, world) => {
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const copies = [-W, 0, W]; ctx.lineJoin = 'round';
  world.continents.forEach(c => {
    PL_insets(c.pts, c.cxp, c.cyp).forEach((ring, i) => {
      const g = Math.round(58 + i * 40);                                            // 58 → 218: coast → peak
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      copies.forEach(dx => { PL_coast(ctx, ring, dx); ctx.fill(); });
    });
  });
  ctx.save(); ctx.filter = 'blur(2px)'; ctx.drawImage(ctx.canvas, 0, 0); ctx.restore();  // round the terraces
};

// derive a tangent-space NORMAL MAP from the heightmap (Sobel). This is what makes the relief
// catch light on the front face — a fragment-shader effect, so it works on every GPU (and in
// headless software WebGL) unlike displacementMap, which needs vertex-texture fetch.
const PL_normalMap = (heightCanvas, strength) => {
  const W = 1024, H = 512, tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
  const c = tmp.getContext('2d'); c.drawImage(heightCanvas, 0, 0, W, H);
  const src = c.getImageData(0, 0, W, H).data, out = c.createImageData(W, H), o = out.data;
  const at = (x, y) => { x = (x + W) % W; y = y < 0 ? 0 : y >= H ? H - 1 : y; return src[(y * W + x) * 4] / 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    let nx = -dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz) || 1;
    const i = (y * W + x) * 4; o[i] = (nx / l * 0.5 + 0.5) * 255; o[i + 1] = (ny / l * 0.5 + 0.5) * 255; o[i + 2] = (nz / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  c.putImageData(out, 0, 0); return tmp;
};

// ─── retro bitmap post-process ───────────────────────────────────────────────────────────
// The app is a CRT cogitator; a smooth modern WebGL sphere reads "too new". So we render the
// globe to a LOW-RES target and run a fullscreen pass that ORDERED-DITHERS + POSTERIZES it to a
// chunky, limited-colour image — like a planet drawn on an old bitmap display. Keeps hue (so
// conquest colour / red alert still read) but quantises depth; the vector HUD stays crisp atop.
const PL_POST_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const PL_POST_FRAG = [
  'precision mediump float;',
  'uniform sampler2D tDiffuse; uniform sampler2D uBayer; uniform vec2 uLowRes; uniform float uLevels;',
  'varying vec2 vUv;',
  'void main(){',
  '  vec4 c = texture2D(tDiffuse, vUv);',
  '  vec2 px = floor(vUv * uLowRes);',
  '  float d = texture2D(uBayer, (px + 0.5) / 8.0).r - 0.5;',     // 8x8 Bayer, RepeatWrapping tiles it
  '  vec3 col = c.rgb + d / uLevels;',                            // dither before quantising
  '  col = floor(col * uLevels + 0.5) / uLevels;',                // posterise to uLevels steps/channel
  '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);',
  '}',
].join('\n');
// recursive Bayer matrix (0..n²-1) → an 8x8 ordered-dither threshold texture
const PL_makeBayer = (THREE) => {
  const build = (n) => { if (n === 1) return [[0]]; const s = build(n >> 1), h = s.length, o = [];
    for (let y = 0; y < n; y++) { o[y] = []; for (let x = 0; x < n; x++) { const quad = x < h ? (y < h ? 0 : 3) : (y < h ? 2 : 1); o[y][x] = 4 * s[y % h][x % h] + quad; } } return o; };
  const m = build(8), data = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const v = Math.round(((m[y][x] + 0.5) / 64) * 255), i = (y * 8 + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
  const tex = new THREE.DataTexture(data, 8, 8, THREE.RGBAFormat); tex.needsUpdate = true;
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
};

// five faction hatch patterns (dark lines/dots over the faction colour) — keep factions
// readable apart even before colour fully registers. Built once against the texture's bg hue.
const PL_makeHatches = (bgHex) => {
  const specs = [
    (c) => { c.rotate(Math.PI / 4); c.strokeStyle = bgHex; c.globalAlpha = 0.5; c.lineWidth = 2.2; c.beginPath(); c.moveTo(0, -20); c.lineTo(0, 20); c.stroke(); },
    (c) => { c.rotate(-Math.PI / 4); c.strokeStyle = bgHex; c.globalAlpha = 0.5; c.lineWidth = 2.2; c.beginPath(); c.moveTo(0, -20); c.lineTo(0, 20); c.stroke(); },
    (c) => { c.strokeStyle = bgHex; c.globalAlpha = 0.45; c.lineWidth = 1.6; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 12); c.moveTo(0, 0); c.lineTo(12, 0); c.stroke(); },
    (c) => { c.fillStyle = bgHex; c.globalAlpha = 0.5; c.beginPath(); c.arc(6, 6, 2.4, 0, 7); c.fill(); },
    (c) => { c.strokeStyle = bgHex; c.globalAlpha = 0.5; c.lineWidth = 2.2; c.beginPath(); c.moveTo(-2, 0); c.lineTo(14, 0); c.stroke(); },
  ];
  const sizes = [12, 12, 12, 12, 14];
  return specs.map((draw, i) => {
    const s = sizes[i], cv = document.createElement('canvas'); cv.width = cv.height = s;
    const c = cv.getContext('2d'); c.translate(s / 2, s / 2); draw(c);
    return cv;
  });
};

// ─── the world: continents seeded from the day, in equirectangular texture space ───────────
// Ports the land/ocean generation + low-discrepancy conquest order from the old SVG version,
// but lays the lobed continents out in lat/lon and paints them into a texture for the sphere.
const PL_buildWorld = (seed, landRatioProp, texW, texH) => {
  const wr = mulberry32(hashStr('mc-world|' + (seed || todayStr())));
  const u = wr();
  let baseLandRatio, rockWorld = false;
  if (u < 0.05) { baseLandRatio = 0.30 + (u / 0.05) * 0.18; }                       // water world
  else if (u < 0.33) { rockWorld = true; baseLandRatio = 0.97 + ((u - 0.05) / 0.28) * 0.03; }  // rock world
  else { baseLandRatio = 0.90 + ((u - 0.33) / 0.67) * 0.09; }                       // land-heavy
  const landRatio = landRatioProp != null ? landRatioProp : baseLandRatio;
  const LAT = [12, -10, 22, -18, 6, -24, 16, -14];                                  // kept near the equator
  const K = 6 + Math.floor(wr() * 4);                                               // 6–9 continents
  const weights = []; for (let k = 0; k < K; k++) weights.push(0.55 + wr());
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  const lonOff = wr() * 360;
  const noise = Math.sin;
  // lobed closed outline in lat/lon degrees about a centre, then projected to texture px (with
  // longitude compression by cos(lat)); ±360° copies at paint time make the seam wrap seamless.
  const blobPx = (latC, lonC, angR, bseed) => {
    const pts = [], M = 40, cl = Math.max(0.18, Math.cos(latC * PL_D));
    for (let q = 0; q < M; q++) {
      const a = (q / M) * Math.PI * 2;
      const w = 1 + 0.17 * noise(3 * a + bseed) + 0.11 * noise(5 * a + bseed * 1.7) + 0.07 * noise(8 * a + bseed * 2.3);
      const lat = latC + angR * w * Math.sin(a), lon = lonC + (angR * w * Math.cos(a)) / cl;
      pts.push([(lon / 360) * texW, ((90 - lat) / 180) * texH]);
    }
    return pts;
  };
  const continents = [];
  for (let k = 0; k < K; k++) {
    const frac = weights[k] / wSum;
    const Rfrac = Math.min(1.05, Math.sqrt(landRatio * frac * 4.4));                 // 0..~1 of the sphere radius
    const angR = Math.min(82, Rfrac * 74);                                          // → angular radius, degrees
    const latC = LAT[Math.floor(wr() * LAT.length) % LAT.length];
    const lonC = (k / K) * 360 + lonOff + (wr() - 0.5) * 16;
    const bseed = 0.7 + k * 1.3;
    continents.push({ k, frac, latC, lonC, angR, bseed,
      cxp: (lonC / 360) * texW, cyp: ((90 - latC) / 180) * texH, pts: blobPx(latC, lonC, angR, bseed) });
  }
  continents.sort((a, b) => a.lonC - b.lonC);
  // scattered (golden-ratio) conquest order, so the taken fraction reads at any rotation
  const order = continents.map((_, j) => j).sort((x, y) => ((x * 0.61803) % 1) - ((y * 0.61803) % 1));
  let acc = 0; order.forEach(j => { continents[j].a = acc; acc += continents[j].frac; continents[j].b = acc; });
  // rock worlds may host a small inland sea or two (or none)
  const seas = [];
  if (rockWorld && wr() < 0.55) {
    const n = 1 + (wr() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const latC = LAT[Math.floor(wr() * LAT.length) % LAT.length], lonC = wr() * 360, angR = 9 + wr() * 11;
      seas.push({ i, pts: blobPx(latC, lonC, angR, 3.1 + i * 2.7) });
    }
  }
  return { continents, seas, rockWorld, landRatio };
};

// faction (macro / expense category) spans packed into the conquered fraction [0, conq]
const PL_faceSpans = (data, conq) => {
  const facs = (data || []).filter(d => !d.neutral && d.value > 0);
  const facTotal = facs.reduce((s, d) => s + d.value, 0) || 1;
  let fc = 0;
  return facs.map((d, i) => { const seg = { d, color: PL_resolve(d.color), start: fc, end: fc + (d.value / facTotal) * conq, hatch: i % 5 }; fc = seg.end; return seg; });
};
const PL_ownerAt = (spans, pos) => spans.find(s => pos >= s.start && pos < s.end) || null;

// ─── paint the world into the equirectangular texture at the current (eased) conquered frac ──
const PL_paint = (ctx, W, H, world, spans, conq, pal, hatches) => {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = world.rockWorld ? pal.rock : pal.ocean;
  ctx.fillRect(0, 0, W, H);
  if (!world.rockWorld) {                                                           // faint sea texture
    ctx.save(); ctx.globalAlpha = 0.10; ctx.strokeStyle = pal.ink3; ctx.lineWidth = 1.4;
    for (let y = H * 0.08; y < H; y += H * 0.05) { ctx.beginPath(); for (let x = 0; x <= W; x += 14) ctx.lineTo(x, y + Math.sin(x * 0.04) * 2.2); ctx.stroke(); }
    ctx.restore();
  }
  const copies = [-W, 0, W];
  ctx.lineJoin = 'round';
  world.continents.forEach(c => {
    // How much of THIS continent's conquest-range [c.a, c.b] is taken: a straddler is partly taken
    // (its conquered island is centroid-scaled by √localConq so AREA grows linearly with conquest).
    const e = Math.min(c.b, conq);                                                  // conquered up to here within [c.a, c.b]
    const conquered = c.a < conq;
    const straddles = c.a < conq && c.b > conq;
    const localConq = straddles ? (conq - c.a) / (c.b - c.a) : 0;
    const baseScale = conquered ? (straddles ? Math.sqrt(PL_clamp01(localConq)) : 1) : 0;
    // Split the conquered land among factions by AREA = their share of the conquered span. The macro/
    // category spans that overlap this continent's conquered range each get a concentric ring; ring
    // area = baseScale²·frac, so total land per faction == its calorie/spend share (disjoint across
    // continents, but proportional overall — so protein/carbs/fat ALL read even with one continent taken).
    const rangeLen = Math.max(1e-9, e - c.a);
    const segs = conquered ? spans.map(s => {
      const ov = Math.min(s.end, e) - Math.max(s.start, c.a);
      return ov > 1e-9 ? { color: s.color, hatch: s.hatch, frac: ov / rangeLen } : null;
    }).filter(Boolean) : [];
    const scaleC = (s) => c.pts.map(p => [c.cxp + (p[0] - c.cxp) * s, c.cyp + (p[1] - c.cyp) * s]);
    const fillHatch = (idx, dx) => { const pat = ctx.createPattern(hatches[idx], 'repeat'); if (pat) { ctx.fillStyle = pat; ctx.fill(); } };
    const rings = PL_insets(c.pts, c.cxp, c.cyp);                                    // terrace contour lines
    copies.forEach(dx => {
      // base unclaimed terrain (purple Tyranid ground) + thin inter-country border
      PL_coast(ctx, c.pts, dx); ctx.fillStyle = pal.landN; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = pal.bg; ctx.stroke();
      // conquered land: nested overpaint, outer→inner, each faction a ring of proportional area
      if (segs.length && baseScale > 0.02) {
        let cum = 0;
        segs.forEach(seg => {
          const sIn = baseScale * Math.sqrt(Math.max(0, 1 - cum));
          if (sIn >= 0.02) { const pts = scaleC(sIn); PL_coast(ctx, pts, dx); ctx.fillStyle = seg.color; ctx.fill(); PL_coast(ctx, pts, dx); fillHatch(seg.hatch, dx); }
          cum += seg.frac;
        });
        if (straddles && localConq > 0.004) {                                       // battle-front outline around the conquered island
          PL_coast(ctx, scaleC(baseScale), dx); ctx.lineWidth = 2.2; ctx.strokeStyle = pal.bone; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
      // topographic contour lines (idea1 terrain scan) — inner terrace rings over the land
      ctx.lineWidth = Math.max(0.7, H * 0.0014); ctx.strokeStyle = conquered ? pal.bone : pal.accent2; ctx.globalAlpha = 0.4;
      for (let i = 1; i < rings.length; i++) { PL_coast(ctx, rings[i], dx); ctx.stroke(); }
      ctx.globalAlpha = 1;
      // coastline / national border
      PL_coast(ctx, c.pts, dx);
      ctx.lineWidth = conquered ? 2.4 : 1.8; ctx.strokeStyle = conquered ? pal.bone : pal.ink3;
      ctx.globalAlpha = conquered ? 0.95 : 0.8; ctx.stroke(); ctx.globalAlpha = 1;
    });
  });
};

// ─── surface war: faction salvos fired FROM conquered land toward enemy ground ──────────────
// Strikes anchor to CONTINENTS, not random disc points: each shot launches from a faction-held
// continent and lands on enemy ground — the unclaimed purple Tyranid infestation, or a RIVAL
// faction's land — coloured by the FIRING faction. The Tyranid ground is never a source, only a
// target. Endpoints are continent centroids projected through the spinning sphere each frame, so
// a shot tracks the land it belongs to and only shows while both ends face us. A small fixed pool
// with seeded timing keeps it deterministic; `intensity` gates how many fire at once.

// project a sphere-surface point (lat/lon°) through the spinning mesh + ortho camera to scope px.
// Mirrors three.js SphereGeometry's UV→position and the equirectangular texture mapping, so a
// continent's projected centroid sits exactly on its painted territory. front = comfortably faces us.
const PL_project = (latC, lonC, rotY, cx, cy, r) => {
  const phi = lonC * PL_D, cl = Math.cos(latC * PL_D);
  const x = -Math.cos(phi) * cl, y = Math.sin(latC * PL_D), z = Math.sin(phi) * cl;
  const xr = x * Math.cos(rotY) + z * Math.sin(rotY), zr = -x * Math.sin(rotY) + z * Math.cos(rotY);
  return { x: cx + xr * r, y: cy - y * r, z: zr, front: zr > 0.12 };
};
// who holds each continent at the eased conquered fraction — a span (faction) or null (= unclaimed
// purple Tyranid ground). Same ownership rule the texture paint uses.
const PL_ownerByContinent = (world, spans, conq) => world.continents.map(c => {
  const mid = (c.a + c.b) / 2, straddles = c.a < conq && c.b > conq;
  if (c.b <= conq) return PL_ownerAt(spans, Math.min(mid, conq - 1e-6));
  if (straddles) return PL_ownerAt(spans, Math.min(conq - 1e-6, c.b)) || spans[spans.length - 1] || null;
  return null;
});

const PL_buildFire = (seed) => {
  const fr = mulberry32(hashStr('mc-war-fire|' + (seed || todayStr())));
  const fire = [];
  for (let s = 0; s < 6; s++) {                                                     // a fixed pool; intensity gates how many fire
    const flight = 1150 + fr() * 850, beam = fr() < 0.28, cycle = 3200 + fr() * 3800; // cycle FIXED per channel → stable picks
    fire.push({ s, flight, beam, beamDur: 260 + fr() * 170, cycle, phase: fr() * 8000, _pi: -1, valid: false });
  }
  return fire;
};
const PL_bez = (A, B, C, p) => { const u = 1 - p; return [u * u * A[0] + 2 * u * p * B[0] + p * p * C[0], u * u * A[1] + 2 * u * p * B[1] + p * p * C[1]]; };
const PL_easeOut = (p) => 1 - (1 - p) * (1 - p);                                     // gentle deceleration on flight/impact
// deterministic [0,1) from two ints — the per-channel, per-cycle pick stream (no Math.random)
const PL_rand2 = (a, b) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ─── orbital fleet ───────────────────────────────────────────────────────────────────────
// A few capital ships on a tilted low orbit (seeded per day). Each fires a lance down onto the
// purple Tyranid ground every several seconds. Pure 2D vector on the fx overlay (no WebGL).
const PL_buildFleet = (seed) => {
  const fr = mulberry32(hashStr('mc-war-fleet|' + (seed || todayStr())));
  const ships = [];
  for (let i = 0; i < 3; i++) ships.push({ i, phase: fr() * Math.PI * 2, speed: 0.015 + fr() * 0.015,
    scale: 0.85 + fr() * 0.5, lancePhase: fr() * 9000, lanceGap: 6000 + fr() * 5000, lanceDur: 650 + fr() * 450, tgtK: -1, _li: -1 });
  return { ships };
};
// a capital-ship silhouette (bone hull, dark edge, engine glow at the stern), nose along travel
const PL_ship = (ctx, sx, sy, ang, len, hull, glow, size) => {
  const W = len * 0.34;
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(len * 0.5, 0); ctx.lineTo(len * 0.1, -W * 0.5); ctx.lineTo(-len * 0.5, -W * 0.42);
  ctx.lineTo(-len * 0.5, W * 0.42); ctx.lineTo(len * 0.1, W * 0.5); ctx.closePath();
  ctx.fillStyle = hull; ctx.fill();
  ctx.lineWidth = Math.max(0.6, size * 0.005); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(-len * 0.5, 0, W * 0.34, 0, 7); ctx.fillStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = size * 0.03; ctx.fill(); ctx.shadowBlur = 0;
  ctx.restore();
};

// ─── Tyranid counter-attack ──────────────────────────────────────────────────────────────
// The unclaimed ground is never a rocket source — but it fights back ORGANICALLY: lobbed
// bio-plasma globs from neutral front-facing land onto faction-held territory. Lumpy wobbling
// blobs, a spore trail, and an acid-splatter impact — visibly NOT a mechanical shell. Coloured
// from the ground itself (pal.landN) so on Health it reads as the purple Tyranid infestation.
const PL_buildSpores = (seed) => {
  const fr = mulberry32(hashStr('mc-war-spore|' + (seed || todayStr())));
  const spores = [];
  for (let s = 0; s < 4; s++) {                                                     // heavier + fewer than faction rockets
    const flight = 1500 + fr() * 900, cycle = 4200 + fr() * 4200;
    spores.push({ s, flight, cycle, splat: 600 + fr() * 260, phase: fr() * 9000, _pi: -1, valid: false });
  }
  return { spores };
};
// a wobbling organic outline (sinusoidal radius) — the bio-plasma "blob" silhouette
const PL_blob = (ctx, x, y, rad, ph, lobes) => {
  const N = 20; ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = rad * (1 + 0.24 * Math.sin(lobes * a + ph) + 0.12 * Math.sin(2 * lobes * a - ph * 1.3));
    i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
};
// a glowing bio-plasma glob: lumpy body + a brighter inner core
const PL_glob = (ctx, x, y, rad, ph, body, core, size) => {
  ctx.save();
  ctx.shadowColor = body; ctx.shadowBlur = size * 0.045;
  ctx.fillStyle = body; ctx.globalAlpha = 0.92; PL_blob(ctx, x, y, rad, ph, 3); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = core; ctx.globalAlpha = 0.95; PL_blob(ctx, x, y, rad * 0.5, -ph * 1.2, 2); ctx.fill();
  ctx.restore(); ctx.globalAlpha = 1;
};

const PL_drawFx = (ctx, t, fire, size, intensity, alertMix, reduced, dangerHex, limbHex, cx, cy, r, world, rotY, spans, conq, fleet, accentHex, spores, tyrHex) => {
  const dpr = ctx._dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  // crisp limb ring (carries the eased green→red alert tint), sells the sphere edge
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
  ctx.lineWidth = 1.4; ctx.strokeStyle = PL_mix(limbHex, dangerHex, alertMix); ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;

  // resolve the battlefield: who holds each continent, and which ones currently face us. Launch
  // sites = faction-held + front; targets = ANY front continent not held by the firing faction
  // (so factions hit the purple Tyranid ground AND each other; the ground never launches).
  const conts = (world && world.continents) || [];
  const owners = (conts.length && spans) ? PL_ownerByContinent(world, spans, conq) : [];
  const proj = conts.map(c => PL_project(c.latC, c.lonC, rotY, cx, cy, r));
  const srcIdx = [], frontIdx = [];
  for (let i = 0; i < conts.length; i++) { if (!proj[i].front) continue; frontIdx.push(i); if (owners[i]) srcIdx.push(i); }

  const IMPACT = 560, SLOTS = Math.max(1, Math.round(1 + intensity * 1.1));
  const arc = (A, B, C, p0, p1, n, w, col, alpha) => {
    ctx.beginPath(); for (let i = 0; i <= n; i++) { const q = PL_bez(A, B, C, p0 + (p1 - p0) * (i / n)); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.globalAlpha = alpha; ctx.lineCap = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
  };
  fire.forEach((m, idx) => {
    const period = Math.max(m.beam ? 2600 : m.flight + IMPACT + 600, m.cycle);
    const pi = Math.floor((t + m.phase) / period);
    if (m._pi !== pi) {                                                             // new cycle → choose a fresh shot
      m._pi = pi; m.valid = false;
      if (srcIdx.length && (idx < SLOTS || reduced)) {
        const sI = srcIdx[Math.floor(PL_rand2(m.s + 11, pi) * srcIdx.length)], F = owners[sI];
        const enemies = frontIdx.filter(j => j !== sI && (!owners[j] || owners[j].color !== F.color));
        if (enemies.length) {
          const tI = enemies[Math.floor(PL_rand2(m.s + 23, pi) * enemies.length)];
          m.src = { lat: conts[sI].latC, lon: conts[sI].lonC }; m.tgt = { lat: conts[tI].latC, lon: conts[tI].lonC }; m.col = F.color; m.valid = true;
        }
      }
    }
    if (!m.valid || (idx >= SLOTS && !reduced)) return;

    const sp = PL_project(m.src.lat, m.src.lon, rotY, cx, cy, r), tp = PL_project(m.tgt.lat, m.tgt.lon, rotY, cx, cy, r);
    if (sp.z <= 0.03 || tp.z <= 0.03) return;                                       // a shot only shows while in view
    const S = [sp.x, sp.y], T = [tp.x, tp.y], col = alertMix > 0.5 ? dangerHex : m.col;
    const mx = (S[0] + T[0]) / 2, my = (S[1] + T[1]) / 2, chord = Math.hypot(T[0] - S[0], T[1] - S[1]) || 1;
    let ox = mx - cx, oy = my - cy, ol = Math.hypot(ox, oy);
    if (ol < 1e-3) { ox = -(T[1] - S[1]); oy = T[0] - S[0]; ol = chord; }
    const lift = chord * 0.20 + r * 0.10, P = [mx + (ox / ol) * lift, my + (oy / ol) * lift];

    if (reduced) {                                                                  // static fallback
      arc(S, P, T, 0, 1, 18, Math.max(0.8, size * 0.008), col, 0.5);
      ctx.beginPath(); ctx.arc(T[0], T[1], Math.max(1.4, size * 0.014), 0, 7); ctx.fillStyle = col; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
      return;
    }
    const tt = (t + m.phase) % period;
    ctx.save(); ctx.shadowColor = col;
    if (m.beam) {
      if (tt < m.beamDur) {
        const k = tt / m.beamDur, op = 1 - k;
        ctx.shadowBlur = size * 0.05;
        ctx.beginPath(); ctx.moveTo(S[0], S[1]); ctx.lineTo(T[0], T[1]);
        ctx.lineWidth = Math.max(1, size * 0.012 * op); ctx.strokeStyle = col; ctx.globalAlpha = 0.5 + op * 0.45; ctx.lineCap = 'round'; ctx.stroke();
        ctx.shadowBlur = 0; ctx.beginPath(); ctx.moveTo(S[0], S[1]); ctx.lineTo(T[0], T[1]);
        ctx.lineWidth = Math.max(0.5, size * 0.004); ctx.strokeStyle = limbHex; ctx.globalAlpha = op * 0.85; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(T[0], T[1], Math.max(1.5, size * 0.02) * op, 0, 7); ctx.fillStyle = limbHex; ctx.globalAlpha = op; ctx.fill(); ctx.globalAlpha = 1;
      }
    } else if (tt < m.flight) {                                                     // arcing warhead + comet trail
      const p = PL_easeOut(tt / m.flight), tail = Math.max(0, p - 0.45), h = PL_bez(S, P, T, p), hr = Math.max(1.3, size * 0.014);
      ctx.shadowBlur = size * 0.045; arc(S, P, T, tail, p, 14, Math.max(0.8, size * 0.008), col, 0.42);
      ctx.shadowBlur = 0; arc(S, P, T, tail + (p - tail) * 0.55, p, 9, Math.max(1, size * 0.012), col, 0.9);
      arc(S, P, T, tail + (p - tail) * 0.72, p, 5, Math.max(0.5, size * 0.0045), limbHex, 0.85);
      ctx.beginPath(); ctx.arc(h[0], h[1], hr, 0, 7); ctx.fillStyle = col; ctx.fill();
      ctx.beginPath(); ctx.arc(h[0], h[1], hr * 0.42, 0, 7); ctx.fillStyle = limbHex; ctx.fill();
    } else {                                                                        // impact: expanding ring + bloom
      const it = tt - m.flight;
      if (it < IMPACT) {
        const k = PL_easeOut(it / IMPACT), rad = Math.max(1.5, size * 0.012) + k * size * 0.07, op = 1 - k;
        ctx.beginPath(); ctx.arc(T[0], T[1], rad, 0, 7); ctx.lineWidth = Math.max(1, size * 0.012 * op); ctx.strokeStyle = col; ctx.globalAlpha = op; ctx.stroke();
        ctx.shadowBlur = size * 0.05; ctx.beginPath(); ctx.arc(T[0], T[1], Math.max(1.6, size * 0.022) * op, 0, 7); ctx.fillStyle = limbHex; ctx.globalAlpha = op; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  });

  // fleet orbit (shared with the render block below): semi-axes + a ship's live screen position.
  // `behind` = hidden over the top of the planet, so the Tyranids can't reach it with a lob.
  const flA = size * 0.47, flB = size * 0.34;
  const PL_shipPos = (sh) => {
    const th = sh.phase + (t / 1000) * sh.speed, sn = Math.sin(th);
    const sx = cx + flA * Math.cos(th), sy = cy + flB * sn;
    return { sx, sy, sn, behind: sn < -0.02 && Math.hypot(sx - cx, sy - cy) < r * 0.97 };
  };

  // ── Tyranid organic counter-attack: the unclaimed (purple) front-facing ground NEVER launches a
  // rocket, but it lobs bio-plasma globs BACK — onto faction-held land if any faces us, otherwise UP
  // at the orbiting fleet that's bombarding it. Wobbling blob + spore trail + acid splatter, coloured
  // from the ground itself (tyrHex) so it reads as the infestation hitting back. A fully-infested world
  // (no faction land at all) fights hardest: every spore channel goes active against the ships.
  const neutralFront = frontIdx.filter(j => !owners[j]);
  const hasFleet = !!(fleet && fleet.ships && fleet.ships.length);
  if (spores && spores.spores && neutralFront.length && (srcIdx.length || hasFleet)) {
    const allTyranid = !srcIdx.length;                                            // nothing conquered → spit skyward, full barrage
    const SP_SLOTS = allTyranid ? spores.spores.length : Math.max(1, Math.round(intensity * 0.9));
    const tyrCore = PL_mix(tyrHex, limbHex, 0.55);
    spores.spores.forEach((m, idx) => {
      const period = Math.max(m.flight + m.splat + 700, m.cycle);
      const pi = Math.floor((t + m.phase) / period);
      if (m._pi !== pi) {                                                          // new cycle → pick a fresh lob (neutral land → faction land OR a ship)
        m._pi = pi; m.valid = false; m.tgtShip = -1;
        if (idx < SP_SLOTS || reduced) {
          const sI = neutralFront[Math.floor(PL_rand2(m.s + 41, pi) * neutralFront.length)];
          m.src = { lat: conts[sI].latC, lon: conts[sI].lonC };
          if (srcIdx.length) {                                                     // faction land to hit
            const tI = srcIdx[Math.floor(PL_rand2(m.s + 57, pi) * srcIdx.length)];
            m.tgt = { lat: conts[tI].latC, lon: conts[tI].lonC }; m.valid = true;
          } else if (hasFleet) {                                                   // no land → target a ship in orbit
            m.tgtShip = Math.floor(PL_rand2(m.s + 73, pi) * fleet.ships.length); m.valid = true;
          }
        }
      }
      if (!m.valid || (idx >= SP_SLOTS && !reduced)) return;
      const sp = PL_project(m.src.lat, m.src.lon, rotY, cx, cy, r);
      if (sp.z <= 0.03) return;                                                    // source rotated out of view
      let T;
      if (m.tgtShip >= 0) {                                                        // lob UP at the orbiting ship (live position)
        const pos = PL_shipPos(fleet.ships[m.tgtShip]);
        if (pos.behind) return;                                                    // can't reach a ship hidden behind the planet
        T = [pos.sx, pos.sy];
      } else {
        const tp = PL_project(m.tgt.lat, m.tgt.lon, rotY, cx, cy, r);
        if (tp.z <= 0.03) return;
        T = [tp.x, tp.y];
      }
      const S = [sp.x, sp.y];
      const mx = (S[0] + T[0]) / 2, my = (S[1] + T[1]) / 2, chord = Math.hypot(T[0] - S[0], T[1] - S[1]) || 1;
      let ox = mx - cx, oy = my - cy, ol = Math.hypot(ox, oy);
      if (ol < 1e-3) { ox = -(T[1] - S[1]); oy = T[0] - S[0]; ol = chord; }
      const lift = chord * 0.30 + r * 0.16, P = [mx + (ox / ol) * lift, my + (oy / ol) * lift];   // heavier lob arc than rockets
      const gr = Math.max(1.6, size * 0.019);
      if (reduced) {                                                              // static fallback: a few trail dots + the glob at rest on the target
        ctx.globalAlpha = 0.45; ctx.fillStyle = tyrHex;
        for (let k = 0; k <= 4; k++) { const q = PL_bez(S, P, T, k / 4); ctx.beginPath(); ctx.arc(q[0], q[1], gr * 0.4, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1; PL_glob(ctx, T[0], T[1], gr, m.s, tyrHex, tyrCore, size);
        return;
      }
      const tt = (t + m.phase) % period;
      if (tt < m.flight) {                                                        // lobbing glob + dribbling spore trail
        const p = PL_easeOut(tt / m.flight), h = PL_bez(S, P, T, p), ph = (t + m.phase) * 0.012 + m.s;
        for (let k = 1; k <= 3; k++) { const q = PL_bez(S, P, T, Math.max(0, p - k * 0.07)); ctx.globalAlpha = 0.3 * (1 - k / 4); ctx.fillStyle = tyrHex; ctx.beginPath(); ctx.arc(q[0], q[1], gr * (0.55 - k * 0.08), 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1; PL_glob(ctx, h[0], h[1], gr, ph, tyrHex, tyrCore, size);
      } else {                                                                    // acid splatter on impact
        const it = tt - m.flight;
        if (it < m.splat) {
          const k = PL_easeOut(it / m.splat), op = 1 - k;
          ctx.save(); ctx.shadowColor = tyrHex; ctx.shadowBlur = size * 0.04;
          ctx.globalAlpha = op * 0.45; ctx.fillStyle = tyrHex; ctx.beginPath(); ctx.arc(T[0], T[1], Math.max(2, size * 0.02) + k * size * 0.035, 0, 7); ctx.fill();
          ctx.shadowBlur = 0;
          for (let b = 0; b < 6; b++) { const a = b / 6 * Math.PI * 2 + m.s, d = k * size * 0.06; ctx.globalAlpha = op * 0.85; ctx.fillStyle = b % 2 ? tyrCore : tyrHex; ctx.beginPath(); ctx.arc(T[0] + Math.cos(a) * d, T[1] + Math.sin(a) * d, Math.max(1, size * 0.011) * op, 0, 7); ctx.fill(); }
          ctx.globalAlpha = 1; ctx.restore();
        }
      }
    });
  }

  // ── orbital fleet: ships ride a tilted low orbit (A wide, B short). On the near/bottom arc they
  // cross in front of the planet; over the top they slip behind it. Each fires a lance straight
  // down onto the purple Tyranid ground (front-facing neutral land) every several seconds.
  if (fleet && fleet.ships) {
    const A = flA, B = flB;                                                       // higher orbit in the freed annulus; ships ring outside the (smaller) limb, dip behind over the top
    const tgtPool = neutralFront.length ? neutralFront : frontIdx;                // reuse the hoisted neutralFront
    fleet.ships.forEach(sh => {
      const th = sh.phase + (t / 1000) * sh.speed, sn = Math.sin(th);
      const sx = cx + A * Math.cos(th), sy = cy + B * sn, dist = Math.hypot(sx - cx, sy - cy);
      const behind = sn < -0.02 && dist < r * 0.97;                               // hidden behind the planet over the top
      if (!reduced && tgtPool.length && !behind) {                               // lance bombardment from this ship
        const li = Math.floor((t + sh.lancePhase) / sh.lanceGap);
        if (sh._li !== li) { sh._li = li; sh.tgtK = tgtPool[Math.floor(PL_rand2(sh.i + 31, li) * tgtPool.length)]; }
        const lt = (t + sh.lancePhase) % sh.lanceGap, tp = sh.tgtK >= 0 ? proj[sh.tgtK] : null;
        if (tp && tp.z > 0.03 && lt < sh.lanceDur) {
          const op = Math.sin(Math.PI * (lt / sh.lanceDur)), lcol = alertMix > 0.5 ? dangerHex : accentHex;
          ctx.save(); ctx.shadowColor = lcol; ctx.shadowBlur = size * 0.05;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tp.x, tp.y);
          ctx.lineWidth = Math.max(1, size * 0.014 * op); ctx.strokeStyle = lcol; ctx.globalAlpha = 0.5 * op; ctx.lineCap = 'round'; ctx.stroke();
          ctx.shadowBlur = 0; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tp.x, tp.y);
          ctx.lineWidth = Math.max(0.5, size * 0.005); ctx.strokeStyle = limbHex; ctx.globalAlpha = 0.9 * op; ctx.stroke();
          ctx.beginPath(); ctx.arc(tp.x, tp.y, Math.max(1.5, size * 0.028) * op, 0, 7); ctx.fillStyle = limbHex; ctx.shadowColor = lcol; ctx.shadowBlur = size * 0.05; ctx.globalAlpha = op; ctx.fill();
          ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.restore();
        }
      }
      if (behind) return;
      const ang = Math.atan2(B * Math.cos(th), -A * sn), len = Math.max(7, size * 0.085) * sh.scale;
      ctx.globalAlpha = sn < 0 ? 0.6 : 1;                                          // far (top) arc dimmer for depth
      PL_ship(ctx, sx, sy, ang, len, dangerHex, limbHex, size);                    // red hull, white-hot engine glow
      ctx.globalAlpha = 1;
    });
  }
};

// ─── scanner-scope HUD chrome (static vector overlay) ────────────────────────────────────
// Frame, centre crosshair, faint measurement grid, edge graticule ticks, corner crosshairs,
// axis numbers. Counts ADAPT to size so the 92px Health globe stays clean and the 148px
// Finance globe reads as an instrument. Generalised so ANY viz wears the same chrome: pass
// `children` to frame them under the overlay, and shape:'circle' for radar-style instruments.
// With no `children` it returns just the overlay SVG — the original WarPlanet contract (see the
// PL_Hud alias below). All furniture uses the SAME opacities as before so it reads identically.
const PL_ScopeFrame = (props) => {
  const { size, accent2, shape = 'square', children } = props;
  const grid = props.grid !== false, ticks = props.ticks !== false, crosshair = props.crosshair !== false, corners = props.corners !== false;
  const numbers = props.numbers != null ? props.numbers : (size >= 120 && shape === 'square');
  const pad = Math.max(2, size * 0.022), x0 = pad, y0 = pad, x1 = size - pad, y1 = size - pad, span = x1 - x0, c = size / 2;
  const bezR = Math.max(1, size * 0.01);
  const big = size >= 120;
  const gridN = big ? 10 : 6, tickN = big ? 16 : 8;
  const gstep = span / gridN, tstep = span / tickN;
  const R = span / 2, circle = shape === 'circle';
  const cid = 'pl' + shape[0] + Math.round(size);
  const F = (n) => n.toFixed(1);
  const svg = (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <defs><clipPath id={cid}>{circle
        ? <circle cx={F(c)} cy={F(c)} r={F(R)} />
        : <rect x={F(x0)} y={F(y0)} width={F(span)} height={F(span)} rx={F(bezR)} ry={F(bezR)} />}</clipPath></defs>
      <g clipPath={`url(#${cid})`}>
        {grid && (circle
          ? <g>
              <g stroke={accent2} strokeOpacity="0.09" strokeWidth="0.5" fill="none">{[0.33, 0.66].map((f, i) => <circle key={'rr' + i} cx={F(c)} cy={F(c)} r={F(R * f)} />)}</g>
              <g stroke={accent2} strokeOpacity="0.09" strokeWidth="0.5">{Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return <line key={'sp' + i} x1={F(c)} y1={F(c)} x2={F(c + Math.cos(a) * R)} y2={F(c + Math.sin(a) * R)} />; })}</g>
            </g>
          : <g stroke={accent2} strokeOpacity="0.09" strokeWidth="0.5">
              {Array.from({ length: gridN - 1 }, (_, i) => <line key={'gv' + i} x1={F(x0 + gstep * (i + 1))} y1={F(y0)} x2={F(x0 + gstep * (i + 1))} y2={F(y1)} />)}
              {Array.from({ length: gridN - 1 }, (_, i) => <line key={'gh' + i} x1={F(x0)} y1={F(y0 + gstep * (i + 1))} x2={F(x1)} y2={F(y0 + gstep * (i + 1))} />)}
            </g>)}
        {crosshair && <g stroke={accent2} strokeOpacity="0.4" strokeWidth="0.8">
          <line x1={F(circle ? c - R : x0)} y1={F(c)} x2={F(circle ? c + R : x1)} y2={F(c)} /><line x1={F(c)} y1={F(circle ? c - R : y0)} x2={F(c)} y2={F(circle ? c + R : y1)} />
        </g>}
        {ticks && (circle
          ? <g stroke={accent2} strokeOpacity="0.55">{Array.from({ length: tickN }, (_, i) => { const a = (i / tickN) * Math.PI * 2 - Math.PI / 2, b = i % 4 === 0, h = b ? size * 0.028 : size * 0.015;
              return <line key={'tc' + i} x1={F(c + Math.cos(a) * R)} y1={F(c + Math.sin(a) * R)} x2={F(c + Math.cos(a) * (R - h))} y2={F(c + Math.sin(a) * (R - h))} strokeWidth={b ? 0.9 : 0.5} />; })}</g>
          : <g stroke={accent2} strokeOpacity="0.55">
              {Array.from({ length: tickN + 1 }, (_, i) => { const x = x0 + tstep * i, b = i % 4 === 0, h = b ? size * 0.028 : size * 0.015; return <g key={'th' + i}>
                <line x1={F(x)} y1={F(y1)} x2={F(x)} y2={F(y1 - h)} strokeWidth={b ? 0.9 : 0.5} /><line x1={F(x)} y1={F(y0)} x2={F(x)} y2={F(y0 + h)} strokeWidth={b ? 0.9 : 0.5} /></g>; })}
              {Array.from({ length: tickN + 1 }, (_, i) => { const y = y0 + tstep * i, b = i % 4 === 0, h = b ? size * 0.028 : size * 0.015; return <g key={'tv' + i}>
                <line x1={F(x0)} y1={F(y)} x2={F(x0 + h)} y2={F(y)} strokeWidth={b ? 0.9 : 0.5} /><line x1={F(x1)} y1={F(y)} x2={F(x1 - h)} y2={F(y)} strokeWidth={b ? 0.9 : 0.5} /></g>; })}
            </g>)}
      </g>
      {circle
        ? <g fill="none" stroke={accent2}><circle cx={F(c)} cy={F(c)} r={F(R)} strokeOpacity="0.7" strokeWidth="1.3" /><circle cx={F(c)} cy={F(c)} r={F(R - 3)} strokeOpacity="0.3" strokeWidth="0.6" /></g>
        : <g fill="none" stroke={accent2}>
            <rect x={F(x0)} y={F(y0)} width={F(span)} height={F(span)} rx={F(bezR)} ry={F(bezR)} strokeOpacity="0.7" strokeWidth="1.3" />
            <rect x={F(x0 + 3)} y={F(y0 + 3)} width={F(span - 6)} height={F(span - 6)} rx={F(Math.max(0.5, bezR - 1))} ry={F(Math.max(0.5, bezR - 1))} strokeOpacity="0.3" strokeWidth="0.6" />
          </g>}
      {corners && (() => { const cm = Math.max(4, size * 0.045), o = Math.max(7, size * 0.075);
        const plus = (x, y) => `M${F(x - cm)} ${F(y)}H${F(x + cm)}M${F(x)} ${F(y - cm)}V${F(y + cm)}`;
        return <path d={[plus(x0 + o, y0 + o), plus(x1 - o, y0 + o), plus(x0 + o, y1 - o), plus(x1 - o, y1 - o)].join(' ')} fill="none" stroke={accent2} strokeOpacity="0.85" strokeWidth="1.1" strokeLinecap="round" />; })()}
      {numbers && <g fill={accent2} fillOpacity="0.55" fontFamily="var(--font-mono)" fontSize={F(size * 0.038)}>
        {[0.2, 0.4, 0.6, 0.8].map((f, i) => <text key={'nx' + i} x={F(x0 + span * f)} y={F(y1 - size * 0.04)} textAnchor="middle">{Math.round(f * 100)}</text>)}
        {[0.2, 0.4, 0.6, 0.8].map((f, i) => <text key={'ny' + i} x={F(x1 - size * 0.05)} y={F(y0 + span * f)} textAnchor="end" dominantBaseline="middle">{Math.round((1 - f) * 100)}</text>)}
      </g>}
    </svg>
  );
  if (!children) return svg;
  return <div style={{ position: 'relative', width: size, height: size }}>{children}{svg}</div>;
};
// back-compat alias: WarPlanet renders <PL_Hud size accent2 /> as a bare overlay (square, no children).
const PL_Hud = PL_ScopeFrame;

// ─── responsive rectangular scope frame (fluid) ──────────────────────────────────────────
// Same scanner-scope furniture as PL_ScopeFrame, but it SIZES TO ITS CONTAINER (ResizeObserver)
// and supports a non-square rectangle — for framing fluid layouts like the calendar month grid.
// Drawn in real pixels (viewBox == px box, so no non-uniform stretch → corners/ticks stay crisp).
// The overlay is pointer-events:none so the wrapped content stays clickable. No interior grid by
// default (the wrapped content usually IS the grid); `pad` insets the content so the border/ticks
// sit just outside it. Static (no animation) so nothing to pause / reduce-motion.
const ScopeFrameFluid = (props) => {
  const { accent, children } = props;
  const ticks = props.ticks !== false, corners = props.corners !== false, border = props.border !== false;
  const crosshair = props.crosshair === true;            // default OFF — busy over a grid
  const pad = props.pad != null ? props.pad : 11;        // CSS inset between the frame and the content
  const wrapRef = usePLRef(null);
  const [dim, setDim] = usePL({ w: 0, h: 0 });
  usePLEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const measure = () => setDim({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (!window.ResizeObserver) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const a2 = PL_resolve(accent || 'var(--accent-2)');
  const { w, h } = dim;
  const F = (n) => n.toFixed(1);
  let svg = null;
  if (w > 1 && h > 1) {
    const m = Math.min(w, h);
    const ip = Math.max(2, m * 0.022), x0 = ip, y0 = ip, x1 = w - ip, y1 = h - ip;
    const bezR = Math.max(1, m * 0.01), cx = w / 2, cy = h / 2;
    const tickN = 16, tx = (x1 - x0) / tickN, ty = (y1 - y0) / tickN;
    svg = (
      <svg width={w} height={h} viewBox={`0 0 ${F(w)} ${F(h)}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
        {crosshair && <g stroke={a2} strokeOpacity="0.4" strokeWidth="0.8">
          <line x1={F(x0)} y1={F(cy)} x2={F(x1)} y2={F(cy)} /><line x1={F(cx)} y1={F(y0)} x2={F(cx)} y2={F(y1)} />
        </g>}
        {ticks && <g stroke={a2} strokeOpacity="0.55">
          {Array.from({ length: tickN + 1 }, (_, i) => { const x = x0 + tx * i, b = i % 4 === 0, hh = b ? m * 0.028 : m * 0.015; return <g key={'th' + i}>
            <line x1={F(x)} y1={F(y1)} x2={F(x)} y2={F(y1 - hh)} strokeWidth={b ? 0.9 : 0.5} /><line x1={F(x)} y1={F(y0)} x2={F(x)} y2={F(y0 + hh)} strokeWidth={b ? 0.9 : 0.5} /></g>; })}
          {Array.from({ length: tickN + 1 }, (_, i) => { const y = y0 + ty * i, b = i % 4 === 0, hh = b ? m * 0.028 : m * 0.015; return <g key={'tv' + i}>
            <line x1={F(x0)} y1={F(y)} x2={F(x0 + hh)} y2={F(y)} strokeWidth={b ? 0.9 : 0.5} /><line x1={F(x1)} y1={F(y)} x2={F(x1 - hh)} y2={F(y)} strokeWidth={b ? 0.9 : 0.5} /></g>; })}
        </g>}
        {border && <g fill="none" stroke={a2}>
          <rect x={F(x0)} y={F(y0)} width={F(x1 - x0)} height={F(y1 - y0)} rx={F(bezR)} ry={F(bezR)} strokeOpacity="0.7" strokeWidth="1.3" />
          <rect x={F(x0 + 3)} y={F(y0 + 3)} width={F(x1 - x0 - 6)} height={F(y1 - y0 - 6)} rx={F(Math.max(0.5, bezR - 1))} ry={F(Math.max(0.5, bezR - 1))} strokeOpacity="0.3" strokeWidth="0.6" />
        </g>}
        {corners && (() => { const cm = Math.max(4, m * 0.045), o = Math.max(7, m * 0.06);
          const plus = (x, y) => `M${F(x - cm)} ${F(y)}H${F(x + cm)}M${F(x)} ${F(y - cm)}V${F(y + cm)}`;
          return <path d={[plus(x0 + o, y0 + o), plus(x1 - o, y0 + o), plus(x0 + o, y1 - o), plus(x1 - o, y1 - o)].join(' ')} fill="none" stroke={a2} strokeOpacity="0.85" strokeWidth="1.1" strokeLinecap="round" />; })()}
      </svg>
    );
  }
  return <div ref={wrapRef} style={{ position: 'relative', padding: pad }}>{children}{svg}</div>;
};

// ─── radial scanner (2D canvas radar) — no WebGL ─────────────────────────────────────────
// A circular scope wearing the ScopeFrame circle chrome, with markers plotted at (angle 0..1
// clockwise from top, radius 0..1), an optional rotating sweep, and/or a fixed "you are here"
// needle (`sweepFrom`) with an elapsed wedge. Same lifecycle as WarPlanet: one RAF loop that
// pauses when the tab is hidden, and a single static frame under prefers-reduced-motion.
const RadialScope = (props) => {
  const { size = 120, sweep = false, sweepPeriod = 6000, sweepFrom = null, accent, trail = true } = props;
  const cvRef = usePLRef(null);
  const S = usePLRef({});
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const markers = props.markers || [];
  const sig = JSON.stringify(markers.map(m => [m.angle, m.radius, m.color, m.size, m.pulse])) + '|' + sweepFrom + '|' + sweep;

  usePLEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * dpr; cv.height = size * dpr; cv.style.width = cv.style.height = size + 'px';
    const ctx = cv.getContext('2d');
    const cx = size / 2, cy = size / 2, R = size / 2 - Math.max(2, size * 0.022);
    const pal = { accent: PL_resolve(accent || 'var(--accent-2)'), bone: PL_resolve('var(--bone)'), danger: PL_resolve('var(--danger)') };
    const st = S.current;
    st.ctx = ctx; st.dpr = dpr; st.markers = props.markers || []; st.sweepFrom = sweepFrom;
    const TOP = -Math.PI / 2;

    const draw = (t) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      if (st.sweepFrom != null) {                                                       // fixed elapsed wedge + needle
        const a = TOP + PL_clamp01(st.sweepFrom) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, TOP, a); ctx.closePath();
        ctx.fillStyle = pal.accent; ctx.globalAlpha = 0.07; ctx.fill(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.lineWidth = Math.max(1, size * 0.012); ctx.strokeStyle = pal.accent; ctx.shadowColor = pal.accent; ctx.shadowBlur = size * 0.03; ctx.globalAlpha = 0.9; ctx.stroke();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
      if (sweep && !reduced) {                                                          // rotating radar sweep
        const a = TOP + ((t % sweepPeriod) / sweepPeriod) * Math.PI * 2;
        if (trail) { const N = 14, arc = Math.PI * 0.5;
          for (let k = 0; k < N; k++) { const a1 = a - (k / N) * arc, a0 = a - ((k + 1) / N) * arc;
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
            ctx.fillStyle = pal.accent; ctx.globalAlpha = 0.10 * (1 - k / N); ctx.fill(); ctx.globalAlpha = 1; } }
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.lineWidth = Math.max(1, size * 0.01); ctx.strokeStyle = pal.accent; ctx.shadowColor = pal.accent; ctx.shadowBlur = size * 0.03; ctx.globalAlpha = 0.85; ctx.stroke();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
      (st.markers || []).forEach(m => {                                                 // plotted blips
        const a = TOP + ((((m.angle || 0) % 1) + 1) % 1) * Math.PI * 2;
        const rr = PL_clamp01(m.radius == null ? 0.7 : m.radius) * R;
        const mx = cx + Math.cos(a) * rr, my = cy + Math.sin(a) * rr;
        const col = PL_resolve(m.color || pal.accent), base = m.size || Math.max(1.8, size * 0.022);
        const k = (m.pulse && !reduced) ? (0.65 + 0.35 * Math.sin(t * 0.006 + a)) : 1;
        ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = size * 0.05 * k;
        ctx.beginPath(); ctx.arc(mx, my, base * k, 0, 7); ctx.fillStyle = col; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(mx, my, Math.max(0.6, base * 0.42), 0, 7); ctx.fillStyle = pal.bone; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
        ctx.restore();
      });
    };
    st.draw = draw;

    const animated = sweep || (st.markers || []).some(m => m.pulse);
    let raf = 0;
    if (reduced || !animated) { draw(0); }
    else {
      const loop = (t) => { draw(t); raf = requestAnimationFrame(loop); };
      const onVis = () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf), raf = 0; } else if (!raf) raf = requestAnimationFrame(loop); };
      document.addEventListener('visibilitychange', onVis); st.onVis = onVis;
      raf = requestAnimationFrame(loop);
    }
    return () => { if (raf) cancelAnimationFrame(raf); if (st.onVis) document.removeEventListener('visibilitychange', st.onVis); S.current = {}; };
    // eslint-disable-next-line
  }, [size, accent, sweep, sweepPeriod, reduced]);

  usePLEffect(() => {                                                                   // live data → re-store + redraw if static
    const st = S.current; if (!st || !st.draw) return;
    st.markers = props.markers || []; st.sweepFrom = sweepFrom;
    const animated = sweep || (st.markers || []).some(m => m.pulse);
    if (reduced || !animated) st.draw(0);
    // eslint-disable-next-line
  }, [sig]);

  const accent2 = PL_resolve(accent || 'var(--accent-2)');
  return (
    <PL_ScopeFrame size={size} accent2={accent2} shape="circle">
      <canvas ref={cvRef} style={{ position: 'absolute', inset: 0, width: size, height: size, display: 'block' }} />
    </PL_ScopeFrame>
  );
};

// ─── reactor gauge (2D canvas concentric charge-rings) — no WebGL ────────────────────────
// Fraction-of-goal scalars as segmented LED rings filling clockwise from top; the rings charge
// up on mount and ease toward new values with the planet's time-constant. A ring flagged
// `alert` washes toward --danger as it passes 1.0. Optional centred mono readout (HTML overlay,
// so it stays crisp + themed). Pauses when the tab is hidden; settles instantly if reduced.
const ReactorGauge = (props) => {
  const { size = 120, segments = 36 } = props;
  const cvRef = usePLRef(null);
  const S = usePLRef({});
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const rings = props.rings || [];
  const sig = JSON.stringify(rings.map(r => [r.value, r.color, r.alert]));

  usePLEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * dpr; cv.height = size * dpr; cv.style.width = cv.style.height = size + 'px';
    const ctx = cv.getContext('2d');
    const cx = size / 2, cy = size / 2, danger = PL_resolve('var(--danger)');
    const st = S.current; st.ctx = ctx;
    const TOP = -Math.PI / 2, gap = 0.22, segAng = (Math.PI * 2) / segments;
    const thick = Math.max(3, size * 0.045), ringGap = thick + Math.max(2, size * 0.022);
    const outerR = size / 2 - Math.max(2, size * 0.03) - thick / 2;

    const drawRing = (rr, frac, colHex) => {
      const filled = Math.round(PL_clamp01(frac) * segments);
      for (let s = 0; s < segments; s++) {
        const a0 = TOP + s * segAng + segAng * gap * 0.5, a1 = TOP + (s + 1) * segAng - segAng * gap * 0.5, on = s < filled;
        ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a1); ctx.lineWidth = thick; ctx.lineCap = 'butt'; ctx.strokeStyle = colHex;
        if (on) { ctx.shadowColor = colHex; ctx.shadowBlur = size * 0.03; ctx.globalAlpha = 1; } else { ctx.shadowBlur = 0; ctx.globalAlpha = 0.10; }
        ctx.stroke();
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
      (props.rings || []).forEach((r, i) => {
        const rr = outerR - i * ringGap; if (rr < thick) return;
        let col = PL_resolve(r.color || 'var(--accent-2)');
        const v = st.disp[i] != null ? st.disp[i] : (r.value || 0);
        if (r.alert && v >= 1) col = PL_mix(col, danger, PL_clamp01(v - 1));
        drawRing(rr, v, col);
      });
    };
    st.draw = draw;

    let raf = 0, last = 0;
    const settled = () => (props.rings || []).every((r, i) => Math.abs((st.disp[i] || 0) - (r.value || 0)) < 0.002);
    const frame = (t) => {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016; last = t;
      const kc = 1 - Math.exp(-dt / 0.18);
      (props.rings || []).forEach((r, i) => { const tgt = r.value || 0; st.disp[i] = (st.disp[i] || 0) + (tgt - (st.disp[i] || 0)) * kc; });
      draw();
      if (!settled()) { raf = requestAnimationFrame(frame); } else { raf = 0; last = 0; }
    };
    st.kick = () => { if (!reduced && !raf && !settled()) { last = 0; raf = requestAnimationFrame(frame); } };

    if (reduced) { st.disp = (props.rings || []).map(r => r.value || 0); draw(); }      // settle instantly
    else { st.disp = (props.rings || []).map(() => 0); draw(); st.kick(); }             // charge up from empty

    const onVis = () => { if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; } else if (!document.hidden) st.kick(); };
    document.addEventListener('visibilitychange', onVis); st.onVis = onVis;
    return () => { if (raf) cancelAnimationFrame(raf); if (st.onVis) document.removeEventListener('visibilitychange', st.onVis); S.current = {}; };
    // eslint-disable-next-line
  }, [size, segments, reduced]);

  usePLEffect(() => {                                                                   // ease to new values on data change
    const st = S.current; if (!st || !st.draw) return;
    if (reduced) { st.disp = (props.rings || []).map(r => r.value || 0); st.draw(); } else st.kick && st.kick();
    // eslint-disable-next-line
  }, [sig]);

  const center = props.center;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <canvas ref={cvRef} style={{ position: 'absolute', inset: 0, width: size, height: size, display: 'block' }} />
      {center && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', textAlign: 'center' }}>
          <div className="mono num" style={{ fontSize: Math.round(size * 0.20), lineHeight: 1, color: 'var(--ink)', fontWeight: 600 }}>{center.value}{center.unit && <span className="muted-2" style={{ fontSize: Math.round(size * 0.085), marginLeft: 2 }}>{center.unit}</span>}</div>
          {center.sub && <div className="mono muted-2" style={{ fontSize: Math.round(size * 0.075), marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{center.sub}</div>}
        </div>
      )}
    </div>
  );
};

// ─── the war planet (3D) ─────────────────────────────────────────────────────────────────
const WarPlanet = (props) => {
  const { data, size = 110, alert = false, whole = 0, ocean, landNeutral, seed, landRatio } = props;
  const glRef = usePLRef(null);    // WebGL canvas
  const fxRef = usePLRef(null);    // 2D fx canvas
  const S = usePLRef({});          // mutable scene/animation state, survives data-driven re-renders

  const total = (data || []).reduce((s, d) => s + d.value, 0);
  const conqTarget = (whole > 0 ? whole : total) > 0 ? PL_clamp01(total / (whole > 0 ? whole : total)) : 0;
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // a stable signature of the inputs that change the painted texture (not the world layout)
  const dataSig = JSON.stringify((data || []).map(d => [d.value, d.color, !!d.neutral])) + '|' + conqTarget;

  // ── build/teardown the scene; rebuilds only when the world layout or size changes ──
  usePLEffect(() => {
    const THREE = window.THREE;
    const glCanvas = glRef.current, fxCanvas = fxRef.current;
    if (!THREE || !glCanvas || !fxCanvas) { S.current.noGL = !THREE; return; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = size * 0.38, cx = size / 2, cy = size / 2;

    // palette resolved from the live theme (or harness vars) → hex for three + canvas
    const pal = {
      ocean: PL_resolve(ocean || 'oklch(0.52 0.11 245)'),
      landN: PL_resolve(landNeutral || 'var(--surface-3)'),
      rock: PL_resolve('oklch(0.27 0.022 55)'),
      bone: PL_resolve('var(--bone)'), bg: PL_resolve('var(--bg)'),
      ink3: PL_resolve('var(--ink-3)'), ink4: PL_resolve('var(--ink-4)'),
      danger: PL_resolve('var(--danger)'), accent: PL_resolve('var(--accent)'),
      accent2: PL_resolve('var(--accent-2)'), warn: PL_resolve('var(--warn)'),
    };
    const hatches = PL_makeHatches(pal.bg);

    // texture canvas (equirectangular) → CanvasTexture on the sphere
    const TW = size >= 120 ? 1792 : 1280, TH = TW / 2;
    const texCanvas = document.createElement('canvas'); texCanvas.width = TW; texCanvas.height = TH;
    const tctx = texCanvas.getContext('2d');
    const world = PL_buildWorld(seed, landRatio, TW, TH);
    // heightmap (built once) → real elevation relief on the sphere
    const heightCanvas = document.createElement('canvas'); heightCanvas.width = TW; heightCanvas.height = TH;
    PL_paintHeight(heightCanvas.getContext('2d'), TW, TH, world);

    const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true });
    renderer.setPixelRatio(dpr); renderer.setSize(size, size, false);
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;

    const scene = new THREE.Scene();
    const fH = 1 / 0.76;                                                            // ortho half-frustum → sphere = 0.38·size (smaller, leaves an annulus for the fleet)
    const cam = new THREE.OrthographicCamera(-fH, fH, fH, -fH, 0.1, 10); cam.position.set(0, 0, 3); cam.lookAt(0, 0, 0);

    const tex = new THREE.CanvasTexture(texCanvas);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace; else if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    const heightTex = new THREE.CanvasTexture(heightCanvas);                         // linear data — no sRGB
    const normalTex = new THREE.CanvasTexture(PL_normalMap(heightCanvas, 9));        // lit relief (every GPU)
    const geo = new THREE.SphereGeometry(1, 220, 150);                               // dense enough for crisp relief
    const mat = new THREE.MeshPhongMaterial({ map: tex, shininess: 15, specular: new THREE.Color(0x33301f),
      normalMap: normalTex, normalScale: new THREE.Vector2(1.5, 1.5),
      displacementMap: heightTex, displacementScale: size >= 120 ? 0.075 : 0.058, displacementBias: 0 });
    const mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
    // faint atmosphere shell (rim glow), tinted on alert
    const atmoMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.accent), transparent: true, opacity: 0.15, side: THREE.BackSide, blending: THREE.AdditiveBlending });
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.07, 48, 48), atmoMat); scene.add(atmo);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff3df, 1.08); sun.position.set(-0.7, 0.7, 0.9); scene.add(sun);

    // retro bitmap post-process: low-res render target + fullscreen dither/posterise quad
    const PIXEL = 0.5;                                                               // render scale (lower = chunkier)
    const lowW = Math.max(46, Math.round(size * PIXEL)), lowH = lowW;
    const rt = new THREE.WebGLRenderTarget(lowW, lowH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, depthBuffer: true });
    const bayerTex = PL_makeBayer(THREE);
    const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const postMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: rt.texture }, uBayer: { value: bayerTex }, uLowRes: { value: new THREE.Vector2(lowW, lowH) }, uLevels: { value: 4.0 } },
      vertexShader: PL_POST_VERT, fragmentShader: PL_POST_FRAG, transparent: true, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat); postScene.add(quad);
    const renderFrame = () => { renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null); renderer.render(postScene, postCam); };

    // fx (2D) canvas at device resolution
    fxCanvas.width = size * dpr; fxCanvas.height = size * dpr; fxCanvas.style.width = fxCanvas.style.height = size + 'px';
    const fctx = fxCanvas.getContext('2d'); fctx._dpr = dpr;

    const fire = PL_buildFire(seed);                                               // strikes anchor to live territory; colour comes from the firing faction's span
    const fleet = PL_buildFleet(seed);                                             // orbital capital ships + their lance bombardment
    const spores = PL_buildSpores(seed);                                           // Tyranid organic counter-attack: neutral ground lobs bio-plasma back

    const st = S.current;
    st.renderer = renderer; st.scene = scene; st.cam = cam; st.mesh = mesh; st.mat = mat;
    st.atmoMat = atmoMat; st.tex = tex; st.heightTex = heightTex; st.normalTex = normalTex; st.geo = geo; st.atmo = atmo; st.tctx = tctx; st.TW = TW; st.TH = TH;
    st.renderFrame = renderFrame; st.rt = rt; st.bayerTex = bayerTex; st.postMat = postMat; st.quad = quad;
    st.world = world; st.pal = pal; st.hatches = hatches; st.fire = fire; st.fleet = fleet; st.spores = spores; st.fctx = fctx;
    st.cx = cx; st.cy = cy; st.r = r; st.size = size; st.dpr = dpr; st.noGL = false;
    st.conqDisplay = conqTarget; st.conqTarget = conqTarget;
    st.alertMix = alert ? 1 : 0; st.alertTarget = alert ? 1 : 0;
    st.data = data;                                                                // latest factions — the easing frame reads this, NOT the (stale) setup-closure `data`
    st.spans = PL_faceSpans(st.data, st.conqDisplay);
    st.paused = false;

    const repaint = () => { PL_paint(tctx, TW, TH, world, st.spans, st.conqDisplay, pal, hatches); tex.needsUpdate = true; };
    const applyAlert = () => {
      const m = st.alertMix;
      mat.color.setRGB(1, 1 - m * 0.62, 1 - m * 0.66);                              // multiply the map toward red
      mat.emissive = new THREE.Color(pal.danger); mat.emissiveIntensity = m * 0.28;
      atmoMat.color.set(PL_mix(pal.accent, pal.danger, m)); atmoMat.opacity = 0.12 + m * 0.16;
    };
    st.repaint = repaint; st.applyAlert = applyAlert;
    repaint(); applyAlert();

    const SPIN = 2 * Math.PI / 60;                                                  // ~60s / revolution
    let raf = 0, last = 0;
    const frame = (t) => {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016; last = t;
      const kc = 1 - Math.exp(-dt / 0.18);
      if (Math.abs(st.conqDisplay - st.conqTarget) > 0.0005) { st.conqDisplay += (st.conqTarget - st.conqDisplay) * kc; st.spans = PL_faceSpans(st.data, st.conqDisplay); repaint(); }
      const ka = 1 - Math.exp(-dt / 0.28);
      if (Math.abs(st.alertMix - st.alertTarget) > 0.002) { st.alertMix += (st.alertTarget - st.alertMix) * ka; applyAlert(); }
      mesh.rotation.y += dt * SPIN; atmo.rotation.y = mesh.rotation.y;
      renderFrame();
      const intensity = (st.alertTarget ? 1.0 : 0.45) + st.conqDisplay * 0.9;
      PL_drawFx(fctx, t, fire, size, intensity, st.alertMix, false, pal.danger, pal.bone, cx, cy, r, st.world, mesh.rotation.y, st.spans, st.conqDisplay, st.fleet, pal.accent, st.spores, pal.landN);
      raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      mesh.rotation.y = 0.5; renderFrame();
      const intensity = (st.alertTarget ? 1.0 : 0.45) + st.conqDisplay * 0.9;
      PL_drawFx(fctx, 0, fire, size, intensity, st.alertMix, true, pal.danger, pal.bone, cx, cy, r, st.world, mesh.rotation.y, st.spans, st.conqDisplay, st.fleet, pal.accent, st.spores, pal.landN);
    } else {
      const onVis = () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf), raf = 0; } else if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };
      document.addEventListener('visibilitychange', onVis);
      st.onVis = onVis;
      raf = requestAnimationFrame(frame);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (st.onVis) document.removeEventListener('visibilitychange', st.onVis);
      tex.dispose(); heightTex.dispose(); normalTex.dispose(); geo.dispose(); mat.dispose(); atmo.geometry.dispose(); atmoMat.dispose();
      rt.dispose(); bayerTex.dispose(); postMat.dispose(); quad.geometry.dispose();
      renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss();
      S.current = {};
    };
    // eslint-disable-next-line
  }, [size, seed, landRatio, reduced]);

  // ── live updates that should EASE (logging, going over budget) — no teardown ──
  usePLEffect(() => {
    const st = S.current; if (!st || !st.renderer) return;
    st.conqTarget = conqTarget;
    st.alertTarget = alert ? 1 : 0;
    st.data = data;                                                                // keep the easing frame painting the CURRENT macros
    st.spans = PL_faceSpans(st.data, st.conqDisplay);
    if (st.repaint) st.repaint();
    if (reduced) {                                                                  // no loop to ease — settle + redraw once
      st.conqDisplay = conqTarget; st.alertMix = alert ? 1 : 0; st.spans = PL_faceSpans(data, st.conqDisplay);
      st.applyAlert && st.applyAlert(); st.repaint && st.repaint();
      st.renderFrame();
      const intensity = (st.alertTarget ? 1.0 : 0.45) + st.conqDisplay * 0.9;
      st.fire.forEach(m => { m._pi = -1; });                                          // ownership changed → re-pick on redraw
      st.spores && st.spores.spores.forEach(m => { m._pi = -1; });
      PL_drawFx(st.fctx, 0, st.fire, st.size, intensity, st.alertMix, true, st.pal.danger, st.pal.bone, st.cx, st.cy, st.r, st.world, st.mesh ? st.mesh.rotation.y : 0.5, st.spans, st.conqDisplay, st.fleet, st.pal.accent, st.spores, st.pal.landN);
    }
    // eslint-disable-next-line
  }, [dataSig, alert]);

  const accent2 = PL_resolve('var(--accent-2)');
  const atmoCss = `radial-gradient(circle at 50% 50%, transparent 60%, ${PL_resolve(alert ? 'var(--danger)' : 'var(--accent-2)')} 86%, transparent 100%)`;
  // A <canvas> only ever yields ONE WebGL context for its DOM lifetime, and the setup effect's
  // cleanup force-loses it. So when the scene must rebuild (new day → new `seed`, or size/landRatio
  // change) we must remount the canvas to get a FRESH context — reusing the node renders nothing.
  // This key matches the setup effect's deps; changing it swaps in brand-new canvas elements.
  const glKey = `${size}|${seed}|${landRatio}|${reduced}`;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <div aria-hidden="true" style={{ position: 'absolute', inset: '-8%', background: atmoCss, opacity: alert ? 0.4 : 0.22, filter: 'blur(3px)', transition: 'opacity .4s ease', pointerEvents: 'none' }} />
      <canvas key={'gl|' + glKey} ref={glRef} width={size} height={size} style={{ position: 'absolute', inset: 0, width: size, height: size, display: 'block' }} />
      <canvas key={'fx|' + glKey} ref={fxRef} style={{ position: 'absolute', inset: 0, width: size, height: size, display: 'block' }} />
      <PL_Hud size={size} accent2={accent2} grid={false} />
    </div>
  );
};

// ─── public component ────────────────────────────────────────────────────────────────────
const DonutChart = (props) => {
  const { data, size = 110, war = false } = props;
  if (war) return <WarPlanet {...props} />;
  // Non-war fallback (no live call site uses this today): a simple shaded disc with shares.
  const total = (data || []).reduce((s, d) => s + d.value, 0);
  if (!total) return <div style={{ width: size, height: size }} />;
  const r = size * 0.44, c = size / 2; let a = -Math.PI / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {(data || []).map((d, i) => { const frac = d.value / total, a2 = a + frac * Math.PI * 2;
        const x1 = c + r * Math.cos(a), y1 = c + r * Math.sin(a), x2 = c + r * Math.cos(a2), y2 = c + r * Math.sin(a2), big = frac > 0.5 ? 1 : 0; a = a2;
        return <path key={i} d={`M${c} ${c}L${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${big} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z`} fill={PL_resolve(d.color)} stroke="var(--bg)" strokeWidth="1.2" />; })}
    </svg>
  );
};

// ─── shared viz toolkit ──────────────────────────────────────────────────────────────────
// The same scanner-scope language the war planet wears, made available to the module cards so
// the rest of the app reads as instruments too — all 2D (no extra WebGL contexts). Cards must
// read window.MCViz LAZILY (inside render/effects): modules.jsx is parsed BEFORE this file.
window.MCViz = { ScopeFrame: PL_ScopeFrame, ScopeFrameFluid, RadialScope, ReactorGauge, resolve: PL_resolve, mix: PL_mix, clamp01: PL_clamp01 };
