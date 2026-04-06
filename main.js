const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');

// ── Provider definitions (mirrors AgentSession.swift) ─────────────────────────
const PROVIDERS = {
  claude: {
    name: 'Claude',
    binary: 'claude',
    args: ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
    inputMode: 'stream-json', // sends JSON to stdin
    install: 'npm install -g @anthropic-ai/claude-code',
  },
  codex: {
    name: 'Codex',
    binary: 'codex',
    args: ['exec', '--json', '--full-auto', '--skip-git-repo-check'],
    inputMode: 'arg', // message is appended as last arg
    install: 'npm install -g @openai/codex',
  },
  gemini: {
    name: 'Gemini',
    binary: 'gemini',
    args: ['--yolo', '-p'],
    inputMode: 'arg',
    install: 'npm install -g @google/gemini-cli',
  },
  copilot: {
    name: 'Copilot',
    binary: 'copilot',
    args: ['-p'],
    inputMode: 'arg',
    install: 'npm install -g @github/copilot-cli',
  },
  opencode: {
    name: 'OpenCode',
    binary: 'opencode',
    args: ['-p'],
    inputMode: 'arg',
    install: 'curl -fsSL https://opencode.ai/install | bash',
  },
};

function detectAvailableProviders() {
  const available = {};
  for (const [key, prov] of Object.entries(PROVIDERS)) {
    try {
      execSync(`where ${prov.binary}`, { stdio: 'ignore' });
      available[key] = true;
    } catch {
      available[key] = false;
    }
  }
  return available;
}

// ── Character state (mirrors WalkerCharacter.swift) ───────────────────────────
class WalkerCharacter {
  constructor(name, videoFile, opts = {}) {
    this.name = name;
    this.videoFile = videoFile;
    this.displayHeight = 150;
    this.displayWidth = Math.round(this.displayHeight * (1080 / 1920));

    // Walk timing from frame analysis (matches Swift)
    this.accelStart    = opts.accelStart    ?? 3.0;
    this.fullSpeedStart= opts.fullSpeedStart?? 3.75;
    this.decelStart    = opts.decelStart    ?? 7.5;
    this.walkStop      = opts.walkStop      ?? 8.25;
    this.videoDuration = 10.0;
    this.walkAmountRange = opts.walkAmountRange ?? [0.25, 0.5];
    this.yOffset       = opts.yOffset       ?? 0;

    // Walk state
    this.positionProgress = opts.startPos ?? 0.3;
    this.isWalking  = false;
    this.isPaused   = true;
    this.isIdle     = false;   // idle = clicked, showing popover
    this.goingRight = true;
    this.walkStartTime = 0;
    this.walkStartPos  = 0;
    this.walkEndPos    = 0;
    this.pauseEndTime  = Date.now() + randomRange(500, 3000);

    // Windows
    this.win = null;        // character window
    this.popoverWin = null; // chat popover

    // Agent session
    this.process = null;
    this.isBusy  = false;
  }

  // Movement curve (matches Swift movementPosition)
  movementPosition(videoTime) {
    const dIn  = this.fullSpeedStart - this.accelStart;
    const dLin = this.decelStart - this.fullSpeedStart;
    const dOut = this.walkStop - this.decelStart;
    const v = 1.0 / (dIn / 2.0 + dLin + dOut / 2.0);

    if (videoTime <= this.accelStart) return 0.0;
    if (videoTime <= this.fullSpeedStart) {
      const t = videoTime - this.accelStart;
      return v * t * t / (2.0 * dIn);
    }
    if (videoTime <= this.decelStart) {
      const easeInDist = v * dIn / 2.0;
      const t = videoTime - this.fullSpeedStart;
      return easeInDist + v * t;
    }
    if (videoTime <= this.walkStop) {
      const easeInDist = v * dIn / 2.0;
      const linearDist = v * dLin;
      const t = videoTime - this.decelStart;
      return easeInDist + linearDist + v * (t - t * t / (2.0 * dOut));
    }
    return 1.0;
  }

