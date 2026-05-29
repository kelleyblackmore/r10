'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('r10', {
  // droid window
  toggleChat: () => ipcRenderer.send('droid:toggle-chat'),
  drag: (dx, dy) => ipcRenderer.send('droid:drag', { dx, dy }),
  onState: (cb) => ipcRenderer.on('droid:state', (_e, s) => cb(s)),
  onBubble: (cb) => ipcRenderer.on('droid:bubble', (_e, t) => cb(t)),

  // chat window
  hideChat: () => ipcRenderer.send('chat:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  send: (payload) => ipcRenderer.invoke('chat:send', payload),
  stop: () => ipcRenderer.send('chat:stop'),
  onChunk: (cb) => ipcRenderer.on('chat:chunk', (_e, c) => cb(c)),

  capture: () => ipcRenderer.invoke('screen:capture'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),
  listModels: () => ipcRenderer.invoke('ollama:models'),
  engineStatus: () => ipcRenderer.invoke('engine:status'),
  ensureModel: (vision) => ipcRenderer.invoke('model:ensure', { vision }),
  onProgress: (cb) => ipcRenderer.on('model:progress', (_e, p) => cb(p)),
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
