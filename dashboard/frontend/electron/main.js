const { app, BrowserWindow, Menu, Tray, nativeImage, Notification, ipcMain } = require("electron");
const path = require("path");

const isDev = !app.isPackaged;
const VITE_URL = "http://localhost:3000";
const PROD_INDEX = path.join(__dirname, "../dist/index.html");

let mainWindow = null;
let tray = null;

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(VITE_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(PROD_INDEX);
  }

  // Hide to tray on close instead of quitting
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray() {
  // Use a blank 16×16 image as placeholder — replace assets/icon.ico with real icon
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("AntíJitter");

  const menu = Menu.buildFromTemplate([
    {
      label: "Open dashboard",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: "separator" },
    {
      label: "Connection status",
      enabled: false,
      id: "status-item",
    },
    { type: "separator" },
    {
      label: "Quit AntíJitter",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);

  tray.on("double-click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

// ── Failover notifications ────────────────────────────────────────────────────

ipcMain.on("failover", (_event, data) => {
  if (Notification.isSupported()) {
    new Notification({
      title: "AntíJitter — Failover caught",
      body: `Starlink spike (${data.before} ms) → ${data.to} (${data.after} ms). Saved ${data.saved} ms.`,
      icon: path.join(__dirname, "../assets/icon.ico"),
    }).show();
  }

  // Update tray label
  if (tray) {
    tray.setToolTip(`AntíJitter — last failover saved ${data.saved} ms`);
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
});