  startWalk(travelDistance) {
    this.isPaused  = false;
    this.isWalking = true;
    this.walkStartTime = Date.now();

    if (this.positionProgress > 0.85) this.goingRight = false;
    else if (this.positionProgress < 0.15) this.goingRight = true;
    else this.goingRight = Math.random() > 0.5;

    this.walkStartPos = this.positionProgress;
    const refWidth = 500;
    const walkPx = randomRange(this.walkAmountRange[0], this.walkAmountRange[1]) * refWidth;
    const walkAmount = travelDistance > 0 ? walkPx / travelDistance : 0.3;

    if (this.goingRight) {
      this.walkEndPos = Math.min(this.walkStartPos + walkAmount, 1.0);
    } else {
      this.walkEndPos = Math.max(this.walkStartPos - walkAmount, 0.0);
    }

    // Tell renderer to play + flip
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('walk', { playing: true, goingRight: this.goingRight });
    }
  }

  enterPause() {
    this.isWalking = false;
    this.isPaused  = true;
    this.pauseEndTime = Date.now() + randomRange(5000, 12000);

    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('walk', { playing: false, goingRight: this.goingRight });
    }
  }

  // Calculate Y: on Windows, Y=0 is top of screen, increases downward.
  // areaTopY = the Y coordinate of the top edge of the taskbar.
  // We want the character's feet to sit right at the taskbar, with some
  // of the bottom (15%) overlapping the taskbar for a natural look.
  getY(areaTopY) {
    // Shift the character UP by its full height, then let 15% of the
    // bottom hang over the taskbar edge so feet touch the bar.
    return Math.round(areaTopY - this.displayHeight * 0.85 + this.yOffset);
  }

  updateFrame(areaX, areaWidth, areaTopY) {
    if (this.isIdle) {
      const travelDist = Math.max(areaWidth - this.displayWidth, 0);
      const x = Math.round(areaX + travelDist * this.positionProgress);
      const y = this.getY(areaTopY);
      if (this.win && !this.win.isDestroyed()) this.win.setPosition(x, y);
      return;
    }

    const now = Date.now();
    const travelDist = Math.max(areaWidth - this.displayWidth, 0);

    if (this.isPaused) {
      if (now >= this.pauseEndTime) {
        this.startWalk(travelDist);
      } else {
        const x = Math.round(areaX + travelDist * this.positionProgress);
        const y = this.getY(areaTopY);
        if (this.win && !this.win.isDestroyed()) this.win.setPosition(x, y);
        return;
      }
    }

    if (this.isWalking) {
      const elapsed = (now - this.walkStartTime) / 1000;
      const videoTime = Math.min(elapsed, this.videoDuration);

      const walkNorm = elapsed >= this.videoDuration ? 1.0 : this.movementPosition(videoTime);
      const pos = this.walkStartPos + (this.walkEndPos - this.walkStartPos) * walkNorm;
      this.positionProgress = Math.min(Math.max(pos, 0), 1);

      if (elapsed >= this.videoDuration) {
        this.enterPause();
        return;
      }

      const x = Math.round(areaX + travelDist * this.positionProgress);
      const y = this.getY(areaTopY);
      if (this.win && !this.win.isDestroyed()) this.win.setPosition(x, y);
    }
  }
}

function randomRange(a, b) { return a + Math.random() * (b - a); }

// ── App state ─────────────────────────────────────────────────────────────────
let characters = [];
let tray = null;
let tickInterval = null;

const THEMES = ['Peach', 'Midnight', 'Cloud', 'Moss'];
let currentTheme = 'Peach';
let currentProvider = 'claude';
let soundsEnabled = true;
let availableProviders = {};

