import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const desktopPackageLockPath = path.resolve(currentDir, "../desktop/package-lock.json");

function readDesktopPackageLockVersion() {
  const packageLock = JSON.parse(fs.readFileSync(desktopPackageLockPath, "utf8"));
  return String(packageLock.packages?.[""]?.version || packageLock.version || "").trim();
}

const appVersion = readDesktopPackageLockVersion() || "unknown";

export default defineConfig({
  plugins: [react()],
  define: {
    __CASHMONEY_APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: path.resolve(currentDir, "../backend/finance/static/finance/react"),
    emptyOutDir: true,
    manifest: true,
  },
});
