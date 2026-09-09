const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', Object.freeze({
  isElectron: true,
  getPrinters: () => ipcRenderer.invoke('pos:get-printers'),
  printSilent: (options) => ipcRenderer.invoke('pos:print-silent', options),
  kickDrawer: (printerName) => ipcRenderer.invoke('pos:kick-drawer', printerName),
  getSystemInfo: () => ipcRenderer.invoke('pos:get-system-info'),
}));