app.whenReady().then(() => {
  availableProviders = detectAvailableProviders();
  // Auto-select first available provider
  const firstAvailable = Object.keys(PROVIDERS).find(k => availableProviders[k]);
  if (firstAvailable) currentProvider = firstAvailable;

  // Create characters
  const bruce = new WalkerCharacter('Bruce', 'walk-bruce.webm', {
    accelStart: 3.0, fullSpeedStart: 3.75, decelStart: 8.0, walkStop: 8.5,
    walkAmountRange: [0.4, 0.65], yOffset: -3, startPos: 0.3,
  });
  const jazz = new WalkerCharacter('Jazz', 'walk-jazz.webm', {
    accelStart: 3.9, fullSpeedStart: 4.5, decelStart: 8.0, walkStop: 8.75,
    walkAmountRange: [0.35, 0.6], yOffset: -7, startPos: 0.7,
  });
  const moe = new WalkerCharacter('Moe', 'walk-jazz.webm', { // fallback to jazz video but with moe logic
    accelStart: 2.5, fullSpeedStart: 3.0, decelStart: 7.5, walkStop: 8.0,
    walkAmountRange: [0.5, 0.8], yOffset: -5, startPos: 0.5,
  });
  moe.yOffset = -10;
  jazz.pauseEndTime = Date.now() + randomRange(8000, 14000);

  characters = [bruce, jazz, moe];
  // Initial state: hide Moe, let user ADD him
  moe.hidden = true;
  
  characters.forEach(c => {
     if (!c.hidden) createCharacterWindow(c);
  });
  setupTray();
  startTick();

  // IPC: character clicked
  ipcMain.on('character-clicked', (e) => {
    const char = characters.find(c => c.win && c.win.webContents === e.sender);
    if (!char) return;
    if (char.isIdle) {
      closePopover(char);
    } else {
      openPopover(char);
    }
  });

  ipcMain.on('send-message', (e, msg) => {
    const char = characters.find(c => c.popoverWin && c.popoverWin.webContents === e.sender);
    if (!char) return;
    sendMessage(char, msg);
  });

  ipcMain.on('reset-session', (e) => {
    const char = characters.find(c => c.popoverWin && c.popoverWin.webContents === e.sender);
    if (char) restartSession(char);
  });

  ipcMain.on('switch-provider', (e, providerName) => {
    // Provider name comes in like "Claude", "GeminiCLI"... 
    // We need to find the key.
    const key = Object.keys(PROVIDERS).find(k => PROVIDERS[k].name === providerName || k === providerName.toLowerCase());
    if (key) switchProvider(key);
  });

  ipcMain.on('set-always-on-top', (e, value) => {
    // Apply to all windows (characters and popovers)
    characters.forEach(char => {
      if (char.win && !char.win.isDestroyed()) {
        char.win.setAlwaysOnTop(value, value ? 'screen-saver' : 'normal');
        // BUGFIX: Show in taskbar if NOT on top, so they can be found!
        char.win.setSkipTaskbar(!value); 
      }
      if (char.popoverWin && !char.popoverWin.isDestroyed()) {
        char.popoverWin.setAlwaysOnTop(value, value ? 'pop-up-menu' : 'normal');
        char.popoverWin.setSkipTaskbar(!value);
      }
    });
  });

  ipcMain.on('set-opacity', (e, value) => {
    characters.forEach(char => {
      if (char.win && !char.win.isDestroyed()) {
        char.win.setOpacity(value);
      }
    });
  });
});

app.on('window-all-closed', () => { /* keep tray alive */ });

// ── Create character window ──────────────────────────────────────────────────
function createCharacterWindow(char) {
  const win = new BrowserWindow({
    width: char.displayWidth,
    height: char.displayHeight,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(false);
  // Load the character renderer HTML
  win.loadFile(path.join(__dirname, 'renderer', 'character.html'), {
    query: { video: char.videoFile, name: char.name },
  });
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('walk', { playing: false, goingRight: char.goingRight });
  });
  char.win = win;
}

// ── Popover / terminal ──────────────────────────────────────────────────────
function openPopover(char) {
  // Close any sibling popover
  characters.forEach(c => { if (c !== char && c.isIdle) closePopover(c); });

  char.isIdle = true;
  char.isWalking = false;
  char.isPaused = true;
  if (char.win && !char.win.isDestroyed()) {
    char.win.webContents.send('walk', { playing: false, goingRight: char.goingRight });
  }

  if (!char.popoverWin || char.popoverWin.isDestroyed()) {
    const popW = 420, popH = 310;
    const charBounds = char.win.getBounds();
    let px = Math.round(charBounds.x + charBounds.width / 2 - popW / 2);
    let py = charBounds.y - popH - 10;

    const primaryDisplay = screen.getPrimaryDisplay();
    const wa = primaryDisplay.workArea;
    px = Math.max(wa.x + 4, Math.min(px, wa.x + wa.width - popW - 4));
    py = Math.max(wa.y + 4, py);

    const pop = new BrowserWindow({
      width: popW, height: popH,
      x: px, y: py,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
      },
    });
    pop.setAlwaysOnTop(true, 'pop-up-menu');
    pop.loadFile(path.join(__dirname, 'renderer', 'terminal.html'), {
      query: { name: char.name, theme: currentTheme, provider: PROVIDERS[currentProvider].name },
    });
    char.popoverWin = pop;

    // Start CLI session
    startSession(char);
  } else {
    char.popoverWin.show();
    char.popoverWin.focus();
  }
}

