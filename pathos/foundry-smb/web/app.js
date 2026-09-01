/* Kleio — a small-business ontology workspace.
 *
 * The front end knows nothing about Authors, Works or Passages. It reads the
 * ontology metadata from /api/ontology and renders whatever object types it
 * finds, which is the property that lets one deployment serve a bookshop's
 * catalogue and another a corpus of 1.1M classical passages.
 */

const API = "/api";
const state = { ontology: null, metrics: null, lineage: null, route: null, cache: {} };

/* ---------- helpers -------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
};
const num = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
const pct = (x, digits = 2) => `${(100 * x).toFixed(digits)}%`;
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

async function get(path) {
  if (state.cache[path]) return state.cache[path];
  const res = await fetch(API + path);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  if (!path.startsWith("/objects")) state.cache[path] = body;
  return body;
}

const typeDef = (name) => state.ontology.object_types.find((t) => t.api_name === name);
const facetProps = (t) => t.properties.filter((p) => p.role === "facet");

/* Human labels for the two-letter corpus language codes. */
const LANGS = { grc: "Ancient Greek", lat: "Latin", eng: "English", ger: "German",
  fre: "French", ita: "Italian", spa: "Spanish", ara: "Arabic", mul: "Multiple",
  und: "Undetermined" };
const langName = (c) => LANGS[c] || c;

/* ---------- shell ---------------------------------------------------------- */
const NAV = [
  { group: "Workspace", items: [
    { id: "home", label: "Overview", color: "var(--blue4)" },
    { id: "lineage", label: "Data lineage", color: "var(--cerulean4)" },
    { id: "ontology", label: "Ontology manager", color: "var(--indigo4)" },
    { id: "figures", label: "Figures", color: "var(--turquoise3)" },
  ]},
];

function renderRail() {
  const rail = $("#rail-scroll");
  rail.innerHTML = "";
  for (const g of NAV) {
    rail.append(el("div", { class: "rail-group" }, g.group));
    for (const it of g.items) rail.append(navItem(it.id, it.label, it.color));
  }
  rail.append(el("div", { class: "rail-group" }, "Object types"));
  for (const t of state.ontology.object_types) {
    rail.append(navItem(`explore/${t.api_name}`, t.plural_name, t.color, t.object_count));
  }
  rail.append(el("div", { class: "rail-group" }, "Guide"));
  rail.append(navItem("playbook", "Why this shape", "var(--gray2)"));

  const s = state.metrics.sample;
  $("#foot-db").innerHTML =
    `<code>sample.db</code> · ${num(s.sample_n)} of ${num(s.population_n)} rows` +
    `<br>seed <code>${s.seed}</code>`;
}

function navItem(id, label, color, count) {
  const active = state.route && state.route.id === id;
  return el("button", {
      class: "nav-item" + (active ? " active" : ""),
      onclick: () => (location.hash = "#/" + id),
    },
    el("span", { class: "dot", style: `background:${color}` }),
    el("span", { class: "txt" }, label),
    count != null ? el("span", { class: "count" }, num(count)) : null);
}

function crumbs(...parts) {
  const c = $("#crumbs");
  c.innerHTML = "";
  parts.forEach((p, i) => {
    if (i) c.append(el("span", { class: "sep" }, "/"));
    c.append(i === parts.length - 1 ? el("strong", {}, p) : el("span", {}, p));
  });
}

/* ---------- charts (hand-rolled; no CDN, works offline) -------------------- */
function barChart(rows, { color = "var(--blue4)", format = num, label = (r) => r.label } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return el("div", { class: "bars" },
    rows.map((r) =>
      el("div", {},
        el("div", { class: "bar-label" },
          el("span", {}, label(r)),
          el("span", { style: "font-family:var(--mono);color:var(--gray3)" }, format(r.value))),
        el("div", { class: "bar-track" },
          el("div", { class: "bar-fill",
            style: `width:${(100 * r.value) / max}%;background:${typeof color === "function" ? color(r) : color}` })))));
}

