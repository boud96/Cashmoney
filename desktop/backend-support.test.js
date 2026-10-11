const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { rotateIfLarge } = require("./backend-support.js");

test("a log past the limit starts fresh and keeps one old copy", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cashmoney-logs-"));
  const log = path.join(dir, "backend.out.log");
  fs.writeFileSync(log, "x".repeat(2000));
  fs.writeFileSync(`${log}.1`, "older");

  rotateIfLarge(log, 1000);

  assert.equal(fs.existsSync(log), false);
  assert.equal(fs.readFileSync(`${log}.1`, "utf8").length, 2000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a small or missing log is left alone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cashmoney-logs-"));
  const log = path.join(dir, "backend.err.log");
  rotateIfLarge(log, 1000);
  fs.writeFileSync(log, "small");

  rotateIfLarge(log, 1000);

  assert.equal(fs.readFileSync(log, "utf8"), "small");
  assert.equal(fs.existsSync(`${log}.1`), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
