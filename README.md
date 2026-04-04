# lil agents win 🖥️✨

![lil agents win](public/assets/hero.png)

**Tiny AI companions that live on your Windows taskbar.**

Bruce and Jazz walk back and forth above your taskbar. Click one to open an AI terminal. They walk, they think, they vibe — now natively on Windows.

> The Windows port of [lil-agents](https://github.com/ryanstephen/lil-agents) by [@ryanstephen](https://github.com/ryanstephen)

---

## ⚡ quick start

```powershell
git clone https://github.com/Arigitshub/lil-agents-win.git
cd lil-agents-win
npm install
npm start
```

That's it. Bruce and Jazz will appear above your taskbar.

## ✨ features

- 🚶 **Animated characters** — Transparent WebM video with alpha, walking with eased motion curves
- 💬 **Click to chat** — Each character opens a real AI terminal
- 🤖 **Multi-provider** — Claude, Codex, Gemini, Copilot, OpenCode — switch from the system tray
- 🎨 **Four themes** — Peach, Midnight, Cloud, Moss (switch from the system tray)
- 💭 **Thinking bubbles** — Playful phrases while your agent works ("vibing...", "cooking...", "don't rush me")
- 🔔 **Completion alerts** — Characters celebrate when done ("ta-da!", "boom!")
- 🖥️ **Taskbar native** — Characters walk *above* your taskbar, never behind it
- 🖱️ **Click-through** — Transparent windows don't block your desktop
- ⚙️ **System tray** — Toggle characters, providers, themes, and sounds
- ⌨️ **Slash commands** — `/clear`, `/copy` in the chat terminal
- 🔄 **Session management** — Refresh button to restart sessions
- 🔍 **Auto-detect** — Automatically finds which AI CLIs are installed

## 🎨 themes

| Peach 🍑 | Midnight 🌙 | Cloud ☁️ | Moss 🌿 |
|----------|-------------|----------|---------|
| Playful pink & warm | Dark mode + orange accents | Clean Fluent UI | Retro organic terminal |

## 🤖 supported providers

| Provider | Binary | Install | Input Mode |
|----------|--------|---------|------------|
| **Claude** | `claude` | `npm i -g @anthropic-ai/claude-code` | Stream JSON (persistent) |
| **Codex** | `codex` | `npm i -g @openai/codex` | Per-message spawn |
| **Gemini** | `gemini` | `npm i -g @google/gemini-cli` | Per-message spawn |
| **Copilot** | `copilot` | `npm i -g @github/copilot-cli` | Per-message spawn |
| **OpenCode** | `opencode` | `curl -fsSL https://opencode.ai/install \| bash` | Per-message spawn |

Switch providers from the **system tray → Provider** menu. The app auto-detects which CLIs you have installed.

## 🛠️ requirements

- **Windows 10/11**
- **Node.js 18+**
- At least one supported AI CLI installed (see table above)

## 🏗️ architecture

This is a faithful port of the [macOS original](https://github.com/ryanstephen/lil-agents). Key differences:

| macOS | Windows |
|-------|---------|
| Swift + AppKit | Electron + Node.js |
| HEVC Alpha `.mov` | VP9 Alpha `.webm` |
| NSWindow per character | BrowserWindow per character |
| CVDisplayLink (60fps) | setInterval (60fps) |
| NSPopover | Separate BrowserWindow |
| NSStatusItem | Electron Tray |

The walking motion uses the **exact same eased movement curves** from the original Swift code — smooth acceleration, linear cruise, and deceleration per character.

## 📂 project structure

```
lil-agents-win/
├── main.js              # Electron main process — windows, walking, tray
├── preload.js           # Secure IPC bridge
├── renderer/
│   ├── character.html   # Transparent video + thinking bubble
│   └── terminal.html    # Chat terminal with 4 themes
├── public/assets/
│   ├── walk-bruce.webm  # Bruce walking (VP9 alpha)
│   └── walk-jazz.webm   # Jazz walking (VP9 alpha)
└── package.json
```

## 🤝 contributing

PRs welcome! Some ideas:
- Add more AI providers
- Add more characters
- Add sound effects
- Add an installer/auto-updater
- Multi-monitor support
- Custom API endpoint support

## 📄 license

MIT License. See [LICENSE](LICENSE) for details.

---

**Made with 💛 for Windows users who deserve cute AI friends too.**
