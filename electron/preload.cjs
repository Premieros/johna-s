const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', Object.freeze({
  isElectron: true,
  getPrinters: () => ipcRenderer.invoke('pos:get-printers'),
  printSilent: (options) => ipcRenderer.invoke('pos:print-silent', options),
  getPrintQueueState: () => ipcRenderer.invoke('pos:get-print-queue-state'),
  kickDrawer: (printerName) => ipcRenderer.invoke('pos:kick-drawer', printerName),
  getSystemInfo: () => ipcRenderer.invoke('pos:get-system-info'),
}));
