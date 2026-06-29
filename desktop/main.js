const { app, BrowserWindow, Menu, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const BACKEND_PORT = app.isPackaged ? "8765" : "8000";
const APP_URL = `http://127.0.0.1:${BACKEND_PORT}/`;
const APP_USER_MODEL_ID = "local.cashmoney.desktop";
const WINDOW_STATE_FILE = "window-state.json";
let backendProcess = null;
let mainWindow = null;
let isQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

if (gotSingleInstanceLock) {
  app.setAppUserModelId(APP_USER_MODEL_ID);

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });
}

function isAppOriginUrl(url) {
  try {
    return new URL(url).origin === new URL(APP_URL).origin;
  } catch {
    return false;
  }
}

function isExternalHttpUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return ["http:", "https:"].includes(parsedUrl.protocol) && !isAppOriginUrl(url);
  } catch {
    return false;
  }
}

function openExternalUrl(url) {
  if (isExternalHttpUrl(url)) {
    shell.openExternal(url).catch(() => {});
    return true;
  }
  return false;
}

function appIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "favicon.ico");
  }
  return path.resolve(__dirname, "..", "backend", "finance", "static", "favicon.ico");
}

function backendRoot() {
  return path.resolve(__dirname, "..", "backend");
}

function pythonPath() {
  return path.resolve(__dirname, "..", ".venv", "Scripts", "python.exe");
}

function packagedBackendPath() {
  return path.join(process.resourcesPath, "backend", "cashmoney-backend.exe");
}

function backendLogs() {
  const logDir = app.getPath("userData");
  fs.mkdirSync(logDir, { recursive: true });
  return {
    stderr: fs.openSync(path.join(logDir, "backend.err.log"), "a"),
    stdout: fs.openSync(path.join(logDir, "backend.out.log"), "a"),
  };
}

function backendLogPaths() {
  const logDir = app.getPath("userData");
  return {
    stderr: path.join(logDir, "backend.err.log"),
    stdout: path.join(logDir, "backend.out.log"),
  };
}

function windowStatePath() {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILE);
}

function defaultWindowBounds() {
  const { width: displayWidth, height: displayHeight } = screen.getPrimaryDisplay().workAreaSize;
  const minWidth = Math.min(1120, displayWidth);
  const minHeight = Math.min(760, displayHeight);
  return {
    height: Math.max(minHeight, Math.min(1000, displayHeight)),
    minHeight,
    minWidth,
    width: Math.max(minWidth, Math.min(1680, displayWidth)),
  };
}

function boundsInsideDisplay(bounds) {
  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    return false;
  }
  const rectangle = {
    height: Math.max(1, Math.round(bounds.height)),
    width: Math.max(1, Math.round(bounds.width)),
    x: Number.isFinite(bounds.x) ? Math.round(bounds.x) : 0,
    y: Number.isFinite(bounds.y) ? Math.round(bounds.y) : 0,
  };
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const horizontalOverlap = rectangle.x < area.x + area.width && rectangle.x + rectangle.width > area.x;
    const verticalOverlap = rectangle.y < area.y + area.height && rectangle.y + rectangle.height > area.y;
    return horizontalOverlap && verticalOverlap;
  });
}