function donut(rows, colors) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  let offset = 0;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 140 140");
  svg.setAttribute("width", "140");
  svg.setAttribute("height", "140");
  rows.forEach((r, i) => {
    const len = (r.value / total) * C;
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", 70); circle.setAttribute("cy", 70); circle.setAttribute("r", R);
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", colors[i % colors.length]);
    circle.setAttribute("stroke-width", 17);
    circle.setAttribute("stroke-dasharray", `${len} ${C - len}`);
    circle.setAttribute("stroke-dashoffset", -offset);
    circle.setAttribute("transform", "rotate(-90 70 70)");
    svg.append(circle);
    offset += len;
  });
  const t = document.createElementNS(ns, "text");
  t.setAttribute("x", 70); t.setAttribute("y", 74);
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("fill", "#15150f");
  t.setAttribute("font-size", "17"); t.setAttribute("font-weight", "600");
  t.setAttribute("font-family", "var(--sans)");
  t.textContent = num(total);
  svg.append(t);
  return svg;
}

function card(title, hint, ...body) {
  return el("div", { class: "card" },
    el("div", { class: "card-head" }, el("h3", {}, title),
      hint ? el("span", { class: "hint" }, hint) : null),
    el("div", { class: "card-body" }, ...body));
}

function kpi(label, value, unit, foot, accent) {
  return el("div", { class: "card kpi" + (accent ? " accent" : "") },
    el("div", { class: "label" }, label),
    el("div", { class: "value" }, value, unit ? el("small", {}, " " + unit) : null),
    foot ? el("div", { class: "foot" }, foot) : null);
}

/* ---------- view: overview ------------------------------------------------- */
const CORPUS_COLORS = ["#2b5c9b", "#5b4e88", "#2f7d75", "#8a6d1f"];

function viewHome() {
  crumbs("Kleio", "Overview");
  const m = state.metrics, s = m.sample;
  const view = $("#view");
  view.innerHTML = "";

  view.append(el("div", { class: "view-head" },
    el("h1", {}, "Classical corpus workspace"),
    el("p", {}, "A working ontology over the Perseus and Open Greek and Latin corpora. " +
      "The full warehouse holds " + num(s.population_n) + " citable passages; this workspace " +
      "runs on a seeded random sample of " + num(s.sample_n) + " so the whole thing fits " +
      "on a laptop and every number below is reproducible.")));

  view.append(el("div", { class: "grid g-kpi" },
    kpi("Sample", num(s.sample_n), "passages", `${pct(s.fraction, 3)} of the population`, true),
    kpi("Population", num(s.population_n), "passages", `${num(m.ingest.editions)} editions parsed`),
    kpi("Works represented", num(m.counts.Work), "", "editions with ≥1 sampled passage"),
    kpi("Authors", num(m.counts.Author), "", "derived object type"),
    kpi("Words sampled", num(m.totals.words), "", num(m.totals.chars) + " characters")));

  const corpusRows = m.by_corpus.map((r) => ({ ...r }));
  view.append(el("div", { class: "grid g-2 mt" },
    card("Where the sample came from", "by source corpus",
      el("div", { style: "display:flex;gap:20px;align-items:center;flex-wrap:wrap" },
        donut(corpusRows, CORPUS_COLORS),
        el("div", { style: "flex:1;min-width:190px" },
          corpusRows.map((r, i) => el("div", { class: "legend-item", style: "margin-bottom:9px" },
            el("span", { class: "swatch", style: `background:${CORPUS_COLORS[i % 4]}` }),
            el("span", {}, r.label),
            el("span", { style: "margin-left:auto;font-family:var(--mono);color:var(--gray3)" },
              num(r.value)))))))
    ,
    card("Languages in the sample", "passage count",
      barChart(m.by_language.map((r) => ({ ...r, label: langName(r.label) })),
        { color: "var(--turquoise3)" }))));

  view.append(el("div", { class: "grid g-2 mt" },
    card("Most represented authors", "click to explore",
      el("div", { class: "bars" },
        m.top_authors.map((r) =>
          el("div", { style: "cursor:pointer",
            onclick: () => go(`explore/Author?q=${encodeURIComponent(r.label)}`) },
            el("div", { class: "bar-label" },
              el("span", {}, r.label),
              el("span", { style: "font-family:var(--mono);color:var(--gray3)" },
                `${num(r.value)} · ${r.work_count} works`)),
            el("div", { class: "bar-track" },
              el("div", { class: "bar-fill",
                style: `width:${(100 * r.value) / m.top_authors[0].value}%;background:var(--indigo4)` })))))),
    card("Passage length", "words per citable unit",
      barChart(m.passage_length, { color: "var(--green4)" }))));

  view.append(el("div", { class: "grid g-2 mt" },
    card("Provenance", "how this dataset was produced",
      el("dl", { class: "props" },
        [
          ["Connector", m.ingest.source_kind],
          ["Ingested", (m.ingest.finished_at || "").replace("T", " ")],
          ["Editions parsed", num(m.ingest.editions)],
          ["Sampling", s.method],
          ["Seed", String(s.seed)],
          ["Fraction", `${pct(s.fraction, 3)} (n = ${num(s.sample_n)}, N = ${num(s.population_n)})`],
        ].flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v || "—")]))),
    card("Source corpora", "upstream revisions",
      m.corpora.map((c) => el("div", { style: "margin-bottom:12px" },
        el("div", { style: "font-weight:600" }, c.label),
        el("div", { class: "urn", style: "margin-top:3px" }, c.repo, " @ ", (c.revision || "").slice(0, 10)),
        el("div", { style: "color:var(--gray2);font-size:11.5px;margin-top:3px" }, c.license))))));
}

