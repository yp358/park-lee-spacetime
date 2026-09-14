// μOS kernel — boot, show icons, run one app full-screen, go home. That's the whole OS.
// Adding an app never touches this file: see README.md.

const boot = document.getElementById("boot");
const bootMark = document.getElementById("boot-mark");
const desktop = document.getElementById("desktop");
const icons = document.getElementById("icons");
const hudCount = document.getElementById("hud-count");
const appScreen = document.getElementById("app-screen");
const appBody = document.getElementById("app-body");
const appTitle = document.getElementById("app-title");
const homeBtn = document.getElementById("home-btn");
const themeToggle = document.getElementById("theme-toggle");

let audioCtx = null;
let activeCleanup = null;

// Shared capabilities handed to every app — kept tiny and offline-only on purpose.
const api = {
  say(text) {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(String(text));
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  },
  tone(freq = 440, ms = 150) {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + ms / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + ms / 1000);
  },
};

// ---- theme: dark (the 8-bit screen) / light (the paper chassis) ----
// Ported palette from pathos/generative/parklee.css so μOS reads as the
// same machine as https://yp358.github.io/. See os.css for the tokens.
function loadTheme() {
  try {
    return localStorage.getItem("mu-os-theme");
  } catch {
    return null;
  }
}
function saveTheme(t) {
  try {
    localStorage.setItem("mu-os-theme", t);
  } catch {
    /* private browsing or blocked storage — theme just won't persist */
  }
}
function applyTheme(t) {
  if (t) document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
}
function toggleTheme() {
  const current =
    document.documentElement.getAttribute("data-theme") ||
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  saveTheme(next);
  api.tone(next === "dark" ? 330 : 520, 90);
}

// ---- the ∞ mark — same pixel-art technique and bitmap as parklee.js,
// so μOS's boot mark is the exact Park-Lee Spacetime logo, not a new one.
function pixelSVG(rows, unit, cls = "") {
  const w = rows[0].length, h = rows.length;
  let d = "";
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (rows[y][x] === "X") d += `M${x} ${y}h1v1h-1z`;
  return `<svg class="${cls}" width="${w * unit}" height="${h * unit}" viewBox="0 0 ${w} ${h}"
    shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"/></svg>`;
}
const INFINITY_BITMAP = [
  ".XX...XX.",
  "X..X.X..X",
  "X...X...X",
  "X..X.X..X",
  ".XX...XX.",
];

function goHome() {
  if (typeof activeCleanup === "function") activeCleanup();
  activeCleanup = null;
  appBody.innerHTML = "";
  appScreen.hidden = true;
  desktop.hidden = false;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

async function openApp(entry, name) {
  api.say(name);
  appTitle.textContent = name.toUpperCase();
  desktop.hidden = true;
  appScreen.hidden = false;
  const mod = await import(`./apps/${entry}`);
  activeCleanup = mod.default(appBody, api) || null;
}

function renderIcons(apps) {
  icons.innerHTML = "";
  for (const app of apps) {
    const btn = document.createElement("button");
    btn.className = "tile";
    btn.setAttribute("aria-label", app.name);
    btn.innerHTML = `<span class="glyph">${app.emoji}</span><span class="tn">${app.name}</span>`;
    btn.addEventListener("click", () => openApp(app.entry, app.name));
    icons.appendChild(btn);
  }
  if (hudCount) hudCount.textContent = `APPS: ${apps.length}`;
}

async function main() {
  bootMark.innerHTML = pixelSVG(INFINITY_BITMAP, 11);
  applyTheme(loadTheme());
  themeToggle.addEventListener("click", toggleTheme);

  const apps = await fetch("./apps.json").then((r) => r.json());
  renderIcons(apps);
  homeBtn.addEventListener("click", goHome);

  setTimeout(() => {
    boot.hidden = true;
    desktop.hidden = false;
  }, 900);
}

main();