function closePopover(char) {
  if (!char.isIdle) return;
  if (char.popoverWin && !char.popoverWin.isDestroyed()) {
    char.popoverWin.hide();
  }
  char.isIdle = false;
  char.pauseEndTime = Date.now() + randomRange(2000, 5000);

  // Show thinking bubble if still busy
  if (char.isBusy && char.win && !char.win.isDestroyed()) {
    char.win.webContents.send('thinking', true);
  }
}

// ── CLI session management (multi-provider) ──────────────────────────────────
function startSession(char) {
  if (char.process) return;

  const prov = PROVIDERS[currentProvider];
  if (!prov) return;

  // Check if the provider binary is available
  if (!availableProviders[currentProvider]) {
    if (char.popoverWin && !char.popoverWin.isDestroyed()) {
      char.popoverWin.webContents.send('cli-error',
        `${prov.name} CLI not found.\n\nInstall it:\n  ${prov.install}`);
    }
    return;
  }

  char.providerKey = currentProvider;

  // For stream-json providers (Claude), spawn a persistent process
  if (prov.inputMode === 'stream-json') {
    const proc = spawn(prov.binary, prov.args, { shell: true, env: { ...process.env } });
    setupProcessHandlers(char, proc);
    char.process = proc;
  }
  // For arg-based providers, we spawn per-message (handled in sendMessage)
}

function setupProcessHandlers(char, proc) {
  let lineBuffer = '';

  proc.stdout.on('data', (chunk) => {
    lineBuffer += chunk.toString();
    let newlineIdx;
    while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.substring(0, newlineIdx);
      lineBuffer = lineBuffer.substring(newlineIdx + 1);
      if (line.trim()) {
        try {
          const json = JSON.parse(line);
          if (char.popoverWin && !char.popoverWin.isDestroyed()) {
            char.popoverWin.webContents.send('cli-data', json);
          }
          // Detect turn completion (varies by provider)
          const doneTypes = ['result', 'turn.completed', 'done', 'end', 'complete'];
          if (doneTypes.includes(json.type)) {
            char.isBusy = false;
            if (char.win && !char.win.isDestroyed()) {
              char.win.webContents.send('thinking', false);
              char.win.webContents.send('completion', true);
            }
          }
        } catch (e) {
          // Non-JSON line — send as plain text (Gemini fallback)
          if (char.popoverWin && !char.popoverWin.isDestroyed()) {
            char.popoverWin.webContents.send('cli-data', {
              type: 'assistant',
              message: { content: [{ type: 'text', text: line + '\n' }] }
            });
          }
        }
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    const trimmed = text.trim();
    // Filter spinner noise from Gemini and other CLIs
    const isNoise = /^[\u2800-\u28FF\u2713\u2192\u25C6]/.test(trimmed) || trimmed === '';
    if (!isNoise && char.popoverWin && !char.popoverWin.isDestroyed()) {
      char.popoverWin.webContents.send('cli-error', text);
    }
  });

  proc.on('close', () => {
    char.process = null;
    if (char.isBusy) {
      char.isBusy = false;
      if (char.win && !char.win.isDestroyed()) {
        char.win.webContents.send('thinking', false);
        char.win.webContents.send('completion', true);
      }
    }
    if (char.popoverWin && !char.popoverWin.isDestroyed()) {
      char.popoverWin.webContents.send('cli-exit');
    }
  });
}

// Handle sending messages — supports both stream-json and arg-based providers
function sendMessage(char, msg) {
  const provKey = char.providerKey || currentProvider;
  const prov = PROVIDERS[provKey];
  if (!prov) return;

  char.isBusy = true;
  if (char.win && !char.win.isDestroyed()) {
    char.win.webContents.send('thinking', true);
  }

  if (prov.inputMode === 'stream-json') {
    // Claude: write JSON to stdin of persistent process
    if (!char.process) return;
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: msg }
    }) + '\n';
    try { char.process.stdin.write(payload); } catch (err) { /* ignore */ }
  } else {
    // Codex/Gemini/Copilot/OpenCode: spawn a new process per message
    if (char.process) { try { char.process.kill(); } catch(e) {} }
    const args = [...prov.args, msg];
    const proc = spawn(prov.binary, args, { shell: true, env: { ...process.env } });
    setupProcessHandlers(char, proc);
    char.process = proc;
  }
}

function restartSession(char) {
  if (char.process) { try { char.process.kill(); } catch (e) {} }
  char.process = null;
  char.isBusy = false;
  startSession(char);
}

