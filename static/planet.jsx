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
    const mid = (c.a + c.b) / 2;
    const owner = c.b <= conq ? PL_ownerAt(spans, Math.min(mid, conq - 1e-6)) : null;
    const straddles = c.a < conq && c.b > conq;
    const localConq = straddles ? (conq - c.a) / (c.b - c.a) : 0;
    const frontOwner = straddles ? (PL_ownerAt(spans, Math.min(conq - 1e-6, c.b)) || spans[spans.length - 1] || null) : null;
    const fsc = straddles ? Math.sqrt(PL_clamp01(localConq)) : 0;
    const frontPts = straddles ? c.pts.map(p => [c.cxp + (p[0] - c.cxp) * fsc, c.cyp + (p[1] - c.cyp) * fsc]) : null;
    const fillHatch = (idx, dx) => { const pat = ctx.createPattern(hatches[idx], 'repeat'); if (pat) { ctx.fillStyle = pat; ctx.fill(); } };
    const rings = PL_insets(c.pts, c.cxp, c.cyp);                                    // terrace contour lines
    copies.forEach(dx => {
      // base unclaimed terrain + thin inter-country border
      PL_coast(ctx, c.pts, dx); ctx.fillStyle = pal.landN; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = pal.bg; ctx.stroke();
      if (owner) { PL_coast(ctx, c.pts, dx); ctx.fillStyle = owner.color; ctx.fill(); PL_coast(ctx, c.pts, dx); fillHatch(owner.hatch, dx); }
      if (straddles && frontOwner && localConq > 0.004) {
        PL_coast(ctx, frontPts, dx); ctx.fillStyle = frontOwner.color; ctx.fill();
        PL_coast(ctx, frontPts, dx); fillHatch(frontOwner.hatch, dx);
        PL_coast(ctx, frontPts, dx); ctx.lineWidth = 2.2; ctx.strokeStyle = pal.bone; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
        if (localConq > 0.03) PL_teeth(ctx, frontPts.filter((_, q) => q % 2 === 0), dx, Math.max(4, H * 0.018), pal.bone);
      }
      // topographic contour lines (idea1 terrain scan) — inner terrace rings over the land
      ctx.lineWidth = Math.max(0.7, H * 0.0014); ctx.strokeStyle = (owner || straddles) ? pal.bone : pal.accent2; ctx.globalAlpha = 0.4;
      for (let i = 1; i < rings.length; i++) { PL_coast(ctx, rings[i], dx); ctx.stroke(); }
      ctx.globalAlpha = 1;
      // coastline / national border
      PL_coast(ctx, c.pts, dx);
      ctx.lineWidth = (owner || straddles) ? 2.4 : 1.8; ctx.strokeStyle = (owner || straddles) ? pal.bone : pal.ink3;
      ctx.globalAlpha = (owner || straddles) ? 0.95 : 0.8; ctx.stroke(); ctx.globalAlpha = 1;
    });
  });
  world.seas.forEach(sea => copies.forEach(dx => {
    PL_coast(ctx, sea.pts, dx); ctx.fillStyle = pal.ocean; ctx.fill();
    PL_coast(ctx, sea.pts, dx); ctx.lineWidth = 1.4; ctx.strokeStyle = pal.ink4; ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1;
  }));
};

