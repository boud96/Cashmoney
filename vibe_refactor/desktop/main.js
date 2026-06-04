const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const APP_URL = "http://127.0.0.1:8000/";
let backendProcess = null;

function backendRoot() {
  return path.resolve(__dirname, "..", "backend");
}

function pythonPath() {
  return path.resolve(__dirname, "..", ".venv", "Scripts", "python.exe");
}

function waitForBackend(deadlineMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get("http://127.0.0.1:8000/api/health/", (response) => {
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
    backendProcess = spawn(
      pythonPath(),
      ["manage.py", "runserver", "127.0.0.1:8000", "--noreload"],
      {
        cwd: backendRoot(),
        windowsHide: true,
        stdio: "ignore",
      }
    );
    backendProcess.unref();
    await waitForBackend();
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#f5f7f8",
    title: "Cashmoney",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  await startBackendIfNeeded();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

