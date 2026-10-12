/* The Same Machine: charts and interactions. Data: data.json (built by analysis/build.py). */
(async function () {
  const D = await (await fetch("data.json")).json();
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const C = { recalled: css("--rec"), imagined: css("--img"), retold: css("--ret") };
  const G = ["recalled", "imagined", "retold"];
  const GL = { recalled: "Remembered", imagined: "Imagined", retold: "Retold" };
  const MUTED = css("--muted"), GRID = css("--grid"), AXIS = css("--axis"), INK2 = css("--ink-2"), MID = css("--mid");
  const F = D.features;
  const fmt = d3.format(",");
  const f2 = d3.format(".2f"), f3 = d3.format(".3f");
  const pfmt = (p) => { const ps = p < 0.001 ? "p < .001" : "p = " + d3.format(".3f")(p).replace(/^0/, ""); return (p < 0.001 ? "Yes, very" : p < 0.01 ? "Yes" : p < 0.05 ? "Weak" : "No") + ` <span style="color:var(--muted)">(${ps})</span>`; };
  const signed = (v, f = f2) => (v > 0 ? "+" : v < 0 ? "−" : "") + f(Math.abs(v));

  /* ---------- tooltip ---------- */
  const tip = document.getElementById("tip");
  function showTip(html, ev) {
    tip.innerHTML = html;
    tip.style.opacity = 1;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => (tip.style.opacity = 0);

  /* ---------- responsive registry ---------- */
  const charts = [];
  function chart(id, draw) {
    const el = document.getElementById(id);
    if (!el) return;
    const c = { el, draw, w: 0 };
    charts.push(c);
    c.render = () => {
      c.w = el.clientWidth;
      if (c.w < 60) return;
      el.innerHTML = "";
      try { draw(el, c.w); } catch (e) { console.error("chart " + id + " failed:", e.stack); }
    };
    c.render();
    return c;
  }
  let rT;
  addEventListener("resize", () => {
    clearTimeout(rT);
    rT = setTimeout(() => charts.forEach((c) => { if (Math.abs(c.el.clientWidth - c.w) > 4) c.render(); }), 150);
  });
  const svgIn = (el, w, h) => d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h);
  const isNarrow = () => innerWidth < 700;

  /* ---------- progress + nav ---------- */
  const prog = document.getElementById("progress");
  addEventListener("scroll", () => {
    const h = document.documentElement;
    prog.style.width = (100 * h.scrollTop) / (h.scrollHeight - h.clientHeight) + "%";
  }, { passive: true });
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("vis")), { threshold: 0.12 });
  document.querySelectorAll(".fade-in").forEach((el) => io.observe(el));

  /* ---------- stat strip ---------- */
  const M = D.meta;
  const normTotal = M.normWords.concreteness + M.normWords.lancaster + M.normWords.warriner;
  document.getElementById("strip").innerHTML = [
    [fmt(M.n), "stories: remembered, made up or retold"],
    [(M.words / 1e6).toFixed(1) + " million", "words analysed"],
    [fmt(M.workers), "people who wrote them"],
    [fmt(Math.round(normTotal / 1000)) + "k", "words rated by people, from 3 published lists"],
    ["25", "ways of measuring each story"],
  ].map(([n, l]) => `<div><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");

  /* =========================================================== HERO */
  (function hero() {
    const cv = document.getElementById("heroCanvas");
    const ctx = cv.getContext("2d");
    const pts = D.map;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let W, H, t0 = performance.now();
    const seeds = pts.map(() => [Math.random(), Math.random(), Math.random() * Math.PI * 2]);
    function size() {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    addEventListener("resize", size);
    const cols = [C.recalled, C.imagined, C.retold];
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let running = true;
    new IntersectionObserver((e) => (running = e[0].isIntersecting)).observe(cv);
    function frame(now) {
      requestAnimationFrame(frame);
      if (!running) return;
      const t = reduce ? 1 : Math.min(1, (now - t0) / 3200);
      const e = d3.easeCubicInOut(t);
      const mob = W < 700;
      const s = mob ? W * 0.92 : Math.min(W * 0.62, H * 0.95);
      const ox = mob ? (W - s) / 2 : W - s - W * 0.04, oy = mob ? H * 0.07 : (H - s) / 2;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = 0.75;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], sd = seeds[i];
        const wob = reduce ? 0 : Math.sin(now / 1400 + sd[2]) * 1.6;
        const x = (1 - e) * sd[0] * W + e * (ox + p[0] * s) + wob;
        const y = (1 - e) * sd[1] * H + e * (oy + p[1] * s) + Math.cos(now / 1700 + sd[2]) * 1.6 * (reduce ? 0 : 1);
        ctx.fillStyle = cols[p[2]];
        ctx.fillRect(x, y, 1.8, 1.8);
      }
    }
    requestAnimationFrame(frame);
  })();

  /* =========================================================== GAME */
  (function game() {
    const root = document.getElementById("gameRoot");
    const rounds = D.game.slice(0, 12);
    let i = 0, you = 0, model = 0, answered = false;
    const FK = ["perceptual", "concreteness", "properNouns", "time", "cognitive", "generic"];
    function pct(k, v) {
      const p = D.featPct[k]; // 5,25,50,75,95
      const xs = [5, 25, 50, 75, 95];
      if (v <= p[0]) return 3;
      if (v >= p[4]) return 97;
      for (let j = 0; j < 4; j++) if (v <= p[j + 1]) return xs[j] + ((v - p[j]) / (p[j + 1] - p[j] || 1)) * (xs[j + 1] - xs[j]);
      return 50;
    }
    function render() {
      if (i >= rounds.length) return finish();
      const r = rounds[i];
      answered = false;
      root.innerHTML = `<div class="card">
        <div class="game-meta"><span>Story ${i + 1} of ${rounds.length}</span><span>You ${you} · Model ${model}</span></div>
        <div class="game-text">“${r.t.replace(/</g, "&lt;")}”</div>
        <div class="game-btns">
          <button class="gbtn" data-g="recalled"><i class="sw rec"></i>Remembered</button>
          <button class="gbtn" data-g="imagined"><i class="sw img"></i>Imagined</button>
        </div>
        <div class="reveal" id="rev"></div></div>`;
      root.querySelectorAll(".gbtn[data-g]").forEach((b) => b.addEventListener("click", () => answer(b.dataset.g)));
    }
    function answer(g) {
      if (answered) return;
      answered = true;
      const r = rounds[i];
      const ok = g === r.g;
      const mg = r.p >= 0.5 ? "recalled" : "imagined";
      const mok = mg === r.g;
      you += ok; model += mok;
      root.querySelectorAll(".gbtn[data-g]").forEach((b) => { b.disabled = true; b.style.opacity = b.dataset.g === g ? 1 : 0.35; });
      const rev = root.querySelector("#rev");
      rev.innerHTML = `<div class="verdict">${ok ? "Correct." : "Not quite."} This was <span class="${r.g === "recalled" ? "rec" : "img"}">${r.g === "recalled" ? "a real memory" : "imagined"}</span>.</div>
        <div class="reveal-grid">
          <div>
            <div class="panel-title">Computer's guess: ${Math.round(r.p * 100)}% chance it's real. ${mok ? "It got this one right." : "It got this one wrong."}</div>
            <div class="meter"><i style="left:${r.p * 100}%"></i></div>
            <div class="meter-l"><span>sounds made up</span><span>sounds real</span></div>
            <p class="panel-note" style="margin-top:14px">What the story is about, in the writer's words: <i>${(r.e || "").replace(/</g, "&lt;")}</i></p>
          </div>
          <div>
            <div class="panel-title">This story compared with all stories <span style="color:var(--muted);font-weight:400">(middle line = average)</span></div>
            ${FK.map((k) => { const p = pct(k, r.f[k]); return `<div class="fbar"><span>${F[k].label}</span><span class="track"><u></u><i style="width:${p}%"></i></span></div>`; }).join("")}
          </div>
        </div>
        <div class="game-btns"><button class="gbtn next">${i + 1 < rounds.length ? "Next story →" : "See results →"}</button></div>`;
      rev.classList.add("on");
      root.querySelector(".game-meta span:last-child").textContent = `You ${you} · Model ${model}`;
      rev.querySelector(".next").addEventListener("click", () => { i++; render(); root.scrollIntoView({ behavior: "smooth", block: "start" }); });
    }
    function finish() {
      const n = rounds.length;
      root.innerHTML = `<div class="card">
        <div class="verdict" style="font-size:30px">You scored ${you}/${n}. The model scored ${model}/${n}.</div>
        <p style="color:var(--ink-2);font-size:15px">Most people do only a little better than flipping a coin at this. The computer looks for the same clues described on this page: real memories have more specific details (dates, numbers, names), and made-up stories have more "thinking out loud". Across all 5,535 real and made-up stories, it is right only ${Math.round(D.classifier.accFeatures * 100)}% of the time. Real memories and made-up stories really are hard to tell apart, and that is the point.</p>
        <div class="game-btns"><button class="gbtn" id="again">Play again with new stories</button><a class="gbtn next" href="#signature" style="text-decoration:none">See the evidence ↓</a></div></div>`;
      root.querySelector("#again").addEventListener("click", () => {
        d3.shuffle(D.game);
        rounds.splice(0, rounds.length, ...D.game.slice(0, 12));
        i = 0; you = 0; model = 0; render();
      });
    }
    render();
  })();

  /* =========================================================== FOREST (effect sizes) */
  let effMode = "ind";
  const forest = chart("forest", (el, W) => {
    const narrow = W < 600;
    const rows = D.effects.map((e) => {
      if (effMode === "ind") return { key: e.key, d: e.d, lo: e.lo, hi: e.hi, p: e.p, means: e.means };
      const pr = D.paired[e.key];
      const se = Math.sqrt(1 / pr.n + (pr.dz * pr.dz) / (2 * pr.n));
      return { key: e.key, d: pr.dz, lo: pr.dz - 1.96 * se, hi: pr.dz + 1.96 * se, p: pr.p, means: e.means, n: pr.n };
    }).sort((a, b) => a.d - b.d);
    const rh = 24, m = { t: 34, r: narrow ? 14 : 150, b: 34, l: narrow ? 108 : 150 };
    const H = m.t + m.b + rows.length * rh;
    const svg = svgIn(el, W, H);
    const x = d3.scaleLinear().domain([-0.5, 0.5]).range([m.l, W - m.r]);
    const y = d3.scaleBand().domain(rows.map((r) => r.key)).range([m.t, H - m.b]).padding(0.3);
    svg.append("g").attr("class", "gridline").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(narrow ? 5 : 10).tickSize(-(H - m.t - m.b)).tickFormat((d) => (d > 0 ? "+" : "") + d))
      .call((g) => g.selectAll("text").attr("class", "lbl-m").attr("dy", "1.2em"));
    svg.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t - 8).attr("y2", H - m.b);
    // shaded small-effect band
    svg.append("rect").attr("x", x(-0.2)).attr("width", x(0.2) - x(-0.2)).attr("y", m.t - 8).attr("height", H - m.b - m.t + 8).attr("fill", "#ffffff05");
    if (!narrow) svg.append("text").attr("class", "lbl-m").attr("x", x(0.2) - 4).attr("y", m.t - 14).attr("text-anchor", "end").text("small differences");
    svg.append("text").attr("class", "lbl-b").attr("x", W - m.r).attr("y", 14).attr("text-anchor", "end").attr("fill", C.recalled).text(narrow ? "real →" : "more in real memories →");
    svg.append("text").attr("class", "lbl-b").attr("x", m.l).attr("y", 14).attr("fill", C.imagined).text(narrow ? "← made up" : "← more in made-up stories");
    const g = svg.selectAll(".r").data(rows, (d) => d.key).join("g").attr("transform", (d) => `translate(0,${y(d.key) + y.bandwidth() / 2})`);
    g.append("text").attr("class", "lbl").attr("x", m.l - 12).attr("text-anchor", "end").attr("dy", "0.35em").text((d) => F[d.key].label);
    g.append("line").attr("x1", (d) => x(Math.max(-0.5, d.lo))).attr("x2", (d) => x(Math.min(0.5, d.hi))).attr("stroke", (d) => (d.d > 0 ? C.recalled : C.imagined)).attr("stroke-width", 2).attr("stroke-linecap", "round").attr("opacity", 0.55);
    g.append("circle").attr("cx", (d) => x(d.d)).attr("r", 5.5).attr("fill", (d) => (d.d > 0 ? C.recalled : C.imagined)).attr("stroke", css("--surface")).attr("stroke-width", 2)
      .attr("opacity", (d) => (d.lo > 0 || d.hi < 0 ? 1 : 0.35));
    if (!narrow) g.append("text").attr("class", "lbl-m").attr("x", W - m.r + 14).attr("dy", "0.35em").attr("opacity", (d) => (d.lo > 0 || d.hi < 0 ? 1 : 0.5)).text((d) => signed(d.d));
    g.append("rect").attr("x", 0).attr("width", W).attr("y", -rh / 2).attr("height", rh).attr("fill", "transparent")
      .on("mousemove", (ev, d) => {
        const mm = d.means;
        showTip(`<b>${F[d.key].label}</b><div style="color:var(--muted);margin-bottom:6px">${F[d.key].desc}</div>
          <div class="row"><span>Size of difference</span><b>${signed(d.d)}</b></div>
          <div class="row"><span>Reliable difference?</span><span>${pfmt(d.p)}</span></div>
          ${G.map((k) => `<div class="row"><span><i class="sw ${k.slice(0, 3)}"></i>${GL[k]} average</span><span>${f3(mm[k][0])}</span></div>`).join("")}`, ev);
      })
      .on("mouseleave", hideTip);
  });
  document.querySelectorAll("#effToggle button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#effToggle button").forEach((x) => x.classList.toggle("on", x === b));
    effMode = b.dataset.v; forest.render();
  }));

  /* =========================================================== FINGERPRINT */
  chart("fingerprint", (el, W) => {
    const mods = ["Visual", "Auditory", "Haptic", "Gustatory", "Olfactory", "Interoceptive"];
    const names = { Visual: "Sight", Auditory: "Sound", Haptic: "Touch", Gustatory: "Taste", Olfactory: "Smell", Interoceptive: "Inner body" };
    const m = { t: 20, r: 24, b: 36, l: 100 }, rh = 44, H = m.t + m.b + rh * mods.length;
    const svg = svgIn(el, W, H);
    const x = d3.scaleLinear().domain([-0.16, 0.16]).range([m.l, W - m.r]);
    svg.append("g").attr("class", "gridline").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(8).tickSize(-(H - m.t - m.b)).tickFormat((d) => (d > 0 ? "+" : "") + d)).selectAll("text").attr("class", "lbl-m");
    svg.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t).attr("y2", H - m.b);
    mods.forEach((md, i) => {
      const cy = m.t + rh * i + rh / 2;
      const vals = G.map((g) => D.fingerprint[g][md]);
      svg.append("line").attr("x1", x(d3.min(vals))).attr("x2", x(d3.max(vals))).attr("y1", cy).attr("y2", cy).attr("stroke", AXIS).attr("stroke-width", 2);
      svg.append("text").attr("class", "lbl").attr("x", m.l - 14).attr("y", cy).attr("dy", "0.35em").attr("text-anchor", "end").text(names[md]);
      G.forEach((g) => {
        svg.append("circle").attr("cx", x(D.fingerprint[g][md])).attr("cy", cy).attr("r", 7).attr("fill", C[g]).attr("stroke", css("--surface")).attr("stroke-width", 2)
          .on("mousemove", (ev) => showTip(`<b>${names[md]}</b> · ${GL[g]}<div class="row"><span>Compared with the average story</span><b>${D.fingerprint[g][md] >= 0 ? "more" : "less"} (${signed(D.fingerprint[g][md])})</b></div>`, ev)).on("mouseleave", hideTip);
      });
    });
    svg.append("text").attr("class", "lbl-m").attr("x", W - m.r).attr("y", H - 4).attr("text-anchor", "end").text("more than average →");
    svg.append("text").attr("class", "lbl-m").attr("x", m.l).attr("y", H - 4).text("← less than average");
  });

  /* =========================================================== DISTRIBUTIONS */
  const DK = ["perceptual", "concreteness", "cognitive", "generic", "time", "properNouns", "i", "words"];
  let distK = "concreteness";
  const seg = document.getElementById("distToggle");
  seg.innerHTML = DK.map((k) => `<button data-v="${k}" class="${k === distK ? "on" : ""}">${F[k].label}</button>`).join("");
  const dist = chart("dist", (el, W) => {
    const d = D.dist[distK];
    const H = isNarrow() ? 240 : 300, m = { t: 16, r: 16, b: 38, l: 16 };
    const svg = svgIn(el, W, H);
    const mids = d.bins.slice(0, -1).map((b, i) => (b + d.bins[i + 1]) / 2);
    const x = d3.scaleLinear().domain([d.bins[0], d.bins[d.bins.length - 1]]).range([m.l, W - m.r]);
    const ymax = d3.max(G, (g) => d3.max(d[g]));
    const y = d3.scaleLinear().domain([0, ymax * 1.08]).range([H - m.b, m.t]);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(8).tickSizeOuter(0)).selectAll("text").attr("class", "lbl-m");
    const area = d3.area().x((_, i) => x(mids[i])).y0(y(0)).y1((v) => y(v)).curve(d3.curveMonotoneX);
    const line = d3.line().x((_, i) => x(mids[i])).y((v) => y(v)).curve(d3.curveMonotoneX);
    ["retold", "imagined", "recalled"].forEach((g) => {
      svg.append("path").attr("d", area(d[g])).attr("fill", C[g]).attr("opacity", 0.1);
      svg.append("path").attr("d", line(d[g])).attr("fill", "none").attr("stroke", C[g]).attr("stroke-width", 2);
    });
    const eff = D.effects.find((e) => e.key === distK);
    G.forEach((g, j) => {
      const mu = eff.means[g][0];
      svg.append("line").attr("x1", x(mu)).attr("x2", x(mu)).attr("y1", m.t + 14).attr("y2", H - m.b).attr("stroke", C[g]).attr("stroke-width", 1).attr("opacity", 0.8);
    });
    svg.append("text").attr("class", "lbl-m").attr("x", W - m.r).attr("y", m.t + 4).attr("text-anchor", "end")
      .text(F[distK].desc);
    // hover crosshair
    const hl = svg.append("line").attr("stroke", INK2).attr("y1", m.t).attr("y2", H - m.b).attr("opacity", 0);
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
      .on("mousemove", (ev) => {
        const [mx] = d3.pointer(ev);
        const i = Math.max(0, Math.min(mids.length - 1, d3.bisectCenter(mids, x.invert(mx))));
        hl.attr("x1", x(mids[i])).attr("x2", x(mids[i])).attr("opacity", 0.6);
        showTip(`<b>${F[distK].label} ≈ ${f2(mids[i])}</b>${G.map((g) => `<div class="row"><span><i class="sw ${g.slice(0, 3)}"></i>${GL[g]}</span><span>${f3(d[g][i])}</span></div>`).join("")}<div style="color:var(--muted);margin-top:4px">higher = more stories have this score</div>`, ev);
      })
      .on("mouseleave", () => { hl.attr("opacity", 0); hideTip(); });
  });
  seg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    distK = b.dataset.v; dist.render();
  }));

  /* =========================================================== WORDS */
  chart("words", (el, W) => {
    const n = isNarrow() ? 18 : 28;
    const R = D.words.recalled.slice(0, n), I = D.words.imagined.slice(0, n);
    const rh = 19, m = { t: 30, b: 10 }, H = m.t + m.b + n * rh;
    const svg = svgIn(el, W, H);
    const half = W / 2, gap = isNarrow() ? 16 : 70;
    const zmax = d3.max([...R, ...I], (d) => Math.abs(d.z));
    const xl = d3.scaleLinear().domain([0, zmax]).range([0, half - gap / 2 - 82]);
    svg.append("text").attr("class", "lbl-b").attr("x", half - gap / 2).attr("y", 14).attr("text-anchor", "end").attr("fill", C.imagined).text("Made-up stories say…");
    svg.append("text").attr("class", "lbl-b").attr("x", half + gap / 2).attr("y", 14).attr("fill", C.recalled).text("…real memories say");
    const draw = (arr, side) => arr.forEach((d, i) => {
      const cy = m.t + i * rh;
      const w = xl(Math.abs(d.z));
      const xx = side < 0 ? half - gap / 2 - w : half + gap / 2;
      svg.append("rect").attr("x", xx).attr("y", cy + 3).attr("width", Math.max(w, 1)).attr("height", rh - 7).attr("rx", 3).attr("fill", side < 0 ? C.imagined : C.recalled).attr("opacity", 0.85)
        .on("mousemove", (ev) => showTip(`<b>“${d.w}”</b><div class="row"><span>How typical of this type</span><b>${f2(Math.abs(d.z))}</b></div><div class="row"><span>Times used in all stories</span><span>${fmt(d.f)}</span></div>`, ev)).on("mouseleave", hideTip);
      svg.append("text").attr("class", "lbl").attr("x", side < 0 ? xx - 6 : xx + w + 6).attr("y", cy + rh / 2).attr("dy", "0.3em").attr("text-anchor", side < 0 ? "end" : "start").text(d.w);
    });
    draw(I, -1); draw(R, 1);
    svg.append("line").attr("class", "zero").attr("x1", half).attr("x2", half).attr("y1", m.t).attr("y2", H - m.b).attr("opacity", 0.5);
  });

  /* =========================================================== SCROLLY MAP */
  (function mapScrolly() {
    const cv = document.getElementById("mapCanvas");
    const ctx = cv.getContext("2d");
    const pts = D.map;
    const TN = { concert: "Concerts & music", said: "Conversations", trip: "Travel", job: "Work & jobs", baby: "Births & babies", game: "Sports", doctor: "Hospitals & health", dog: "Pets", school: "School & graduation", car: "Cars & accidents", feel: "Feelings & life", wedding: "Weddings", birthday: "Birthdays", funeral: "Death & funerals", park: "The outdoors", house: "Home & moving" };
    const topics = D.topics.map((t) => ({ ...t, name: TN[t.terms[0]] || t.terms.slice(0, 2).join(" / ") }));
    const pcol = d3.scaleLinear().domain([0.15, 0.5, 0.85]).range([C.imagined, MID, C.recalled]).clamp(true);
    const gcol = [C.recalled, C.imagined, C.retold];
    let step = 0, from = 0, tStart = 0, W, H, S, ox, oy, qt, hover = -1;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    function size() {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      S = Math.min(W, H - 40) * 0.96; ox = (W - S) / 2; oy = (H - 40 - S) / 2;
      qt = d3.quadtree().x((d) => ox + d[0] * S).y((d) => oy + d[1] * S).addAll(pts.map((p, i) => [...p, i]));
      topics.forEach((t) => {
        const mine = pts.filter((p) => p[3] === t.id);
        t.cx = ox + d3.median(mine, (p) => p[0]) * S; t.cy = oy + d3.median(mine, (p) => p[1]) * S;
      });
      // nudge labels apart so none overlap (widths sized for the longer step-4 labels)
      const fs = S > 500 ? 7.2 : 6.1;
      topics.forEach((t) => (t.lw = (t.name.length + 7) * fs + 14));
      for (let it = 0; it < 60; it++) {
        for (let a = 0; a < topics.length; a++) for (let b = a + 1; b < topics.length; b++) {
          const A = topics[a], B = topics[b];
          const ox_ = (A.lw + B.lw) / 2 - Math.abs(A.cx - B.cx), oy_ = 30 - Math.abs(A.cy - B.cy);
          if (ox_ > 0 && oy_ > 0) {
            if (ox_ < oy_ * 1.5) { const d = (A.cx < B.cx ? -1 : 1) * ox_ / 2; A.cx += d; B.cx -= d; }
            else { const d = (A.cy < B.cy ? -1 : 1) * oy_ / 2; A.cy += d; B.cy -= d; }
          }
        }
      }
    }
    size();
    addEventListener("resize", () => { size(); draw(1); });
    function colorFor(p, s) {
      if (s === 0) return "#6d6d74";
      if (s === 1) return gcol[p[2]];
      if (s === 2 || s === 4) return "#4a4a50";
      return pcol(p[4]);
    }
    function draw(e) {
      ctx.clearRect(0, 0, W, H);
      const r = S > 500 ? 2.1 : 1.7;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const a = d3.color(colorFor(p, from)), b = d3.color(colorFor(p, step));
        ctx.fillStyle = d3.interpolateRgb(a, b)(e);
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.arc(ox + p[0] * S, oy + p[1] * S, r, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (step === 2 || step === 4) {
        ctx.font = `500 ${S > 500 ? 12.5 : 10.5}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        topics.forEach((t) => {
          let label = t.name;
          if (step === 4) label += `  ${t.gap.concreteness >= 0 ? "+" : "−"}${Math.abs(t.gap.concreteness).toFixed(2)}`;
          const w = ctx.measureText(label).width + 14;
          ctx.globalAlpha = e;
          ctx.fillStyle = "#141416e6"; ctx.strokeStyle = "rgba(255,255,255,.12)";
          ctx.beginPath(); ctx.roundRect(t.cx - w / 2, t.cy - 11, w, 22, 11); ctx.fill(); ctx.stroke();
          ctx.fillStyle = step === 4 ? d3.interpolateRgb(MID, C.recalled)(Math.min(1, 0.35 + t.gap.concreteness * 1.8)) : "#f4f3ee";
          if (step === 4) ctx.fillStyle = "#f4f3ee";
          ctx.fillText(label, t.cx, t.cy + 4);
          if (step === 4) { // concreteness gap as a bar under label
            ctx.fillStyle = C.recalled;
            ctx.fillRect(t.cx - w / 2 + 7, t.cy + 13, Math.max(2, (w - 14) * Math.min(1, t.gap.concreteness / 0.4)), 3);
          }
        });
        ctx.globalAlpha = 1;
      }
      if (hover >= 0) {
        const p = pts[hover];
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ox + p[0] * S, oy + p[1] * S, 6, 0, 7); ctx.stroke();
      }
    }
    function animate() {
      const now = performance.now();
      const e = d3.easeCubicInOut(Math.min(1, (now - tStart) / 700));
      draw(e);
      if (e < 1) requestAnimationFrame(animate); else from = step;
    }
    function setStep(s) {
      if (s === step) return;
      from = step; step = s; tStart = performance.now(); requestAnimationFrame(animate);
      const lg = document.getElementById("mapLegend");
      lg.innerHTML = s === 1 ? `<span><i class="sw rec"></i>Remembered</span><span><i class="sw img"></i>Imagined</span><span><i class="sw ret"></i>Retold</span>`
        : s === 3 ? `<span>sounds made up</span><span class="grad"></span><span>sounds real</span>`
        : s === 4 ? `<span>Number = how much more concrete the real stories are than the made-up ones</span>` : `<span>${fmt(pts.length)} stories</span>`;
    }
    setStep(0); document.getElementById("mapLegend").innerHTML = `<span>${fmt(pts.length)} stories</span>`; draw(1);
    const steps = document.querySelectorAll("#scrolly .step");
    const sio = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { steps.forEach((s) => s.classList.toggle("on", s === e.target)); setStep(+e.target.dataset.step); }
    }), { rootMargin: "-45% 0px -45% 0px" });
    steps.forEach((s) => sio.observe(s));
    cv.addEventListener("mousemove", (ev) => {
      const rct = cv.getBoundingClientRect();
      const f = qt.find(ev.clientX - rct.left, ev.clientY - rct.top, 10);
      if (!f) { hover = -1; hideTip(); draw(1); return; }
      hover = f[6];
      const t = topics[f[3]];
      showTip(`<b>${(f[5] || "(no description)").replace(/</g, "&lt;")}</b>
        <div class="row" style="margin-top:6px"><span><i class="sw ${["rec", "img", "ret"][f[2]]}"></i>${GL[G[f[2]]]}</span><span>${t.name}</span></div>
        <div class="row"><span>Computer's guess: chance it's real</span><b>${Math.round(f[4] * 100)}%</b></div>`, ev);
      draw(1);
    });
    cv.addEventListener("mouseleave", () => { hover = -1; hideTip(); draw(1); });
  })();

  /* =========================================================== TOPIC HEATMAP */
  chart("topicHeat", (el, W) => {
    const TN = { concert: "Concerts & music", said: "Conversations", trip: "Travel", job: "Work & jobs", baby: "Births & babies", game: "Sports", doctor: "Hospitals & health", dog: "Pets", school: "School & graduation", car: "Cars & accidents", feel: "Feelings & life", wedding: "Weddings", birthday: "Birthdays", funeral: "Death & funerals", park: "The outdoors", house: "Home & moving" };
    const cols = ["concreteness", "perceptual", "time", "properNouns", "generic", "cognitive"];
    const rows = D.topics.map((t) => ({ ...t, name: TN[t.terms[0]] })).sort((a, b) => b.gap.concreteness - a.gap.concreteness);
    const narrow = W < 640;
    const m = { t: 54, r: 10, b: 10, l: narrow ? 120 : 160 }, mixW = narrow ? 70 : 150, rh = 30;
    const H = m.t + m.b + rows.length * rh;
    const svg = svgIn(el, W, H);
    const cw = (W - m.l - m.r - mixW - 20) / cols.length;
    const col = d3.scaleDiverging().domain([-0.6, 0, 0.6]).interpolator((t) => (t < 0.5 ? d3.interpolateRgb(C.imagined, MID)(t * 2) : d3.interpolateRgb(MID, C.recalled)((t - 0.5) * 2))).clamp(true);
    cols.forEach((k, j) => svg.append("text").attr("class", "lbl-m").attr("x", m.l + j * cw + cw / 2).attr("y", m.t - 12).attr("text-anchor", "middle").text(narrow ? F[k].label.split(" ")[0] : F[k].label));
    svg.append("text").attr("class", "lbl-m").attr("x", W - m.r - mixW).attr("y", m.t - 12).text("story mix");
    rows.forEach((t, i) => {
      const y = m.t + i * rh;
      svg.append("text").attr("class", "lbl").attr("x", m.l - 10).attr("y", y + rh / 2).attr("dy", "0.35em").attr("text-anchor", "end").text(t.name);
      cols.forEach((k, j) => {
        const v = t.gap[k];
        svg.append("rect").attr("x", m.l + j * cw + 1).attr("y", y + 1).attr("width", cw - 2).attr("height", rh - 2).attr("rx", 4).attr("fill", col(v))
          .on("mousemove", (ev) => showTip(`<b>${t.name}</b> · ${F[k].label}<div class="row"><span>Difference</span><b>${signed(v)}</b></div><div style="color:var(--muted)">${v >= 0 ? "more in real memories" : "more in made-up stories"}</div><div class="row"><span>Stories in this topic</span><span>${fmt(t.n)}</span></div><div style="color:var(--muted);margin-top:4px">Common words: ${t.terms.slice(0, 6).join(", ")}</div>`, ev)).on("mouseleave", hideTip);
        if (!narrow || Math.abs(v) > 0.3) svg.append("text").attr("x", m.l + j * cw + cw / 2).attr("y", y + rh / 2).attr("dy", "0.35em").attr("text-anchor", "middle").attr("fill", "#f4f3ee").attr("font-size", 11).attr("pointer-events", "none").text(signed(v));
      });
      let x0 = W - m.r - mixW;
      G.forEach((g) => {
        const w = (t.mix[g] / t.n) * (mixW - 4);
        svg.append("rect").attr("x", x0).attr("y", y + 9).attr("width", Math.max(0, w - 2)).attr("height", rh - 18).attr("rx", 2).attr("fill", C[g])
          .on("mousemove", (ev) => showTip(`<b>${t.name}</b><div class="row"><span>${GL[g]}</span><b>${t.mix[g]} (${Math.round((100 * t.mix[g]) / t.n)}%)</b></div>`, ev)).on("mouseleave", hideTip);
        x0 += w;
      });
    });
  });

  /* =========================================================== RETELLING */
  chart("simHist", (el, W) => {
    const s = D.retell.simHist;
    const H = 260, m = { t: 16, r: 16, b: 38, l: 16 };
    const svg = svgIn(el, W, H);
    const mids = s.bins.slice(0, -1).map((b, i) => (b + s.bins[i + 1]) / 2);
    const x = d3.scaleLinear().domain([0, 0.8]).range([m.l, W - m.r]);
    const keys = [["random", "#6b6b70", "Random pairs"], ["imagined", C.imagined, "Imagined vs. its source"], ["retold", C.retold, "Retold vs. original"]];
    const ymax = d3.max(keys, ([k]) => d3.max(s[k]));
    const y = d3.scaleSqrt().domain([0, ymax]).range([H - m.b, m.t]);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(8).tickSizeOuter(0)).selectAll("text").attr("class", "lbl-m");
    keys.forEach(([k, c]) => {
      const pts = mids.map((mm, i) => [mm, s[k][i]]).filter((p) => p[0] <= 0.8);
      svg.append("path").attr("d", d3.area().x((p) => x(p[0])).y0(y(0)).y1((p) => y(p[1])).curve(d3.curveBasis)(pts)).attr("fill", c).attr("opacity", 0.12);
      svg.append("path").attr("d", d3.line().x((p) => x(p[0])).y((p) => y(p[1])).curve(d3.curveBasis)(pts)).attr("fill", "none").attr("stroke", c).attr("stroke-width", 2);
      const md = D.retell.simMedian[k];
      svg.append("line").attr("x1", x(md)).attr("x2", x(md)).attr("y1", m.t + 20).attr("y2", H - m.b).attr("stroke", c).attr("stroke-width", 1);
      svg.append("text").attr("class", "lbl-m").attr("x", x(md) + 4).attr("y", m.t + 26).text("typical: " + f2(md));
    });
    svg.append("text").attr("class", "lbl-m").attr("x", W - m.r).attr("y", H - 4).attr("text-anchor", "end").text("more shared wording →");
  });

  function ciChart(id, obj, xlab) {
    chart(id, (el, W) => {
      const ks = Object.keys(obj).map(Number).sort();
      const H = 220, m = { t: 14, r: 16, b: 40, l: 44 };
      const svg = svgIn(el, W, H);
      const x = d3.scalePoint().domain(ks).range([m.l + 20, W - m.r - 20]);
      const y = d3.scaleLinear().domain([0.6, 0.78]).range([H - m.b, m.t]);
      svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r))).selectAll("text").attr("class", "lbl-m");
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickSizeOuter(0)).selectAll("text").attr("class", "lbl-m");
      svg.append("text").attr("class", "lbl-m").attr("x", (m.l + W - m.r) / 2).attr("y", H - 4).attr("text-anchor", "middle").text(xlab);
      svg.append("text").attr("class", "lbl-m").attr("transform", `translate(11,${(m.t + H - m.b) / 2}) rotate(-90)`).attr("text-anchor", "middle").text("amount of change");
      svg.append("path").attr("d", d3.line().x((k) => x(k)).y((k) => y(obj[k][0]))(ks)).attr("fill", "none").attr("stroke", C.retold).attr("stroke-width", 2);
      ks.forEach((k) => {
        const [mu, lo, hi] = obj[k];
        svg.append("line").attr("x1", x(k)).attr("x2", x(k)).attr("y1", y(lo)).attr("y2", y(hi)).attr("stroke", C.retold).attr("stroke-width", 2).attr("opacity", 0.5).attr("stroke-linecap", "round");
        svg.append("circle").attr("cx", x(k)).attr("cy", y(mu)).attr("r", 6).attr("fill", C.retold).attr("stroke", css("--surface")).attr("stroke-width", 2)
          .on("mousemove", (ev) => showTip(`<b>${xlab} = ${k}</b><div class="row"><span>Average amount of change</span><b>${f2(mu)}</b></div><div class="row"><span>Margin of error</span><span>${f2(lo)} to ${f2(hi)}</span></div><div style="color:var(--muted);margin-top:4px">0 = identical wording, 1 = nothing in common</div>`, ev)).on("mouseleave", hideTip);
      });
    });
  }
  ciChart("driftFreq", D.retell.driftByFreq, "How often they think about it (1–5)");
  ciChart("driftImp", D.retell.driftByImportance, "How important it was (1–5)");

  function barChart(id, rows, opts) {
    chart(id, (el, W) => {
      const narrow = W < 600;
      const rh = 26, m = { t: 10, r: narrow ? 50 : 90, b: 30, l: narrow ? 140 : 210 }, H = m.t + m.b + rows.length * rh;
      const svg = svgIn(el, W, H);
      const ext = d3.max(rows, (r) => Math.abs(r.v)) * 1.35;
      const x = d3.scaleLinear().domain([-ext, ext]).range([m.l, W - m.r]);
      svg.append("g").attr("class", "gridline").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickSize(-(H - m.t - m.b))).selectAll("text").attr("class", "lbl-m");
      svg.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t).attr("y2", H - m.b);
      rows.forEach((r, i) => {
        const y = m.t + i * rh;
        svg.append("text").attr("class", "lbl").attr("x", m.l - 10).attr("y", y + rh / 2).attr("dy", "0.35em").attr("text-anchor", "end").text(r.label);
        const x0 = x(Math.min(0, r.v)), w = Math.abs(x(r.v) - x(0));
        svg.append("rect").attr("x", x0).attr("y", y + 5).attr("width", Math.max(w, 1)).attr("height", rh - 10).attr("rx", 3)
          .attr("fill", opts.color(r)).attr("opacity", r.p < 0.01 ? 1 : 0.3)
          .on("mousemove", (ev) => showTip(`<b>${r.label}</b><div class="row"><span>${opts.stat}</span><b>${signed(r.v, f3)}</b></div><div class="row"><span>Reliable?</span><span>${pfmt(r.p)}</span></div>${r.extra || ""}`, ev)).on("mouseleave", hideTip);
        svg.append("text").attr("class", "lbl-m").attr("x", r.v >= 0 ? x(r.v) + 6 : x(r.v) - 6).attr("y", y + rh / 2).attr("dy", "0.35em").attr("text-anchor", r.v >= 0 ? "start" : "end").text(signed(r.v));
      });
    });
  }
  const dp = Object.values(D.retell.driftPredictors).map((d) => ({ label: d.label, v: d.r, p: d.p, extra: `<div class="row"><span>People</span><span>${fmt(d.n)}</span></div>` })).sort((a, b) => b.v - a.v);
  barChart("driftPred", dp, { stat: "Strength of link (−1 to +1)", color: (r) => (r.v >= 0 ? C.retold : "#8a8983") });
  const rd = D.retell.deltas.map((d) => ({ label: F[d.key].label, v: d.dz, p: d.p, extra: `<div class="row"><span>Second tellings with more of this</span><span>${Math.round(d.pctUp * 100)}%</span></div>` })).sort((a, b) => a.v - b.v);
  barChart("retDelta", rd, { stat: "Change from first to second telling", color: (r) => (r.v >= 0 ? C.retold : "#8a8983") });

  const ps = D.retell.pRecShift;
  document.getElementById("retTiles").innerHTML = `
    <div class="tile"><div class="n ret">${fmt(D.retell.n)}</div><div class="l">people who told the same memory twice, months apart</div></div>
    <div class="tile"><div class="n">${Math.round(ps.pctMoreImagined * 100)}%</div><div class="l">of second tellings sounded <b>more made up</b> than the first telling, according to the computer model</div></div>
    <div class="tile"><div class="n">#1</div><div class="l">Sensory detail in the first telling was the <b>strongest sign</b> that a memory would stay the same</div></div>`;

  /* =========================================================== AGE */
  (function ageGrid() {
    const host = document.getElementById("ageGrid");
    const K = ["perceptual", "concreteness", "cognitive", "generic", "diversity", "properNouns", "time", "words"];
    const B = D.age.buckets;
    const lab = ["18", "25", "30", "35", "40", "45", "50", "55+"];
    K.forEach((k) => {
      const div = document.createElement("div");
      div.className = "card";
      const mdl = D.age.series[k].model;
      const par = mdl.interactionP >= 0.05;
      div.innerHTML = `<div class="panel-title">${F[k].label}</div><div class="panel-note">${par ? "<span style='color:var(--ink-2)'>✓ Lines move together</span>" : "<span style='color:var(--gold)'>✕ Lines move differently</span>"}</div><div class="chart" id="age_${k}"></div>`;
      host.appendChild(div);
      chart("age_" + k, (el, W) => {
        const H = 170, m = { t: 12, r: 8, b: 24, l: 38 };
        const svg = svgIn(el, W, H);
        const s = D.age.series[k];
        const x = d3.scalePoint().domain(B).range([m.l + 6, W - m.r - 6]);
        const all = ["recalled", "imagined"].flatMap((g) => s[g].flatMap((p) => [p.lo, p.hi]));
        const y = d3.scaleLinear().domain(d3.extent(all)).nice(4).range([H - m.b, m.t]);
        svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r))).selectAll("text").attr("class", "lbl-m");
        svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickFormat((d, i) => ([0, 2, 4, 7].includes(i) || W > 260 ? lab[i] : "")).tickSizeOuter(0)).selectAll("text").attr("class", "lbl-m");
        ["imagined", "recalled"].forEach((g) => {
          svg.append("path").attr("d", d3.area().x((_, i) => x(B[i])).y0((p) => y(p.lo)).y1((p) => y(p.hi)).curve(d3.curveMonotoneX)(s[g])).attr("fill", C[g]).attr("opacity", 0.14);
          svg.append("path").attr("d", d3.line().x((_, i) => x(B[i])).y((p) => y(p.m)).curve(d3.curveMonotoneX)(s[g])).attr("fill", "none").attr("stroke", C[g]).attr("stroke-width", 2);
          s[g].forEach((p, i) => svg.append("circle").attr("cx", x(B[i])).attr("cy", y(p.m)).attr("r", 3).attr("fill", C[g]));
        });
        const hl = svg.append("line").attr("stroke", INK2).attr("y1", m.t).attr("y2", H - m.b).attr("opacity", 0);
        svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
          .on("mousemove", (ev) => {
            const [mx] = d3.pointer(ev);
            const i = d3.minIndex(B, (b) => Math.abs(x(b) - mx));
            hl.attr("x1", x(B[i])).attr("x2", x(B[i])).attr("opacity", 0.5);
            showTip(`<b>Age ${lab[i]}${i < 7 ? "–" + (B[i + 1] - 1) : ""}</b>${["recalled", "imagined"].map((g) => `<div class="row"><span><i class="sw ${g.slice(0, 3)}"></i>${GL[g]}</span><span>${f3(s[g][i].m)} (n=${s[g][i].n})</span></div>`).join("")}`, ev);
          })
          .on("mouseleave", () => { hl.attr("opacity", 0); hideTip(); });
      });
    });
  })();

  /* =========================================================== CORRELATION ATLAS */
  let corrG = "recalled";
  const divCol = d3.scaleDiverging().domain([-0.35, 0, 0.35]).interpolator((t) => (t < 0.5 ? d3.interpolateRgb("#e66767", MID)(t * 2) : d3.interpolateRgb(MID, C.recalled)((t - 0.5) * 2))).clamp(true);
  const corr = chart("corrHeat", (el, W) => {
    const c = D.corr, rows = c.rows, cols = c.cols, data = c.data[corrG];
    const narrow = W < 640;
    const m = { t: narrow ? 96 : 110, r: 10, b: 40, l: narrow ? 104 : 130 };
    const cw = (W - m.l - m.r) / cols.length, rh = narrow ? 18 : 22;
    const H = m.t + m.b + rows.length * rh;
    const svg = svgIn(el, W, H);
    cols.forEach((cl, j) => svg.append("text").attr("class", "lbl-m").attr("transform", `translate(${m.l + j * cw + cw / 2},${m.t - 8}) rotate(-45)`).text(cl));
    rows.forEach((rk, i) => {
      const y = m.t + i * rh;
      svg.append("text").attr("class", "lbl").attr("x", m.l - 8).attr("y", y + rh / 2).attr("dy", "0.35em").attr("text-anchor", "end").attr("font-size", narrow ? 10.5 : 12).text(F[rk].label);
      cols.forEach((cl, j) => {
        const v = data[i][j];
        const rect = svg.append("rect").attr("x", m.l + j * cw + 1).attr("y", y + 1).attr("width", cw - 2).attr("height", rh - 2).attr("rx", 3);
        if (!v) { rect.attr("fill", "#1c1c20"); return; }
        rect.attr("fill", divCol(v[0])).attr("opacity", v[1] < 0.001 ? 1 : 0.28)
          .on("mousemove", (ev) => showTip(`<b>${F[rk].label}</b> × <b>${cl}</b><div style="color:var(--muted)">${GL[corrG]} stories</div><div class="row"><span>Strength of link (−1 to +1)</span><b>${signed(v[0])}</b></div><div class="row"><span>Reliable?</span><span>${pfmt(v[1])}</span></div><div class="row"><span>Stories</span><span>${fmt(v[2])}</span></div>`, ev))
          .on("mouseleave", hideTip);
        if (!narrow && v[1] < 0.001 && Math.abs(v[0]) >= 0.1) svg.append("text").attr("x", m.l + j * cw + cw / 2).attr("y", y + rh / 2).attr("dy", "0.35em").attr("text-anchor", "middle").attr("font-size", 10).attr("fill", "#f4f3ee").attr("pointer-events", "none").text(signed(v[0]).replace("0.", "."));
      });
    });
    // legend
    const lw = Math.min(220, W * 0.5), lx = W - m.r - lw, ly = H - 22;
    const defs = svg.append("defs").append("linearGradient").attr("id", "cg");
    d3.range(0, 1.01, 0.1).forEach((t) => defs.append("stop").attr("offset", t).attr("stop-color", divCol(-0.35 + t * 0.7)));
    svg.append("rect").attr("x", lx).attr("y", ly).attr("width", lw).attr("height", 8).attr("rx", 4).attr("fill", "url(#cg)");
    svg.append("text").attr("class", "lbl-m").attr("x", lx).attr("y", ly + 22).text("−.35");
    svg.append("text").attr("class", "lbl-m").attr("x", lx + lw / 2).attr("y", ly + 22).attr("text-anchor", "middle").text("0");
    svg.append("text").attr("class", "lbl-m").attr("x", lx + lw).attr("y", ly + 22).attr("text-anchor", "end").text("+.35");
    const nsig = data.flat().filter((v) => v && v[1] < 0.001).length;
    svg.append("text").attr("class", "lbl-m").attr("x", m.l).attr("y", ly + 8).text(`${nsig} of ${rows.length * cols.length} squares show a reliable link`);
  });
  document.querySelectorAll("#corrToggle button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#corrToggle button").forEach((x) => x.classList.toggle("on", x === b));
    corrG = b.dataset.v; corr.render();
  }));

  chart("featHeat", (el, W) => {
    const K = D.featCorr.keys, Mx = D.featCorr.m;
    const narrow = W < 640;
    const m = { t: 10, r: 10, b: narrow ? 90 : 110, l: narrow ? 96 : 120 };
    const n = K.length, cs = Math.min(26, (W - m.l - m.r) / n);
    const H = m.t + m.b + n * cs;
    const svg = svgIn(el, W, H);
    const col = d3.scaleDiverging().domain([-0.8, 0, 0.8]).interpolator((t) => (t < 0.5 ? d3.interpolateRgb("#e66767", MID)(t * 2) : d3.interpolateRgb(MID, C.recalled)((t - 0.5) * 2))).clamp(true);
    for (let i = 0; i < n; i++) {
      svg.append("text").attr("class", "lbl").attr("font-size", narrow ? 10 : 11.5).attr("x", m.l - 6).attr("y", m.t + i * cs + cs / 2).attr("dy", "0.35em").attr("text-anchor", "end").text(F[K[i]].label);
      svg.append("text").attr("class", "lbl-m").attr("font-size", narrow ? 9.5 : 11).attr("transform", `translate(${m.l + i * cs + cs / 2 + 3},${m.t + n * cs + 6}) rotate(-60)`).attr("text-anchor", "end").text(F[K[i]].label);
      for (let j = 0; j <= i; j++) {
        const v = Mx[i][j];
        svg.append("rect").attr("x", m.l + j * cs + 1).attr("y", m.t + i * cs + 1).attr("width", cs - 2).attr("height", cs - 2).attr("rx", 2)
          .attr("fill", i === j ? "#2a2a2f" : col(v))
          .on("mousemove", (ev) => i !== j && showTip(`<b>${F[K[i]].label}</b> × <b>${F[K[j]].label}</b><div class="row"><span>Strength of link (−1 to +1)</span><b>${signed(v)}</b></div>`, ev))
          .on("mouseleave", hideTip);
      }
    }
  });

  chart("eventArc", (el, W) => {
    const H = 230, m = { t: 14, r: 16, b: 40, l: 44 };
    const svg = svgIn(el, W, H);
    const x = d3.scaleLinear().domain([0, 9]).range([m.l, W - m.r]);
    const vals = G.flatMap((g) => D.eventArc[g].minorBin);
    const y = d3.scaleLinear().domain([0, d3.max(vals) * 1.15]).nice().range([H - m.b, m.t]);
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5, "%").tickSize(-(W - m.l - m.r))).selectAll("text").attr("class", "lbl-m");
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues([0, 9]).tickFormat((d) => (d === 0 ? "start" : "end")).tickSizeOuter(0)).selectAll("text").attr("class", "lbl-m");
    svg.append("text").attr("class", "lbl-m").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text("position in the story");
    G.forEach((g) => {
      const v = D.eventArc[g].minorBin;
      svg.append("path").attr("d", d3.line().x((_, i) => x(i)).y((d) => y(d)).curve(d3.curveMonotoneX)(v)).attr("fill", "none").attr("stroke", C[g]).attr("stroke-width", 2);
    });
    const hl = svg.append("line").attr("stroke", INK2).attr("y1", m.t).attr("y2", H - m.b).attr("opacity", 0);
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
      .on("mousemove", (ev) => {
        const i = Math.round(x.invert(d3.pointer(ev)[0]));
        const ii = Math.max(0, Math.min(9, i));
        hl.attr("x1", x(ii)).attr("x2", x(ii)).attr("opacity", 0.5);
        showTip(`<b>Part ${ii + 1} of 10 of the story</b>${G.map((g) => `<div class="row"><span><i class="sw ${g.slice(0, 3)}"></i>${GL[g]}</span><span>${d3.format(".1%")(D.eventArc[g].minorBin[ii])}</span></div>`).join("")}`, ev);
      })
      .on("mouseleave", () => { hl.attr("opacity", 0); hideTip(); });
  });

  document.getElementById("clfTiles").innerHTML = `
    <div class="tile"><div class="n">${Math.round(D.classifier.accFeatures * 100)}%</div><div class="l">right, using only the 25 measures on this page</div></div>
    <div class="tile"><div class="n">${Math.round(D.classifier.accText * 100)}%</div><div class="l">right, using every word in the story</div><div class="s">a little inflated by words from the instructions</div></div>
    <div class="tile"><div class="n">50%</div><div class="l">what you'd get by flipping a coin</div></div>`;

  chart("pRecHist", (el, W) => {
    const H = 220, m = { t: 14, r: 16, b: 40, l: 16 };
    const svg = svgIn(el, W, H);
    const x = d3.scaleLinear().domain([0, 1]).range([m.l, W - m.r]);
    const mids = d3.range(25).map((i) => (i + 0.5) / 25);
    const y = d3.scaleLinear().domain([0, d3.max(G, (g) => d3.max(D.pRecHist[g])) * 1.08]).range([H - m.b, m.t]);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5, "%").tickSizeOuter(0)).selectAll("text").attr("class", "lbl-m");
    svg.append("text").attr("class", "lbl-m").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text("computer's guess: chance the story is a real memory");
    svg.append("line").attr("class", "zero").attr("x1", x(0.5)).attr("x2", x(0.5)).attr("y1", m.t).attr("y2", H - m.b);
    ["retold", "imagined", "recalled"].forEach((g) => {
      svg.append("path").attr("d", d3.area().x((_, i) => x(mids[i])).y0(y(0)).y1((d) => y(d)).curve(d3.curveBasis)(D.pRecHist[g])).attr("fill", C[g]).attr("opacity", 0.1);
      svg.append("path").attr("d", d3.line().x((_, i) => x(mids[i])).y((d) => y(d)).curve(d3.curveBasis)(D.pRecHist[g])).attr("fill", "none").attr("stroke", C[g]).attr("stroke-width", 2);
    });
  });

  /* =========================================================== methods table */
  document.querySelector("#featTable tbody").innerHTML = Object.entries(F).map(([k, v]) => `<tr><td>${v.label}</td><td>${v.desc}</td></tr>`).join("");

  /* nav highlight */
  const navLinks = [...document.querySelectorAll(".topbar nav a")];
  const nio = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) navLinks.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id));
  }), { rootMargin: "-40% 0px -55% 0px" });
  navLinks.forEach((a) => { const s = document.querySelector(a.getAttribute("href")); if (s) nio.observe(s); });
  const scr = document.getElementById("scrolly");
  new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) navLinks.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#map"));
  }), { rootMargin: "-40% 0px -55% 0px" }).observe(scr);
})();
