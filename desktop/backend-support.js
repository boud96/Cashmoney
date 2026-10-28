// Helpers for running the bundled backend. They don't use Electron, so `node --test`
// can check them (backend-support.test.js).
const crypto = require("node:crypto");
const fs = require("node:fs");

// The packaged backend gets a fresh random token per launch (CASHMONEY_INSTANCE_TOKEN)
// and proves it on /api/health/?nonce=… with an HMAC of the nonce. Another program
// answering on the port can't, so the app never loads it (CR-45).
function newSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function healthProof(token, nonce) {
  return crypto.createHmac("sha256", token).update(nonce).digest("hex");
}

function provesInstance(payload, token, nonce) {
  if (typeof payload?.proof !== "string" || !/^[0-9a-f]{64}$/.test(payload.proof)) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(payload.proof, "hex"), Buffer.from(healthProof(token, nonce), "hex"));
}

// Log files would otherwise grow for the life of the install.
const LOG_MAX_BYTES = 1_000_000;

// Start a fresh log once it has grown past maxBytes; the previous one stays as <name>.1.
function rotateIfLarge(filePath, maxBytes = LOG_MAX_BYTES) {
  try {
    if (fs.statSync(filePath).size > maxBytes) {
      fs.renameSync(filePath, `${filePath}.1`);
    }
  } catch {
    // No file yet, or it is in use: keep appending.
  }
}

// The files the app runs and shows on each platform. Electron on Linux can't use an
// .ico as the window icon, so Linux gets a PNG.
function platformFiles(platform = process.platform) {
  if (platform === "win32") {
    return { backendExecutable: "cashmoney-backend.exe", venvPython: ["Scripts", "python.exe"], icon: "favicon.ico" };
  }
  return { backendExecutable: "cashmoney-backend", venvPython: ["bin", "python"], icon: "cashmoney.png" };
}

module.exports = { LOG_MAX_BYTES, healthProof, newSecret, platformFiles, provesInstance, rotateIfLarge };
