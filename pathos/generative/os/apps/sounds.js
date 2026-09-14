// Animal soundboard. No audio files (offline, no network) — a WebAudio
// chirp stands in for a "sound", and speechSynthesis says the animal's name.

const ANIMALS = [
  { emoji: "🐸", name: "frog", freq: 220 },
  { emoji: "🐱", name: "cat", freq: 660 },
  { emoji: "🐶", name: "dog", freq: 330 },
  { emoji: "🐮", name: "cow", freq: 165 },
  { emoji: "🐷", name: "pig", freq: 440 },
  { emoji: "🐔", name: "chicken", freq: 880 },
];

export default function mount(container, api) {
  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(3, 1fr)";
  grid.style.gap = "4vmin";
  grid.style.width = "min(90vw, 640px)";

  for (const a of ANIMALS) {
    const btn = document.createElement("button");
    btn.textContent = a.emoji;
    btn.setAttribute("aria-label", a.name);
    btn.style.fontSize = "clamp(3rem, 10vmin, 5rem)";
    btn.style.aspectRatio = "1";
    btn.style.border = "none";
    btn.style.borderRadius = "28px";
    btn.style.background = "#ffffff";
    btn.style.boxShadow = "0 8px 0 rgba(0,0,0,0.1)";
    btn.addEventListener("click", () => {
      api.say(a.name);
      api.tone(a.freq, 220);
    });
    grid.appendChild(btn);
  }

  container.appendChild(grid);
}