/* ---------- view: explorer ------------------------------------------------- */
const explorer = { type: null, q: "", filters: {}, page: 1, sort: null, desc: false };

async function viewExplore(typeName, params) {
  const t = typeDef(typeName);
  if (!t) return viewHome();
  if (explorer.type !== typeName) {
    Object.assign(explorer, { type: typeName, q: "", filters: {}, page: 1, sort: null, desc: false });
  }
  if (params && params.get("q") != null) { explorer.q = params.get("q"); explorer.page = 1; }
  crumbs("Kleio", "Object explorer", t.plural_name);

  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "view-head" },
    el("h1", {}, t.plural_name),
    el("p", {}, t.description)));

  const shell = el("div", { class: "explorer" });
  const side = el("aside", { class: "card filters" });
  const body = el("div", {});
  shell.append(side, body);
  view.append(shell);

  renderFacets(side, t);
  await renderResults(body, t);
}

async function renderFacets(side, t) {
  side.innerHTML = "";
  side.append(el("div", { class: "card-head" }, el("h3", {}, "Filters")));
  const bodyEl = el("div", { class: "card-body" });
  side.append(bodyEl);

  const props = facetProps(t);
  if (!props.length) {
    bodyEl.append(el("div", { class: "note" }, "This object type has no faceted properties."));
    return;
  }
  for (const p of props) {
    const box = el("div", { class: "facet" }, el("h4", {}, p.display_name),
      el("div", { class: "spin", style: "padding:8px;text-align:left" }, "…"));
    bodyEl.append(box);
    try {
      const data = await get(`/facets/${t.api_name}/${p.api_name}?limit=14`);
      box.innerHTML = "";
      box.append(el("h4", {}, p.display_name));
      for (const v of data.values) {
        const on = explorer.filters[p.api_name] === v.value;
        box.append(el("button", {
            class: "facet-val" + (on ? " on" : ""),
            onclick: () => {
              if (on) delete explorer.filters[p.api_name];
              else explorer.filters[p.api_name] = v.value;
              explorer.page = 1;
              render();
            },
          },
          el("span", {}, p.api_name.endsWith("language") ? langName(v.value) : truncate(v.value, 22)),
          el("span", { class: "n" }, num(v.count))));
      }
    } catch (e) {
      box.innerHTML = "";
      box.append(el("h4", {}, p.display_name), el("div", { class: "note" }, String(e.message)));
    }
  }
}

