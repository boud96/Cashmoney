// Helpers for running the bundled backend. They don't use Electron, so `node --test`
// can check them (backend-support.test.js).
const fs = require("node:fs");

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

module.exports = { LOG_MAX_BYTES, rotateIfLarge };
