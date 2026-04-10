const { contextBridge, ipcRenderer } = require("electron");

// Expose a narrow API to the renderer — no full Node access
contextBridge.exposeInMainWorld("electronAPI", {
  /** Send a failover event to the main process for a tray notification. */
  notifyFailover: (data) => ipcRenderer.send("failover", data),
  /** True when running inside Electron. */
  isElectron: true,
});
