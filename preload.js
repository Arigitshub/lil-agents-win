const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lilAgents', {
  onWalk:       (cb) => ipcRenderer.on('walk',         (_e, data) => cb(data)),
  onThinking:   (cb) => ipcRenderer.on('thinking',     (_e, val)  => cb(val)),
  onCompletion: (cb) => ipcRenderer.on('completion',   (_e, val)  => cb(val)),
  onCliData:    (cb) => ipcRenderer.on('cli-data',     (_e, json) => cb(json)),
  onCliError:   (cb) => ipcRenderer.on('cli-error',    (_e, text) => cb(text)),
  onCliExit:    (cb) => ipcRenderer.on('cli-exit',     ()         => cb()),
  onThemeChange:(cb) => ipcRenderer.on('theme-change', (_e, t)    => cb(t)),
  onProviderChange:(cb) => ipcRenderer.on('provider-change', (_e, name)  => cb(name)),
  characterClicked: () => ipcRenderer.send('character-clicked'),
  sendMessage:  (msg) => ipcRenderer.send('send-message', msg),
  resetSession: ()    => ipcRenderer.send('reset-session'),
  switchProvider:(p)  => ipcRenderer.send('switch-provider', p),
  setAlwaysOnTop:(v)  => ipcRenderer.send('set-always-on-top', v),
  setOpacity:    (v)  => ipcRenderer.send('set-opacity', v),
});
