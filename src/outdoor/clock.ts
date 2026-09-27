// @ts-nocheck -- ported as-is from the outdoor-designs a6 prototype (public/outdoor-designs/a6.html),
// where it was designed and tested across synthetic day types; typing it adds nothing but churn.
//
// The Today view: when to go out first, then a 24h clock drawn on canvas. The ring is the
// feels-like temperature as a continuous spectrum (green, orange, red), flames lick out of
// hours with strong sun, a drifting violet gas marks polluted air (sandy haze for dust), a
// bright arc marks the good window (07:00 to 21:00 only), and plain "why" rows follow.
// Drag around the clock to scrub an hour; tap the middle to come back to now.

export interface ClockHour {
  hour: number;
  feels: number;
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
<div class="sub" data-c="sub"></div>
<div class="dial" data-c="dial">
  <canvas data-c="cv" aria-label="The day as a clock. Colour is how hot it feels, flames mark strong sun, violet gas marks polluted air. Drag around it to see each hour."></canvas>
  <div class="centre">
    <div class="c-when" data-c="cWhen"></div>
    <div class="c-word" data-c="cWord"></div>
    <div class="c-feels" data-c="cFeels"></div>
  </div>
</div>
<section class="why" data-c="why"></section>`;

/** Draw the clock into `root` (which must contain CLOCK_HTML); returns a cleanup. */
export function mountClock(
  root: HTMLElement,
  DATA: { date: string; nowHour: number; hours: ClockHour[]; live?: boolean; dayWord?: string; intro?: boolean },
): () => void {

  const hours = DATA.hours;
  const WAKE = 7, SLEEP = 21; // only ever recommend 07:00 to 21:00
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
    if (a === 12 || b === 12) return `${fmt(a)} to ${fmt(b)}`;
    return sa === sb ? `${na} to ${nb} ${sb}` : `${fmt(a)} to ${fmt(b)}`;
  }
  function runs(from, test) {
    const out = [];
    for (let i = Math.max(from, WAKE); i < SLEEP; i++) {
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
    const good = runs(now, isGood), ok = runs(now, isOk);
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
    if (good.length) {
      const [a, b] = good[0];
      const w = blockers(start, a);
      return { a: "Go out", b: range(a, b), col: COLOR.good, mood: COLOR.good, sub: w.length ? `${cap(joinWords(w))} until then.` : "Conditions improve later." };
    }
    if (ok.length) {
      const [a, b] = ok[0];
      const isNow = a <= start && live && now >= WAKE;
      return { a: "Short trips", b: isNow ? `now, until ${fmt(b)}` : range(a, b), col: COLOR.ok, mood: COLOR.ok, sub: "Stay near shade, keep it brief." };
    }
    // name only what blocks every remaining hour; the rows below carry the rest
    const rest = hours.slice(start, SLEEP);
    const all = [];
    if (rest.every(h => h.heat === "bad")) all.push("too hot");
    if (rest.every(h => h.air === "bad")) all.push(airIsDust(rest) ? "dusty air" : "smoggy air");
    if (rest.every(h => h.uvLevel === "bad")) all.push("strong sun");
    const sub = all.length ? `${cap(joinWords(all))} all day.` : `${cap(joinWords(blockers(start, SLEEP)))}, one after another.`;
    return { a: "Stay in", b: dayWord, col: COLOR.bad, mood: COLOR.bad, sub };
  }

  // ---------- spectrum: feels-like to colour ----------
  const STOPS = [
    [18, [48, 209, 150]], [26, [48, 209, 88]], [31, [140, 222, 60]], [33, [255, 200, 40]],
    [35, [255, 140, 20]], [37.5, [255, 69, 58]], [42, [226, 28, 52]], [47, [150, 8, 40]],
  ];
  function heatRGB(f) {
    if (f <= STOPS[0][0]) return STOPS[0][1];
    for (let i = 1; i < STOPS.length; i++) {
      const [x1, c1] = STOPS[i], [x0, c0] = STOPS[i - 1];
      if (f <= x1) { const t = (f - x0) / (x1 - x0); return c0.map((v, k) => v + (c1[k] - v) * t); }
    }
    return STOPS[STOPS.length - 1][1];
  }
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  // per-hour signals, then smooth interpolation between hour centres
  const sig = {
    feels: hours.map(h => h.feels),
    night: hours.map((h, i) => (i < WAKE || i >= SLEEP ? 1 : 0)),
    // flames only where the sun is too strong ("avoid"); the "hats on" warning zone stays clear
    uv: hours.map(h => (h.night ? 0 : h.uvLevel === "bad" ? 0.6 + 0.4 * Math.min(1, (h.uv - 6) / 4) : 0)),
    // gas only where the air is over the limit ("avoid"); the OK warning zone stays clear
    air: hours.map(h => (h.air === "bad" ? 1 : 0)),
    dust: hours.map(h => (h.air !== "good" && RANK[h.dustLevel] >= RANK[h.pollutionLevel] && h.dustLevel !== "good" ? 1 : 0)),
  };
  const smooth = t => t * t * (3 - 2 * t);
  function at(arr, deg) {
    let x = ((deg % 360) + 360) % 360 / 15 - 0.5;
    const i = Math.floor(x), f = smooth(x - i);
    const a = arr[(i + 24) % 24], b = arr[(i + 25) % 24];
    return a + (b - a) * f;
  }

  // ---------- canvas ----------
  const cv = $("cv"), ctx = cv.getContext("2d");
  let S, DPR, CX, R_OUT, R_IN, R_MID, ringLayer;
  const TAU = Math.PI * 2;
  const ang = deg => ((deg - 90) * Math.PI) / 180;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const b = cv.getBoundingClientRect();
    DPR = Math.min(3, window.devicePixelRatio || 1);
    S = b.width;
    cv.width = Math.round(S * DPR); cv.height = Math.round(S * DPR);
    CX = S / 2;
    R_OUT = S * 0.372; R_IN = R_OUT - S * 0.072; R_MID = (R_OUT + R_IN) / 2;
    buildRing();
  }

  function buildRing() {
    ringLayer = document.createElement("canvas");
    ringLayer.width = cv.width; ringLayer.height = cv.height;
    const g = ringLayer.getContext("2d");
    g.scale(DPR, DPR);
    // continuous spectrum, a thin wedge every 0.5 degree
    const step = 0.5;
    for (let d = 0; d < 360; d += step) {
      const c = heatRGB(at(sig.feels, d + step / 2));
      const nt = at(sig.night, d + step / 2);
      g.beginPath();
      g.arc(CX, CX, R_OUT, ang(d), ang(d + step + 0.25));
      g.arc(CX, CX, R_IN, ang(d + step + 0.25), ang(d), true);
      g.closePath();
      // night: sink the colour into a cool slate so it never reads as play time
      g.fillStyle = rgb(c.map((v, k) => v + ([34, 37, 50][k] - v) * 0.74 * nt));
      g.fill();
    }
    // depth: darker inner edge, soft highlight on the outer edge
    const sh = g.createRadialGradient(CX, CX, R_IN, CX, CX, R_OUT);
    sh.addColorStop(0, "rgba(0,0,0,.35)"); sh.addColorStop(.45, "rgba(0,0,0,0)"); sh.addColorStop(.9, "rgba(255,255,255,.06)"); sh.addColorStop(1, "rgba(255,255,255,0)");
    g.beginPath(); g.arc(CX, CX, R_OUT, 0, TAU); g.arc(CX, CX, R_IN, TAU, 0, true); g.fillStyle = sh; g.fill();

    // recommended windows: a clean bright arc just inside the ring
    const good = runs(now, isGood), okR = runs(now, isOk);
    const rec = good.length ? good : okR;
    const col = good.length ? "#6dffa0" : "#ffd27a";
    g.lineCap = "round"; g.lineWidth = 4;
    rec.forEach(([a, b]) => {
      g.save();
      g.shadowColor = col; g.shadowBlur = 12;
      g.strokeStyle = col;
      g.beginPath(); g.arc(CX, CX, R_OUT + 8, ang(a * 15 + 1.5), ang(b * 15 - 1.5)); g.stroke();
      g.restore();
    });
  }

  // cheap smooth noise: layered sines, enough for flicker
  const noise = (x, t) => 0.5 + 0.28 * Math.sin(x * 1.7 + t * 5.3) + 0.14 * Math.sin(x * 3.9 - t * 8.1 + 1.3) + 0.08 * Math.sin(x * 9.1 + t * 13.7 + 4);

  // gas: particles all around the dial, visible only where the air is bad
  // two layers: big slow haze hugging the inner edge, and smaller wisps drifting over it
  const GAS = Array.from({ length: 240 }, (_, i) => {
    const base = i % 2 === 0;
    return {
    a: (i / 240) * 360 + Math.random() * 3,
    off: base ? Math.random() * 0.6 - 0.1 : Math.random() * 2 - 1,
    base,
    size: base ? 1.1 + Math.random() * 0.5 : 0.45 + Math.random() * 0.6,
    sp: (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 2.2),
    ph: Math.random() * TAU,
    };
  });
  // sparks rising out of the flames
  const SPARKS = Array.from({ length: 46 }, () => ({ a: 0, life: 1, t0: -Math.random() * 2, dur: 0.9 + Math.random() * 0.9, drift: Math.random() * 2 - 1 }));

  function drawFlames(t) {
    ctx.globalCompositeOperation = "lighter";
    // soft heat glow behind the tongues
    for (let d = 0; d < 360; d += 2) {
      const u = at(sig.uv, d + 1);
      if (u < 0.02) continue;
      const r1 = R_OUT + 4 + 26 * u;
      const gr = ctx.createRadialGradient(CX, CX, R_OUT - 4, CX, CX, r1);
      gr.addColorStop(0, `rgba(255,120,20,${0.22 * u})`); gr.addColorStop(1, "rgba(255,60,0,0)");
      ctx.beginPath(); ctx.arc(CX, CX, r1, ang(d), ang(d + 2.2)); ctx.arc(CX, CX, R_OUT - 4, ang(d + 2.2), ang(d), true);
      ctx.fillStyle = gr; ctx.fill();
    }
    // tongues
    for (let d = 0; d < 360; d += 1.6) {
      const u = at(sig.uv, d);
      if (u < 0.03) continue;
      const n = noise(d * 0.19, t), n2 = noise(d * 0.07 + 10, t * 0.7);
      const q = Math.sqrt(u); // gentle sun: shorter flames, but still bright, never muddy
      const hgt = S * (0.018 + 0.07 * u) * (0.35 + 0.95 * n);
      const half = 1.5 + 1.1 * u;
      const sway = (n2 - 0.5) * 5;
      const b0 = R_OUT - 3, tipR = R_OUT + hgt;
      const p = (r, dd) => [CX + r * Math.cos(ang(dd)), CX + r * Math.sin(ang(dd))];
      const [lx, ly] = p(b0, d - half), [rx, ry] = p(b0, d + half), [tx, ty] = p(tipR, d + sway);
      const [c1x, c1y] = p(R_OUT + hgt * 0.45, d - half * 0.9 + sway * 0.3), [c2x, c2y] = p(R_OUT + hgt * 0.45, d + half * 0.9 + sway * 0.3);
      const [bx, by] = p(b0, d);
      const gr = ctx.createLinearGradient(bx, by, tx, ty);
      gr.addColorStop(0, `rgba(255,236,170,${0.8 * q})`);
      gr.addColorStop(0.3, `rgba(255,170,50,${0.62 * q})`);
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
        for (let tries = 0; tries < 12; tries++) { const a = Math.random() * 360; if (Math.random() < at(sig.uv, a)) { s.a = a; s.u = at(sig.uv, a); break; } s.u = 0; }
      }
      if (!s.u) return;
      const r = R_OUT + 4 + k * S * 0.09 * s.u;
      const a = s.a + s.drift * k * 4;
      ctx.fillStyle = `rgba(255,210,120,${(1 - k) * 0.9 * s.u})`;
      ctx.beginPath(); ctx.arc(CX + r * Math.cos(ang(a)), CX + r * Math.sin(ang(a)), 1.1, 0, TAU); ctx.fill();
    });
    ctx.globalCompositeOperation = "source-over";
  }

  function drawGas(t) {
    GAS.forEach(p => {
      const a = p.a + t * p.sp + Math.sin(t * 0.4 + p.ph) * 3;
      const k = at(sig.air, a);
      if (k < 0.02) return;
      const dust = at(sig.dust, a);
      const r = R_IN - S * (p.base ? 0.03 : 0.04) - p.off * S * 0.03 + Math.sin(t * 0.6 + p.ph * 2) * S * 0.012;
      const x = CX + r * Math.cos(ang(a)), y = CX + r * Math.sin(ang(a));
      const rad = S * 0.045 * p.size * (0.85 + 0.15 * Math.sin(t * 0.9 + p.ph));
      // violet, never green: green is the comfortable colour of the ring
      const toxic = p.ph > 3.2 ? [150, 90, 255] : [200, 140, 255], sand = p.ph > 3.2 ? [190, 140, 80] : [230, 190, 125];
      const c = toxic.map((v, i) => v + (sand[i] - v) * dust);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const al = p.base ? 0.16 : 0.3;
      gr.addColorStop(0, rgb(c, al * k));
      gr.addColorStop(0.5, rgb(c, al * 0.45 * k));
      gr.addColorStop(1, rgb(c, 0));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
    });
  }

  let selected = home;
  function drawMarkers(t) {
    // the time of day: ticks across the ring (every hour, stronger every 6) and clear labels,
    // drawn on top of the gas and flames so they always read
    ctx.save();
    ctx.lineCap = "round";
    for (let h = 0; h < 24; h++) {
      const major = h % 6 === 0, a = ang(h * 15), c = Math.cos(a), s2 = Math.sin(a);
      const r0 = major ? R_IN + 2 : R_OUT - (R_OUT - R_IN) * 0.28, r1 = R_OUT - 2;
      ctx.strokeStyle = major ? "rgba(0,0,0,.55)" : "rgba(0,0,0,.35)";
      ctx.lineWidth = major ? 2.5 : 1.5;
      ctx.beginPath(); ctx.moveTo(CX + r0 * c, CX + r0 * s2); ctx.lineTo(CX + r1 * c, CX + r1 * s2); ctx.stroke();
    }
    ctx.font = `700 ${Math.max(11, Math.round(S * 0.034))}px -apple-system, system-ui`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = 6;
    ctx.fillStyle = "rgba(255,255,255,.82)";
    const rl = R_IN - S * 0.075;
    [[0, "Midnight"], [6, "6 AM"], [12, "Noon"], [18, "6 PM"]].forEach(([h, txt]) => {
      const a = ang(h * 15);
      ctx.fillText(txt, CX + rl * Math.cos(a), CX + rl * Math.sin(a));
    });
    ctx.restore();

    // selected hour (while scrubbing): a bright outline around that hour
    if (selected !== home) {
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
    drawGas(t);
    drawFlames(t);
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
    $("cFeels").textContent = reasonOf(h);
    renderWhy(i);
    if (reduce) frame(performance.now());
  }
  function hourAt(e) {
    const b = cv.getBoundingClientRect();
    const x = e.clientX - b.left - b.width / 2, y = e.clientY - b.top - b.height / 2;
    let deg = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
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
  function hourRows(h) {
    const dusty = RANK[h.dustLevel] >= RANK[h.pollutionLevel] && RANK[h.dustLevel] > 0;
    return [
      {
        ic: glyph("heat", LVC[h.heat] || QUIET),
        t: h.heat === "bad" ? "Too hot" : h.heat === "ok" ? "Warm" : "Comfortable",
        v: `feels ${h.feels}°`, c: LVC[h.heat],
      },
      h.night
        ? { ic: glyph("moon", QUIET), t: "Sun is down", v: "", c: "" }
        : {
            ic: glyph("sun", LVC[h.uvLevel] || QUIET),
            t: h.uvLevel === "bad" ? "Strong sun" : h.uvLevel === "ok" ? "Sunny, hats on" : "Gentle sun",
            v: `UV ${Math.round(h.uv)}`, c: LVC[h.uvLevel],
          },
      {
        ic: glyph("air", LVC[h.air] || QUIET),
        t: airWordOf(h),
        v: dusty ? `dust ${h.dust ?? "n/a"}` : `AQI ${h.pollution ?? "n/a"}`, c: LVC[h.air],
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
  $("sub").textContent = H.sub;
  $("mood").style.setProperty("--mood", H.mood + "55");
  $("mood").style.setProperty("--mood2", rgb(heatRGB(hours[now].feels), 0.25));

  resize();
  showCentre(home);
  const onResize = () => { resize(); if (reduce) frame(performance.now()); };
  addEventListener("resize", onResize);
  if (reduce) frame(performance.now()); else start();

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVis);
    removeEventListener("resize", onResize);
  };
}