async function renderResults(body, t) {
  body.innerHTML = "";

  const input = el("input", {
    type: "search", placeholder: `Search ${t.plural_name.toLowerCase()}…`, value: explorer.q,
  });
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { explorer.q = input.value; explorer.page = 1; refresh(t, body); }, 220);
  });

  const chips = Object.entries(explorer.filters).map(([k, v]) =>
    el("button", { class: "btn", onclick: () => { delete explorer.filters[k]; render(); } },
      `${k}: ${truncate(v, 18)} ✕`));

  body.append(el("div", { class: "toolbar" },
    el("div", { class: "search" },
      el("span", { html: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>' }),
      input),
    chips,
    chips.length ? el("button", { class: "btn", onclick: () => { explorer.filters = {}; render(); } }, "Clear all") : null));

  const holder = el("div", { class: "card" }, el("div", { class: "spin" }, "Querying…"));
  body.append(holder);
  await refresh(t, body, holder);
}

async function refresh(t, body, holder) {
  holder = holder || body.querySelector(".card:last-child");
  const qs = new URLSearchParams({ page: explorer.page, pageSize: 50 });
  if (explorer.q) qs.set("q", explorer.q);
  if (explorer.sort) { qs.set("sort", explorer.sort); qs.set("desc", explorer.desc ? "1" : "0"); }
  for (const [k, v] of Object.entries(explorer.filters)) qs.set(k, v);

  holder.innerHTML = "";
  holder.append(el("div", { class: "spin" }, "Querying…"));
  let data;
  try {
    data = await get(`/objects/${t.api_name}?${qs}`);
  } catch (e) {
    holder.innerHTML = "";
    holder.append(el("div", { class: "empty" }, "Query failed: " + e.message));
    return;
  }

  const cols = t.properties.filter((p) => p.role !== "body").slice(0, 6);
  const bodyProp = t.properties.find((p) => p.role === "body");

  holder.innerHTML = "";
  if (!data.objects.length) {
    holder.append(el("div", { class: "empty" },
      "No " + t.plural_name.toLowerCase() + " match this search."));
  } else {
    const head = el("tr", {}, cols.map((c) =>
      el("th", { onclick: () => {
          explorer.desc = explorer.sort === c.api_name ? !explorer.desc : false;
          explorer.sort = c.api_name;
          refresh(t, body);
        } },
        c.display_name + (explorer.sort === c.api_name ? (explorer.desc ? " ↓" : " ↑") : ""))),
      bodyProp ? el("th", {}, bodyProp.display_name) : null);

    const rows = data.objects.map((o) =>
      el("tr", { onclick: () => openDrawer(t.api_name, o[t.primary_key]) },
        cols.map((c) => el("td", { class: c.data_type === "integer" ? "num" : "" },
          c.api_name.endsWith("language") ? langName(o[c.api_name])
            : c.api_name.includes("urn") ? el("span", { class: "urn" }, o[c.api_name])
            : truncate(o[c.api_name] == null ? "" : String(o[c.api_name]), 46) || "—")),
        bodyProp ? el("td", { class: "clip greek" }, truncate(o[bodyProp.api_name], 120)) : null));

    holder.append(el("div", { style: "overflow-x:auto" },
      el("table", { class: "rows" }, el("thead", {}, head), el("tbody", {}, rows))));
  }

  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  holder.append(el("div", { class: "pager" },
    el("span", {}, `${num(data.total)} ${t.plural_name.toLowerCase()}`),
    explorer.q ? el("span", { style: "color:var(--gray2)" }, `matching “${explorer.q}”`) : null,
    el("span", { class: "spacer" }),
    el("span", {}, `Page ${data.page} of ${num(pages)}`),
    el("button", { class: "btn", disabled: data.page <= 1,
      onclick: () => { explorer.page--; refresh(t, body); } }, "Previous"),
    el("button", { class: "btn", disabled: data.page >= pages,
      onclick: () => { explorer.page++; refresh(t, body); } }, "Next")));
}

/* ---------- object detail drawer ------------------------------------------- */
async function openDrawer(typeName, pk) {
  const overlay = $("#overlay");
  overlay.innerHTML = "";
  const close = () => (overlay.innerHTML = "");
  overlay.append(el("div", { class: "scrim", onclick: close }));
  const drawer = el("aside", { class: "drawer" }, el("div", { class: "spin" }, "Loading…"));
  overlay.append(drawer);

  let data;
  try {
    data = await get(`/objects/${typeName}/${encodeURIComponent(pk)}`);
  } catch (e) {
    drawer.innerHTML = "";
    drawer.append(el("div", { class: "empty" }, e.message));
    return;
  }
  if (!data) { drawer.innerHTML = ""; drawer.append(el("div", { class: "empty" }, "Not found")); return; }

  const t = typeDef(typeName);
  const o = data.object;
  const title = o[t.title_column] || pk;
  const bodyProp = t.properties.find((p) => p.role === "body");
  const subtitle = t.properties.find((p) => p.role === "subtitle");

  drawer.innerHTML = "";
  drawer.append(el("div", { class: "drawer-head" },
    el("div", { class: "eyebrow" },
      el("span", { class: "swatch", style: `background:${t.color}` }),
      t.display_name,
      el("button", { class: "close", onclick: close }, "✕")),
    el("h2", {}, typeName === "Passage" ? `${o.work_title || "Passage"} ${title}` : title),
    subtitle ? el("div", { style: "color:var(--gray3);font-size:12px;margin-top:4px" },
      o[subtitle.api_name] || "") : null));

  const b = el("div", { class: "drawer-body" });
  drawer.append(b);

  if (bodyProp && o[bodyProp.api_name]) {
    b.append(el("div", { class: "passage-text" }, o[bodyProp.api_name]));
  }

  b.append(el("div", { class: "section-title" }, "Properties"));
  const dl = el("dl", { class: "props" });
  for (const p of t.properties) {
    if (p.role === "body") continue;
    let v = o[p.api_name];
    if (v == null || v === "") v = "—";
    else if (p.api_name.endsWith("language")) v = `${langName(v)} (${o[p.api_name]})`;
    else if (p.data_type === "integer") v = num(v);
    dl.append(el("dt", {}, p.display_name),
      el("dd", { class: p.api_name.includes("urn") ? "urn" : "" }, String(v)));
  }
  b.append(dl);

  for (const link of data.links) {
    const lt = typeDef(link.object_type);
    // "wrote" reads correctly from the Author side; from the Work side the
    // same edge has to read "written by", so links carry both labels.
    const label = link.direction === "outgoing"
      ? link.display_name
      : (link.inverse_name || link.display_name);
    b.append(el("div", { class: "section-title" },
      `${label} · ${lt.plural_name} (${num(link.total)})`));
    if (!link.objects.length) { b.append(el("div", { class: "note" }, "None.")); continue; }
    for (const other of link.objects) {
      const label = other[lt.title_column] || other[lt.primary_key];
      const detail = link.object_type === "Passage" ? truncate(other.text, 90)
        : link.object_type === "Work" ? [other.author, other.language && langName(other.language)]
            .filter(Boolean).join(" · ")
        : `${num(other.work_count)} works · ${num(other.passage_count)} passages`;
      b.append(el("div", { class: "link-row",
          onclick: () => openDrawer(link.object_type, other[lt.primary_key]) },
        el("span", { class: "ref" }, truncate(String(label), 28)),
        el("span", { class: "body" }, detail)));
    }
    if (link.total > link.objects.length) {
      b.append(el("button", { class: "btn", style: "margin-top:6px",
        onclick: () => {
          close();
          const key = link.object_type === "Passage" ? "edition_urn"
            : link.object_type === "Work" ? "author" : null;
          explorer.type = null;
          go(`explore/${link.object_type}`);
          setTimeout(() => {
            if (key) { explorer.filters = { [key]: o[key] || o[t.title_column] }; render(); }
          }, 30);
        } },
        `Open all ${num(link.total)} in the explorer`));
    }
  }
}

/* ---------- view: ontology manager ----------------------------------------- */
function viewOntology() {
  crumbs("Kleio", "Ontology manager");
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "view-head" },
    el("h1", {}, "Ontology manager"),
    el("p", {}, "Object types, their properties and the links between them. " +
      "This is the only place the shape of the workspace is defined — the explorer, " +
      "the search index and the API all read it at runtime, so a new object type is a " +
      "metadata change rather than a release.")));

  view.append(el("div", { class: "grid g-3" },
    state.ontology.object_types.map((t) =>
      el("div", { class: "card" },
        el("div", { class: "card-head" },
          el("div", { class: "type-head" },
            el("span", { class: "type-glyph", style: `background:${t.color}` },
              t.display_name[0]),
            el("div", {},
              el("h3", {}, t.display_name),
              el("div", { style: "color:var(--gray2);font-size:11px;font-family:var(--mono)" },
                t.backing_table))),
          el("span", { class: "hint" }, num(t.object_count))),
        el("div", { class: "card-body" },
          el("div", { class: "note", style: "margin-bottom:12px" }, t.description),
          el("div", { class: "prop-list" },
            t.properties.map((p) =>
              el("div", { class: "prop" },
                el("div", {},
                  el("div", { class: "name" }, p.display_name),
                  el("div", { class: "api" }, p.api_name)),
                el("span", { class: "role" }, p.role),
                el("span", { class: "tag" }, p.data_type)))),
          el("button", { class: "btn primary", style: "margin-top:14px;width:100%",
            onclick: () => go(`explore/${t.api_name}`) }, `Explore ${t.plural_name}`))))));

  view.append(el("div", { class: "mt" },
    card("Link types", "how objects join",
      el("div", { class: "prop-list" },
        state.ontology.link_types.map((l) =>
          el("div", { class: "prop" },
            el("div", {},
              el("div", { class: "name" },
                `${l.source_type} — ${l.display_name} → ${l.target_type}`),
              el("div", { class: "api" }, `${l.source_key} = ${l.target_key}`),
              el("div", { class: "note", style: "margin-top:4px" }, l.description)),
            el("span", { class: "role" }, l.cardinality.replace(/_/g, " ").toLowerCase()),
            el("span", { class: "tag" }, l.api_name)))))));
}

