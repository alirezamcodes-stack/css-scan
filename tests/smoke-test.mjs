import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = process.env.STYLESCAN_CHROME;
if (!chrome || !existsSync(chrome) || basename(chrome).toLowerCase() !== "chrome.exe") {
  console.error("FAIL: Set STYLESCAN_CHROME to the chrome.exe path of Google Chrome for Testing.");
  process.exit(1);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "JavaScript evaluation failed");
    return result.result?.value;
  }
  close() { this.socket.close(); }
}

async function poll(action, label, timeout = 15000) {
  const stop = Date.now() + timeout;
  while (Date.now() < stop) {
    try {
      const value = await action();
      if (value) return value;
    } catch { /* not ready yet */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const testRoot = await fs.mkdtemp(join(tmpdir(), "stylescan-smoke-"));
const profile = join(testRoot, "profile");
const extension = join(testRoot, "extension");
const fixture = await fs.readFile(join(root, "tests", "fixture.html"));
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(fixture);
});
let child;
let browser;
let page;
let worker;
let options;
let stderr = "";
try {
  await fs.mkdir(extension);
  for (const file of ["manifest.json", "background.js", "popup.html", "popup.css", "popup.js", "options.html", "options.css", "options.js"]) {
    await fs.copyFile(join(root, file), join(extension, file));
  }
  await fs.cp(join(root, "src"), join(extension, "src"), { recursive: true });
  await fs.cp(join(root, "icons"), join(extension, "icons"), { recursive: true });
  const manifestPath = join(extension, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  // A private localhost permission lets an automated test inject without a
  // toolbar click. The release manifest remains activeTab-only.
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await fs.writeFile(manifestPath, JSON.stringify(manifest));

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/fixture.html`;
  child = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    ...(process.env.STYLESCAN_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
    "--window-size=1280,800",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
    fixtureUrl,
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const activePort = await poll(async () => {
    const text = await fs.readFile(join(profile, "DevToolsActivePort"), "utf8");
    const [port, browserPath] = text.trim().split(/\r?\n/);
    return port && browserPath ? { port, browserPath } : null;
  }, "Chrome DevTools port");
  const listTargets = async () => (await (await fetch(`http://127.0.0.1:${activePort.port}/json/list`)).json());
  const targets = await poll(async () => {
    const list = await listTargets();
    const tab = list.find((item) => item.type === "page" && item.url === fixtureUrl);
    if (!tab) return null;
    for (const sw of list.filter((item) => item.type === "service_worker" && item.url.endsWith("/background.js"))) {
      const probe = new CDP(sw.webSocketDebuggerUrl);
      try {
        await probe.open();
        await probe.send("Runtime.enable");
        if (await probe.evaluate(`globalThis.chrome?.runtime?.getManifest?.().name`) === manifest.name) return { tab, sw };
      } catch { /* A browser-owned worker may also be named background.js. */ }
      finally { probe.close(); }
    }
    return null;
  }, "page and extension service worker", 10000);
  browser = new CDP(`ws://127.0.0.1:${activePort.port}${activePort.browserPath}`);
  page = new CDP(targets.tab.webSocketDebuggerUrl);
  worker = new CDP(targets.sw.webSocketDebuggerUrl);
  await Promise.all([browser.open(), page.open(), worker.open()]);
  const downloadPath = join(testRoot, "downloads");
  await fs.mkdir(downloadPath);
  await browser.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath });
  const product = (await browser.send("Browser.getVersion")).product || "";
  assert(/^Chrome\//.test(product), `Chrome-only smoke test received ${product}`);
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await worker.send("Runtime.enable");
  await poll(() => page.evaluate(`document.readyState === 'complete' && !!document.querySelector('#target')`), "fixture page ready");

  const tabId = await worker.evaluate(`(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(item => item.url === ${JSON.stringify(fixtureUrl)});
    if (!tab) throw new Error('fixture tab not visible to extension: ' + JSON.stringify(tabs));
    return tab.id;
  })()`);
  const extensionId = new URL(targets.sw.url).hostname;
  const optionsTargetId = (await browser.send("Target.createTarget", { url: `chrome-extension://${extensionId}/options.html` })).targetId;
  const optionsMeta = await poll(async () => (await listTargets()).find((item) => item.id === optionsTargetId), "options tab");
  options = new CDP(optionsMeta.webSocketDebuggerUrl);
  await options.open();
  await options.send("Runtime.enable");
  await poll(() => options.evaluate(`location.protocol === 'chrome-extension:' && !!globalThis.chrome?.runtime?.sendMessage`), "extension options ready").catch(async (error) => {
    const state = await options.evaluate(`({href:location.href,ready:document.readyState,chrome:typeof chrome,runtime:typeof chrome?.runtime})`);
    throw new Error(`${error.message}: ${JSON.stringify(state)}`);
  });
  const ensured = await options.evaluate(`(async () => {
    const ensured = await chrome.runtime.sendMessage({type:'STYLSCAN_ENSURE',tabId:${tabId}});
    if (!ensured?.ok) throw new Error(ensured?.error || 'background ensure failed');
    return ensured;
  })()`);
  assert(ensured?.ok, "Background injection failed");
  const setup = await worker.evaluate(`chrome.tabs.sendMessage(${tabId},{type:'STYLSCAN_TOGGLE'})`);
  assert(setup?.active === true, "Inspector did not activate");
  const rect = await page.evaluate(`(() => {const r=document.querySelector('#target').getBoundingClientRect();return {x:r.x+5,y:r.y+5};})()`);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  const inspected = await poll(() => page.evaluate(`(() => {
    const s=document.querySelector('#stylescan-ultra-root')?.shadowRoot;
    return s?.querySelector('.ss-selector')?.textContent?.includes('target')
      ? { selector:s.querySelector('.ss-selector').textContent,
          code:s.querySelector('#ss-code')?.value || '' }
      : null;
  })()`), "selected CSS", 10000);
  assert(inspected.code.includes("border"), "CSS output lacks the card's border rule");
  const cascade = await page.evaluate(`(() => {
    const s=document.querySelector('#stylescan-ultra-root').shadowRoot;
    return { summary:s.querySelector('.ss-cascade summary')?.textContent || '',
      candidate:!!s.querySelector('.ss-cascade-decl.candidate'),
      inactive:!!s.querySelector('.ss-cascade-decl.inactive') };
  })()`);
  assert(cascade.summary.includes("Cascade diagnostics") && cascade.candidate && cascade.inactive,
    `Cascade diagnostics missing expected rule states: ${JSON.stringify(cascade)}`);
  if (process.env.STYLESCAN_SCREENSHOT_DIR) {
    await fs.mkdir(process.env.STYLESCAN_SCREENSHOT_DIR, { recursive: true });
    const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(join(process.env.STYLESCAN_SCREENSHOT_DIR, "inspector-preview.png"), Buffer.from(shot.data, "base64"));
  }
  const copied = await worker.evaluate(`chrome.tabs.sendMessage(${tabId},{type:'STYLSCAN_COPY_CSS'})`);
  assert(copied?.copied === true, `Copy CSS failed: ${copied?.error || "unknown error"}`);
  const visual = await page.evaluate(`(() => {
    const s=document.querySelector('#stylescan-ultra-root').shadowRoot;
    s.querySelector('[data-tab="visual"]').click();
    const input=s.querySelector('[data-property="background-color"]');
    input.focus(); input.value='rgb(255, 0, 0)';
    input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    return getComputedStyle(document.querySelector('#target')).backgroundColor;
  })()`);
  assert(visual === "rgb(255, 0, 0)", `Visual edit did not apply: ${visual}`);
  const coded = await page.evaluate(`(() => {
    const s=document.querySelector('#stylescan-ultra-root').shadowRoot;
    s.querySelector('[data-tab="inspect"]').click();
    const editor=s.querySelector('#ss-code');
    editor.value='#target { outline: 7px solid rgb(255, 0, 0) !important; }';
    editor.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    s.querySelector('[data-action="apply-css"]').click();
    return getComputedStyle(document.querySelector('#target')).outlineWidth;
  })()`);
  assert(coded === "7px", `Code edit did not apply: ${coded}`);
  await options.evaluate(`(() => {
    const select=document.querySelector('#theme');
    select.value='light';
    select.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  const storedTheme = await poll(async () => {
    const value = await worker.evaluate(`(async () => (await chrome.storage.sync.get('stylescanSettings')).stylescanSettings?.theme)()`);
    return value === "light" ? value : null;
  }, "saved settings", 5000);
  assert(storedTheme === "light", `Settings did not persist: ${storedTheme}`);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = await page.evaluate(`(() => {
    const s=document.querySelector('#stylescan-ultra-root').shadowRoot;
    const panel=s.querySelector('.ss-panel').getBoundingClientRect();
    const toolbar=s.querySelector('.ss-toolbar').getBoundingClientRect();
    return { panelLeft:panel.left,panelRight:panel.right,toolbarLeft:toolbar.left,toolbarRight:toolbar.right };
  })()`);
  assert(mobile.panelLeft >= 0 && mobile.panelRight <= 391 && mobile.toolbarLeft >= 0 && mobile.toolbarRight <= 391, `Mobile overlay overflows viewport: ${JSON.stringify(mobile)}`);
  if (process.env.STYLESCAN_SCREENSHOT_DIR) {
    const mobileShot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(join(process.env.STYLESCAN_SCREENSHOT_DIR, "mobile-preview.png"), Buffer.from(mobileShot.data, "base64"));
    await options.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const shot = await options.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(join(process.env.STYLESCAN_SCREENSHOT_DIR, "options-preview.png"), Buffer.from(shot.data, "base64"));
  }
  await poll(() => page.evaluate(`document.querySelector('#stylescan-ultra-root').dataset.theme === 'light'`), "light theme in inspected tab");
  await page.evaluate(`(() => {
    const s=document.querySelector('#stylescan-ultra-root').shadowRoot;
    const editor=s.querySelector('#ss-code');
    editor.focus();
    editor.value='#target { color: purple; }';
    editor.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
  })()`);
  await options.evaluate(`(() => {
    const select=document.querySelector('#theme');
    select.value='dark';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await poll(() => page.evaluate(`document.querySelector('#stylescan-ultra-root').dataset.theme === 'dark'`), "theme update in inspected tab");
  const retainedDraft = await page.evaluate(`document.querySelector('#stylescan-ultra-root').shadowRoot.querySelector('#ss-code')?.value`);
  assert(retainedDraft === "#target { color: purple; }", `Settings update lost CSS draft: ${retainedDraft}`);
  const invalidEdit = await page.evaluate(`(() => {
    const s=document.querySelector('#stylescan-ultra-root').shadowRoot;
    s.querySelector('[data-tab="changes"]').click();
    const before=s.querySelectorAll('.ss-history-item').length;
    s.querySelector('[data-tab="inspect"]').click();
    const editor=s.querySelector('#ss-code');
    editor.value='color: red;';
    editor.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    s.querySelector('[data-action="apply-css"]').click();
    const error=s.querySelector('.ss-toast').textContent;
    s.querySelector('[data-tab="changes"]').click();
    return { before, after:s.querySelectorAll('.ss-history-item').length, error };
  })()`);
  assert(invalidEdit.before === invalidEdit.after && invalidEdit.error.includes("valid CSS rule"),
    `Invalid CSS was recorded as an edit: ${JSON.stringify(invalidEdit)}`);
  await page.evaluate(`(() => {
    const s=document.querySelector('#stylescan-ultra-root').shadowRoot;
    s.querySelector('[data-tab="visual"]').click();
    const input=s.querySelector('[data-property="background-color"]');
    input.focus(); input.value='rgb(0, 128, 0)';
    input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
  })()`);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 730, deviceScaleFactor: 1, mobile: false });
  await delay(250);
  const pendingEdit = await page.evaluate(`(() => {
    const s=document.querySelector('#stylescan-ultra-root').shadowRoot;
    const input=s.querySelector('[data-property="background-color"]');
    return { focused:s.activeElement===input, value:input?.value,
      background:getComputedStyle(document.querySelector('#target')).backgroundColor };
  })()`);
  assert(pendingEdit.focused && pendingEdit.value === "rgb(0, 128, 0)" && pendingEdit.background === "rgb(0, 128, 0)",
    `Resize interrupted a visual edit: ${JSON.stringify(pendingEdit)}`);
  const undone = await page.evaluate(`(() => {
    const s=document.querySelector('#stylescan-ultra-root').shadowRoot;
    s.querySelector('[data-property="background-color"]').dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    s.querySelector('[data-tab="changes"]').click();
    s.querySelector('[data-action="undo"]').click();
    return getComputedStyle(document.querySelector('#target')).backgroundColor;
  })()`);
  assert(undone === "rgb(255, 0, 0)", `Undo lost the committed visual edit after resize: ${undone}`);
  await page.evaluate(`(() => {
    const s=document.querySelector('#stylescan-ultra-root').shadowRoot;
    s.querySelector('[data-tab="visual"]').click();
    const input=s.querySelector('[data-property="background-color"]');
    input.focus(); input.value='';
    input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    s.querySelector('[data-tab="changes"]').click();
    s.querySelector('[data-action="export-css"]').click();
  })()`);
  const removalExport = await poll(() => fs.readFile(join(downloadPath, "stylescan-changes.css"), "utf8"), "CSS changes download", 10000);
  assert(removalExport.includes("Remove inline background-color"),
    `Removed inline property was silently omitted from CSS export: ${removalExport}`);
  await browser.send("Browser.close");
  console.log(`PASS: extension loaded, inspected ${inspected.selector}, copied CSS, applied visual/code edits, and saved settings.`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  if (stderr) console.error(stderr.slice(-2000));
  process.exitCode = 1;
} finally {
  for (const connection of [options, worker, page, browser]) connection?.close();
  if (child && child.exitCode === null) child.kill();
  await new Promise((resolve) => server.close(resolve));
  await delay(500);
  const resolved = resolve(testRoot);
  const temp = resolve(tmpdir());
  if (dirname(resolved) === temp && basename(resolved).startsWith("stylescan-smoke-")) {
    try { await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch { console.warn(`Temporary Chrome profile remains at ${resolved}`); }
  }
}
