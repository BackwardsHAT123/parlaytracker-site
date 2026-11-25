// Parlay Tracker site: the playable slip in the hero (legs move like the app's,
// then the app's own cashed confetti or busted tear, ported from
// ConfettiDrawing.swift and TearDrawing.swift), and the squares board.
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- Odds and probability helpers ----------

  const toDecimal = (am) => (am < 0 ? 1 + 100 / -am : 1 + am / 100);
  const toAmerican = (dec) => (dec >= 2 ? "+" + Math.round((dec - 1) * 100) : String(Math.round(-100 / (dec - 1))));
  // Standard normal CDF (Abramowitz-Stegun 7.1.26).
  function phi(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }
  // The app's colour bands, off the rounded whole percent (ProbabilityPalette).
  function band(p) {
    const pct = Math.round(p * 100);
    if (pct <= 10) return "red";
    if (pct <= 30) return "orange";
    if (pct <= 49) return "orange-soft";
    if (pct <= 69) return "blue";
    return "green";
  }
  // The app's trend wording (TrendEstimator.label).
  function trend(p) {
    if (p >= 0.88) return "All but safe";
    if (p >= 0.7) return "Looking good";
    if (p >= 0.5) return "Just ahead";
    if (p >= 0.3) return "Just behind";
    if (p >= 0.12) return "In trouble";
    return "All but gone";
  }
  const money = (n) => "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // ---------- The slip ----------

  const slip = document.getElementById("slip");
  if (!slip) return;
  const legsEl = document.getElementById("legs");
  const chanceEl = document.getElementById("ticket-chance");
  const statusEl = document.getElementById("ticket-status");
  const footLabel = slip.querySelector(".foot-label");
  const playBtn = document.getElementById("play");
  const note = document.getElementById("slip-note");
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  const STAKE = 25;

  // Two kinds of leg: a stat against a line (bar fills toward the mark, settles
  // the moment it clears), and a side (moneyline/spread, settles at the final).
  const LEGS = [
    { pick: "Over 47.5", odds: -125, away: "KC", home: "BUF", kind: "over", line: 47.5, unit: "pts", league: "nfl",
      start: 0, len: 8.6, curve: 1.25, finals: { cash: 54, bust: 54 } },
    { pick: "Seattle Kraken ML", odds: -150, away: "SEA", home: "DET", kind: "side", need: 0, pickHome: false, league: "nhl",
      start: 0.6, len: 7.2, sd: 1.6, finals: { cash: [4, 2], bust: [4, 2] }, chunk: 1 },
    { pick: "Jalen Brunson Over 24.5 pts", odds: -130, away: "NYK", home: "BOS", kind: "over", line: 24.5, unit: "pts", league: "nba",
      start: 1.2, len: 7.6, curve: 1.6, finals: { cash: 29, bust: 31 } },
    { pick: "Tarik Skubal Over 6.5 K", odds: -140, away: "DET", home: "CLE", kind: "over", line: 6.5, unit: "K", league: "mlb",
      start: 0.2, len: 6.4, curve: 1.1, finals: { cash: 8, bust: 9 } },
    // The last game decides it. In the bust run the Lakers win by 4 and miss by half a point.
    { pick: "Lakers -4.5", odds: -125, away: "LAL", home: "PHX", kind: "side", need: 4.5, pickHome: false, league: "nba",
      start: 2.2, len: 8.2, sd: 12, finals: { cash: [114, 103], bust: [110, 106] }, chunk: 2.5, comeback: true },
  ];

  const decimal = LEGS.reduce((d, l) => d * toDecimal(l.odds), 1);
  slip.querySelector(".slip-pay").innerHTML = `$${STAKE} <span aria-hidden="true">&#8594;</span><span class="sr">pays</span> ${money(STAKE * decimal)}`;
  slip.querySelector(".slip-odds").textContent = toAmerican(decimal);
  const implied = (l) => 1 / toDecimal(l.odds);

  // Seeded random so a run's scoring is fixed once it starts.
  function rng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  // A side's scoring: each team's final split into chunks at random times. With
  // `comeback` (the bust run only), the pick builds a lead early and the other
  // side scores late, so it comes down to the last minute.
  function scoring(leg, finals, rand, comeback) {
    const make = (total, skew) => {
      const n = Math.max(1, Math.round(total / leg.chunk));
      const times = Array.from({ length: n }, () => Math.pow(rand(), skew)).sort((a, b) => a - b);
      const pts = Array.from({ length: n }, () => Math.floor(total / n));
      const extra = total - pts.reduce((a, b) => a + b, 0);
      for (let i = 0; i < extra; i++) pts[i % n] += 1;
      return times.map((t, i) => ({ t, p: pts[i] }));
    };
    const [pickFinal, oppFinal] = finals;
    // An exponent above 1 pulls scoring earlier, below 1 later.
    return comeback
      ? { pick: make(pickFinal, 1.5), opp: make(oppFinal, 0.7) }
      : { pick: make(pickFinal, 1), opp: make(oppFinal, 1) };
  }
  const scoreAt = (events, f) => events.reduce((s, e) => (e.t <= f ? s + e.p : s), 0);

  function period(league, f) {
    if (f >= 1) return "Final";
    if (league === "nhl") return ["1st", "2nd", "3rd"][Math.min(2, Math.floor(f * 3))];
    if (league === "mlb") return `${Math.min(9, 1 + Math.floor(f * 9))}th inning`.replace(/^1th/, "1st").replace(/^2th/, "2nd").replace(/^3th/, "3rd");
    return ["1st", "2nd", "3rd", "4th"][Math.min(3, Math.floor(f * 4))];
  }

  // Build the rows once.
  const rows = LEGS.map((leg) => {
    const li = document.createElement("li");
    li.className = "leg";
    li.innerHTML = `
      <div class="leg-pick">${leg.pick}<span class="odds">${leg.odds > 0 ? "+" : ""}${leg.odds}</span></div>
      <div class="leg-right"><span class="chip">Too early</span><span class="pct"></span></div>
      <div class="leg-game"></div>
      ${leg.kind === "over" ? `<div class="bar"><div class="bar-fill"></div><div class="bar-mark" style="left:${(100 / 1.45).toFixed(1)}%"></div></div>` : ""}`;
    legsEl.appendChild(li);
    return {
      li, leg,
      chip: li.querySelector(".chip"), pct: li.querySelector(".pct"), game: li.querySelector(".leg-game"),
      fill: li.querySelector(".bar-fill"),
    };
  });

  let run = null;          // the run in progress
  let nextOutcome = "cash";

  function reset() {
    slip.dataset.state = "ready";
    footLabel.textContent = "Chance to cash";
    for (const r of rows) {
      r.li.removeAttribute("data-band");
      r.li.removeAttribute("data-result");
      r.chip.textContent = "Too early";
      r.pct.textContent = "";
      r.game.textContent = r.leg.kind === "over" ? `${r.leg.away} @ ${r.leg.home}` : `${r.leg.away} @ ${r.leg.home}`;
      if (r.fill) r.fill.style.width = "0%";
    }
    const chance = LEGS.reduce((p, l) => p * implied(l), 1);
    chanceEl.textContent = Math.round(chance * 100) + "%";
    statusEl.textContent = "Pregame";
  }

  function startRun() {
    const outcome = nextOutcome;
    nextOutcome = outcome === "cash" ? "bust" : "cash";
    const rand = rng(Date.now());
    run = {
      outcome, t0: performance.now(), done: false,
      legs: LEGS.map((leg) => ({
        settled: null,
        events: leg.kind === "side" ? scoring(leg, leg.finals[outcome], rand, !!leg.comeback && outcome === "bust") : null,
        final: leg.kind === "over" ? leg.finals[outcome] : null,
        wobble: rand() * Math.PI * 2,
      })),
    };
    playBtn.disabled = true;
    playBtn.textContent = "Playing…";
    note.textContent = "Games are on. Legs settle as soon as they're decided.";
    reset();
    requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!run || run.done) return;
    const t = (now - run.t0) / 1000;
    let chance = 1;
    let hits = 0;
    let busted = false;
    let allDone = true;

    rows.forEach((r, i) => {
      const leg = r.leg;
      const st = run.legs[i];
      const f = Math.max(0, Math.min(1, (t - leg.start) / leg.len));
      let p;

      if (st.settled) {
        p = st.settled === "hit" ? 1 : 0;
      } else if (f <= 0) {
        p = implied(leg);
        allDone = false;
        r.chip.textContent = "Too early";
      } else if (leg.kind === "over") {
        // Stats only go up: the final reached along a curve, plus a small wobble in pace.
        const shape = Math.min(1, Math.pow(f, leg.curve) + 0.04 * Math.sin(f * 9 + st.wobble) * f * (1 - f));
        const v = Math.floor(st.final * Math.max(0, shape));
        const shown = Math.max(v, r.lastV || 0);
        r.lastV = shown;
        if (shown > leg.line) {
          st.settled = "hit";
          p = 1;
        } else {
          const pace = (shown / Math.max(f, 0.06)) * f + leg.line * (1 - f);
          const expected = shown + pace * (1 - f);
          const sd = Math.max(0.6, leg.line * 0.4 * Math.sqrt(1 - f));
          p = phi((expected - leg.line) / sd);
          allDone = false;
        }
        r.game.textContent = `${leg.away} @ ${leg.home}   ${shown} ${leg.unit}, ${period(leg.league, f)}`;
        if (r.fill) r.fill.style.width = Math.min(100, (shown / (leg.line * 1.45)) * 100) + "%";
      } else {
        const ps = scoreAt(st.events.pick, f);
        const os = scoreAt(st.events.opp, f);
        const margin = ps - os;
        const away = leg.pickHome ? os : ps;
        const home = leg.pickHome ? ps : os;
        r.game.textContent = `${leg.away} ${away}-${home} ${leg.home}, ${period(leg.league, f)}`;
        if (f >= 1) {
          st.settled = margin > leg.need ? "hit" : "miss";
          p = st.settled === "hit" ? 1 : 0;
        } else {
          const sd = leg.sd * Math.sqrt(1 - f) + 0.35;
          p = phi((margin - leg.need) / sd);
          allDone = false;
        }
      }

      if (st.settled) {
        r.li.dataset.result = st.settled;
        r.li.dataset.band = st.settled === "hit" ? "green" : "red";
        r.chip.textContent = st.settled === "hit" ? "Hit" : "Missed";
        r.pct.textContent = "";
        if (st.settled === "hit") hits += 1; else busted = true;
      } else if (f > 0) {
        r.li.dataset.band = band(p);
        r.chip.textContent = trend(p);
        // A leg still being played never reads 0% or 100%.
        r.pct.textContent = Math.min(99, Math.max(1, Math.round(p * 100))) + "%";
      }
      chance *= p;
    });

    const pct = Math.round(chance * 100);
    chanceEl.textContent = pct === 0 && chance > 0 ? "<1%" : pct + "%";
    statusEl.textContent = busted ? "Busted" : `${hits} of ${LEGS.length} hit`;

    if (busted) return finish("lost");
    if (allDone && hits === LEGS.length) return finish("won");
    requestAnimationFrame(tick);
  }

  function finish(result) {
    run.done = true;
    if (result === "won") {
      slip.dataset.state = "won";
      footLabel.textContent = "Paid";
      chanceEl.textContent = money(STAKE * decimal);
      statusEl.textContent = "Cashed";
      note.textContent = "Cashed. The first time you see a winner in the app, it throws confetti like this.";
      if (!reduceMotion.matches) confetti();
      done();
    } else {
      footLabel.textContent = "Lost";
      chanceEl.textContent = money(STAKE);
      statusEl.textContent = "Busted";
      note.textContent = "Lakers won by 4. Busted by half a point. The app tears up a losing ticket, once.";
      // The app's quarter-second beat before the paper starts to pull apart.
      setTimeout(() => {
        if (reduceMotion.matches) { slip.dataset.state = "lost-done"; done(); return; }
        slip.dataset.state = "lost";
        tear(() => { slip.dataset.state = "lost-done"; done(); });
      }, 250);
    }
  }

  function done() {
    playBtn.disabled = false;
    playBtn.textContent = "Play again";
  }

  // ---------- Canvas effects (coordinates in CSS pixels of the slip) ----------

  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const W = slip.offsetWidth, H = slip.offsetHeight;
    canvas.width = Math.round(W * 1.6 * dpr);
    canvas.height = Math.round(H * 1.8 * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The slip's own box inside the larger canvas.
    return { W, H, x0: W * 0.3, y0: H * 0.4 };
  }
  const rand = (a, b) => a + Math.random() * (b - a);

  // ConfettiFrame: 110 pieces, a closed-form path each, 3.6 s with a 0.9 s fade.
  function confetti() {
    const box = sizeCanvas();
    const palette = ["#1c9e5c", "#4dc785", "#facc40", "#fde88c", "#ffffff", "#3f78b5"];
    const parts = Array.from({ length: 110 }, () => ({
      angle: rand(-Math.PI * 0.93, -Math.PI * 0.07), speed: rand(380, 980), drag: rand(1.9, 3.1),
      fall: rand(120, 230), spin: rand(-9, 9), spinPhase: rand(0, 6.28), flipRate: rand(4, 11), flipPhase: rand(0, 6.28),
      swayAmp: rand(4, 20), swayRate: rand(2, 5), swayPhase: rand(0, 6.28), w: rand(6, 11), h: rand(9, 16),
      delay: rand(0, 0.22), circle: Math.random() < 0.2, color: palette[Math.floor(Math.random() * palette.length)],
    }));
    const DURATION = 3.6, FADE = 0.9;
    const scaleY = Math.min(Math.max(box.H / 800, 0.55), 1);
    const scaleX = Math.min(Math.max(box.W / 620, 0.4), 0.9);
    const ox = box.x0 + box.W / 2, oy = box.y0 + box.H * 0.34;
    const start = performance.now();
    (function frame(now) {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (t >= DURATION) return;
      ctx.globalAlpha = Math.min(1, (DURATION - t) / FADE);
      for (const p of parts) {
        const u = t - p.delay;
        if (u <= 0) continue;
        const launch = (1 - Math.exp(-p.drag * u)) / p.drag;
        const settle = p.fall * (u - (1 - Math.exp(-2.5 * u)) / 2.5);
        const sway = Math.sin(u * p.swayRate + p.swayPhase) * p.swayAmp * Math.min(1, u);
        const x = ox + Math.cos(p.angle) * p.speed * scaleX * launch + sway;
        const y = oy + Math.sin(p.angle) * p.speed * scaleY * launch + settle;
        const flip = Math.max(0.15, Math.abs(Math.cos(u * p.flipRate + p.flipPhase)));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(u * p.spin + p.spinPhase);
        ctx.scale(1, flip);
        ctx.fillStyle = p.color;
        if (p.circle) { ctx.beginPath(); ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    })(start);
  }

  // TearFrame: the paper strains (0.25-1.0 s), rips along a jagged edge, and
  // the halves fall away; gone at 2.7 s.
  function tear(onDone) {
    const box = sizeCanvas();
    const { W, H, x0, y0 } = box;
    const offsets = Array.from({ length: 17 }, () => rand(-11, 11));
    const edge = offsets.map((o, i) => [W / 2 + o, (H * i) / (offsets.length - 1)]);
    const scraps = Array.from({ length: 30 }, () => ({ fr: Math.random(), vx: rand(-260, 260), vy: rand(-260, -40), spin: rand(-8, 8), size: rand(4, 9) }));
    const STRAIN = 0.25, RIP = 1.0, DURATION = 2.7;
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const red = "#bd1f1f", ink = "#292624";

    function face() {
      ctx.fillStyle = "#faf5eb";
      ctx.strokeStyle = "#b8ad9e";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(0, 0, W, H, 12); ctx.fill(); ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = ink;
      ctx.font = "700 22px 'Barlow Condensed', sans-serif";
      ctx.fillText("5-leg parlay", W / 2, H * 0.3);
      ctx.fillStyle = "rgba(41,38,36,0.6)";
      ctx.font = "500 15px 'Barlow', sans-serif";
      ctx.fillText("Lakers -4.5 missed by half a point", W / 2, H * 0.3 + 24);
      ctx.save();
      ctx.translate(W / 2, H * 0.5);
      ctx.rotate((-6 * Math.PI) / 180);
      ctx.font = "800 46px 'Barlow Condensed', sans-serif";
      const tw = ctx.measureText("BUSTED").width;
      ctx.strokeStyle = red; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(-tw / 2 - 16, -36, tw + 32, 50, 7); ctx.stroke();
      ctx.fillStyle = red;
      ctx.fillText("BUSTED", 0, 4);
      ctx.restore();
      ctx.fillStyle = red;
      ctx.font = "700 26px 'Barlow Condensed', sans-serif";
      ctx.fillText("-" + money(STAKE), W / 2, H * 0.5 + 64);
    }

    function halfPath(left) {
      const p = new Path2D();
      const outer = left ? 0 : W;
      p.moveTo(outer, 0);
      for (const [x, y] of edge) p.lineTo(x, y);
      p.lineTo(outer, H);
      p.closePath();
      return p;
    }
    const halves = [halfPath(true), halfPath(false)];
    const start = performance.now();

    (function frame(now) {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (t >= DURATION) { onDone(); return; }
      const fadeIn = clamp(t / 0.15);
      const fadeOut = 1 - clamp((t - 1.95) / 0.6);
      const strain = clamp((t - STRAIN) / (RIP - STRAIN));
      const fall = clamp((t - RIP) / 1.35);
      const ripped = t >= RIP;
      ctx.globalAlpha = fadeIn * fadeOut;

      [true, false].forEach((left, i) => {
        const sign = left ? -1 : 1;
        const shake = ripped ? 0 : Math.sin(t * 58) * 2 * strain;
        const tilt = sign * (strain * 1.2 + fall * (left ? 34 : 28));
        const apart = sign * (strain * 1.5 + fall * 70);
        const drop = fall * fall * H * 2.4;
        const ax = left ? 0 : W;
        ctx.save();
        ctx.translate(x0 + apart + shake, y0 + drop);
        ctx.translate(ax, H);
        ctx.rotate((tilt * Math.PI) / 180);
        ctx.translate(-ax, -H);
        ctx.shadowColor = `rgba(0,0,0,${0.22 * fadeIn})`;
        ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
        ctx.clip(halves[i]);
        ctx.shadowColor = "transparent";
        face();
        ctx.restore();
      });

      if (!ripped) {
        const last = Math.max(1, Math.floor((edge.length - 1) * strain));
        ctx.save();
        ctx.translate(x0 + Math.sin(t * 58) * 2 * strain, y0);
        ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 1.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(edge[0][0], edge[0][1]);
        for (let i = 1; i <= last && i < edge.length; i++) ctx.lineTo(edge[i][0], edge[i][1]);
        ctx.stroke();
        ctx.restore();
      } else {
        const since = t - RIP;
        for (const s of scraps) {
          const [ex, ey] = edge[Math.min(edge.length - 1, Math.floor(s.fr * (edge.length - 1)))];
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - since / 1.2) * fadeOut;
          ctx.translate(x0 + ex + s.vx * since, y0 + ey + s.vy * since + 520 * since * since);
          ctx.rotate(s.spin * since);
          ctx.fillStyle = "#f5ede0";
          ctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size * 0.7);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    })(start);
  }

  playBtn.addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    startRun();
  });
  reset();

  // ---------- Squares board (static): your squares, and the four quarter winners ----------

  const grid = document.getElementById("board-grid");
  if (grid) {
    const top = [7, 3, 0, 9, 4, 1, 6, 8, 2, 5];
    const side = [4, 0, 7, 2, 9, 5, 1, 8, 3, 6];
    const mine = new Set(["1-4", "0-2", "1-6", "2-0", "3-8", "4-4", "5-1", "6-7", "7-3", "8-9", "9-5"]);
    // Quarter-end scores as (home last digit, away last digit): 7-0, 14-10, 17-13, 24-20.
    const wins = { "Q1": [7, 0], "Q2": [4, 0], "Q3": [7, 3], "Q4": [4, 0] };
    const winAt = {};
    for (const [q, [h, a]] of Object.entries(wins)) {
      const key = `${side.indexOf(a)}-${top.indexOf(h)}`;
      winAt[key] = winAt[key] ? winAt[key] + "/" + q.slice(1) : q;
    }
    const cells = [];
    cells.push('<span class="axis"></span>');
    for (const d of top) cells.push(`<span class="axis">${d}</span>`);
    side.forEach((d, r) => {
      cells.push(`<span class="axis">${d}</span>`);
      top.forEach((_, c) => {
        const key = `${r}-${c}`;
        const cls = [winAt[key] ? "win" : "", mine.has(key) ? "mine" : ""].join(" ").trim();
        cells.push(`<span class="${cls}">${winAt[key] || ""}</span>`);
      });
    });
    grid.innerHTML = cells.join("");
  }
})();