// ─── orbital bombardment: a deterministic salvo of ballistic missiles + beams over the globe ─
const PL_buildFire = (seed, cx, cy, r, poolColors, dangerHex) => {
  const fr = mulberry32(hashStr('mc-war-fire|' + (seed || todayStr())));
  const pick = () => poolColors.length ? poolColors[Math.floor(fr() * poolColors.length)] : dangerHex;
  const fire = [];
  for (let s = 0; s < 6; s++) {                                                     // a fixed pool; intensity gates how many fire
    const a0 = fr() * Math.PI * 2, rad0 = (0.22 + fr() * 0.6) * r;
    const a1 = a0 + (0.55 + fr() * 0.7) * Math.PI * (fr() < 0.5 ? 1 : -1), rad1 = (0.22 + fr() * 0.6) * r;
    const S = [cx + Math.cos(a0) * rad0, cy + Math.sin(a0) * rad0];
    const T = [cx + Math.cos(a1) * rad1, cy + Math.sin(a1) * rad1];
    const mx = (S[0] + T[0]) / 2, my = (S[1] + T[1]) / 2, chord = Math.hypot(T[0] - S[0], T[1] - S[1]) || 1;
    let ox = mx - cx, oy = my - cy, ol = Math.hypot(ox, oy);
    if (ol < 1e-3) { ox = -(T[1] - S[1]); oy = T[0] - S[0]; ol = chord; }
    const lift = chord * 0.22 + r * 0.14, P = [mx + (ox / ol) * lift, my + (oy / ol) * lift];
    const beam = fr() < 0.30, flight = 1150 + fr() * 850;
    fire.push({ s, S, P, T, flight, beam, beamDur: 260 + fr() * 170, baseGap: 5200 + fr() * 4200, phase: fr() * 8000, col: pick() });
  }
  return fire;
};
const PL_bez = (A, B, C, p) => { const u = 1 - p; return [u * u * A[0] + 2 * u * p * B[0] + p * p * C[0], u * u * A[1] + 2 * u * p * B[1] + p * p * C[1]]; };
const PL_easeOut = (p) => 1 - (1 - p) * (1 - p);                                     // gentle deceleration on flight/impact
const PL_drawFx = (ctx, t, fire, size, intensity, alertMix, reduced, dangerHex, limbHex, cx, cy, r) => {
  const dpr = ctx._dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  // crisp limb ring (carries the eased green→red alert tint), sells the sphere edge
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
  ctx.lineWidth = 1.4; ctx.strokeStyle = PL_mix(limbHex, dangerHex, alertMix); ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
  const IMPACT = 560, SLOTS = Math.round(2 + intensity * 2.2);
  const arc = (A, B, C, p0, p1, n, w, col, alpha) => {
    ctx.beginPath(); for (let i = 0; i <= n; i++) { const q = PL_bez(A, B, C, p0 + (p1 - p0) * (i / n)); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.globalAlpha = alpha; ctx.lineCap = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
  };
  fire.forEach((m, idx) => {
    if (idx >= SLOTS && !reduced) return;
    const col = alertMix > 0.5 ? dangerHex : m.col;
    if (reduced) {                                                                  // static fallback
      arc(m.S, m.P, m.T, 0, 1, 18, Math.max(0.8, size * 0.008), col, 0.5);
      ctx.beginPath(); ctx.arc(m.T[0], m.T[1], Math.max(1.4, size * 0.014), 0, 7); ctx.fillStyle = col; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
      return;
    }
    const period = Math.max(m.beam ? 2600 : m.flight + IMPACT + 600, m.baseGap / (0.55 + intensity * 0.55));
    const tt = (t + m.phase) % period;
    ctx.save(); ctx.shadowColor = col;
    if (m.beam) {
      if (tt < m.beamDur) {
        const k = tt / m.beamDur, op = 1 - k;
        ctx.shadowBlur = size * 0.05;
        ctx.beginPath(); ctx.moveTo(m.S[0], m.S[1]); ctx.lineTo(m.T[0], m.T[1]);
        ctx.lineWidth = Math.max(1, size * 0.012 * op); ctx.strokeStyle = col; ctx.globalAlpha = 0.5 + op * 0.45; ctx.lineCap = 'round'; ctx.stroke();
        ctx.shadowBlur = 0; ctx.beginPath(); ctx.moveTo(m.S[0], m.S[1]); ctx.lineTo(m.T[0], m.T[1]);
        ctx.lineWidth = Math.max(0.5, size * 0.004); ctx.strokeStyle = limbHex; ctx.globalAlpha = op * 0.85; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(m.T[0], m.T[1], Math.max(1.5, size * 0.02) * op, 0, 7); ctx.fillStyle = limbHex; ctx.globalAlpha = op; ctx.fill(); ctx.globalAlpha = 1;
      }
    } else if (tt < m.flight) {                                                     // arcing warhead + comet trail
      const p = PL_easeOut(tt / m.flight), tail = Math.max(0, p - 0.45), h = PL_bez(m.S, m.P, m.T, p), hr = Math.max(1.3, size * 0.014);
      ctx.shadowBlur = size * 0.045; arc(m.S, m.P, m.T, tail, p, 14, Math.max(0.8, size * 0.008), col, 0.42);
      ctx.shadowBlur = 0; arc(m.S, m.P, m.T, tail + (p - tail) * 0.55, p, 9, Math.max(1, size * 0.012), col, 0.9);
      arc(m.S, m.P, m.T, tail + (p - tail) * 0.72, p, 5, Math.max(0.5, size * 0.0045), limbHex, 0.85);
      ctx.beginPath(); ctx.arc(h[0], h[1], hr, 0, 7); ctx.fillStyle = col; ctx.fill();
      ctx.beginPath(); ctx.arc(h[0], h[1], hr * 0.42, 0, 7); ctx.fillStyle = limbHex; ctx.fill();
    } else {                                                                        // impact: expanding ring + bloom
      const it = tt - m.flight;
      if (it < IMPACT) {
        const k = PL_easeOut(it / IMPACT), rad = Math.max(1.5, size * 0.012) + k * size * 0.07, op = 1 - k;
        ctx.beginPath(); ctx.arc(m.T[0], m.T[1], rad, 0, 7); ctx.lineWidth = Math.max(1, size * 0.012 * op); ctx.strokeStyle = col; ctx.globalAlpha = op; ctx.stroke();
        ctx.shadowBlur = size * 0.05; ctx.beginPath(); ctx.arc(m.T[0], m.T[1], Math.max(1.6, size * 0.022) * op, 0, 7); ctx.fillStyle = limbHex; ctx.globalAlpha = op; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  });
};

// ─── scanner-scope HUD chrome (static vector overlay) ────────────────────────────────────
// Frame, centre crosshair, faint measurement grid, edge graticule ticks, corner crosshairs,
// axis numbers. Counts ADAPT to size so the 92px Health globe stays clean and the 148px
// Finance globe reads as an instrument.
const PL_Hud = ({ size, accent2 }) => {
  const pad = Math.max(2, size * 0.022), x0 = pad, y0 = pad, x1 = size - pad, y1 = size - pad, span = x1 - x0, c = size / 2;
  const bezR = Math.max(1, size * 0.01);
  const big = size >= 120;
  const gridN = big ? 10 : 6, tickN = big ? 16 : 8;
  const gstep = span / gridN, tstep = span / tickN;
  const cid = 'pl' + Math.round(size);
  const F = (n) => n.toFixed(1);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <defs><clipPath id={cid}><rect x={F(x0)} y={F(y0)} width={F(span)} height={F(span)} rx={F(bezR)} ry={F(bezR)} /></clipPath></defs>
      <g clipPath={`url(#${cid})`}>
        <g stroke={accent2} strokeOpacity="0.09" strokeWidth="0.5">
          {Array.from({ length: gridN - 1 }, (_, i) => <line key={'gv' + i} x1={F(x0 + gstep * (i + 1))} y1={F(y0)} x2={F(x0 + gstep * (i + 1))} y2={F(y1)} />)}
          {Array.from({ length: gridN - 1 }, (_, i) => <line key={'gh' + i} x1={F(x0)} y1={F(y0 + gstep * (i + 1))} x2={F(x1)} y2={F(y0 + gstep * (i + 1))} />)}
        </g>
        <g stroke={accent2} strokeOpacity="0.4" strokeWidth="0.8">
          <line x1={F(x0)} y1={F(c)} x2={F(x1)} y2={F(c)} /><line x1={F(c)} y1={F(y0)} x2={F(c)} y2={F(y1)} />
        </g>
        <g stroke={accent2} strokeOpacity="0.55">
          {Array.from({ length: tickN + 1 }, (_, i) => { const x = x0 + tstep * i, b = i % 4 === 0, h = b ? size * 0.028 : size * 0.015; return <g key={'th' + i}>
            <line x1={F(x)} y1={F(y1)} x2={F(x)} y2={F(y1 - h)} strokeWidth={b ? 0.9 : 0.5} /><line x1={F(x)} y1={F(y0)} x2={F(x)} y2={F(y0 + h)} strokeWidth={b ? 0.9 : 0.5} /></g>; })}
          {Array.from({ length: tickN + 1 }, (_, i) => { const y = y0 + tstep * i, b = i % 4 === 0, h = b ? size * 0.028 : size * 0.015; return <g key={'tv' + i}>
            <line x1={F(x0)} y1={F(y)} x2={F(x0 + h)} y2={F(y)} strokeWidth={b ? 0.9 : 0.5} /><line x1={F(x1)} y1={F(y)} x2={F(x1 - h)} y2={F(y)} strokeWidth={b ? 0.9 : 0.5} /></g>; })}
        </g>
      </g>
      <rect x={F(x0)} y={F(y0)} width={F(span)} height={F(span)} rx={F(bezR)} ry={F(bezR)} fill="none" stroke={accent2} strokeOpacity="0.7" strokeWidth="1.3" />
      <rect x={F(x0 + 3)} y={F(y0 + 3)} width={F(span - 6)} height={F(span - 6)} rx={F(Math.max(0.5, bezR - 1))} ry={F(Math.max(0.5, bezR - 1))} fill="none" stroke={accent2} strokeOpacity="0.3" strokeWidth="0.6" />
      {(() => { const cm = Math.max(4, size * 0.045), o = Math.max(7, size * 0.075);
        const plus = (x, y) => `M${F(x - cm)} ${F(y)}H${F(x + cm)}M${F(x)} ${F(y - cm)}V${F(y + cm)}`;
        return <path d={[plus(x0 + o, y0 + o), plus(x1 - o, y0 + o), plus(x0 + o, y1 - o), plus(x1 - o, y1 - o)].join(' ')} fill="none" stroke={accent2} strokeOpacity="0.85" strokeWidth="1.1" strokeLinecap="round" />; })()}
      {big && <g fill={accent2} fillOpacity="0.55" fontFamily="var(--font-mono)" fontSize={F(size * 0.038)}>
        {[0.2, 0.4, 0.6, 0.8].map((f, i) => <text key={'nx' + i} x={F(x0 + span * f)} y={F(y1 - size * 0.04)} textAnchor="middle">{Math.round(f * 100)}</text>)}
        {[0.2, 0.4, 0.6, 0.8].map((f, i) => <text key={'ny' + i} x={F(x1 - size * 0.05)} y={F(y0 + span * f)} textAnchor="end" dominantBaseline="middle">{Math.round((1 - f) * 100)}</text>)}
      </g>}
    </svg>
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
    const r = size * 0.37, cx = size / 2, cy = size / 2;

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
    const fH = 1 / 0.74;                                                            // ortho half-frustum → sphere = 0.37·size
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

    const facHues = (data || []).filter(d => !d.neutral && d.value > 0).map(d => PL_resolve(d.color)).filter(Boolean);
    const fire = PL_buildFire(seed, cx, cy, r, facHues, pal.danger);

    const st = S.current;
    st.renderer = renderer; st.scene = scene; st.cam = cam; st.mesh = mesh; st.mat = mat;
    st.atmoMat = atmoMat; st.tex = tex; st.heightTex = heightTex; st.normalTex = normalTex; st.geo = geo; st.atmo = atmo; st.tctx = tctx; st.TW = TW; st.TH = TH;
    st.renderFrame = renderFrame; st.rt = rt; st.bayerTex = bayerTex; st.postMat = postMat; st.quad = quad;
    st.world = world; st.pal = pal; st.hatches = hatches; st.fire = fire; st.fctx = fctx;
    st.cx = cx; st.cy = cy; st.r = r; st.size = size; st.dpr = dpr; st.noGL = false;
    st.conqDisplay = conqTarget; st.conqTarget = conqTarget;
    st.alertMix = alert ? 1 : 0; st.alertTarget = alert ? 1 : 0;
    st.spans = PL_faceSpans(data, st.conqDisplay);
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
      if (Math.abs(st.conqDisplay - st.conqTarget) > 0.0005) { st.conqDisplay += (st.conqTarget - st.conqDisplay) * kc; st.spans = PL_faceSpans(data, st.conqDisplay); repaint(); }
      const ka = 1 - Math.exp(-dt / 0.28);
      if (Math.abs(st.alertMix - st.alertTarget) > 0.002) { st.alertMix += (st.alertTarget - st.alertMix) * ka; applyAlert(); }
      mesh.rotation.y += dt * SPIN; atmo.rotation.y = mesh.rotation.y;
      renderFrame();
      const intensity = (st.alertTarget ? 1.0 : 0.45) + st.conqDisplay * 0.9;
      PL_drawFx(fctx, t, fire, size, intensity, st.alertMix, false, pal.danger, pal.bone, cx, cy, r);
      raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      mesh.rotation.y = 0.5; renderFrame();
      const intensity = (st.alertTarget ? 1.0 : 0.45) + st.conqDisplay * 0.9;
      PL_drawFx(fctx, 0, fire, size, intensity, st.alertMix, true, pal.danger, pal.bone, cx, cy, r);
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
    st.spans = PL_faceSpans(data, st.conqDisplay);
    if (st.repaint) st.repaint();
    if (reduced) {                                                                  // no loop to ease — settle + redraw once
      st.conqDisplay = conqTarget; st.alertMix = alert ? 1 : 0; st.spans = PL_faceSpans(data, st.conqDisplay);
      st.applyAlert && st.applyAlert(); st.repaint && st.repaint();
      st.renderFrame();
      const intensity = (st.alertTarget ? 1.0 : 0.45) + st.conqDisplay * 0.9;
      PL_drawFx(st.fctx, 0, st.fire, st.size, intensity, st.alertMix, true, st.pal.danger, st.pal.bone, st.cx, st.cy, st.r);
    }
    // eslint-disable-next-line
  }, [dataSig, alert]);

  const accent2 = PL_resolve('var(--accent-2)');
  const atmoCss = `radial-gradient(circle at 50% 50%, transparent 60%, ${PL_resolve(alert ? 'var(--danger)' : 'var(--accent-2)')} 86%, transparent 100%)`;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <div aria-hidden="true" style={{ position: 'absolute', inset: '-8%', background: atmoCss, opacity: alert ? 0.4 : 0.22, filter: 'blur(3px)', transition: 'opacity .4s ease', pointerEvents: 'none' }} />
      <canvas ref={glRef} width={size} height={size} style={{ position: 'absolute', inset: 0, width: size, height: size, display: 'block' }} />
      <canvas ref={fxRef} style={{ position: 'absolute', inset: 0, width: size, height: size, display: 'block' }} />
      <PL_Hud size={size} accent2={accent2} />
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
