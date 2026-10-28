// CI smoke test: open the built app in headless Chrome, visit every page, and fail on
// console errors. A build alone doesn't prove the pages render.
//
//   node frontend/scripts/ui-smoke.mjs
//
// Expects a backend on 127.0.0.1:$CASHMONEY_PORT (default 8765) with sample data.
// CASHMONEY_INSTANCE_TOKEN: when set, the backend must prove it on /api/health/, as the
//   desktop app requires (desktop/backend-support.js).
// CHROME_PATH: defaults to Chrome's usual Windows location, or google-chrome elsewhere.
// CHROME_DEBUG_PORT: attach to an app already listening on this DevTools port (the
//   desktop app started with --remote-debugging-port) instead of starting Chrome. The
//   app must load the page from the backend by itself, which means it proved its launch
//   token; it keeps running afterwards.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { newSecret, provesInstance } = require("../../desktop/backend-support.js");
const { version } = JSON.parse(readFileSync(new URL("../../desktop/package.json", import.meta.url), "utf8"));

const base = `http://127.0.0.1:${process.env.CASHMONEY_PORT || "8765"}`;
const defaultChrome = process.platform === "win32"
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "google-chrome";
const chromePath = process.env.CHROME_PATH || defaultChrome;
const attachPort = process.env.CHROME_DEBUG_PORT;
const debugPort = attachPort ? Number(attachPort) : 9333;
// The installed app waits up to 120 s for its backend (the first start migrates).
const startLimitMs = attachPort ? 120000 : 60000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const problems = [];

async function waitUntil(check, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) {
        return value;
      }
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function connect(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map();
  const errors = [];
  const warnings = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    } else if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      errors.push(`exception: ${details.exception?.description || details.text}`);
    } else if (message.method === "Runtime.consoleAPICalled") {
      const text = message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ");
      if (["error", "assert"].includes(message.params.type)) {
        errors.push(`console.${message.params.type}: ${text}`);
      } else if (message.params.type === "warning") {
        warnings.push(text);
      }
    } else if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      errors.push(`${message.params.entry.source}: ${message.params.entry.text}`);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text);
    }
    return result.result.value;
  };
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  return { errors, evaluate, send, warnings, close: () => ws.close() };
}

await waitUntil(async () => (await fetch(`${base}/api/health/`)).ok, "the backend", startLimitMs);
const token = process.env.CASHMONEY_INSTANCE_TOKEN;
if (token) {
  const nonce = newSecret(16);
  const health = await (await fetch(`${base}/api/health/?nonce=${nonce}`)).json();
  if (!provesInstance(health, token, nonce)) {
    problems.push("The backend did not prove the launch token.");
  }
}

let profile = null;
let chrome = null;
if (!attachPort) {
  profile = mkdtempSync(join(tmpdir(), "cashmoney-smoke-"));
  chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--window-size=1440,900",
    "about:blank",
  ], { stdio: "ignore" });
}

try {
  // An attached app shows its "Starting Cashmoney…" page first; wait until it loads the app.
  const target = await waitUntil(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return targets.find((item) => item.type === "page" && (!attachPort || item.url.startsWith(`${base}/`)));
  }, attachPort ? "the app's window to load the app" : "Chrome", startLimitMs);
  const page = await connect(target.webSocketDebuggerUrl);
  await page.send("Page.navigate", { url: `${base}/` });
  // The Dashboard opens on the tab used last: check the Overview, then the Transactions tab.
  await waitUntil(() => page.evaluate("!!document.querySelector('#dashboard-tab-overview')"), "the dashboard tabs", 60000);
  await page.evaluate("document.querySelector('#dashboard-tab-overview').click()");
  await waitUntil(() => page.evaluate("document.querySelectorAll('.js-plotly-plot').length >= 1 && document.querySelectorAll('.category-ranking-list .category-ranking-row').length > 0"), "the charts", 60000);
  await page.evaluate("document.querySelector('#dashboard-tab-transactions').click()");
  await waitUntil(() => page.evaluate("document.querySelectorAll('.ag-center-cols-container .ag-row').length > 0"), "the transaction table", 60000);

  const labels = await page.evaluate("[...document.querySelectorAll('.nav-tab')].map((button) => button.textContent.trim())");
  for (const label of labels) {
    await page.evaluate(`[...document.querySelectorAll('.nav-tab')].find((button) => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
    await waitUntil(() => page.evaluate(`document.querySelector('main h1')?.textContent.trim() === ${JSON.stringify(label)}`), `the ${label} page`, 20000);
    await sleep(1500);
    const sections = await page.evaluate("document.querySelectorAll('main section, main .panel').length");
    console.log(`${label}: ${sections} sections`);
    if (!sections) {
      problems.push(`${label}: the page shows no content.`);
    }
  }
  const shownVersion = await page.evaluate("document.querySelector('.help-version-list dd')?.textContent.trim() || ''");
  console.log(`Help shows ${shownVersion || "no version"}`);
  if (shownVersion !== `v${version}`) {
    problems.push(`Help shows "${shownVersion}" instead of v${version}.`);
  }
  problems.push(...page.errors.map((text) => `Console error: ${text}`));
  page.warnings.forEach((text) => console.log(`Console warning (not a failure): ${text}`));
  page.close();
} finally {
  if (chrome) {
    chrome.kill();
    await sleep(1000);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Chrome may still hold a file; the temp folder gets cleaned up anyway.
    }
  }
}

if (problems.length) {
  console.error(`UI smoke test failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("UI smoke test passed.");
