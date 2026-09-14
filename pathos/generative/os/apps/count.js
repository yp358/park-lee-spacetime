// Tap to count, 0-20. Every change is spoken aloud so reading is never required.

export default function mount(container, api) {
  let n = 0;

  const display = document.createElement("div");
  display.style.fontSize = "clamp(6rem, 30vmin, 12rem)";
  display.style.fontWeight = "800";
  display.textContent = n;
  container.appendChild(display);

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "6vmin";

  function makeBtn(label, delta, color) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.width = "140px";
    btn.style.height = "140px";
    btn.style.borderRadius = "999px";
    btn.style.border = "none";
    btn.style.background = color;
    btn.style.fontSize = "3rem";
    btn.style.color = "#fff";
    btn.style.boxShadow = "0 8px 0 rgba(0,0,0,0.15)";
    btn.addEventListener("click", () => {
      n = Math.max(0, Math.min(20, n + delta));
      display.textContent = n;
      api.say(n);
      api.tone(220 + n * 20, 120);
    });
    return btn;
  }

  row.appendChild(makeBtn("−", -1, "#ff5a5f"));
  row.appendChild(makeBtn("+", 1, "#3ec9ff"));
  container.appendChild(row);
}