/* ---------- view: lineage --------------------------------------------------- */
const LAYERS = [
  ["raw", "Raw", "Bytes as they arrived from the source"],
  ["clean", "Parsed", "Structure extracted, nothing dropped"],
  ["sample", "Sampled", "The working slice this workspace runs on"],
  ["ontology", "Ontology", "Objects and indexes the UI reads"],
];

function viewLineage() {
  crumbs("Kleio", "Data lineage");
  const view = $("#view");
  view.innerHTML = "";
  const { nodes, edges } = state.lineage;

  view.append(el("div", { class: "view-head" },
    el("h1", {}, "Data lineage"),
    el("p", {}, "Every dataset in the workspace and the transform that produced it. " +
      "The point of keeping this visible is that when a number on the overview page " +
      "looks wrong, you can walk back to the file it came from without asking anybody.")));

  const lanes = el("div", { class: "card" }, el("div", { class: "card-body" },
    el("div", { class: "lineage" },
      LAYERS.map(([key, title, sub]) =>
        el("div", { class: "lane" },
          el("div", { class: "lane-title" }, title),
          el("div", { class: "note", style: "text-align:center;margin-bottom:12px;font-size:11px;color:var(--gray1)" }, sub),
          nodes.filter((n) => n.layer === key).map((n) =>
            el("div", { class: "node" },
              el("div", { class: "n-kind" }, n.kind),
              el("div", { class: "n-name" }, n.name),
              el("div", { class: "n-rows" }, num(n.row_count), " rows"),
              el("div", { class: "n-desc" }, n.description))))))));
  view.append(lanes);

  const byRid = Object.fromEntries(nodes.map((n) => [n.rid, n.name]));
  view.append(el("div", { class: "mt" },
    card("Transforms", `${edges.length} edges`,
      el("ul", { class: "edge-list", style: "margin:0;padding-left:18px" },
        edges.map((e) => el("li", {},
          el("code", {}, byRid[e.source_rid] || e.source_rid),
          " → ",
          el("code", {}, byRid[e.target_rid] || e.target_rid),
          el("span", { style: "color:var(--gray2)" }, ` · ${e.transform} — ${e.description}`)))))));
}

