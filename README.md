# WASD Page Scroller

Scroll web pages with **WASD** keys, like movement in-game. Toggle with **Alt+S**.

🌐 **Website & download:** <https://awsd-scroller.vercel.app/>

## Features

- Smooth scrolling with `W` / `A` / `S` / `D` (diagonal movement normalized)
- Snap navigation on short-form video: `S` = next, `W` = previous
  (Instagram Reels, TikTok, YouTube Shorts, Facebook Reels, Spotlight)
- Story navigation: `D` = next, `A` = previous (Instagram/Facebook Stories)
- Adjustable scroll speed via the popup (2–30 px/frame)
- Works inside inner scroll containers (modals, feeds), not just the page root
- Toggle anywhere with `Alt+S`; setting persists across sites

## Install

### Option 1 — Download the build

Get `wasd-scroller-chrome.zip` from the
[official website](https://awsd-scroller.vercel.app/),
unzip it, then in Chrome/Edge/Brave go to `chrome://extensions`,
enable **Developer mode**, and **Load unpacked** the folder.

### Option 2 — Build from source

Requirements: Node.js 18+.

```powershell
npm.cmd install
npm.cmd run build      # Chrome/Edge -> .output/chrome-mv3
npm.cmd run build:firefox  # Firefox -> .output/firefox-mv2
```

Then **Load unpacked** the corresponding `.output` folder.
For a store-ready archive: `npm.cmd run zip`.

### Option 3 — Dev mode (live reload)

```powershell
npm.cmd run dev         # Chrome
npm.cmd run dev:firefox # Firefox
```

## Usage

| Keys    | Action                                              |
| ------- | --------------------------------------------------- |
| W/A/S/D | Scroll up/left/down/right                         |
| W/S     | Previous/next video on Reels, TikTok, Shorts      |
| A/D     | Previous/next story in Instagram/Facebook Stories |
| Alt+S   | Toggle the extension on/off                       |

Keys are ignored while typing in inputs, textareas, and editable fields.

## Tests

```powershell
npm.cmd test   # Vitest, 59 unit tests (utils/scroll-logic.test.js)
```

Pure logic (key mapping, route detection, speed clamp, message validation)
lives in `utils/scroll-logic.js` and is unit-tested. DOM heuristics
(`findScrollTarget`, `stepReel`) need a real browser and are not covered.

## Permissions

- `storage` — persist the on/off state and speed setting.
- Content scripts run on all URLs (`<all_urls>`) because scrolling any page
  is the extension's core purpose. No browsing data is collected or transmitted.

## AI disclosure / disclaimer

**This project was built with AI assistance.** Code, tests, styles, copy, and
docs were produced with AI coding agents (including OpenCode) under human
direction, then reviewed and tested by the maintainer.

- AI-generated output can contain mistakes: review changes before trusting
  them, and report bugs via GitHub issues.
- No warranty is provided; use at your own risk.
- No user data is collected by this extension; the AI tools used during
  development received only this repo's source code, never your browsing data.