function switchProvider(providerKey) {
  if (currentProvider === providerKey) return;
  currentProvider = providerKey;

  // Kill all existing sessions and restart with new provider
  characters.forEach(c => {
    if (c.process) { try { c.process.kill(); } catch (e) {} }
    c.process = null;
    c.isBusy = false;
    c.providerKey = providerKey;

    // Update terminal
    if (c.popoverWin && !c.popoverWin.isDestroyed()) {
      c.popoverWin.webContents.send('provider-change', PROVIDERS[providerKey].name);
    }

    // Restart session if popover is open
    if (c.isIdle) {
      startSession(c);
    }
  });

  rebuildTrayMenu();
}

// ── Tick loop (like CVDisplayLink) ──────────────────────────────────────────
function startTick() {
  tickInterval = setInterval(() => {
    const primaryDisplay = screen.getPrimaryDisplay();
    const wa = primaryDisplay.workArea;

    // workArea excludes the taskbar. On a typical bottom-taskbar setup:
    //   wa.y = 0 (top of usable area)
    //   wa.y + wa.height = top edge of the taskbar
    const taskbarTopY = wa.y + wa.height;

    // Walk area = full work area width with small margins
    const areaX = wa.x + 50;
    const areaWidth = wa.width - 100;

    characters.forEach(c => c.updateFrame(areaX, areaWidth, taskbarTopY));
  }, 1000 / 60); // 60fps
}

// ── System tray ─────────────────────────────────────────────────────────────
function setupTray() {
  const iconPath = path.join(__dirname, '..', 'LilAgents', 'menuicon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }
  tray = new Tray(trayIcon);
  tray.setToolTip('lil agents');
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  const providerSubmenu = Object.entries(PROVIDERS).map(([key, prov]) => ({
    label: `${prov.name}${availableProviders[key] ? '' : ' (not installed)'}`,
    type: 'radio',
    checked: key === currentProvider,
    enabled: availableProviders[key],
    click: () => switchProvider(key),
  }));

  const template = [
    { label: 'Bring All to Front', click: () => bringAllToFront() },
    { label: 'Reset Positions',    click: () => resetPositions() },
    { type: 'separator' },
    { label: 'Bruce', type: 'checkbox', checked: !characters[0].hidden, click: (item) => toggleCharacter(0, item.checked) },
    { label: 'Jazz',  type: 'checkbox', checked: !characters[1].hidden, click: (item) => toggleCharacter(1, item.checked) },
    { label: 'Moe (Added)', type: 'checkbox', checked: !characters[2].hidden, click: (item) => toggleCharacter(2, item.checked) },
    { type: 'separator' },
    { label: 'Provider', submenu: providerSubmenu },
    { type: 'separator' },
    { label: 'Sounds', type: 'checkbox', checked: soundsEnabled, click: (item) => { soundsEnabled = item.checked; } },
    { label: 'Style', submenu: THEMES.map(t => ({
      label: t, type: 'radio', checked: t === currentTheme,
      click: () => { currentTheme = t; characters.forEach(c => { if (c.popoverWin && !c.popoverWin.isDestroyed()) c.popoverWin.webContents.send('theme-change', t); }); },
    }))},
    { type: 'separator' },
    { label: 'Quit', click: () => {
      characters.forEach(c => { if (c.process) try { c.process.kill(); } catch(e){} });
      app.quit();
    }},
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function bringAllToFront() {
  characters.forEach(char => {
    if (char.win && !char.win.isDestroyed()) {
      char.win.show();
      char.win.focus();
    }
    if (char.popoverWin && !char.popoverWin.isDestroyed()) {
      char.popoverWin.show();
      char.popoverWin.focus();
      char.popoverWin.webContents.send('bring-to-front');
    }
  });
}

function resetPositions() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const wa = primaryDisplay.workArea;
  const areaWidth = wa.width - 100;
  
  characters[0].positionProgress = 0.3;
  characters[1].positionProgress = 0.7;
  
  characters.forEach(char => {
    if (char.popoverWin && !char.popoverWin.isDestroyed()) {
      closePopover(char);
    }
  });
}

function toggleCharacter(idx, visible) {
  const char = characters[idx];
  if (!char) return;
  char.hidden = !visible;
  if (visible) {
    if (char.win && !char.win.isDestroyed()) {
      char.win.show();
    } else {
      createCharacterWindow(char);
    }
  } else {
    if (char.win && !char.win.isDestroyed()) char.win.hide();
    if (char.popoverWin && !char.popoverWin.isDestroyed()) char.popoverWin.hide();
    char.isIdle = false;
  }
}