/* ---------- view: playbook -------------------------------------------------- */
function viewPlaybook() {
  crumbs("Kleio", "Why this shape");
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "view-head" },
    el("h1", {}, "Why this shape"),
    el("p", {}, "Foundry's value is not the pixels — it is that data, its meaning and its " +
      "provenance live in one place. Almost all of that survives being made small. " +
      "This is which parts were kept and which were deliberately dropped.")));

  const keep = [
    ["Ontology over tables", "Staff think in Customers and Orders, not joins. Object types, " +
      "properties and links are stored as data, so the explorer, the API and the search " +
      "index all follow one definition."],
    ["Lineage you can see", "Every dataset records the transform that made it. A wrong number " +
      "is traceable to a file, not to a person's memory."],
    ["Reproducible slices", "The sample is a seeded draw with its N, n and seed written to a " +
      "manifest, so anyone can redraw it and get the same rows."],
    ["Search that is part of the object", "Full-text search runs against the same objects the " +
      "explorer lists, not a separate system that drifts."],
  ];
  const drop = [
    ["No cluster", "Spark, Kubernetes and a data engineering team are what make Foundry cost " +
      "what it costs. One SQLite file and the Python standard library run this."],
    ["No code editor in the browser", "Transforms are ordinary Python files in the repository, " +
      "reviewed like any other code."],
    ["No permissions matrix", "An SMB has one team. Access control belongs at the network edge " +
      "until the second office opens."],
    ["No live sync", "Ingest is a command you run. Scheduling it is cron's job."],
  ];

  view.append(el("div", { class: "grid g-2" },
    card("Kept", "the parts that carry the value",
      keep.map(([h, p]) => el("div", { style: "margin-bottom:14px" },
        el("div", { class: "note" }, el("strong", {}, h)),
        el("div", { class: "note", style: "color:var(--gray3);margin-top:3px" }, p)))),
    card("Dropped on purpose", "what makes it fit a small team",
      drop.map(([h, p]) => el("div", { style: "margin-bottom:14px" },
        el("div", { class: "note" }, el("strong", {}, h)),
        el("div", { class: "note", style: "color:var(--gray3);margin-top:3px" }, p))))));

  view.append(el("div", { class: "mt" },
    card("Swapping in your own data", "the corpus is the demo, not the product",
      el("div", { class: "note" },
        "Nothing in the front end mentions Greek. To point this at a different domain: load your " +
        "rows into the same SQLite file, add one row per object type to ", el("code", {}, "object_types"),
        ", one per field to ", el("code", {}, "object_properties"), ", one per relationship to ",
        el("code", {}, "link_types"), ", and create a flat ", el("code", {}, "obj_<Type>"),
        " view. The explorer, facets, drawer and API pick it up on reload.",
        el("ul", { class: "tight" },
          el("li", {}, el("strong", {}, "A bookshop: "), "Title, Customer, Order — the same three-type shape."),
          el("li", {}, el("strong", {}, "A clinic: "), "Patient, Visit, Note — links carry the history."),
          el("li", {}, el("strong", {}, "A workshop: "), "Job, Part, Supplier — lineage shows which price list a quote used."))))));
}

