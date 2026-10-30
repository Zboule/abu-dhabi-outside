// @ts-nocheck -- ported as-is from the outdoor-designs a6 prototype (public/outdoor-designs/a6.html),
// where it was designed and tested across synthetic day types; typing it adds nothing but churn.
//
// The Today view: when to go out first, then a 24h clock drawn on canvas. The ring is the
// feels-like temperature as a continuous spectrum (green, orange, red), flames lick out of
// hours with strong sun (where the ring itself burns), a swarm of violet particles is the ring where
// the air is polluted (sand for dust), a
// bright arc marks the good window (inside the day set in the settings; the rest is darkened),
// and plain "why" rows follow.
// Drag around the clock to scrub an hour; tap the middle to come back to now.

import { heatRGB, rgb, type HeatLimits } from '../lib/heat';
import { sunTimes } from '../lib/sun';

export interface ClockHour {
  hour: number;
  feels: number;
  /** feels-like on the daytime scale (night limits are higher): what the colour follows */
  heatFeels?: number;
  /** pool time rating (too cold, UV, air) */
  pool?: string;
  /** how the heat reads ("Fresh", "Mild, too cool for the pool", "Too hot"...) and its colour when cool */
  heatWord?: string;
  heatCol?: string;
  /** "UV 6.3 → 4.3" in parts, each end with its own level */
  uvParts?: { t: string; lv: string }[];
  heat: string;
  uv: number;
  uvLevel: string;
  night: boolean;
  pollution: number | null;
  pollutionLevel: string;
  pollutant: string | null;
  dust: number | null;
  dustLevel: string;
  air: string;
  verdict: string;
}

export const CLOCK_HTML = `
<div class="mood" data-c="mood"></div>
<h1 data-c="headline"></h1>
<div class="dial" data-c="dial">
  <canvas data-c="cv" aria-label="The day as a clock. Colour is how hot it feels, flames mark strong sun, violet particles mark polluted air. Noon at the top, midnight at the bottom. Drag around it to see each hour."></canvas>
  <div class="centre">
    <div class="c-when" data-c="cWhen"></div>
    <div class="c-word" data-c="cWord"></div>
  </div>
</div>
<section class="why" data-c="why"></section>`;

