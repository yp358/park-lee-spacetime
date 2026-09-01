/* Kleio — Figures: a small interactive figure canvas in the spirit of
 * 3blue1brown, with the immediacy of Desmos. Type a complex- or real-valued
 * expression, drag the plane, scrub the parameter, animate the sliders.
 * Everything is hand-rolled SVG so it works against the stdlib server with no
 * network — the same constraint the rest of the front end keeps.
 *
 * The default construction is Euler's formula: e^(iθ) tracing the unit circle,
 * with its shadows on the axes — cos θ and sin θ.
 *
 * The module exposes window.KleioFigures.render(container). app.js owns the
 * route and the nav item; this file owns everything inside the view.
 */
(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const STORE = "kleio.figures.v2";
  const COLORS = ["#20548c", "#5b4e88", "#2f7d75", "#8a6d1f", "#a33a34", "#3f7a53"];
  const reduceMotion = !!(window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ---------- complex arithmetic -------------------------------------- */
  const cx = (re, im) => ({ re: re, im: im || 0 });
  const add = (a, b) => cx(a.re + b.re, a.im + b.im);
  const sub = (a, b) => cx(a.re - b.re, a.im - b.im);
  const mul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  const div = (a, b) => {
    const d = b.re * b.re + b.im * b.im;
    return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  };
  const neg = (a) => cx(-a.re, -a.im);
  const modC = (a) => Math.hypot(a.re, a.im);
  const argC = (a) => Math.atan2(a.im, a.re);
  const expC = (a) => { const m = Math.exp(a.re); return cx(m * Math.cos(a.im), m * Math.sin(a.im)); };
  const logC = (a) => cx(Math.log(modC(a)), argC(a));
  const powC = (a, b) => {
    if (a.re === 0 && a.im === 0) return (b.re === 0 && b.im === 0) ? cx(1, 0) : cx(0, 0);
    return expC(mul(b, logC(a)));
  };
  const sinC = (a) => cx(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
  const cosC = (a) => cx(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));
  const sinhC = (a) => cx(Math.sinh(a.re) * Math.cos(a.im), Math.cosh(a.re) * Math.sin(a.im));
  const coshC = (a) => cx(Math.cosh(a.re) * Math.cos(a.im), Math.sinh(a.re) * Math.sin(a.im));

  const FUNCS = {
    sin: sinC, cos: cosC, tan: (a) => div(sinC(a), cosC(a)),
    sinh: sinhC, cosh: coshC, tanh: (a) => div(sinhC(a), coshC(a)),
    exp: expC, ln: logC, log: logC, sqrt: (a) => powC(a, cx(0.5, 0)),
    abs: (a) => cx(modC(a), 0), re: (a) => cx(a.re, 0), im: (a) => cx(a.im, 0),
    arg: (a) => cx(argC(a), 0), conj: (a) => cx(a.re, -a.im),
    sign: (a) => { const m = modC(a); return m === 0 ? cx(0, 0) : cx(a.re / m, a.im / m); },
  };
  const CONSTS = { pi: Math.PI, "π": Math.PI, tau: TAU, "τ": TAU, e: Math.E };
  const RESERVED = new Set(["t", "x", "y", "i"].concat(Object.keys(CONSTS), Object.keys(FUNCS)));

  /* ---------- expression parser -------------------------------------- */
  /* tokenise -> insert implicit '*' -> wrap bare-word function calls ->
   * shunting-yard to RPN -> a closure over a {t|x|param} scope. Complex
   * throughout; a real result is just im ≈ 0. */
  function tokenize(src) {
    const s = String(src)
      .replace(/[−]/g, "-").replace(/[·×]/g, "*").replace(/÷/g, "/")
      .replace(/theta|ϑ|θ/gi, "t");
    const out = [];
    let i = 0;
    const digit = (c) => c >= "0" && c <= "9";
    const alpha = (c) => /[a-zA-Z_]/.test(c) || c.charCodeAt(0) > 127;
    while (i < s.length) {
      const c = s[i];
      if (c === " " || c === "\t") { i++; continue; }
      if (digit(c) || (c === "." && digit(s[i + 1]))) {
        let j = i + 1;
        while (j < s.length && (digit(s[j]) || s[j] === ".")) j++;
        out.push({ t: "num", v: parseFloat(s.slice(i, j)) }); i = j; continue;
      }
      if (alpha(c)) {
        if (c.charCodeAt(0) > 127) { out.push({ t: "name", v: c }); i++; continue; }
        let j = i + 1;
        while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
        out.push({ t: "name", v: s.slice(i, j) }); i = j; continue;
      }
      if ("+-*/^(),".indexOf(c) >= 0) {
        out.push({ t: c === "(" ? "lp" : c === ")" ? "rp" : c === "," ? "comma" : "op", v: c });
        i++; continue;
      }
      throw new Error("unexpected character “" + c + "”");
    }
    // implicit multiplication: 2x, 3i, a b, )(  — but never split a function
    // name from its argument list
    const withMul = [];
    for (let k = 0; k < out.length; k++) {
      const prev = withMul[withMul.length - 1], cur = out[k];
      if (prev) {
        const prevEnds = prev.t === "num" || prev.t === "rp" ||
          (prev.t === "name" && !FUNCS[prev.v]);
        const curStarts = cur.t === "num" || cur.t === "lp" || cur.t === "name";
        if (prevEnds && curStarts) withMul.push({ t: "op", v: "*" });
      }
      withMul.push(cur);
    }
    return wrapBareFuncs(withMul);
  }

  function wrapBareFuncs(tk) {
    // sin t -> sin ( t ) ; exp x -> exp ( x ) ; cos 2 -> cos ( 2 )
    function primaryLen(start) {
      let p = start;
      if (tk[p] && tk[p].t === "op" && tk[p].v === "-") p++;
      if (!tk[p]) return 0;
      if (tk[p].t === "num") return p - start + 1;
      if (tk[p].t === "name") {
        if (FUNCS[tk[p].v]) { const inner = primaryLen(p + 1); return inner ? p - start + 1 + inner : 0; }
        return p - start + 1;
      }
      if (tk[p].t === "lp") {
        let depth = 0;
        for (let q = p; q < tk.length; q++) {
          if (tk[q].t === "lp") depth++;
          else if (tk[q].t === "rp" && --depth === 0) return q - start + 1;
        }
      }
      return 0;
    }
    const res = [];
    let k = 0;
    while (k < tk.length) {
      const cur = tk[k];
      if (cur.t === "name" && FUNCS[cur.v] && !(tk[k + 1] && tk[k + 1].t === "lp")) {
        const len = primaryLen(k + 1);
        if (len > 0) {
          res.push(cur, { t: "lp", v: "(" });
          wrapBareFuncs(tk.slice(k + 1, k + 1 + len)).forEach((x) => res.push(x));
          res.push({ t: "rp", v: ")" });
          k += 1 + len;
          continue;
        }
      }
      res.push(cur); k++;
    }
    return res;
  }

  function toRPN(tokens) {
    const out = [], ops = [];
    const prec = { "u-": 5, "^": 4, "*": 3, "/": 3, "+": 2, "-": 2 };
    const rassoc = { "^": 1, "u-": 1 };
    let prev = null;
    for (let k = 0; k < tokens.length; k++) {
      const tk = tokens[k];
      if (tk.t === "num") { out.push(tk); prev = "val"; continue; }
      if (tk.t === "name") {
        if (FUNCS[tk.v]) { ops.push({ t: "fn", v: tk.v }); prev = "fn"; }
        else { out.push(tk); prev = "val"; }
        continue;
      }
      if (tk.t === "op") {
        let op = tk.v;
        if (op === "-" && (prev === null || prev === "op" || prev === "lp" || prev === "fn")) op = "u-";
        while (ops.length) {
          const top = ops[ops.length - 1];
          if (top.t === "fn") { out.push(ops.pop()); continue; }
          if (top.t === "op" &&
              (prec[top.v] > prec[op] || (prec[top.v] === prec[op] && !rassoc[op]))) out.push(ops.pop());
          else break;
        }
        ops.push({ t: "op", v: op }); prev = "op"; continue;
      }
      if (tk.t === "lp") { ops.push(tk); prev = "lp"; continue; }
      if (tk.t === "rp") {
        while (ops.length && ops[ops.length - 1].t !== "lp") out.push(ops.pop());
        if (!ops.length) throw new Error("unbalanced )");
        ops.pop();
        if (ops.length && ops[ops.length - 1].t === "fn") out.push(ops.pop());
        prev = "val"; continue;
      }
      if (tk.t === "comma") {
        while (ops.length && ops[ops.length - 1].t !== "lp") out.push(ops.pop());
        prev = "op"; continue;
      }
    }
    while (ops.length) {
      const top = ops.pop();
      if (top.t === "lp") throw new Error("unbalanced (");
      out.push(top);
    }
    return out;
  }

  function compile(src) {
    let rpn;
    try { rpn = toRPN(tokenize(src)); }
    catch (e) { return { error: e.message }; }
    if (!rpn.length) return { error: "empty" };
    const vars = new Set();
    for (const tk of rpn) {
      if (tk.t === "name" && !FUNCS[tk.v] && !(tk.v in CONSTS) && tk.v !== "i") vars.add(tk.v);
    }
    const fn = (scope) => {
      const st = [];
      for (const tk of rpn) {
        if (tk.t === "num") st.push(cx(tk.v, 0));
        else if (tk.t === "name") {
          if (tk.v === "i") st.push(cx(0, 1));
          else if (tk.v in CONSTS) st.push(cx(CONSTS[tk.v], 0));
          else st.push(cx(scope[tk.v] || 0, 0));
        } else if (tk.t === "fn") st.push(FUNCS[tk.v](st.pop() || cx(0, 0)));
        else if (tk.t === "op") {
          if (tk.v === "u-") { st.push(neg(st.pop() || cx(0, 0))); continue; }
          const b = st.pop() || cx(0, 0), a = st.pop() || cx(0, 0);
          st.push(tk.v === "+" ? add(a, b) : tk.v === "-" ? sub(a, b)
            : tk.v === "*" ? mul(a, b) : tk.v === "/" ? div(a, b) : powC(a, b));
        }
      }
      return st.pop() || cx(0, 0);
    };
    return { fn: fn, vars: vars };
  }

  /* ---------- presets ----------------------------------------------- */
  const PRESETS = {
    euler: {
      label: "Euler's formula",
      note: "e^(iθ) rides the unit circle. Its shadow on each axis is cos θ and sin θ — that is the whole identity.",
      axisMode: "pi", showUnit: true, t0: "0", t1: "2π",
      exprs: [{ src: "e^(i t)", vector: true, projections: true, trace: true, guide: true, waves: false }],
      params: {},
    },
    waves: {
      label: "Sine & cosine, unrolled",
      note: "Turn on ‘wave’: the same rotating arrow, with cos θ and sin θ drawn against θ so you can watch the circle become the two waves.",
      axisMode: "pi", showUnit: true, t0: "0", t1: "2π",
      exprs: [{ src: "e^(i t)", vector: true, projections: false, trace: true, guide: true, waves: true }],
      params: {},
    },
    lissajous: {
      label: "Lissajous figure",
      note: "z(θ) = sin(aθ) + i·sin(bθ + φ). Integer ratios a:b close up; irrational ratios never do. Animate φ to see the figure breathe.",
      axisMode: "plain", showUnit: false, t0: "0", t1: "2π",
      exprs: [{ src: "sin(a t) + i sin(b t + f)", vector: false, projections: false, trace: true, guide: true, waves: false }],
      params: { a: { value: 3, min: 1, max: 7, step: 1, animate: false, rate: 0.1 },
                b: { value: 2, min: 1, max: 7, step: 1, animate: false, rate: 0.1 },
                f: { value: 0, min: 0, max: 6.2832, step: 0.01, animate: true, rate: 0.08 } },
    },
    spiral: {
      label: "Logarithmic spiral",
      note: "z(θ) = e^((k + i)·θ). The real part in the exponent makes the radius grow geometrically while the angle turns.",
      axisMode: "plain", showUnit: false, t0: "0", t1: "6.5",
      exprs: [{ src: "e^((k + i) t)", vector: true, projections: false, trace: true, guide: true, waves: false }],
      params: { k: { value: 0.16, min: -0.4, max: 0.4, step: 0.01, animate: false, rate: 0.06 } },
    },
    rose: {
      label: "Rose curve",
      note: "z(θ) = cos(kθ)·e^(iθ). A sinusoid in the radius; k petals for odd k, 2k for even.",
      axisMode: "plain", showUnit: true, t0: "0", t1: "2π",
      exprs: [{ src: "cos(k t) e^(i t)", vector: true, projections: false, trace: true, guide: true, waves: false }],
      params: { k: { value: 4, min: 1, max: 8, step: 1, animate: false, rate: 0.05 } },
    },
    damped: {
      label: "Damped oscillation",
      note: "A real graph: y = e^(−a·x)·cos(k·x). Scrub to ride the curve; the drop-lines read x and y.",
      axisMode: "plain", showUnit: false, t0: "0", t1: "1",
      exprs: [{ src: "e^(-a x) cos(k x)", vector: false, projections: true, trace: true, guide: true, waves: false }],
      params: { a: { value: 0.35, min: 0, max: 1.5, step: 0.01, animate: false, rate: 0.05 },
                k: { value: 6, min: 1, max: 16, step: 0.1, animate: false, rate: 0.05 } },
    },
  };

  /* ---------- state / persistence ---------------------------------- */
  let state, compiled, active, svg, refs, raf = 0, lastTs = 0, clock = 0, needsDraw = true;
  let paramEls = {};   // name -> {val, slider}; kept off `state` so it never serialises

  function freshFromPreset(key) {
    const p = PRESETS[key];
    return {
      preset: key,
      exprs: p.exprs.map((e, k) => Object.assign({
        color: COLORS[k % COLORS.length], visible: true,
        vector: false, projections: false, trace: true, guide: true, waves: false,
      }, e)),
      params: JSON.parse(JSON.stringify(p.params)),
      t0: p.t0, t1: p.t1,
      axisMode: p.axisMode, showGrid: true, showUnit: p.showUnit,
      view: { cx: 0, cy: 0, ppu: 120 },
      speed: 1, period: 6, progress: 0, playing: !reduceMotion,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.exprs) && s.exprs.length) { s.playing = s.playing && !reduceMotion; return s; }
      }
    } catch (e) { /* fall through */ }
    return freshFromPreset("euler");
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore quota */ }
    }, 250);
  }

  /* ---------- number formatting ----------------------------------- */
  const fmt = (x) => {
    if (!isFinite(x)) return "∞";
    if (Math.abs(x) < 5e-5) x = 0;
    let s = x.toFixed(4).replace(/\.?0+$/, "");
    return s === "-0" ? "0" : s;
  };
  const fmtFixed = (x) => (Math.abs(x) < 5e-5 ? 0 : x).toFixed(4).replace("-0.0000", "0.0000");
  const fmtC = (z) => {
    const r = fmtFixed(z.re), im = Math.abs(z.im).toFixed(4);
    return `${r} ${z.im < 0 ? "−" : "+"} ${im} i`;
  };
  function piFmt(v) {
    if (Math.abs(v) < 1e-9) return "0";
    const r = v / Math.PI;
    for (const d of [1, 2, 3, 4, 6]) {
      const k = Math.round(r * d);
      if (k !== 0 && Math.abs(r - k / d) < 1e-6) {
        const sign = k < 0 ? "−" : "", a = Math.abs(k);
        const top = a === 1 ? "π" : a + "π";
        return d === 1 ? sign + top : sign + top + "/" + d;
      }
    }
    return fmt(v);
  }

  /* ---------- SVG helpers --------------------------------------- */
  const esc = (n) => (Math.round(n * 100) / 100);
  function line(x1, y1, x2, y2, stroke, w, dash, op) {
    return `<line x1="${esc(x1)}" y1="${esc(y1)}" x2="${esc(x2)}" y2="${esc(y2)}" stroke="${stroke}" ` +
      `stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}${op != null ? ` opacity="${op}"` : ""}/>`;
  }
  function path(d, stroke, w, dash, op) {
    if (!d) return "";
    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round" ` +
      `stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}${op != null ? ` opacity="${op}"` : ""}/>`;
  }
  function dot(x, y, r, fill, handle) {
    return `<circle cx="${esc(x)}" cy="${esc(y)}" r="${r}" fill="${fill}" stroke="#ffffff" stroke-width="1.5"` +
      `${handle ? ' data-handle="1" style="cursor:grab"' : ""}/>`;
  }
  function tick(x, y, fill) {
    return `<rect x="${esc(x - 2.5)}" y="${esc(y - 2.5)}" width="5" height="5" fill="${fill}"/>`;
  }
  function text(x, y, str, anchor, fill, size) {
    return `<text x="${esc(x)}" y="${esc(y)}" text-anchor="${anchor || "start"}" fill="${fill || "#6c6a5e"}" ` +
      `font-family="'JetBrains Mono', ui-monospace, monospace" font-size="${size || 10}">${str}</text>`;
  }
  function arrow(x1, y1, x2, y2, color) {
    const ang = Math.atan2(y2 - y1, x2 - x1), L = 9, w = Math.PI / 7;
    const ax = x2 - L * Math.cos(ang - w), ay = y2 - L * Math.sin(ang - w);
    const bx = x2 - L * Math.cos(ang + w), by = y2 - L * Math.sin(ang + w);
    return line(x1, y1, x2, y2, color, 1.75) +
      `<path d="M${esc(x2)} ${esc(y2)} L${esc(ax)} ${esc(ay)} L${esc(bx)} ${esc(by)} Z" fill="${color}"/>`;
  }

  /* ---------- compile pass ------------------------------------- */
  function parseAll() {
    compiled = state.exprs.map((ex) => {
      const c = compile(ex.src);
      if (c.error) return { ex: ex, error: c.error };
      const kind = c.vars.has("t") ? "param" : c.vars.has("x") ? "cartesian" : "const";
      return { ex: ex, fn: c.fn, kind: kind, vars: c.vars };
    });

    const need = new Set();
    compiled.forEach((c) => c.vars && c.vars.forEach((v) => { if (!RESERVED.has(v)) need.add(v); }));
    need.forEach((v) => {
      if (!state.params[v]) state.params[v] = { value: 1, min: -5, max: 5, step: 0.01, animate: false, rate: 0.15 };
    });
    Object.keys(state.params).forEach((v) => { if (!need.has(v)) delete state.params[v]; });

    active = compiled.find((c) => c.fn && c.ex.visible && c.kind !== "const") ||
             compiled.find((c) => c.fn && c.ex.visible) || null;

    renderRows(); renderParams();
    needsDraw = true; save();
  }

  const scope = () => {
    const s = {};
    for (const k in state.params) s[k] = state.params[k].value;
    return s;
  };
  const rangeVal = (str, dflt) => {
    const c = compile(str == null ? "" : str);
    if (c.error) return dflt;
    try { const z = c.fn({}); return isFinite(z.re) ? z.re : dflt; } catch (e) { return dflt; }
  };

  /* ---------- side-panel rendering --------------------------- */
  const OPTS = [["vector", "vec"], ["projections", "proj"], ["trace", "trace"],
                ["guide", "guide"], ["waves", "wave"]];

  function renderRows() {
    const host = refs.rows;
    host.innerHTML = "";
    compiled.forEach((c, idx) => {
      const ex = c.ex;
      const row = document.createElement("div");
      row.className = "fig-row";
      const sw = document.createElement("button");
      sw.className = "fig-swatch" + (ex.visible ? "" : " off");
      sw.style.background = ex.color;
      sw.title = "show / hide";
      sw.onclick = () => { ex.visible = !ex.visible; parseAll(); };

      const inp = document.createElement("input");
      inp.className = "fig-src";
      inp.value = ex.src;
      inp.spellcheck = false;
      inp.setAttribute("aria-label", "expression");
      inp.oninput = () => { ex.src = inp.value; parseAll(); };

      const del = document.createElement("button");
      del.className = "fig-del";
      del.textContent = "✕";
      del.title = "remove";
      del.onclick = () => {
        state.exprs.splice(idx, 1);
        if (!state.exprs.length) state.exprs.push({
          src: "e^(i t)", color: COLORS[0], visible: true,
          vector: true, projections: true, trace: true, guide: true, waves: false,
        });
        parseAll();
      };

      const opts = document.createElement("div");
      opts.className = "fig-row-opts";
      OPTS.forEach(([key, lbl]) => {
        const b = document.createElement("button");
        b.textContent = lbl;
        b.className = ex[key] ? "on" : "";
        b.onclick = () => { ex[key] = !ex[key]; b.className = ex[key] ? "on" : ""; needsDraw = true; save(); };
        opts.appendChild(b);
      });

      row.appendChild(sw); row.appendChild(inp); row.appendChild(del); row.appendChild(opts);
      if (c.error) {
        const er = document.createElement("div");
        er.className = "fig-err";
        er.textContent = c.error;
        row.appendChild(er);
      }
      host.appendChild(row);
    });
  }

  function renderParams() {
    const host = refs.params;
    host.innerHTML = "";
    paramEls = {};
    const keys = Object.keys(state.params);
    if (!keys.length) return;
    keys.forEach((k) => {
      const p = state.params[k];
      const wrap = document.createElement("div");
      wrap.className = "fig-param";

      const head = document.createElement("div");
      head.className = "fig-param-head";
      const val = document.createElement("span");
      val.textContent = "= " + fmt(p.value);
      const anim = document.createElement("button");
      anim.textContent = "animate";
      anim.className = p.animate ? "on" : "";
      anim.onclick = () => { p.animate = !p.animate; anim.className = p.animate ? "on" : ""; save(); };
      head.innerHTML = "<code>" + k + "</code>";
      head.appendChild(val); head.appendChild(anim);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = p.min; slider.max = p.max; slider.step = p.step || 0.01;
      slider.value = p.value;
      slider.oninput = () => { p.value = parseFloat(slider.value); val.textContent = "= " + fmt(p.value); needsDraw = true; save(); };

      const bounds = document.createElement("div");
      bounds.className = "fig-param-bounds";
      [["min", "min"], ["max", "max"], ["step", "step"]].forEach(([field, lbl]) => {
        const b = document.createElement("input");
        b.value = p[field] != null ? p[field] : (field === "step" ? 0.01 : "");
        b.title = lbl;
        b.setAttribute("aria-label", k + " " + lbl);
        b.onchange = () => {
          const n = parseFloat(b.value);
          if (isFinite(n)) {
            p[field] = n;
            slider.min = p.min; slider.max = p.max; slider.step = p.step || 0.01;
            save();
          }
        };
        bounds.appendChild(b);
      });

      wrap.appendChild(head); wrap.appendChild(slider); wrap.appendChild(bounds);
      host.appendChild(wrap);
      paramEls[k] = { val: val, slider: slider };
    });
  }

  /* ---------- coordinate mapping ---------------------------- */
  function mapping() {
    const W = svg.clientWidth || 800, H = svg.clientHeight || 520;
    let ppu = state.view.ppu;
    if (!(ppu > 0) || !isFinite(ppu)) ppu = state.view.ppu = 120;
    const ox = W / 2 - state.view.cx * ppu;
    const oy = H / 2 + state.view.cy * ppu;
    return {
      W: W, H: H, ppu: ppu,
      X: (wx) => ox + wx * ppu,
      Y: (wy) => oy - wy * ppu,
      iX: (px) => (px - ox) / ppu,
      iY: (py) => (oy - py) / ppu,
    };
  }

  function niceStep(px, ppu) {
    const raw = px / ppu;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  /* ---------- draw ---------------------------------------- */
  function samplePath(fn, kind, a, b, n, m) {
    let d = "", pen = false;
    for (let k = 0; k <= n; k++) {
      const u = a + (b - a) * k / n;
      const z = fn(kind === "cartesian" ? { x: u } : Object.assign(scope(), { t: u }));
      const px = kind === "cartesian" ? m.X(u) : m.X(z.re);
      const py = kind === "cartesian" ? m.Y(z.re) : m.Y(z.im);
      if (!isFinite(px) || !isFinite(py) || Math.abs(px) > 1e5 || Math.abs(py) > 1e5) { pen = false; continue; }
      d += (pen ? "L" : "M") + esc(px) + " " + esc(py) + " ";
      pen = true;
    }
    return d;
  }

  function draw() {
    if (!svg || !document.body.contains(svg)) { cancelAnimationFrame(raf); raf = 0; return; }
    const m = mapping();
    const parts = [];
    const INK = "#15150f", GRID = "#e4e2d8", FAINT = "#9a9788";

    // --- grid ---
    if (state.showGrid) {
      const stepX = state.axisMode === "pi" ? piStepX(m) : niceStep(70, m.ppu);
      const stepY = niceStep(70, m.ppu);
      const x0 = m.iX(0), x1 = m.iX(m.W), y0 = m.iY(m.H), y1 = m.iY(0);
      for (let x = Math.ceil(x0 / stepX) * stepX; x <= x1; x += stepX)
        parts.push(line(m.X(x), 0, m.X(x), m.H, GRID, 1));
      for (let y = Math.ceil(y0 / stepY) * stepY; y <= y1; y += stepY)
        parts.push(line(0, m.Y(y), m.W, m.Y(y), GRID, 1));
      // axis labels
      for (let x = Math.ceil(x0 / stepX) * stepX; x <= x1; x += stepX) {
        if (Math.abs(x) < 1e-9) continue;
        const lbl = state.axisMode === "pi" ? piFmt(x) : fmt(x);
        parts.push(text(m.X(x) + 3, m.Y(0) + 12, lbl, "start", FAINT, 9.5));
      }
      for (let y = Math.ceil(y0 / stepY) * stepY; y <= y1; y += stepY) {
        if (Math.abs(y) < 1e-9) continue;
        parts.push(text(m.X(0) + 4, m.Y(y) - 3, fmt(y), "start", FAINT, 9.5));
      }
    }
    // --- axes ---
    parts.push(line(m.X(m.iX(0)), m.Y(0), m.X(m.iX(m.W)), m.Y(0), INK, 1.3));
    parts.push(line(m.X(0), m.Y(m.iY(0)), m.X(0), m.Y(m.iY(m.H)), INK, 1.3));
    parts.push(text(m.X(0) - 4, m.Y(0) + 12, "0", "end", FAINT, 9.5));

    // --- unit circle ---
    if (state.showUnit) {
      parts.push(`<circle cx="${esc(m.X(0))}" cy="${esc(m.Y(0))}" r="${esc(m.ppu)}" fill="none" ` +
        `stroke="${INK}" stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/>`);
    }

    const T = state.progress;
    let readout = null, eqmain = null;

    compiled.forEach((c) => {
      if (!c.fn || !c.ex.visible) return;
      const col = c.ex.color;

      if (c.kind === "const") {
        const z = c.fn(scope());
        if (Math.abs(z.im) < 1e-6) parts.push(line(0, m.Y(z.re), m.W, m.Y(z.re), col, 2, "5 4"));
        else parts.push(dot(m.X(z.re), m.Y(z.im), 4, col));
        return;
      }

      const isCart = c.kind === "cartesian";
      const a = isCart ? m.iX(0) : rangeVal(state.t0, 0);
      const b = isCart ? m.iX(m.W) : rangeVal(state.t1, TAU);
      const cur = a + T * (b - a);
      const nFull = Math.min(2000, Math.max(400, Math.round(Math.abs(b - a) / TAU * 360)));

      if (c.ex.guide) parts.push(path(samplePath(c.fn, c.kind, a, b, nFull, m), col, 1.25, "1.5 3", 0.32));
      if (c.ex.trace) parts.push(path(samplePath(c.fn, c.kind, a, cur, Math.max(24, Math.round(nFull * T)), m), col, 2.4));

      const z = c.fn(isCart ? { x: cur } : Object.assign(scope(), { t: cur }));
      const px = isCart ? m.X(cur) : m.X(z.re);
      const py = isCart ? m.Y(z.re) : m.Y(z.im);

      if (c.ex.waves && !isCart) {
        parts.push(path(sampleAxisWave(c.fn, a, b, nFull, m, "re"), col, 1.4, "4 3", 0.6));
        parts.push(path(sampleAxisWave(c.fn, a, b, nFull, m, "im"), col, 1.4, null, 0.6));
        parts.push(dot(m.X(cur), m.Y(z.re), 3, col));
        parts.push(dot(m.X(cur), m.Y(z.im), 3, col));
      }

      if (c.ex.vector && !isCart) parts.push(arrow(m.X(0), m.Y(0), px, py, col));

      if (c.ex.projections) {
        if (isCart) {
          parts.push(line(px, py, px, m.Y(0), FAINT, 1, "3 3"));
          parts.push(line(px, py, m.X(0), py, FAINT, 1, "3 3"));
          parts.push(tick(px, m.Y(0), INK));
          parts.push(tick(m.X(0), py, INK));
          parts.push(text(px + 4, m.Y(0) - 5, "x " + fmt(cur), "start", INK, 9.5));
          parts.push(text(m.X(0) + 6, py - 4, "y " + fmt(z.re), "start", INK, 9.5));
        } else {
          parts.push(line(px, py, px, m.Y(0), FAINT, 1, "3 3"));
          parts.push(line(px, py, m.X(0), py, FAINT, 1, "3 3"));
          parts.push(tick(px, m.Y(0), INK));
          parts.push(tick(m.X(0), py, INK));
          parts.push(text(px + 4, m.Y(0) - 5, "Re " + fmt(z.re), "start", INK, 9.5));
          parts.push(text(m.X(0) + 6, py - 4, "Im " + fmt(z.im), "start", INK, 9.5));
        }
      }

      parts.push(dot(px, py, 4.5, col, c === active));

      if (c === active) {
        if (isCart) {
          readout = `x = ${fmtFixed(cur)}\ny = ${fmtFixed(z.re)}` +
            (Math.abs(z.im) > 1e-6 ? `\n(im ${fmtFixed(z.im)})` : "");
          eqmain = `y(x) = ${prettySrc(c.ex.src)}`;
        } else {
          const deg = (cur * 180 / Math.PI);
          readout =
            `t = ${fmtFixed(cur)}   ( ${piFmt(cur)} , ${deg.toFixed(1)}° )\n` +
            `z = ${fmtC(z)}\n` +
            `|z| = ${modC(z).toFixed(4)}    arg z = ${fmtFixed(argC(z))}`;
          eqmain = `z(θ) = ${prettySrc(c.ex.src)}`;
        }
      }
    });

    svg.innerHTML = parts.join("");

    refs.eq.innerHTML = eqmain
      ? `${escapeHtml(eqmain)} <span class="fig-map">↦</span> ` +
        `<span class="n">${readout ? escapeHtml(readout.split("\n")[1] || readout.split("\n")[0]) : ""}</span>`
      : "no visible expression";
    refs.readout.textContent = readout || "";
    refs.tval.textContent = "t = " + state.progress.toFixed(3);
  }

  function piStepX(m) {
    let base = Math.PI / 2;
    for (let g = 0; g < 40 && base * m.ppu < 46; g++) base *= 2;
    for (let g = 0; g < 40 && base * m.ppu > 170; g++) base /= 2;
    return base || Math.PI / 2;
  }
  function sampleAxisWave(fn, a, b, n, m, which) {
    let d = "", pen = false;
    for (let k = 0; k <= n; k++) {
      const u = a + (b - a) * k / n;
      const z = fn(Object.assign(scope(), { t: u }));
      const val = which === "re" ? z.re : z.im;
      const px = m.X(u), py = m.Y(val);
      if (!isFinite(px) || !isFinite(py)) { pen = false; continue; }
      d += (pen ? "L" : "M") + esc(px) + " " + esc(py) + " ";
      pen = true;
    }
    return d;
  }
  function prettySrc(s) { return String(s).replace(/\bt\b/g, "θ").replace(/\*/g, "·"); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /* ---------- view fitting ------------------------------- */
  function fitView() {
    const m = mapping();
    const c = active || compiled.find((x) => x.fn);
    if (!c || c.kind === "cartesian") {
      state.view.cx = 0; state.view.cy = 0;
      if (c && c.kind === "cartesian") state.view.ppu = 120;
      return;
    }
    const a = rangeVal(state.t0, 0), b = rangeVal(state.t1, TAU);
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let k = 0; k <= 240; k++) {
      const z = c.fn(Object.assign(scope(), { t: a + (b - a) * k / 240 }));
      if (!isFinite(z.re) || !isFinite(z.im)) continue;
      minx = Math.min(minx, z.re); maxx = Math.max(maxx, z.re);
      miny = Math.min(miny, z.im); maxy = Math.max(maxy, z.im);
    }
    if (!isFinite(minx)) return;
    const spanx = Math.max(0.5, maxx - minx), spany = Math.max(0.5, maxy - miny);
    state.view.cx = (minx + maxx) / 2;
    state.view.cy = (miny + maxy) / 2;
    state.view.ppu = Math.max(24, Math.min(400,
      0.82 * Math.min(m.W / spanx, m.H / spany)));
  }

  /* ---------- animation loop ---------------------------- */
  function anyAnimating() {
    for (const k in state.params) if (state.params[k].animate) return true;
    return false;
  }
  function step(ts) {
    if (!svg || !document.body.contains(svg)) { raf = 0; return; }  // view was navigated away
    raf = requestAnimationFrame(step);
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;

    const animating = state.playing || anyAnimating();
    if (state.playing) {
      clock += dt * state.speed;
      state.progress = (state.progress + dt * state.speed / state.period) % 1;
      if (state.progress < 0) state.progress += 1;
      refs.scrub.value = state.progress;
    }
    if (animating) {
      for (const k in state.params) {
        const p = state.params[k];
        if (!p.animate) continue;
        const phase = 0.5 - 0.5 * Math.cos(clock * (p.rate || 0.15) * TAU);
        p.value = p.min + phase * (p.max - p.min);
        const pe = paramEls[k];
        if (pe) { pe.val.textContent = "= " + fmt(p.value); pe.slider.value = p.value; }
      }
    }

    if (animating || needsDraw) { draw(); needsDraw = false; }
  }

  /* ---------- pan / zoom / scrub-drag ------------------ */
  function wirePointer() {
    let mode = null, sx = 0, sy = 0, scx = 0, scy = 0;
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const m = mapping();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const wx = m.iX(mx), wy = m.iY(my);
      const f = Math.exp(-e.deltaY * 0.0016);
      state.view.ppu = Math.max(8, Math.min(4000, state.view.ppu * f));
      const m2 = mapping();
      state.view.cx += wx - m2.iX(mx);
      state.view.cy += wy - m2.iY(my);
      needsDraw = true; save();
    }, { passive: false });

    svg.addEventListener("pointerdown", (e) => {
      svg.setPointerCapture(e.pointerId);
      const rect = svg.getBoundingClientRect();
      sx = e.clientX - rect.left; sy = e.clientY - rect.top;
      if (e.target && e.target.getAttribute && e.target.getAttribute("data-handle")) {
        mode = "scrub";
      } else {
        mode = "pan"; scx = state.view.cx; scy = state.view.cy;
        svg.style.cursor = "grabbing";
      }
    });
    svg.addEventListener("pointermove", (e) => {
      if (!mode) return;
      const m = mapping();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      if (mode === "pan") {
        state.view.cx = scx - (mx - sx) / m.ppu;
        state.view.cy = scy + (my - sy) / m.ppu;
        needsDraw = true;
      } else if (mode === "scrub" && active) {
        const wx = m.iX(mx), wy = m.iY(my);
        const isCart = active.kind === "cartesian";
        const a = isCart ? m.iX(0) : rangeVal(state.t0, 0);
        const b = isCart ? m.iX(m.W) : rangeVal(state.t1, TAU);
        let best = 0, bestD = Infinity;
        for (let k = 0; k <= 400; k++) {
          const u = a + (b - a) * k / 400;
          const z = active.fn(isCart ? { x: u } : Object.assign(scope(), { t: u }));
          const zx = isCart ? u : z.re, zy = isCart ? z.re : z.im;
          const dd = (zx - wx) * (zx - wx) + (zy - wy) * (zy - wy);
          if (dd < bestD) { bestD = dd; best = k / 400; }
        }
        state.progress = best;
        refs.scrub.value = best;
        needsDraw = true;
      }
    });
    const end = () => { if (mode === "pan") save(); mode = null; svg.style.cursor = "grab"; };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
  }

  /* ---------- mount ----------------------------------- */
  function render(container) {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    lastTs = 0; clock = 0;
    state = load();

    container.innerHTML =
      '<div class="view-head">' +
        '<h1>Figures</h1>' +
        '<p>An interactive figure canvas — 3blue1brown in feel, Desmos in touch. ' +
        'Type an expression in <code>θ</code> (complex, <code>i</code> is the imaginary unit) or in <code>x</code> ' +
        '(a real graph). Drag the plane to pan, scroll to zoom, drag the marker or scrub to move the parameter, ' +
        'and give any single letter a slider. Euler’s formula is loaded by default.</p>' +
      '</div>' +
      '<div class="fig-shell">' +
        '<aside class="fig-side card">' +
          '<div class="card-head"><h3>Definitions</h3>' +
            '<select class="fig-preset" id="fig-preset" title="load a construction"></select></div>' +
          '<div class="card-body">' +
            '<div class="fig-eq" id="fig-eq"></div>' +
            '<div class="fig-note" id="fig-note"></div>' +
            '<div class="fig-rows" id="fig-rows"></div>' +
            '<button class="btn" id="fig-add">+ expression</button>' +
            '<div class="fig-range">' +
              '<label>θ from <input id="fig-t0" spellcheck="false"></label>' +
              '<label>to <input id="fig-t1" spellcheck="false"></label>' +
            '</div>' +
            '<div class="fig-params" id="fig-params"></div>' +
            '<div class="fig-toggles">' +
              '<button id="fig-grid">grid</button><button id="fig-unit">unit circle</button>' +
              '<button id="fig-pi">π axis</button>' +
            '</div>' +
            '<pre class="fig-readout" id="fig-readout"></pre>' +
          '</div>' +
        '</aside>' +
        '<div class="fig-canvas card">' +
          '<svg id="fig-svg" xmlns="http://www.w3.org/2000/svg"></svg>' +
          '<div class="fig-transport">' +
            '<button class="btn" id="fig-play"></button>' +
            '<input type="range" id="fig-scrub" min="0" max="1" step="0.001">' +
            '<span class="fig-t" id="fig-tval">t = 0.000</span>' +
            '<label>rate <input type="range" id="fig-speed" min="0.15" max="3" step="0.05"></label>' +
            '<button class="btn" id="fig-fit">fit</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    svg = container.querySelector("#fig-svg");
    refs = {
      rows: container.querySelector("#fig-rows"),
      params: container.querySelector("#fig-params"),
      eq: container.querySelector("#fig-eq"),
      note: container.querySelector("#fig-note"),
      readout: container.querySelector("#fig-readout"),
      preset: container.querySelector("#fig-preset"),
      scrub: container.querySelector("#fig-scrub"),
      speed: container.querySelector("#fig-speed"),
      play: container.querySelector("#fig-play"),
      tval: container.querySelector("#fig-tval"),
      t0: container.querySelector("#fig-t0"),
      t1: container.querySelector("#fig-t1"),
    };

    // preset menu
    refs.preset.innerHTML = Object.keys(PRESETS)
      .map((k) => `<option value="${k}">${escapeHtml(PRESETS[k].label)}</option>`).join("");
    refs.preset.value = state.preset && PRESETS[state.preset] ? state.preset : "euler";
    refs.preset.onchange = () => {
      state = freshFromPreset(refs.preset.value);
      syncControls();
      parseAll();
      fitView();
      needsDraw = true;
      save();
    };

    container.querySelector("#fig-add").onclick = () => {
      state.exprs.push({
        src: "0.6 e^(i t) + 0.4 e^(-3 i t)", color: COLORS[state.exprs.length % COLORS.length],
        visible: true, vector: false, projections: false, trace: true, guide: true, waves: false,
      });
      parseAll();
    };
    refs.t0.onchange = () => { state.t0 = refs.t0.value; needsDraw = true; save(); };
    refs.t1.onchange = () => { state.t1 = refs.t1.value; needsDraw = true; save(); };

    const toggle = (id, key) => {
      const b = container.querySelector(id);
      const paint = () => { b.className = state[key] ? "on" : ""; };
      paint();
      b.onclick = () => { state[key] = !state[key]; paint(); needsDraw = true; save(); };
    };
    toggle("#fig-grid", "showGrid");
    toggle("#fig-unit", "showUnit");
    const piBtn = container.querySelector("#fig-pi");
    const paintPi = () => { piBtn.className = state.axisMode === "pi" ? "on" : ""; };
    paintPi();
    piBtn.onclick = () => { state.axisMode = state.axisMode === "pi" ? "plain" : "pi"; paintPi(); needsDraw = true; save(); };

    refs.play.onclick = () => {
      state.playing = !state.playing;
      refs.play.textContent = state.playing ? "❚❚ pause" : "▶ play";
      save();
    };
    refs.scrub.oninput = () => { state.progress = parseFloat(refs.scrub.value); needsDraw = true; };
    refs.scrub.onchange = save;
    refs.speed.oninput = () => { state.speed = parseFloat(refs.speed.value); save(); };
    container.querySelector("#fig-fit").onclick = () => { fitView(); needsDraw = true; save(); };

    function syncControls() {
      refs.t0.value = state.t0;
      refs.t1.value = state.t1;
      refs.speed.value = state.speed;
      refs.scrub.value = state.progress;
      refs.play.textContent = state.playing ? "❚❚ pause" : "▶ play";
      container.querySelector("#fig-grid").className = state.showGrid ? "on" : "";
      container.querySelector("#fig-unit").className = state.showUnit ? "on" : "";
      piBtn.className = state.axisMode === "pi" ? "on" : "";
      refs.note.textContent = state.preset && PRESETS[state.preset] ? PRESETS[state.preset].note : "";
    }
    syncControls();

    wirePointer();
    parseAll();

    // first paint after layout settles so the SVG has real dimensions
    requestAnimationFrame(() => { needsDraw = true; if (state.preset === "euler" && !localStorage.getItem(STORE)) fitView(); });

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => { needsDraw = true; });
      ro.observe(svg);
    }

    raf = requestAnimationFrame(step);
  }

  window.KleioFigures = { render: render };
})();