/* ---------- view: figures ------------------------------------------------- */
/* The interactive figure canvas lives in figures.js so this file stays about
 * the ontology. It renders itself into whatever container it is handed and
 * cancels its own animation frame when the node leaves the document. */
function viewFigures() {
  crumbs("Kleio", "Figures");
  const view = $("#view");
  view.innerHTML = "";
  if (window.KleioFigures) window.KleioFigures.render(view);
  else view.append(el("div", { class: "empty" }, "figures.js failed to load"));
}

/* ---------- router ---------------------------------------------------------- */
function go(path) { location.hash = "#/" + path; }

function parseRoute() {
  const raw = (location.hash || "#/home").slice(2);
  const [path, query] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { id: path || "home", parts, params: new URLSearchParams(query || "") };
}

async function render() {
  state.route = parseRoute();
  $("#overlay").innerHTML = "";  // a route change closes any open detail drawer
  renderRail();
  const { parts, params } = state.route;
  try {
    if (parts[0] === "explore" && parts[1]) await viewExplore(parts[1], params);
    else if (parts[0] === "ontology") viewOntology();
    else if (parts[0] === "lineage") viewLineage();
    else if (parts[0] === "figures") viewFigures();
    else if (parts[0] === "playbook") viewPlaybook();
    else viewHome();
  } catch (e) {
    $("#view").innerHTML = "";
    $("#view").append(el("div", { class: "empty" }, "Failed to render: " + e.message));
    console.error(e);
  }
}

async function boot() {
  try {
    const [ontology, metrics, lineage] = await Promise.all([
      get("/ontology"), get("/metrics"), get("/lineage"),
    ]);
    Object.assign(state, { ontology, metrics, lineage });
  } catch (e) {
    $("#view").innerHTML = "";
    $("#view").append(el("div", { class: "empty" },
      "Cannot reach the API: " + e.message + ". Start it with python3 api/server.py"));
    return;
  }
  window.addEventListener("hashchange", render);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("#overlay").innerHTML = "";
  });
  render();
}

boot();
