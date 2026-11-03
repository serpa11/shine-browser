# Shine Browser

**A powerful Safari-styled browser with the Shine desktop app built right in.**

Shine Browser pairs a modern Chromium engine with the exact UI of
[shineai-9mr.pages.dev](https://shineai-9mr.pages.dev) — open Shine in a
split-screen panel next to any tab, highlight text and hit **Ask Shine**,
let Shine drive your browser, and control your PC from the chat.

---

## Features

### Shine, side by side
- **Open Shine split screen** — `Ctrl+Shift+S` or the sparkle button. Shine loads
  natively beside your tabs, with a draggable divider and a maximize toggle.
- **Ask Shine about this** — select any text and a glass action pill appears:
  *Ask Shine · Search on Google · Search this site · Copy · Translate · Define · Print · More*.
  "More" adds Summarize, Rewrite, Improve, Reading mode, Wikipedia / X / YouTube search.
- **Context menu parity** — right-click a selection for *Ask Shine about this*,
  Google search, site search, copy, translate, plus full link/image/edit items.
- **Browser control in Shine** — the Shine page can drive the browser through
  `window.shineBrowser.*` (and a `postMessage` protocol):
  `navigate`, `search`, `newTab`, `closeTab`, `back`, `forward`, `reload`,
  `bookmark`, `togglePanel`, `screenshot`, `openChromeWebStore`, …
- **PC Control in Shine** — `openApp('Notepad')`, `listApps()`, `sysInfo()`,
  `processes()`, `reveal(path)`. A dedicated **PC Control** panel lists every
  installed app (Start Menu + registry), system specs, live processes and
  one-click screenshots.

### Full Chrome feature parity
- Tabs (drag-free, middle-click close, `Ctrl+1..9`, `Ctrl+Tab`), private windows
- Favorites / bookmarks manager with star in the omnibox (`Ctrl+B`, `Ctrl+D`)
- History with search & clear (`Ctrl+H`), Downloads with live progress (`Ctrl+J`)
- **Extensions** — load unpacked extensions, or browse the **Chrome Web Store**:
  any `.crx` you download is unpacked and installed automatically into the
  persistent browser session (Manifest V2 + V3 supported by the Chromium engine)
- Omnibox with Google / Bing / DuckDuckGo / Brave / Ecosia / Startpage / YouTube
  search, bookmark & history suggestions, and an *Ask Shine* suggestion row
- Find in page (`Ctrl+F`), zoom (`Ctrl + / − / 0`), print (`Ctrl+P`),
  save page (`Ctrl+S`), Cast, Task manager, Reading mode, Screenshots
- Developer tools (`F12`), full native context menu, spellcheck
- New Tab page with the Shine sparkle, quick tiles and its own search bar
- Profiles (renameable), light theme, per-profile persistent storage

### Up to date for 2026
Built on **Electron 45 / Chromium** — the same engine class as current Chrome,
so every modern site, API, codec and TLS version works out of the box.

---

## Install

```powershell
# 1. build the app + installer (NSIS setup exe + portable exe)
npm install
npm run dist

# 2. run the standalone installer
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

`npm run dist` produces:
- `dist/ShineBrowserSetup-1.0.0.exe` — one-click installer (Desktop + Start menu
  shortcuts, optional taskbar pin)
- `dist/Shine Browser 1.0.0.exe` — portable build

The app also has a **first-run setup window** that installs shortcuts for you
(Desktop, Start menu, taskbar pin) and can be re-run from *Settings → Re-run
installer*.

## Develop

```powershell
npm start          # run from source
npm run icons      # regenerate build/icon.ico from scripts/make_icon.py
```

## Project layout

```
shine-browser/
├── app/                     # Electron main process
│   ├── main.js              # window, WebContentsView tabs, Shine panel, IPC
│   ├── preload.js           # renderer bridge
│   ├── shine-preload.js     # bridge injected into shineai-9mr.pages.dev
│   ├── webview-preload.js   # selection/context bridge for browsed pages
│   ├── installer.js         # shortcuts, taskbar pin, setup status
│   ├── extensions.js        # load / remove / auto-install .crx extensions
│   ├── downloads.js         # download tracking
│   ├── sysinfo.js           # PC Control: apps, specs, launch, screenshot
│   └── store.js             # JSON persistence (bookmarks, history, …)
├── renderer/                # the browser chrome (Shine design system)
│   ├── index.html
│   ├── style.css
│   └── js/                  # tabs, omnibox, panels, menus, Shine bridge
├── scripts/
│   ├── make_icon.py         # generates build/icon.ico
│   └── install.ps1          # standalone Windows installer
└── build/icon.ico
```

## Shine browser-control API

Call from the Shine panel (console or the live Shine page):

```js
shineBrowser.navigate('https://example.com')
shineBrowser.search('electron webview api')
shineBrowser.newTab('https://github.com')
shineBrowser.openApp('notepad')      // PC Control
shineBrowser.sysInfo()               // CPU / RAM / disk / OS
shineBrowser.screenshot()
shineBrowser.listApps()
```

## License

MIT — see [LICENSE](LICENSE).