function loadWindowState() {
  const defaults = defaultWindowBounds();
  try {
    const state = JSON.parse(fs.readFileSync(windowStatePath(), "utf8"));
    const savedBounds = {
      height: Number.isFinite(state?.bounds?.height) ? Math.round(state.bounds.height) : defaults.height,
      width: Number.isFinite(state?.bounds?.width) ? Math.round(state.bounds.width) : defaults.width,
      x: Number.isFinite(state?.bounds?.x) ? Math.round(state.bounds.x) : undefined,
      y: Number.isFinite(state?.bounds?.y) ? Math.round(state.bounds.y) : undefined,
    };
    if (!boundsInsideDisplay(savedBounds)) {
      return defaults;
    }
    const display = screen.getDisplayMatching({
      height: savedBounds.height,
      width: savedBounds.width,
      x: Number.isFinite(savedBounds.x) ? savedBounds.x : 0,
      y: Number.isFinite(savedBounds.y) ? savedBounds.y : 0,
    }).workArea;
    return {
      ...defaults,
      height: Math.min(display.height, Math.max(defaults.minHeight, savedBounds.height)),
      isMaximized: Boolean(state.isMaximized),
      width: Math.min(display.width, Math.max(defaults.minWidth, savedBounds.width)),
      x: savedBounds.x,
      y: savedBounds.y,
    };
  } catch {
    return defaults;
  }
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) {
    return;
  }
  const state = {
    bounds: window.isMaximized() ? window.getNormalBounds() : window.getBounds(),
    isMaximized: window.isMaximized(),
  };
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(windowStatePath(), JSON.stringify(state, null, 2));
  } catch {
    // Window state persistence should never block app shutdown.
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function backendErrorHtml(title, message) {
  const logs = backendLogPaths();
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: "Segoe UI", system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0e1117; color: #e6edf3; }
    main { width: min(620px, calc(100vw - 40px)); border: 1px solid #30363d; border-radius: 8px; background: #161b22; padding: 22px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.38); }
    h1 { margin: 0 0 10px; font-size: 22px; }
    p { margin: 0 0 14px; color: #8b949e; line-height: 1.45; }
    code { display: block; margin-top: 8px; overflow-wrap: anywhere; color: #e6edf3; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <p>Backend logs:</p>
    <code>${escapeHtml(logs.stdout)}</code>
    <code>${escapeHtml(logs.stderr)}</code>
  </main>
</body>
</html>`;
}

function showBackendError(title, message) {
  const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow({ loadApp: false });
  targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(backendErrorHtml(title, message))}`);
  targetWindow.show();
}

function waitForBackend(deadlineMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(`http://127.0.0.1:${BACKEND_PORT}/api/health/`, (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
        } else {
          retry();
        }
      });
      request.on("error", retry);
      request.setTimeout(1000, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - start > deadlineMs) {
        reject(new Error("Backend did not start in time."));
      } else {
        setTimeout(probe, 400);
      }
    };

    probe();
  });
}

async function startBackendIfNeeded() {
  try {
    await waitForBackend(1200);
    return;
  } catch {
    if (app.isPackaged) {
      const backendExe = packagedBackendPath();
      const logs = backendLogs();
      backendProcess = spawn(
        backendExe,
        [],
        {
          env: { ...process.env, CASHMONEY_DATA_DIR: app.getPath("userData"), CASHMONEY_PORT: BACKEND_PORT },
          windowsHide: true,
          stdio: ["ignore", logs.stdout, logs.stderr],
        }
      );
    } else {
      backendProcess = spawn(
        pythonPath(),
        ["manage.py", "runserver", "127.0.0.1:8000", "--noreload"],
        {
          cwd: backendRoot(),
          windowsHide: true,
          stdio: "ignore",
        }
      );
    }
    backendProcess.once("exit", (code, signal) => {
      backendProcess = null;
      if (!isQuitting) {
        showBackendError(
          "Cashmoney backend stopped",
          `The local backend process exited unexpectedly${code === null ? "" : ` with code ${code}`}${signal ? ` and signal ${signal}` : ""}.`,
        );
      }
    });
    backendProcess.once("error", (error) => {
      backendProcess = null;
      if (!isQuitting) {
        showBackendError("Cashmoney backend failed", error.message);
      }
    });
    backendProcess.unref();
    await waitForBackend();
  }
}

function createWindow(options = {}) {
  const { loadApp = true } = options;
  const windowState = loadWindowState();
  const window = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: windowState.minWidth,
    minHeight: windowState.minHeight,
    autoHideMenuBar: true,
    backgroundColor: "#f5f7f8",
    title: "Cashmoney",
    icon: appIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = window;
  window.setMenu(null);
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (openExternalUrl(url)) {
      return { action: "deny" };
    }
    return isAppOriginUrl(url) ? { action: "allow" } : { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (openExternalUrl(url)) {
      event.preventDefault();
    }
  });
  if (windowState.isMaximized) {
    window.maximize();
  }
  window.on("close", () => saveWindowState(window));
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  if (loadApp) {
    window.loadURL(APP_URL);
  }
  return window;
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    createWindow({ loadApp: false });
    try {
      await startBackendIfNeeded();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(APP_URL);
      }
    } catch (error) {
      showBackendError("Cashmoney backend did not start", error.message);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow({ loadApp: true });
      }
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
    if (backendProcess) {
      backendProcess.kill();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