/** Draw the clock into `root` (which must contain CLOCK_HTML); returns a cleanup. */
export function mountClock(
  root: HTMLElement,
  DATA: {
    date: string;
    nowHour: number;
    hours: ClockHour[];
    live?: boolean;
    dayWord?: string;
    intro?: boolean;
    /** the day's first and last hour (inclusive), from the settings */
    dayFrom?: number;
    dayTo?: number;
    /** the heat limits the colours follow */
    heat?: HeatLimits;
    /** draw the pool time arc (blue, outside the going-out arc) */
    pool?: boolean;
  },
): () => void {

  const hours = DATA.hours;
  // the day, from the settings (day start / day end): hours outside it are darkened and never
  // recommended. Default is the full day (nothing darkened).
  const WAKE = DATA.dayFrom ?? 0, SLEEP = (DATA.dayTo ?? 23) + 1;
  // live = today: plan from now and show the now dot. Another day: plan its whole waking
  // day, and open on noon.
  const live = DATA.live !== false;
  const now = live ? DATA.nowHour : WAKE;
  const home = live ? now : 12;
  const dayWord = DATA.dayWord || "today";
  const RANK = { good: 0, na: 0, ok: 1, bad: 2 };
  const COLOR = { good: "#30d158", ok: "#ffb340", bad: "#ff453a" };
  const $ = id => root.querySelector(`[data-c="${id}"]`);

  // ---------- words ----------
  const ampm = h => { h %= 24; const s = h < 12 ? "AM" : "PM"; const n = h % 12 || 12; return [n, s]; };
  const fmt = h => { if (h % 24 === 0) return "midnight"; if (h === 12) return "noon"; const [n, s] = ampm(h); return `${n} ${s}`; };
  function range(a, b) {
    const [na, sa] = ampm(a), [nb, sb] = ampm(b);
    // noon and midnight are words ("Midnight to 7 AM", not "12 to 7 AM")
    if (a % 12 === 0 || b % 12 === 0) return `${cap(fmt(a))} to ${fmt(b)}`;
    return sa === sb ? `${na} to ${nb} ${sb}` : `${fmt(a)} to ${fmt(b)}`;
  }
  function runs(from, test, to = SLEEP) {
    const out = [];
    for (let i = Math.max(from, WAKE); i < Math.min(to, SLEEP); i++) {
      if (!test(hours[i])) continue;
      const last = out[out.length - 1];
      if (last && last[1] === i) last[1] = i + 1; else out.push([i, i + 1]);
    }
    return out;
  }
  const isGood = h => h.verdict === "good";
  const isOk = h => h.verdict === "ok";
  function blockers(from, to) {
    // which factors block the given stretch, plain words
    const w = [];
    const span = hours.slice(Math.max(from, 0), to);
    if (span.some(h => h.heat === "bad")) w.push("too hot");
    else if (span.some(h => h.heat === "ok")) w.push("warm");
    if (span.some(h => h.air === "bad")) w.push(airIsDust(span) ? "dusty air" : "smoggy air");
    if (span.some(h => !h.night && h.uvLevel === "bad")) w.push("strong sun");
    else if (!w.length && span.some(h => !h.night && h.uvLevel === "ok")) w.push("sunny, hats on");
    return w;
  }
  const airIsDust = span => span.filter(h => h.air !== "good").some(h => RANK[h.dustLevel] >= RANK[h.pollutionLevel] && h.dustLevel !== "good");
  const joinWords = w => w.length <= 1 ? (w[0] || "") : w.slice(0, -1).join(", ") + " and " + w[w.length - 1];
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

  function headline() {
    const start = Math.max(now, WAKE);
    const good = runs(now, isGood);
    const h = hours[now];
    if (live && now >= SLEEP) return { a: "Night time", b: "Sleep well", col: "rgba(235,235,245,.62)", sub: "Check again in the morning.", mood: "#1c2a55" };
    if (good.length && good[0][0] <= start && live && now >= WAKE) {
      const end = good[0][1], again = good[1];
      return {
        a: "Go out now", b: end >= SLEEP ? "all day" : `until ${fmt(end)}`, col: COLOR.good, mood: COLOR.good,
        sub: again ? `And again ${range(again[0], again[1])}.`
          : end < SLEEP && blockers(end, end + 1).length ? `Then ${joinWords(blockers(end, end + 1))}.` : `Feels ${h.feels}° right now.`,
      };
    }
    // otherwise name the next stretch you can go out at all (OK or good hours in a row): "Go out"
    // when every hour of it is good, "Short trips" when some are only OK. A lone good hour later in
    // the day (sometimes good by a point) must not hide the OK hours before and around it
    const okish = h => isGood(h) || isOk(h);
    const next = runs(now, okish)[0];
    if (next) {
      const [a, b] = next, span = hours.slice(a, b), allGood = span.every(isGood);
      const isNow = a <= start && live && now >= WAKE;
      const when = isNow ? (b >= SLEEP ? "now, all day" : `now, until ${fmt(b)}`) : range(a, b);
      const bestRun = runs(a, isGood, b)[0];
      return allGood
        ? { a: "Go out", b: when, col: COLOR.good, mood: COLOR.good, sub: `Feels ${hours[a].feels}°${isNow ? " right now" : " then"}.` }
        : { a: "Short trips", b: when, col: COLOR.ok, mood: COLOR.ok, sub: bestRun ? `Best ${range(...bestRun)}.` : "Stay near shade, keep it brief." };
    }
    // name only what blocks every remaining hour; the rows below carry the rest
    const rest = hours.slice(start, SLEEP);
    const all = [];
    if (rest.every(h => h.heat === "bad")) all.push("too hot");
    if (rest.every(h => h.air === "bad")) all.push(airIsDust(rest) ? "dusty air" : "smoggy air");
    if (rest.every(h => h.uvLevel === "bad")) all.push("strong sun");
    // today, a better window may already be behind us (the faint arc): then it's from now on, not all day
    const missed = live && runs(WAKE, h => isGood(h) || isOk(h), start).length > 0;
    const sub = all.length ? `${cap(joinWords(all))} ${missed ? "from now on" : "all day"}.` : `${cap(joinWords(blockers(start, SLEEP)))}, one after another.`;
    return { a: "Stay in", b: missed ? "now" : dayWord, col: COLOR.bad, mood: COLOR.bad, sub };
  }

  // ---------- spectrum: feels-like to colour (shared with the tiles, lib/heat.ts) ----------

  // per-hour signals, then smooth interpolation between hour centres
  const sig = {
    feels: hours.map(h => h.heatFeels ?? h.feels),
    night: hours.map((h, i) => (i < WAKE || i >= SLEEP ? 1 : 0)),
    // today, the hours already gone sink like the night (a little less: a missed window still reads)
    past: hours.map((h, i) => (live && i < now ? 1 : 0)),
    // flames only where the sun is too strong ("avoid"); the "hats on" warning zone stays clear.
    // Bad air wins over the sun: an hour with both shows the particles only
    uv: hours.map(h => (h.night || h.air === "bad" ? 0 : h.uvLevel === "bad" ? 0.6 + 0.4 * Math.min(1, (h.uv - 6) / 4) : 0)),
    // particles only where the air is over the limit ("avoid"); the OK warning zone stays clear
    air: hours.map(h => (h.air === "bad" ? 1 : 0)),
    dust: hours.map(h => (h.air !== "good" && RANK[h.dustLevel] >= RANK[h.pollutionLevel] && h.dustLevel !== "good" ? 1 : 0)),
  };
  const smooth = t => t * t * (3 - 2 * t);
  const HEAT_HOLD = 0.3; // as the tiles: hours blend a little faster than a full hour
  // flames and particles stay inside their hour (fading only near its edges), so they never spill
  // under a neighbour hour's pool or going-out line
  const FX_HOLD = 0.8;
  // hold: the share of each hour that keeps its own value before blending into the next
  function at(arr, deg, hold = 0) {
    let x = ((deg % 360) + 360) % 360 / 15 - 0.5;
    const i = Math.floor(x), f = smooth(Math.min(1, Math.max(0, (x - i - hold / 2) / (1 - hold))));
    const a = arr[(i + 24) % 24], b = arr[(i + 25) % 24];
    return a + (b - a) * f;
  }

  // how much an angle is a hazard hour (sun burning skin, or air hurting lungs), 0..1. Outside the
  // day hours (settings) the hazard still shows, sunk into the darkened area like its ring would be
  const dayK = d => 1 - 0.7 * at(sig.night, d, FX_HOLD);
  const uvK = d => Math.min(1, at(sig.uv, d, FX_HOLD) / 0.6);
  const airK = d => at(sig.air, d, FX_HOLD);
  // effects of hours already gone fade like their ring
  const pastFade = d => 1 - 0.7 * at(sig.past, d, 0.85);
  const hazardAt = d => Math.max(uvK(d), airK(d));
  // the hand-over between a hazard and the ring: over about a third of an hour each side of the
  // boundary the ring dissolves while the particles (or flames) thin out into it, no hard cut
  const HAZ_HOLD = 0.3;
  const ringHaz = d => Math.max(Math.min(1, at(sig.uv, d, HAZ_HOLD) / 0.6), at(sig.air, d, HAZ_HOLD));

  // ---------- canvas ----------
  const cv = $("cv"), ctx = cv.getContext("2d");
  let S, DPR, CX, R_OUT, R_IN, R_MID, R_C, ringLayer;
  const TAU = Math.PI * 2;
  // noon at the top, midnight at the bottom: the day reads left to right across the top (6 AM
  // on the left, 6 PM on the right), as the widget's strip
  const ang = deg => ((deg + 90) * Math.PI) / 180;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const b = cv.getBoundingClientRect();
    DPR = Math.min(3, window.devicePixelRatio || 1);
    S = b.width;
    cv.width = Math.round(S * DPR); cv.height = Math.round(S * DPR);
    CX = S / 2;
    R_OUT = S * 0.372; R_IN = R_OUT - S * 0.072; R_MID = (R_OUT + R_IN) / 2;
    R_C = S * 0.185; // the centre circle the selected hour's words sit in
    buildRing();
  }

  function buildRing() {
    ringLayer = document.createElement("canvas");
    ringLayer.width = cv.width; ringLayer.height = cv.height;
    const g = ringLayer.getContext("2d");
    g.scale(DPR, DPR);
    // continuous spectrum, a thin wedge every 0.5 degree
    const step = 0.5;
    const sh = g.createRadialGradient(CX, CX, R_IN, CX, CX, R_OUT);
    sh.addColorStop(0, "rgba(0,0,0,.35)"); sh.addColorStop(.45, "rgba(0,0,0,0)"); sh.addColorStop(.9, "rgba(255,255,255,.06)"); sh.addColorStop(1, "rgba(255,255,255,0)");
    for (let d = 0; d < 360; d += step) {
      const c = heatRGB(at(sig.feels, d + step / 2, HEAT_HOLD), DATA.heat);
      const nt = Math.max(at(sig.night, d + step / 2), 0.75 * at(sig.past, d + step / 2, 0.85));
      g.beginPath();
      g.arc(CX, CX, R_OUT, ang(d), ang(d + step + 0.25));
      g.arc(CX, CX, R_IN, ang(d + step + 0.25), ang(d), true);
      g.closePath();
      // night: sink the colour into a cool slate so it never reads as play time
      g.fillStyle = rgb(c.map((v, k) => v + ([34, 37, 50][k] - v) * 0.74 * nt));
      g.fill();
      // depth: darker inner edge, soft highlight on the outer edge
      g.fillStyle = sh; g.fill();
    }
    // hours to avoid whatever the heat have no ring: the fire or the particles are the ring there
    // (drawFlames, drawAirParticles), the temperature doesn't matter. The ring is erased with one
    // smooth conic mask (eased), so it dissolves into them without seams between its slices
    g.save();
    g.globalCompositeOperation = "destination-out";
    const ease = x => x * x * (3 - 2 * x);
    if (g.createConicGradient) {
      const mask = g.createConicGradient(ang(0), CX, CX);
      for (let d = 0; d <= 360; d += 1) mask.addColorStop(d / 360, `rgba(0,0,0,${ease(Math.min(1, ringHaz(d)))})`);
      g.fillStyle = mask;
      g.beginPath(); g.arc(CX, CX, R_OUT + 1, 0, TAU); g.arc(CX, CX, R_IN - 1, TAU, 0, true); g.fill();
    } else {
      for (let d = 0; d < 360; d += step) {
        g.fillStyle = `rgba(0,0,0,${ease(Math.min(1, ringHaz(d + step / 2)))})`;
        g.beginPath(); g.arc(CX, CX, R_OUT + 1, ang(d), ang(d + step)); g.arc(CX, CX, R_IN - 1, ang(d + step), ang(d), true); g.closePath(); g.fill();
      }
    }
    g.restore();

    // recommended windows, outside the ring: going out on the line next to it (green, or yellow
    // when only OK), pool time just beyond (blue for good hours, pale blue for OK ones). The inside
    // of the dial is the sky.
    // Today's earlier windows stay faint and thin, so a missed morning still shows.
    // every hour you can go out, in its own colour: green when good, yellow when only OK (a good
    // hour later never hides the OK ones around it)
    const out = new Array(24).fill(null);
    for (let i = WAKE; i < SLEEP; i++) out[i] = isGood(hours[i]) ? "#6dffa0" : isOk(hours[i]) ? "#ffd27a" : null;
    const swim = new Array(24).fill(null);
    if (DATA.pool) for (let i = live ? WAKE : now; i < SLEEP; i++) swim[i] = { good: "#40c4ff", ok: "#9bdcff" }[hours[i].pool] ?? null;
    // the footsteps and the moving water are drawn in frame() (drawSteps, drawPool); the cache holds the
    // faint line of pool time already gone
    OUT_RUNS = arcRuns(out);
    SWIM_RUNS = arcRuns(swim);
    g.lineCap = "round";
    // pool time already gone: a faint still line where the water was
    for (const { a0, a1, col, past } of SWIM_RUNS) {
      if (!past) continue;
      g.strokeStyle = rgb(col, 0.4); g.lineWidth = 1.6;
      g.beginPath(); g.arc(CX, CX, R_POOL(), ang(a0), ang(a1)); g.stroke();
    }
    buildPool();
    drawSky(g);
  }

  // ---------- the good times: footsteps (going out) and water light (pool time) ----------
  // Going out is a walk along the window (drawSteps); pool time, just beyond, is water light: a lane
  // of the dancing caustic network seen on the floor of a pool (drawPool). Both keep the verdict's
  // hue (green / yellow, blue / pale blue). Today's windows already gone stay faint and still.
  let OUT_RUNS = [], SWIM_RUNS = [];
  // the footsteps run close to the ring, clear of the pool lane beyond them
  const R_LIGHT = () => R_OUT + 6;
  const hexRGB = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  // a colour drawn toward white (light's hot core)
  const mix = (c, k) => c.map(v => v + (255 - v) * k);
  // runs of one colour and one tense: {a0, a1, col, past, open0, open1}, a small gap only where
  // the window starts or stops, or past meets future (open: that end is a real start or stop)
  function arcRuns(cols) {
    const isPast = i => live && i < now;
    const key = i => (cols[i] ? `${cols[i]}|${isPast(i)}` : null);
    const res = [];
    for (let i = 0; i < 24; ) {
      const k = key(i);
      if (!k) { i++; continue; }
      let j = i;
      while (j + 1 < 24 && key(j + 1) === k) j++;
      const edge = n => n < 0 || n > 23 || !cols[n] || isPast(n) !== isPast(i);
      const open0 = edge(i - 1), open1 = edge(j + 1);
      res.push({ a0: i * 15 + (open0 ? 1.5 : 0), a1: (j + 1) * 15 - (open1 ? 1.5 : 0), col: hexRGB(cols[i]), good: cols[i] === "#6dffa0" || cols[i] === "#40c4ff", past: isPast(i), open0, open1 });
      i = j + 1;
    }
    return res;
  }

  // a stroke style whose alpha follows `alphaAt(deg)` along the arc (a conic gradient around the
  // centre), sampled every `step` degrees over [a0, a1]
  function arcPaint(col, a0, a1, alphaAt, step = 1) {
    if (!ctx.createConicGradient) return rgb(col, alphaAt((a0 + a1) / 2));
    const gr = ctx.createConicGradient(ang(0), CX, CX);
    const lo = Math.max(0, a0 - step), hi = Math.min(360, a1 + step);
    for (let d = lo; d <= hi + 1e-6; d += step) gr.addColorStop(Math.min(1, d / 360), rgb(col, +Math.max(0, Math.min(1, alphaAt(d))).toFixed(3)));
    return gr;
  }

  // Going out is a walk: a trail of footprints through each window, left and right, green for good
  // hours, yellow for OK ones; windows already gone keep a faint trail. Every step is always there:
  // only their colour moves, a soft glow walking forward along the trail (steps appearing and
  // vanishing read as data changing).
  function footPath(sc, left) {
    // a bare footprint pointing along +x: forefoot, narrower heel, five toes curving to the outside
    const p = new Path2D(), m = left ? 1 : -1;
    p.ellipse(0.6 * sc, 0, 1.9 * sc, 1.25 * sc, 0, 0, TAU);
    p.ellipse(-2.3 * sc, 0.15 * m * sc, 1.25 * sc, 0.95 * sc, 0, 0, TAU);
    p.rect(-2.3 * sc, -0.8 * sc + 0.15 * m * sc, 2.9 * sc, 1.6 * sc);
    const toes = [[2.95, -0.85, 0.5], [3.2, -0.15, 0.42], [3.15, 0.5, 0.37], [2.95, 1.05, 0.32], [2.6, 1.5, 0.27]];
    for (const [tx, ty, tr] of toes) { p.moveTo((tx + tr) * sc, ty * m * sc); p.arc(tx * sc, ty * m * sc, tr * sc, 0, TAU); }
    return p;
  }
  const STEP = 4, PACE = 10; // degrees between steps; degrees a second the glow walks
  function drawSteps(t) {
    const P = (r, d) => [CX + r * Math.cos(ang(d)), CX + r * Math.sin(ang(d))];
    const sc = Math.max(0.9, S * 0.0028);
    ctx.save();
    for (const { a0, a1, col, past } of OUT_RUNS) {
      const span = a1 - a0 + 40, head = a0 - 20 + (reduce ? -99 : (t * PACE) % span);
      let n = 0;
      for (let d = a0 + 1.5; d < a1 - 1; d += STEP, n++) {
        // the glow: brighter and whiter where it passes, the steps' own colour elsewhere
        const g = past ? 0 : Math.exp(-(((d - head) / 9) ** 2));
        ctx.fillStyle = rgb(mix(col, 0.3 + 0.45 * g), past ? 0.3 : 0.8 + 0.2 * g);
        const left = n % 2 === 0, [x, y] = P(R_LIGHT() + (left ? -1 : 1) * 1.6 * sc, d);
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang(d) + Math.PI / 2 + (left ? -0.12 : 0.12));
        ctx.fill(footPath(sc, left));
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // the pool lane, per pixel: laid out once per size (which pixels, where along the lane and
  // across it, their colour), then lit every frame by a moving cell network (caustics)
  const R_POOL = () => R_OUT + 16, POOL_HW = 4;
  let pool = null;
  function buildPool() {
    pool = null;
    const runs = SWIM_RUNS;
    if (!runs.some(r => !r.past)) return;
    const Q = 4, N = 360 * Q; // a table every quarter degree
    const hw = new Float32Array(N), cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N), fade = new Float32Array(N);
    for (const { a0, a1, col, past, good, open0, open1 } of runs) {
      if (past) continue;
      for (let k = Math.ceil(a0 * Q); k <= Math.floor(a1 * Q) && k < N; k++) {
        const d = k / Q;
        // rounded ends where the lane starts or stops
        const x = Math.min(1, open0 ? (d - a0) / 2.2 : 1, open1 ? (a1 - d) / 2.2 : 1);
        hw[k] = POOL_HW * Math.sqrt(Math.max(0, 1 - (1 - x) ** 2));
        [cr[k], cg[k], cb[k]] = col;
        fade[k] = past ? 0.32 : good ? 1 : 0.8;
      }
    }
    const W = cv.width, RP = R_POOL();
    const rmax = (RP + POOL_HW + 1) * DPR;
    const lo = Math.max(0, Math.floor(CX * DPR - rmax)), hi = Math.min(W, Math.ceil(CX * DPR + rmax));
    const idx = [], ss = [], uu = [], aa = [], ww = [], kk = [];
    let bx0 = W, by0 = W, bx1 = 0, by1 = 0;
    for (let y = lo; y < hi; y++) {
      const dy = (y + 0.5) / DPR - CX;
      for (let x = lo; x < hi; x++) {
        const dx = (x + 0.5) / DPR - CX;
        const r = Math.sqrt(dx * dx + dy * dy), u = r - RP;
        if (u > POOL_HW + 1 || u < -POOL_HW - 1) continue;
        let deg = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
        deg = ((deg % 360) + 360) % 360;
        const k = Math.round(deg * Q) % N;
        if (hw[k] <= 0) continue;
        const a = Math.min(1, (hw[k] - Math.abs(u)) * DPR + 0.5);
        if (a <= 0) continue;
        idx.push(y * W + x); ss.push((deg * Math.PI / 180) * RP); uu.push(u); aa.push(a * fade[k]);
        ww.push(Math.max(0, 1 - (u / Math.max(hw[k], 0.5)) ** 2)); kk.push(k);
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
    }
    if (!idx.length) return;
    const layer = document.createElement("canvas");
    layer.width = W; layer.height = cv.height;
    const lg = layer.getContext("2d");
    const img = lg.createImageData(W, cv.height);
    // the cell network wraps around the dial: a whole number of cells along the lane
    const CELL = 7.5, L = TAU * RP, NC = Math.round(L / CELL), ROWS = Math.ceil((2 * POOL_HW) / CELL) + 3;
    const seed = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    const cells = Array.from({ length: NC * ROWS }, (_, n) => ({
      w1: 0.5 + seed(n) * 0.9, w2: 0.5 + seed(n + 0.5) * 0.9, p1: seed(n + 0.25) * TAU, p2: seed(n + 0.75) * TAU,
      jx: (seed(n + 0.1) - 0.5) * 1.4, jy: (seed(n + 0.6) - 0.5) * 1.4,
    }));
    // the warp and swell phases of each pixel, kept as sin/cos pairs so a frame needs no trig per
    // pixel (sin(a + wt) = sin a cos wt + cos a sin wt)
    const off = POOL_HW + CELL, CS = L / NC; // rows start a cell below the lane
    const PH = [(s, u) => u * 0.5 + s * 0.07, (s, u) => s * 0.23 - u * 0.8, s => s * 0.13, (s, u) => s * 0.31 + u * 0.6, s => s * 0.055];
    const sn = PH.map(() => new Float32Array(idx.length)), cs = PH.map(() => new Float32Array(idx.length));
    const fx0 = new Float32Array(idx.length), fy0 = new Float32Array(idx.length);
    for (let p = 0; p < idx.length; p++) {
      PH.forEach((f, j) => { const v = f(ss[p], uu[p]); sn[j][p] = Math.sin(v); cs[j][p] = Math.cos(v); });
      fx0[p] = ss[p] / CS; fy0[p] = (uu[p] + off) / CELL;
    }
    pool = {
      sn, cs, fx0, fy0,
      n: idx.length, idx: Int32Array.from(idx), s: Float32Array.from(ss), u: Float32Array.from(uu), a: Float32Array.from(aa), w: Float32Array.from(ww), k: Int32Array.from(kk),
      cr, cg, cb, layer, lg, img, data: img.data, box: [bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1],
      NC, ROWS, CS: L / NC, CELL, cells, px: new Float32Array(NC * ROWS), py: new Float32Array(NC * ROWS),
    };
  }

  function drawPool(t) {
    if (!pool) return;
    // the light moves slowly: 30 fresh pictures a second are plenty, the frames between reuse it
    if (pool.last !== undefined && t >= pool.last && t - pool.last < 1 / 32) { ctx.drawImage(pool.layer, 0, 0, S, S); return; }
    pool.last = t;
    const { n, idx, a, w, k, cr, cg, cb, data, NC, ROWS, cells, px, py, sn, cs, fx0, fy0 } = pool;
    // the cells' centres wander in small loops: the network flexes and dances
    for (let c = 0; c < cells.length; c++) {
      const q = cells[c];
      px[c] = 0.5 + q.jx * 0.5 + 0.34 * Math.sin(t * q.w1 + q.p1);
      py[c] = 0.5 + q.jy * 0.5 + 0.34 * Math.cos(t * q.w2 + q.p2);
    }
    const W = [0.9, -1.3, -1.1, 0.7, -1.4].map(f => [Math.cos(f * t), Math.sin(f * t)]);
    const [s0, s1, s2, s3, s4] = sn, [c0, c1, c2, c3, c4] = cs;
    const [[C0, S0], [C1, S1], [C2, S2], [C3, S3], [C4, S4]] = W;
    for (let p = 0; p < n; p++) {
      // a slow warp bends the cell walls into curves, as refracted light does
      const fx = fx0[p] + 0.3 * (s0[p] * C0 + c0[p] * S0) + 0.14 * (s1[p] * C1 + c1[p] * S1);
      const fy = fy0[p] + 0.3 * (s2[p] * C2 + c2[p] * S2) + 0.14 * (s3[p] * C3 + c3[p] * S3);
      const ix = Math.floor(fx), iy = Math.floor(fy);
      let f1 = 9, f2 = 9, f3 = 9;
      for (let oy = -1; oy <= 1; oy++) {
        const ry = iy + oy;
        if (ry < 0 || ry >= ROWS) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const cx = ix + ox, c = ry * NC + (cx < 0 ? cx + NC : cx >= NC ? cx - NC : cx);
          const dx = cx + px[c] - fx, dy = ry + py[c] - fy;
          const dd = dx * dx + dy * dy;
          if (dd < f1) { f3 = f2; f2 = f1; f1 = dd; } else if (dd < f2) { f3 = f2; f2 = dd; } else if (dd < f3) f3 = dd;
        }
      }
      const r1 = Math.sqrt(f1);
      // bright on the cell walls (0 there), brighter still where three cells meet
      let I = 1 - (Math.sqrt(f2) - r1) / 0.22;
      I = I > 0 ? I * I : 0;
      let J = 1 - (Math.sqrt(f3) - r1) / 0.45;
      J = J > 0 ? J * J : 0;
      // light swells travel along the lane, so the net shimmers rather than sits
      const sw = 0.6 + 0.4 * (s4[p] * C4 + c4[p] * S4);
      const kk = k[p], wv = w[p];
      // the water itself: a clear lane of the pool's blue, the light network bright on it
      const A = 0.6 * (0.8 + 0.2 * wv), L = Math.min(1, (I * (0.8 + 0.7 * J)) * sw * (0.55 + 0.45 * wv));
      const al = A + L * (1 - A);
      // deep water, the light in the pool's own blue turning white only where it gathers
      const hot = 0.1 + 0.75 * L * L;
      const o = idx[p] * 4, bodyK = (A * (1 - L)) / al * 0.82, lineK = L / al;
      data[o] = cr[kk] * bodyK + (cr[kk] + (255 - cr[kk]) * hot) * lineK;
      data[o + 1] = cg[kk] * bodyK + (cg[kk] + (255 - cg[kk]) * hot) * lineK;
      data[o + 2] = cb[kk] * (bodyK + 0.08) + (cb[kk] + (255 - cb[kk]) * hot) * lineK;
      data[o + 3] = al * a[p] * 255;
    }
    const [x, y, bw, bh] = pool.box;
    pool.lg.putImageData(pool.img, 0, 0, x, y, bw, bh);
    ctx.drawImage(pool.layer, 0, 0, S, S);
  }

  // cheap smooth noise: layered sines, enough for flicker
  const noise = (x, t) => 0.5 + 0.28 * Math.sin(x * 1.7 + t * 5.3) + 0.14 * Math.sin(x * 3.9 - t * 8.1 + 1.3) + 0.08 * Math.sin(x * 9.1 + t * 13.7 + 4);

  // sparks rising out of the flames
  const SPARKS = Array.from({ length: 46 }, () => ({ a: 0, life: 1, t0: -Math.random() * 2, dur: 0.9 + Math.random() * 0.9, drift: Math.random() * 2 - 1 }));

  function drawFlames(t) {
    ctx.globalCompositeOperation = "lighter";
    const W = R_OUT - R_IN;
    // soft heat glow behind the tongues, from the band out
    for (let d = 0; d < 360; d += 2) {
      const u = at(sig.uv, d + 1, FX_HOLD) * dayK(d + 1) * pastFade(d + 1);
      if (u < 0.02) continue;
      const r1 = R_OUT + 6 + 26 * u;
      const gr = ctx.createRadialGradient(CX, CX, R_IN, CX, CX, r1);
      gr.addColorStop(0, `rgba(255,110,10,${0.28 * u})`); gr.addColorStop(0.45, `rgba(255,120,20,${0.2 * u})`); gr.addColorStop(1, "rgba(255,60,0,0)");
      ctx.beginPath(); ctx.arc(CX, CX, r1, ang(d), ang(d + 2.2)); ctx.arc(CX, CX, R_IN, ang(d + 2.2), ang(d), true);
      ctx.fillStyle = gr; ctx.fill();
    }
    // one fire: tongues rooted on the inner edge of the band, burning through it and far out
    for (let d = 0; d < 360; d += 1.5) {
      const u = at(sig.uv, d, FX_HOLD) * dayK(d) * pastFade(d);
      if (u < 0.03) continue;
      const n = noise(d * 0.19, t), n2 = noise(d * 0.07 + 10, t * 0.7);
      const q = Math.sqrt(u); // gentle sun: shorter flames, but still bright, never muddy
      const hgt = W * (0.75 + 0.35 * n) + S * (0.015 + 0.055 * u) * (0.35 + 0.95 * n);
      const half = 1.7 + 1.3 * u;
      const sway = (n2 - 0.5) * 6;
      const b0 = R_IN - 1, tipR = R_IN + hgt;
      const p = (r, dd) => [CX + r * Math.cos(ang(dd)), CX + r * Math.sin(ang(dd))];
      const [lx, ly] = p(b0, d - half), [rx, ry] = p(b0, d + half), [tx, ty] = p(tipR, d + sway);
      const [c1x, c1y] = p(R_IN + hgt * 0.45, d - half * 0.9 + sway * 0.3), [c2x, c2y] = p(R_IN + hgt * 0.45, d + half * 0.9 + sway * 0.3);
      const [bx, by] = p(b0, d);
      const gr = ctx.createLinearGradient(bx, by, tx, ty);
      gr.addColorStop(0, `rgba(255,220,140,${0.55 * q})`);
      gr.addColorStop(0.3, `rgba(255,170,50,${0.55 * q})`);
      gr.addColorStop(0.7, `rgba(255,80,10,${0.32 * q})`);
      gr.addColorStop(1, "rgba(200,20,0,0)");
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.quadraticCurveTo(c1x, c1y, tx, ty);
      ctx.quadraticCurveTo(c2x, c2y, rx, ry);
      ctx.closePath();
      ctx.fillStyle = gr; ctx.fill();
    }
    // sparks
    SPARKS.forEach(s => {
      let k = (t - s.t0) / s.dur;
      if (k >= 1 || k < 0) {
        // respawn somewhere the sun is strong (rejection sampling)
        s.t0 = t; k = 0;
        for (let tries = 0; tries < 12; tries++) { const a = Math.random() * 360; if (Math.random() < uvK(a)) { s.a = a; s.u = uvK(a) * dayK(a); break; } s.u = 0; }
      }
      if (!s.u) return;
      const r = R_OUT + 8 + k * S * 0.08 * s.u;
      const a = s.a + s.drift * k * 4;
      ctx.fillStyle = `rgba(255,210,120,${(1 - k) * 0.9 * s.u})`;
      ctx.beginPath(); ctx.arc(CX + r * Math.cos(ang(a)), CX + r * Math.sin(ang(a)), 1.1, 0, TAU); ctx.fill();
    });
    ctx.globalCompositeOperation = "source-over";
  }

  // the ring itself made of particles where the air hurts lungs: a swarm of crisp dots filling
  // the band, densest at its middle, drifting and jittering; violet for smog, sand for dust (the
  // widgets draw the same, still)
  const AIR_INK = { smog: [[59, 23, 133], [140, 92, 255], [212, 188, 255]], dust: [[107, 69, 32], [200, 149, 90], [240, 211, 162]] };
  const AIR_P = Array.from({ length: 4200 }, () => ({
    a: Math.random() * 360,
    off: Math.random() + Math.random() - 1, // -1..1, most near 0: dense in the middle of the band
    size: 1.3 + Math.random() * 3.2,
    sp: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 1.4),
    ph: Math.random() * TAU,
    tone: Math.floor(Math.random() * 3),
  }));
  function drawAirParticles(t) {
    const W = R_OUT - R_IN, scale = S / 360;
    AIR_P.forEach(p => {
      const a = p.a + Math.sin(t * 0.35 + p.ph) * 2.2 + Math.sin(t * 1.7 + p.ph * 3) * 0.35;
      const k = at(sig.air, a, HAZ_HOLD) * dayK(a) * pastFade(a);
      if (k < 0.05) return;
      const dust = at(sig.dust, a, FX_HOLD);
      const r = R_MID + p.off * W * 0.68 + Math.sin(t * 1.2 * p.sp + p.ph * 2) * W * 0.06;
      const d = p.size * scale * (1.15 - Math.abs(p.off) * 0.55);
      const c = AIR_INK.smog[p.tone].map((v, i) => v + (AIR_INK.dust[p.tone][i] - v) * dust);
      ctx.fillStyle = rgb(c, k);
      ctx.beginPath(); ctx.arc(CX + r * Math.cos(ang(a)), CX + r * Math.sin(ang(a)), d / 2, 0, TAU); ctx.fill();
    });
  }

  let selected = home;
  // ---------- the sky: the face split along the day's horizon ----------
  // The inside of the dial is two skies cut by the line from sunrise to sunset (real times for
  // the day, lib/sun.ts): above it the day, a filigree sun; below it the night, a crescent moon
  // and stars. Fine gold and silver line work, kept faint where the centre's words sit.
  const SUN = sunTimes(DATA.date);
  function drawSky(g) {
    const Rs = R_IN - 4;
    const aRise = ang(SUN.rise * 15), aSet = ang(SUN.set * 15);
    const at = (r, a) => [CX + r * Math.cos(a), CX + r * Math.sin(a)];
    const gold = a => `rgba(255,206,120,${a})`, silver = a => `rgba(196,210,255,${a})`;

    // the sun and the moon sit on the centre line, in the band between the centre circle and
    // the ring: at the top (noon) and the bottom (midnight), in place of those words
    const sunY = CX - (R_C + Rs) / 2, moonY = CX + (R_C + Rs) / 2;

    // day: the arc from sunrise to sunset over the top, closed by the horizon
    g.save();
    g.beginPath(); g.arc(CX, CX, Rs, aRise, aSet); g.closePath(); g.clip();
    const day = g.createRadialGradient(CX, CX - Rs * 0.55, 0, CX, CX - Rs * 0.2, Rs * 1.1);
    day.addColorStop(0, "rgba(255,170,60,0.20)"); day.addColorStop(0.55, "rgba(255,140,40,0.07)"); day.addColorStop(1, "rgba(255,120,30,0)");
    g.fillStyle = day; g.fillRect(CX - Rs, CX - Rs, Rs * 2, Rs * 2);
    // the sun, quiet, centred in the day sky
    const sx = CX, sy = sunY, R = Rs * 0.1;
    const halo = g.createRadialGradient(sx, sy, 0, sx, sy, R * 2.2);
    halo.addColorStop(0, "rgba(255,200,110,0.05)"); halo.addColorStop(1, "rgba(255,200,110,0)");
    g.fillStyle = halo; g.beginPath(); g.arc(sx, sy, R * 2.2, 0, TAU); g.fill();
    g.lineCap = "round";
    g.strokeStyle = gold(0.25); g.lineWidth = 0.8;
    g.beginPath(); g.arc(sx, sy, R * 0.42, 0, TAU); g.stroke();
    g.strokeStyle = gold(0.15); g.lineWidth = 0.8;
    g.beginPath(); g.arc(sx, sy, R * 0.3, 0, TAU); g.stroke();
    for (let k = 0; k < 24; k++) { // a dotted ring between the disc and the rays
      const a = (k / 24) * TAU; g.fillStyle = gold(0.2);
      g.beginPath(); g.arc(sx + R * 0.52 * Math.cos(a), sy + R * 0.52 * Math.sin(a), 0.7, 0, TAU); g.fill();
    }
    for (let k = 0; k < 16; k++) { // rays: long straight ones, short wavy ones between
      const a = (k / 16) * TAU, long = k % 2 === 0;
      const [x0, y0] = [sx + R * 0.62 * Math.cos(a), sy + R * 0.62 * Math.sin(a)];
      if (long) {
        const [x1, y1] = [sx + R * 1.12 * Math.cos(a), sy + R * 1.12 * Math.sin(a)];
        g.strokeStyle = gold(0.2); g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.fillStyle = gold(0.23); g.beginPath(); g.arc(x1 + 2.2 * Math.cos(a), y1 + 2.2 * Math.sin(a), 0.9, 0, TAU); g.fill();
      } else {
        const len = R * 0.32, nx = -Math.sin(a), ny = Math.cos(a);
        g.strokeStyle = gold(0.17); g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x0, y0);
        for (let q = 1; q <= 6; q++) {
          const f = q / 6, w = Math.sin(f * Math.PI * 2) * 1.6;
          g.lineTo(x0 + Math.cos(a) * len * f + nx * w, y0 + Math.sin(a) * len * f + ny * w);
        }
        g.stroke();
      }
    }
    // a fine dotted arc following the sky's edge
    for (let a = aRise + 0.06; a < aSet - 0.06; a += 0.045) {
      const [x, y] = at(Rs * 0.9, a); g.fillStyle = gold(0.35); g.beginPath(); g.arc(x, y, 0.65, 0, TAU); g.fill();
    }
    g.restore();

    // night: the arc from sunset to sunrise under the bottom
    g.save();
    g.beginPath(); g.arc(CX, CX, Rs, aSet, aRise + TAU); g.closePath(); g.clip();
    const night = g.createRadialGradient(CX, CX + Rs * 0.55, 0, CX, CX + Rs * 0.2, Rs * 1.1);
    night.addColorStop(0, "rgba(70,90,200,0.22)"); night.addColorStop(0.6, "rgba(50,60,160,0.08)"); night.addColorStop(1, "rgba(40,50,140,0)");
    g.fillStyle = night; g.fillRect(CX - Rs, CX - Rs, Rs * 2, Rs * 2);
    // stars: four-point sparkles and dots, away from the centre's words
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 46; k++) {
      const a = aSet + rnd() * ((aRise + TAU) - aSet), r = R_C + 6 + rnd() * (Rs - R_C - 10);
      const [x, y] = at(r, a), size = 0.6 + rnd() * (k % 6 === 0 ? 2.4 : 1.1), al = 0.14 + rnd() * 0.22;
      if (k % 6 === 0) {
        g.strokeStyle = silver(al); g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x - size, y); g.lineTo(x + size, y); g.moveTo(x, y - size); g.lineTo(x, y + size); g.stroke();
      }
      g.fillStyle = silver(al); g.beginPath(); g.arc(x, y, k % 6 === 0 ? 0.9 : size * 0.5, 0, TAU); g.fill();
    }
    // the crescent moon, quiet, centred in the night sky
    const mx = CX, my = moonY, M = Rs * 0.085;
    const glow = g.createRadialGradient(mx, my, 0, mx, my, M * 2.4);
    glow.addColorStop(0, "rgba(180,200,255,0.04)"); glow.addColorStop(1, "rgba(180,200,255,0)");
    g.fillStyle = glow; g.beginPath(); g.arc(mx, my, M * 2.4, 0, TAU); g.fill();
    // a crescent: the moon's lit edge, then back along the edge of the shadow disc inside it
    const crescent = (m) => {
      const bx = mx + m * 0.5, by = my - m * 0.22, rb = m * 0.9; // the shadow disc
      const d = Math.hypot(bx - mx, by - my), phi = Math.atan2(by - my, bx - mx);
      const al = Math.acos((d * d + m * m - rb * rb) / (2 * d * m));
      const p1 = [mx + m * Math.cos(phi + al), my + m * Math.sin(phi + al)];
      const p2 = [mx + m * Math.cos(phi - al), my + m * Math.sin(phi - al)];
      g.beginPath();
      g.moveTo(p1[0], p1[1]);
      g.arc(mx, my, m, phi + al, phi - al + TAU);
      g.arc(bx, by, rb, Math.atan2(p2[1] - by, p2[0] - bx), Math.atan2(p1[1] - by, p1[0] - bx), true);
      g.closePath();
    };
    g.fillStyle = silver(0.05); crescent(M); g.fill();
    g.strokeStyle = silver(0.28); g.lineWidth = 0.8; crescent(M); g.stroke();
    g.strokeStyle = silver(0.12); g.lineWidth = 0.6; crescent(M * 0.78); g.stroke();
    for (let a = aSet + 0.06; a < aRise + TAU - 0.06; a += 0.045) {
      const [x, y] = at(Rs * 0.9, a); g.fillStyle = silver(0.28); g.beginPath(); g.arc(x, y, 0.6, 0, TAU); g.fill();
    }
    g.restore();

    // the horizon, gold on the day side fading to silver, a small mark at sunrise and sunset
    const [rx, ry] = at(Rs, aRise), [tx, ty] = at(Rs, aSet);
    const hz = g.createLinearGradient(rx, ry, tx, ty);
    hz.addColorStop(0, gold(0.55)); hz.addColorStop(0.5, gold(0.25)); hz.addColorStop(1, gold(0.55));
    g.save();
    g.beginPath(); g.rect(0, 0, S, S); g.arc(CX, CX, R_C + 3, 0, TAU, true); g.clip("evenodd");
    g.strokeStyle = hz; g.lineWidth = 1;
    g.beginPath(); g.moveTo(rx, ry); g.lineTo(tx, ty); g.stroke();
    g.restore();
    [[rx, ry], [tx, ty]].forEach(([x, y]) => { g.fillStyle = gold(0.8); g.beginPath(); g.arc(x, y, 2, 0, TAU); g.fill(); });
  }

  function drawMarkers(t) {
    // the time of day: ticks across the ring (every hour, stronger every 6) and clear labels,
    // drawn on top of the particles and flames so they always read
    ctx.save();
    ctx.lineCap = "round";
    for (let h = 0; h < 24; h++) {
      const major = h % 6 === 0, a = ang(h * 15), c = Math.cos(a), s2 = Math.sin(a);
      const r0 = major ? R_IN + 2 : R_OUT - (R_OUT - R_IN) * 0.28, r1 = R_OUT - 2;
      ctx.strokeStyle = major ? "rgba(0,0,0,.55)" : "rgba(0,0,0,.35)";
      ctx.lineWidth = major ? 2.5 : 1.5;
      ctx.beginPath(); ctx.moveTo(CX + r0 * c, CX + r0 * s2); ctx.lineTo(CX + r1 * c, CX + r1 * s2); ctx.stroke();
    }
    ctx.font = `700 ${Math.max(10, Math.round(S * 0.029))}px -apple-system, system-ui`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = 6;
    ctx.fillStyle = "rgba(255,255,255,.82)";
    const rl = R_IN - S * 0.05;
    // noon and midnight are the sun and the moon; 6 AM and 6 PM sit by the horizon's ends
    [[6, "6 AM"], [18, "6 PM"]].forEach(([h, txt]) => {
      const a = ang(h * 15);
      ctx.fillText(txt, CX + rl * Math.cos(a), CX + rl * Math.sin(a));
    });
    ctx.restore();

    // the centre and its link to the selected hour, made of the sky's own material: a soft shade
    // behind the words, and a beam, the sky brightening in a soft wedge from the centre to the
    // hour (gold for a daylight hour, silver for a night one), as if the hour were lit from there
    {
      const a = ang(selected * 15 + 7.5);
      const h = selected + 0.5, day = h > SUN.rise && h < SUN.set;
      const tone = day ? [255, 206, 120] : [196, 210, 255];
      const c = al => `rgba(${tone[0]},${tone[1]},${tone[2]},${al})`;
      const P = r => [CX + r * Math.cos(a), CX + r * Math.sin(a)];
      ctx.save();
      const shade = ctx.createRadialGradient(CX, CX, 0, CX, CX, R_C * 1.25);
      shade.addColorStop(0, "rgba(6,6,10,0.62)"); shade.addColorStop(0.7, "rgba(6,6,10,0.45)"); shade.addColorStop(1, "rgba(6,6,10,0)");
      ctx.fillStyle = shade; ctx.beginPath(); ctx.arc(CX, CX, R_C * 1.25, 0, TAU); ctx.fill();
      ctx.filter = `blur(${Math.round(S * 0.012)}px)`;
      const [b0x, b0y] = P(R_C * 0.6), [b1x, b1y] = P(R_IN);
      const beam = ctx.createLinearGradient(b0x, b0y, b1x, b1y);
      beam.addColorStop(0, c(0)); beam.addColorStop(0.35, c(0.16)); beam.addColorStop(1, c(0.32));
      ctx.fillStyle = beam;
      ctx.beginPath(); ctx.moveTo(b0x, b0y); ctx.arc(CX, CX, R_IN - 2, a - 0.15, a + 0.15); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // the selected hour: a bright outline around it, the now hour included
    {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.shadowColor = "#fff"; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(CX, CX, R_OUT + 3, ang(selected * 15 + 1), ang(selected * 15 + 14));
      ctx.arc(CX, CX, R_IN - 3, ang(selected * 15 + 14), ang(selected * 15 + 1), true);
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
    // now: a small bright dot on the ring, gently breathing (today only)
    if (!live) return;
    const a = ang(now * 15 + 7.5), x = CX + R_MID * Math.cos(a), y = CX + R_MID * Math.sin(a);
    const pulse = reduce ? 0 : (Math.sin(t * 2.4) + 1) / 2;
    ctx.save();
    ctx.fillStyle = `rgba(255,255,255,${0.18 + 0.12 * pulse})`;
    ctx.beginPath(); ctx.arc(x, y, 9 + 3 * pulse, 0, TAU); ctx.fill();
    ctx.shadowColor = "#fff"; ctx.shadowBlur = 10;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  const T0 = performance.now();
  // the ring sweeps in on first load only; a day slid in from the arrows is drawn at once
  const sweep = !reduce && DATA.intro !== false;
  if (!sweep) root.classList.add("no-intro");
  let intro = sweep ? 0 : 1;
  function frame(ms) {
    const t = (ms - T0) / 1000;
    if (sweep) intro = Math.min(1, t / 1.1);
    const e = 1 - Math.pow(1 - intro, 3);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, S, S);
    // ring sweeps in clockwise on load
    ctx.save();
    if (e < 1) { ctx.beginPath(); ctx.moveTo(CX, CX); ctx.arc(CX, CX, S, ang(0), ang(360 * e)); ctx.closePath(); ctx.clip(); }
    ctx.drawImage(ringLayer, 0, 0, S, S);
    ctx.globalAlpha = e;
    drawAirParticles(t);
    drawFlames(t);
    drawPool(t);
    drawSteps(t);
    ctx.restore();
    drawMarkers(t);
  }

  let raf = 0;
  function loop(ms) { frame(ms); raf = requestAnimationFrame(loop); }
  function start() { if (!raf && !reduce) raf = requestAnimationFrame(loop); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVis);

  // ---------- centre + scrub ----------
  const WORD = { good: "Good", ok: "OK", bad: "Avoid", na: "No data" };
  function showCentre(i) {
    selected = i;
    const h = hours[i];
    $("cWhen").textContent = live && i === now ? "Now" : fmt(i).replace("midnight", "Midnight").replace("noon", "Noon");
    $("cWord").textContent = WORD[h.verdict] || "No data";
    $("cWord").style.color = COLOR[h.verdict] || "#fff";
    // like the rings design: the selected hour explains itself, in the centre and below
    renderWhy(i);
    if (reduce) frame(performance.now());
  }
  function hourAt(e) {
    const b = cv.getBoundingClientRect();
    const x = e.clientX - b.left - b.width / 2, y = e.clientY - b.top - b.height / 2;
    let deg = (Math.atan2(y, x) * 180) / Math.PI - 90;
    deg = ((deg % 360) + 360) % 360;
    return { h: Math.min(23, Math.floor(deg / 15)), dist: Math.hypot(x, y) };
  }
  let scrub = false;
  cv.addEventListener("pointerdown", e => {
    const { h, dist } = hourAt(e);
    if (dist < R_IN - 30) { showCentre(home); return; }
    scrub = true; cv.setPointerCapture(e.pointerId); showCentre(h);
  });
  cv.addEventListener("pointermove", e => {
    if (!scrub) return;
    const { h } = hourAt(e);
    if (h !== selected) { showCentre(h); if (navigator.vibrate) navigator.vibrate(3); }
  });
  const endScrub = () => { scrub = false; };
  cv.addEventListener("pointerup", endScrub);
  cv.addEventListener("pointercancel", endScrub);

  // ---------- why: one plain row per reason ----------
  function span([a, b], from) { return a <= Math.max(from, WAKE) ? `until ${fmt(b)}` : range(a, b); }

  // ---------- the selected hour, explained ----------
  const LVC = { good: COLOR.good, ok: COLOR.ok, bad: COLOR.bad };
  function airWordOf(h) {
    const dusty = RANK[h.dustLevel] >= RANK[h.pollutionLevel] && RANK[h.dustLevel] > 0;
    if (h.air === "good") return "Clean air";
    if (dusty) return h.air === "bad" ? "Dusty air" : "Some dust";
    return h.air === "bad" ? "Smoggy air" : "Hazy air";
  }
  /** "Too hot, smoggy air": what holds this hour back (or how it feels when it's fine). */
  function reasonOf(h) {
    if (h.verdict === "good" || h.verdict === "na") return `Feels ${h.feels}°`;
    const lv = RANK[h.verdict], out = [];
    if (RANK[h.heat] === lv) out.push(lv === 2 ? "Too hot" : "Warm");
    if (RANK[h.air] === lv) out.push(airWordOf(h));
    if (!h.night && RANK[h.uvLevel] === lv) out.push(lv === 2 ? "Strong sun" : "Sunny, hats on");
    return out.slice(0, 2).map((w, k) => (k ? w.toLowerCase() : w)).join(", ");
  }
  /** The three factors of one hour, with the same cues as the clock. */
  // SF Symbols-like line glyphs for the rows (24 grid), tinted by the level of that factor
  const ROW_GLYPH = {
    heat: '<path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0Z"/><path d="M12 9v6.5"/><circle cx="12" cy="17" r="1.6" fill="currentColor" stroke="none"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5"/>',
    moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z"/>',
    air: '<path d="M3 8.5h10.5a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12.5h15a2.8 2.8 0 1 1-2.8 2.8"/><path d="M3 16.5h7"/>',
  };
  const glyph = (k, color) =>
    `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 5px ${color}55)">${ROW_GLYPH[k]}</svg>`;
  const QUIET = "rgba(235,235,245,.45)";
  // bad air wears the colour of the particles drawn on the ring (violet smog, sand for dust), so the row reads as that cloud
  const GAS_COL = { air: "#a77bff", dust: "#d7a96b" };
  function hourRows(h) {
    const dusty = RANK[h.dustLevel] >= RANK[h.pollutionLevel] && RANK[h.dustLevel] > 0;
    const gas = h.air === "bad" ? (dusty ? GAS_COL.dust : GAS_COL.air) : "";
    return [
      {
        ic: glyph("heat", h.heatCol || LVC[h.heat] || QUIET),
        t: h.heatWord || (h.heat === "bad" ? "Too hot" : h.heat === "ok" ? "Warm" : "Comfortable"),
        v: `feels ${h.feels}°`, c: h.heatCol || LVC[h.heat],
      },
      h.night
        ? { ic: glyph("moon", QUIET), t: "Sun is down", v: "", c: "" }
        : {
            ic: glyph("sun", LVC[h.uvLevel] || QUIET),
            t: h.uvLevel === "bad" ? "Strong sun" : h.uvLevel === "ok" ? "Sunny, hats on" : "Gentle sun",
            v: h.uvParts?.length ? h.uvParts.map(p => `<span style="color:${LVC[p.lv] || QUIET}">${p.t}</span>`).join("") : `UV ${Math.round(h.uv)}`,
            c: LVC[h.uvLevel],
          },
      {
        ic: glyph("air", gas || LVC[h.air] || QUIET),
        t: airWordOf(h),
        v: dusty ? `dust ${h.dust ?? "n/a"}` : `AQI ${h.pollution ?? "n/a"}`, c: gas || LVC[h.air],
      },
    ];
  }
  const rowHtml = r =>
    `<div class="row"><span class="ic">${r.ic}</span><span class="t">${r.t}</span><span class="v"${r.c ? ` style="color:${r.c}"` : ""}>${r.v}</span></div>`;
  function renderWhy(i) {
    // always the three factors of the selected hour: heat, sun, air
    const el = $("why");
    // the hour is already named in the centre of the clock; only offer the way back
    // the button's row is always there (hidden at home) so showing it doesn't push the rows down
    const back = `<h2><button type="button" class="now-btn"${i === home ? " hidden" : ""}>${live ? "Now" : "Noon"}</button></h2>`;
    el.innerHTML = back + hourRows(hours[i]).map(rowHtml).join("");
    el.querySelector(".now-btn")?.addEventListener("click", () => showCentre(home));
  }


  // ---------- render ----------
  const H = headline();
  $("headline").innerHTML = `${H.a} <span class="when" style="color:${H.col}">${H.b}</span>`;
  $("mood").style.setProperty("--mood", H.mood + "55");
  $("mood").style.setProperty("--mood2", rgb(heatRGB(hours[now].heatFeels ?? hours[now].feels, DATA.heat), 0.25));

  resize();
  showCentre(home);
  // the dial is sized to fit the screen height (see TodayClock), so follow the canvas, not the window
  const onResize = () => { resize(); if (reduce) frame(performance.now()); };
  const ro = new ResizeObserver(onResize);
  ro.observe(cv);
  if (reduce) frame(performance.now()); else start();

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVis);
    ro.disconnect();
  };
}
