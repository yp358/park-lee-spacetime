# μOS — the smallest desktop in the world

**Status**: Prototype
**Follows the format precedent of**: `creos/pre/data/000_shubam_pre` (one-file-per-concern, `dev.sh`, no build step)
**Domain role**: `pathos/generative/` — an AI-directed generative pipeline, per `pathos/README.md`

## One-liner

A "smallest OS in existence" that runs entirely as a static web app: a boot
screen, a home screen of giant icons, and one full-screen app at a time. Every
app is a single small file. Installing a new app never touches the kernel —
you add one entry to `apps.json` and one file to `apps/`.

## Who it's for

Every screen assumes the user is **5 years old and cannot read yet**:

- No typing, ever. No text input fields anywhere.
- Every tap target is at least 120px. Nothing depends on precision.
- Icons are large emoji, not words. Labels exist for a watching adult, not
  as instructions the child must parse.
- Every action gets instant visual and spoken feedback (`speechSynthesis`).
- Nothing destructive happens without being trivially undoable (a "clear"
  button, never a "delete forever" one).
- No network calls, no ads, no accounts. Everything is generated locally —
  `WebAudio` tones instead of audio files, inline SVG instead of images.
- One giant "home" button is always on screen. A 5-year-old can never get
  lost or stuck.

## Why "smallest OS"

An operating system, minimally, is: something that boots, something that
shows you what you can run, and something that runs one thing at a time and
lets you get back out. That's the whole kernel here — `os.js` is ~100 lines
and never grows. Overlapping draggable windows (the usual "OS" affordance)
are deliberately *not* implemented: a toddler dragging a window off-screen is
a support call, not a feature. One app fills the screen; the home button
always returns you to the desktop.

## Self-generative loop

The kernel doesn't know what apps exist — it reads `apps.json` at boot,
draws one icon per entry, and `import()`s the named file from `apps/` only
when that icon is tapped. Each app file's sole contract:

```js
export default function mount(container, api) {
  // build the app's DOM inside `container`
  // api.say(text) speaks it aloud
  // api.tone(freq, ms) plays a short WebAudio beep
  // return an optional cleanup() function, called on home
}
```

So "self-generative" means literally this: a new app — hand-written today,
AI-generated later — is installable by writing one file that satisfies that
contract and appending one line to `apps.json`. Nothing else in the system
needs to change or even be re-read; the kernel already re-fetches
`apps.json` on every boot.

## Design system

μOS's chrome is ported from `pathos/generative/parklee.css` — the same
`Press Start 2P` + `JetBrains Mono` fonts, the same `scr-0…scr-3` + amber
`shine` dark palette (that CSS's "PATHOS" panel already *is* an 8-bit OS
screen), the same scanline overlay, and the same `.win`/`.tile`/`.hud`
component shapes, so μOS reads as the same machine as
[yp358.github.io](https://yp358.github.io/). The boot mark reuses the exact
`pixels()` bitmap technique and ∞ glyph from `parklee.js` rather than a new
one, for brand continuity.

A light theme (that CSS's "paper" chassis: black ink on `#fafafa`, human-blue
accent) is layered in as the alternate `data-theme="light"` state — dark is
the default, since an 8-bit screen is closer to what "OS" evokes, but both
exist now as the foundation this cloudOS keeps building on. The toggle lives
top-right on every screen; the choice persists in `localStorage`. App icons
stay emoji rather than pixel-art glyphs — a 5-year-old needs to recognize a
crayon or a frog instantly, which small monochrome bitmaps don't give you as
reliably as full-color emoji do, so that's the one deliberate departure from
strict pixel-art fidelity.

## File structure

```
pathos/generative/os/
├── README.md        this file
├── dev.sh            quick-start static server
├── index.html         boot screen + desktop shell (the entrypoint)
├── os.css              desktop chrome, big-tap-target rules, boot animation
├── os.js                the kernel: boot → desktop → app loader → home
├── apps.json              the app registry (id, name, emoji, color, entry)
└── apps/
    ├── draw.js             finger-paint canvas, 6 giant color swatches
    ├── count.js             tap to count 0-20, spoken numbers, big +/-
    └── sounds.js             animal-emoji soundboard, spoken name + tone
```

## Run it

```sh
cd pathos/generative/os
./dev.sh                  # → http://localhost:4321
```

(Matches the `creos/pre/data/000_shubam_pre` convention: `python3 -m
http.server`, no build step, no dependencies.)

## Adding an app

1. Create `apps/yourapp.js` exporting a default `mount(container, api)`.
2. Append `{"id": "yourapp", "name": "Your App", "emoji": "🌟", "color":
   "#hex", "entry": "yourapp.js"}` to `apps.json`.
3. Reload. The kernel needs no other changes.
