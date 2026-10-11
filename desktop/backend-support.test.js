const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { healthProof, newSecret, provesInstance, rotateIfLarge } = require("./backend-support.js");

test("only a backend that knows the launch token proves it", () => {
  const token = newSecret();
  const nonce = newSecret(16);

  assert.equal(provesInstance({ status: "ok", proof: healthProof(token, nonce) }, token, nonce), true);
  assert.equal(provesInstance({ status: "ok", proof: healthProof(newSecret(), nonce) }, token, nonce), false);
  assert.equal(provesInstance({ status: "ok", proof: healthProof(token, newSecret(16)) }, token, nonce), false);
  assert.equal(provesInstance({ status: "ok" }, token, nonce), false);
  assert.equal(provesInstance({ status: "ok", proof: "not hex" }, token, nonce), false);
  assert.equal(provesInstance(null, token, nonce), false);
});

test("the proof matches what the backend computes", () => {
  // Python: hmac.new(b"launch-token", b"4f1c2a", hashlib.sha256).hexdigest()
  assert.equal(healthProof("launch-token", "4f1c2a"), "6098a720f231dd394d5437e211808e19a364ef7be85a36d178a69b83e1171101");
});

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
