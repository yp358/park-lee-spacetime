// Finger-paint. No save/load, no undo needed — the only destructive action
// is "clear", and it's one giant broom tap away from a blank page again.

const COLORS = ["#ff5a5f", "#3ec9ff", "#7ed957", "#ffd23f", "#b660ff", "#22222a"];

export default function mount(container, api) {
  container.style.gap = "2vmin";

  const canvas = document.createElement("canvas");
  canvas.style.width = "min(90vw, 700px)";
  canvas.style.height = "min(55vh, 500px)";
  canvas.style.background = "#ffffff";
  canvas.style.borderRadius = "24px";
  canvas.style.boxShadow = "0 8px 0 rgba(0,0,0,0.1)";
  canvas.style.touchAction = "none";
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  let color = COLORS[0];
  let drawing = false;
  let last = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  resize();
  window.addEventListener("resize", resize);

  function point(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  function start(e) {
    drawing = true;
    last = point(e);
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = point(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  }
  function end() {
    drawing = false;
  }

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", start);
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", end);

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "2vmin";
  row.style.flexWrap = "wrap";
  row.style.justifyContent = "center";

  for (const c of COLORS) {
    const swatch = document.createElement("button");
    swatch.style.width = "64px";
    swatch.style.height = "64px";
    swatch.style.borderRadius = "999px";
    swatch.style.border = c === color ? "5px solid #22222a" : "5px solid transparent";
    swatch.style.background = c;
    swatch.addEventListener("click", () => {
      color = c;
      [...row.children].forEach((el) => (el.style.border = "5px solid transparent"));
      swatch.style.border = "5px solid #22222a";
    });
    row.appendChild(swatch);
  }

  const clear = document.createElement("button");
  clear.textContent = "🧹";
  clear.setAttribute("aria-label", "Clear");
  clear.style.width = "64px";
  clear.style.height = "64px";
  clear.style.borderRadius = "999px";
  clear.style.border = "none";
  clear.style.background = "#ffffff";
  clear.style.fontSize = "1.8rem";
  clear.addEventListener("click", () => {
    api.tone(300, 120);
    resize();
  });
  row.appendChild(clear);

  container.appendChild(row);

  return () => window.removeEventListener("resize", resize);
}
