import { parseHref } from "../shared/session-url.js";

const HOST_NAME = "com.kreativepro.paper_capture";

const STAGES = [
  {
    id: "nav",
    short: "NAV",
    title: "Navbar + Dropdowns",
    copy: "Capture desktop Navbar once, then each open dropdown.",
  },
  {
    id: "hover",
    short: "HOVER",
    title: "Hover",
    copy: "Record one element for its default and hover states.",
  },
  {
    id: "multi",
    short: "MULTI",
    title: "Multi-state",
    copy: "Record state 1, change it, then record state 2.",
  },
  {
    id: "single",
    short: "SINGLE",
    title: "Single",
    copy: "Capture any exact element as one object.",
  },
  {
    id: "tags",
    short: "TAGS",
    title: "Tags",
    copy: "Scan names Paper layers. Done writes the receipt and pings the pipeline agent.",
  },
];

const ui = Object.fromEntries([
  "setup", "workspace", "complete", "connection", "paperFileId", "projectRoot", "paperEndpoint",
  "setupError", "startButton", "stageRail", "stepKicker", "stageTitle", "stageCopy", "autoMode",
  "navKindPicker", "recordButton", "recordTitle", "recordHelp", "activity", "takes", "captureError",
  "backButton", "continueButton", "doneButton",   "navProgress", "navProgressLabel", "navProgressCount",
  "navProgressBar", "navProgressFill", "navProgressHelp",
  "tagProgress", "tagProgressLabel", "tagProgressCount", "tagProgressHelp",
  "tagProgressBar", "tagProgressFill",
].map((id) => [id, document.getElementById(id)]));

let port = null;
let requestSequence = 0;
let activeTab = null;
let sourceTabId = null;
let sourceUrl = "";
let stageIndex = 0;
let navKind = "navbar";
let pairDraft = null;
let recording = false;
let pending = 0;
const requests = new Map();
const takes = [];
const retryPayloads = new Map();
const navCapturePhases = new Map([
  ["desktop", "waiting"], ["tablet", "waiting"], ["mobile", "waiting"],
]);
let desktopViewport = null;
let scanPhase = "";

const SCAN_PHASES = {
  locking: { title: "Locking desktop", help: "Holding the tab at 1600.", button: "Locking…" },
  scanning: { title: "Scanning page", help: "Reading live outlines…", button: "Scanning…" },
  desktop: { title: "Desktop tags", help: "Naming home-desktop layers…", button: "Desktop…" },
  tablet: { title: "Tablet tags", help: "Copying desktop names to tablet…", button: "Tablet…" },
  mobile: { title: "Mobile tags", help: "Copying desktop names to mobile…", button: "Mobile…" },
};

const TAG_BREAKS = ["desktop", "tablet", "mobile"];
const tagBreakPhases = new Map(TAG_BREAKS.map((id) => [id, { status: "waiting", matched: 0, renamed: 0 }]));

function setScanPhase(phase) {
  scanPhase = phase;
  document.querySelector(".record-card")?.classList.toggle("working", Boolean(phase));
  renderStage();
}

function setConnection(online, text = online ? "Connected" : "Offline") {
  ui.connection.classList.toggle("online", online);
  ui.connection.innerHTML = `<i></i> ${text}`;
}

function applySession(session, { overwrite = false } = {}) {
  if (!session || typeof session !== "object") return;
  for (const key of ["paperFileId", "projectRoot", "paperEndpoint"]) {
    const value = String(session[key] || "").trim();
    if (!value) continue;
    if (!overwrite && ui[key].value.trim()) continue;
    ui[key].value = value;
  }
}

async function sessionFromOpenTab() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const session = parseHref(tab.url || "");
    if (session) return session;
  }
  return null;
}

function connectHost() {
  if (port) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("The native bridge did not answer. Run install-native-host.command, then restart Chrome."));
      }
    }, 3000);
    port.onMessage.addListener((message) => {
      const pendingRequest = requests.get(message.requestId);
      if (pendingRequest) {
        requests.delete(message.requestId);
        if (message.ok) pendingRequest.resolve(message);
        else pendingRequest.reject(new Error(message.error || "Native bridge request failed"));
      }
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || "Native bridge disconnected";
      port = null;
      setConnection(false);
      for (const waiter of requests.values()) waiter.reject(new Error(error));
      requests.clear();
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`${error}. Run install-native-host.command, then restart Chrome.`));
      }
    });
    const requestId = `connect-${Date.now()}`;
    requests.set(requestId, {
      resolve: (message) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          setConnection(true);
          resolve(message);
        }
      },
      reject: (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      },
    });
    port.postMessage({ requestId, type: "PING" });
  });
}

function nativeRequest(type, payload = {}) {
  if (!port) return Promise.reject(new Error("Native bridge is not connected"));
  const requestId = `request-${Date.now()}-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      requests.delete(requestId);
      reject(new Error(type === "COMMIT_TAKE"
        ? "Paper did not acknowledge this take within 130 seconds"
        : type === "APPLY_SEMANTICS" || type === "APPLY_TAG_BREAKPOINT"
          ? "This breakpoint is still naming Paper layers. Scan again if a row stayed on Naming."
        : "The local bridge timed out"));
    }, type === "COMMIT_TAKE" ? 130000
      : type === "APPLY_SEMANTICS" || type === "APPLY_TAG_BREAKPOINT" ? 120000
      : 30000);
    requests.set(requestId, {
      resolve: (message) => { clearTimeout(timer); resolve(message); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    port.postMessage({ requestId, type, ...payload });
  });
}

async function currentTab() {
  const queries = [
    { active: true, lastFocusedWindow: true },
    { active: true, currentWindow: true },
  ];
  for (const query of queries) {
    const [tab] = await chrome.tabs.query(query);
    if (tab?.id && /^(https?|file):/i.test(tab.url || "")) return tab;
  }
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((item) => /^(https?|file):/i.test(item.url || "") && parseHref(item.url || ""));
  if (tab?.id) return tab;
  throw new Error("Open the source URL in this tab before starting capture");
}

function rememberSourceTab(tab) {
  if (!tab?.id) return tab;
  activeTab = tab;
  sourceTabId = tab.id;
  sourceUrl = cleanSourceUrl(tab.url || sourceUrl || "");
  return tab;
}

async function resolveSourceTab() {
  if (sourceTabId) {
    try {
      const tab = await chrome.tabs.get(sourceTabId);
      if (tab?.id && !tab.discarded) return rememberSourceTab(tab);
    } catch { /* tab was closed or was a capture popup */ }
  }
  if (sourceUrl) {
    const tabs = await chrome.tabs.query({});
    const needle = sourceUrl.replace(/\/$/, "");
    const match = tabs.find((tab) => cleanSourceUrl(tab.url || "").replace(/\/$/, "") === needle);
    if (match?.id) return rememberSourceTab(match);
  }
  return rememberSourceTab(await currentTab());
}

function isMissingReceiver(error) {
  return /Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error || ""));
}

async function ensureInjected(tabId) {
  const injected = await chrome.runtime.sendMessage({ type: "HC_INJECT", tabId });
  if (!injected?.ok) throw new Error(injected?.error || "Could not load Capture Tool on the source tab");
}

async function pageMessage(message) {
  const tab = await resolveSourceTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!isMissingReceiver(error)) throw error;
    await ensureInjected(tab.id);
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

function cleanSourceUrl(href) {
  try {
    const url = new URL(href);
    for (const key of ["paperFileId", "projectRoot", "paperEndpoint", "paper-capture"]) {
      url.searchParams.delete(key);
    }
    const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
    for (const key of ["paperFileId", "projectRoot", "paperEndpoint", "paper-capture"]) {
      hash.delete(key);
    }
    url.hash = hash.toString();
    return url.href;
  } catch {
    return href;
  }
}

function stage() { return STAGES[stageIndex]; }

function currentKind() {
  if (stage().id === "nav") return navKind;
  if (stage().id === "multi") return "multi-state";
  if (stage().id === "single") return "single";
  return stage().id;
}

function renderStages() {
  ui.stageRail.innerHTML = "";
  STAGES.forEach((item, index) => {
    const button = document.createElement("button");
    button.className = `stage-dot${index === stageIndex ? " active" : ""}${index < stageIndex ? " complete" : ""}`;
    button.textContent = index < stageIndex ? "✓" : item.short;
    button.title = item.title;
    button.disabled = index === stageIndex || pending > 0;
    if (index !== stageIndex) button.addEventListener("click", () => changeStage(index));
    ui.stageRail.append(button);
  });
}

function renderTakes() {
  ui.takes.innerHTML = "";
  const visible = takes.filter((take) => take.stage === stage().id);
  if (stage().id === "nav") {
    visible.sort((a, b) => (a.kind === "navbar") - (b.kind === "navbar"));
  }
  for (const take of visible) {
    const row = document.createElement("div");
    row.className = `take ${take.status}`;
    const icon = take.status === "success" ? "✓" : take.status === "failed" ? "!" : take.status === "idle" ? "–" : "…";
    row.innerHTML = `<span class="take-icon">${icon}</span><strong></strong><em></em><p></p>`;
    row.querySelector("strong").textContent = take.sectionId
      ? `${take.sectionId} · ${take.label}`
      : take.label;
    row.querySelector("em").textContent = take.meta || (take.states > 1 ? `${take.states} states` : "");
    row.querySelector("p").textContent = take.note || (take.status === "success"
      ? `✓ added to Paper · ${take.board}`
      : take.status === "failed" ? take.error : "Sending to Paper…");
    if (take.status === "failed" && retryPayloads.has(take.id)) {
      const retry = document.createElement("button");
      retry.className = "retry";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => retryTake(take.id));
      row.append(retry);
    }
    ui.takes.append(row);
  }
}

function renderStage() {
  const item = stage();
  renderStages();
  ui.stepKicker.textContent = `STEP ${stageIndex + 1} OF ${STAGES.length}`;
  ui.stageTitle.textContent = item.title;
  ui.stageCopy.textContent = item.copy;
  ui.navKindPicker.hidden = item.id !== "nav";
  ui.backButton.hidden = stageIndex === 0;
  ui.continueButton.hidden = item.id === "tags";
  ui.doneButton.hidden = item.id !== "tags";
  const navbarConfirmed = navbarReceiptCount();
  const navbarComplete = hasAllNavbarReceipts();
  ui.continueButton.disabled = pending > 0;
  ui.continueButton.classList.toggle("is-waiting", item.id === "nav" && !navbarComplete && pending > 0);
  ui.continueButton.textContent = item.id !== "nav" || navbarComplete
    ? "Continue"
    : pending > 0 ? `Confirming · ${navbarConfirmed}/3` : `Continue · ${navbarConfirmed}/3`;
  const busy = pending > 0 || Boolean(scanPhase);
  ui.doneButton.disabled = busy;
  ui.recordButton.disabled = busy;
  const phase = SCAN_PHASES[scanPhase];
  ui.recordTitle.textContent = phase ? phase.title
    : item.id === "tags"
    ? ui.autoMode.checked ? "Auto semantic scan ready" : "Semantic scan ready"
    : pairDraft ? "State 1 is ready"
      : ui.autoMode.checked ? "Auto mode ready" : "Ready to record";
  ui.recordHelp.textContent = phase ? phase.help
    : item.id === "tags"
    ? "Scan names matching Paper layers."
    : pairDraft ? "Open or change it, then capture state 2."
      : item.id === "nav" && navKind === "dropdown"
        ? "Hover a menu open, then click the open dropdown once."
      : ui.autoMode.checked ? "Scan the page and choose safe matches." : "Choose an element. Use ↑/↓ to select its parent.";
  const recordLabel = phase ? phase.button
    : item.id === "tags" ? "Scan" : ui.autoMode.checked ? "Auto" : "Record";
  ui.recordButton.innerHTML = `<span></span>${recordLabel}`;
  ui.recordButton.classList.toggle("working", Boolean(phase));
  renderNavbarProgress();
  renderTagProgress();
  renderTakes();
  if (!activeTab?.id) return;
  pageMessage({
    type: "HC_SET_RECORDING",
    recording: false,
    mode: item.id,
    captureKind: currentKind(),
  }).catch(() => {});
  if (item.id === "tags") {
    pageMessage({ type: "HC_SHOW_TAG_OUTLINES" }).catch(() => {});
  }
}

function navbarReceiptCount() {
  return new Set(takes
    .filter((take) => take.kind === "navbar" && take.status === "success")
    .map((take) => take.breakpoint)).size;
}

function navbarStatus(name) {
  const take = [...takes].reverse().find((item) => item.kind === "navbar" && item.breakpoint === name);
  if (take?.status === "success") return "confirmed";
  if (take?.status === "sending") return "confirming";
  if (take?.status === "failed") return "failed";
  return navCapturePhases.get(name) || "waiting";
}

function renderNavbarProgress() {
  const desktopStarted = takes.some((take) => take.kind === "navbar" && take.breakpoint === "desktop");
  const visible = stage().id === "nav" && desktopStarted;
  ui.navProgress.hidden = !visible;
  if (!visible) return;
  const count = navbarReceiptCount();
  const statuses = ["desktop", "tablet", "mobile"].map(navbarStatus);
  const working = statuses.some((status) => ["capturing", "captured", "confirming"].includes(status));
  const failed = statuses.some((status) => status === "failed");
  ui.navProgress.classList.toggle("working", working);
  ui.navProgress.classList.toggle("failed", failed);
  ui.navProgress.classList.toggle("complete", count === 3);
  ui.navProgressLabel.textContent = count === 3
    ? "Navbar confirmed in Paper"
    : failed ? "Navbar needs attention"
      : working ? "Capturing and confirming Navbar…" : "Waiting for Navbar capture";
  ui.navProgressCount.textContent = `${count}/3`;
  ui.navProgressBar.setAttribute("aria-valuenow", String(count));
  ui.navProgressFill.style.width = `${(count / 3) * 100}%`;
  ui.navProgressHelp.textContent = count === 3
    ? "All three are confirmed. Continue is ready."
    : failed ? "Retry the failed take; Continue will unlock after all three confirmations."
      : "Continue unlocks automatically after Paper confirms all three.";
  ui.navProgress.querySelectorAll("[data-breakpoint]").forEach((row) => {
    const status = navbarStatus(row.dataset.breakpoint);
    row.className = status;
    row.querySelector("small").textContent = ({
      waiting: "Waiting", capturing: "Capturing…", captured: "Captured · sending",
      confirming: "Confirming…", confirmed: "Paper confirmed", failed: "Retry needed",
    })[status] || "Waiting";
  });
}

function resetTagBreaks() {
  for (const id of TAG_BREAKS) tagBreakPhases.set(id, { status: "waiting", matched: 0, renamed: 0 });
}

function setTagBreak(id, status, extra = {}) {
  const current = tagBreakPhases.get(id) || { status: "waiting", matched: 0, renamed: 0 };
  tagBreakPhases.set(id, { ...current, status, ...extra });
  renderTagProgress();
}

function artboardKind(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("390") || value.includes("mobile")) return "mobile";
  if (value.includes("768") || value.includes("tablet")) return "tablet";
  if (value.includes("desktop")) return "desktop";
  return "";
}

function pendingTagBreaks(artboards) {
  const unused = ["tablet", "mobile"];
  const rows = [];
  for (const artboard of artboards || []) {
    let id = artboardKind(artboard);
    if (id === "desktop") continue;
    if (!unused.includes(id)) id = unused[0] || "";
    if (!id) continue;
    unused.splice(unused.indexOf(id), 1);
    rows.push({ id, artboard });
  }
  return rows;
}

function tagBreakNote(id, row) {
  if (row.status === "capturing" || row.status === "confirming") return "Naming…";
  if (row.status === "failed") return row.error || "Retry needed";
  if (row.status === "skipped") return "No artboard";
  if (row.status !== "confirmed") return "Waiting";
  if (id === "desktop") {
    const matched = Number(row.matched || 0);
    return matched ? `${matched} matched` : "Named";
  }
  const renamed = Number(row.renamed || 0);
  return renamed ? `${renamed} tagged` : "Named";
}

function renderTagProgress() {
  const visible = stage().id === "tags";
  ui.tagProgress.hidden = !visible;
  if (!visible) return;
  const locked = Boolean(desktopViewport?.ok && Math.abs(Number(desktopViewport.width) - 1600) <= 48);
  const rows = TAG_BREAKS.map((id) => tagBreakPhases.get(id) || { status: "waiting" });
  const confirmed = rows.filter((row) => row.status === "confirmed" || row.status === "skipped").length;
  const working = rows.some((row) => ["capturing", "confirming"].includes(row.status))
    || ["locking", "scanning", "desktop", "tablet", "mobile"].includes(scanPhase);
  const failed = rows.some((row) => row.status === "failed") || (Boolean(desktopViewport) && !locked);
  ui.tagProgress.classList.toggle("working", working);
  ui.tagProgress.classList.toggle("locked", locked && !failed);
  ui.tagProgress.classList.toggle("complete", confirmed === 3);
  ui.tagProgress.classList.toggle("failed", failed);
  ui.tagProgressLabel.textContent = confirmed === 3
    ? "Tags applied across breakpoints"
    : failed && !working ? "Tags need attention"
      : scanPhase === "locking" ? "Locking desktop · 1600"
      : scanPhase === "scanning" ? "Scanning page"
      : scanPhase === "desktop" ? "Naming desktop"
      : scanPhase === "tablet" ? "Naming tablet"
      : scanPhase === "mobile" ? "Naming mobile"
      : locked ? "Desktop locked · 1600"
        : desktopViewport ? `Need 1600 · now ${desktopViewport.width}`
          : "Locking to 1600…";
  ui.tagProgressCount.textContent = `${confirmed}/3`;
  ui.tagProgressBar?.setAttribute("aria-valuenow", String(confirmed));
  if (ui.tagProgressFill) ui.tagProgressFill.style.width = `${(confirmed / 3) * 100}%`;
  ui.tagProgressHelp.textContent = confirmed === 3
    ? "Desktop, tablet, and mobile layers are named."
    : failed && !working ? "Retry Scan to finish the failed breakpoint."
      : scanPhase === "locking" ? "Holding the tab at 1600…"
      : scanPhase === "scanning" ? "Reading live outlines…"
      : scanPhase === "desktop" ? "Naming matching home-desktop layers…"
      : scanPhase === "tablet" ? "Copying desktop tags to tablet…"
      : scanPhase === "mobile" ? "Copying desktop tags to mobile…"
      : "Scan names desktop, then tablet, then mobile.";
  ui.tagProgress.querySelectorAll("[data-breakpoint]").forEach((node) => {
    const id = node.dataset.breakpoint;
    const row = tagBreakPhases.get(id) || { status: "waiting" };
    node.className = row.status;
    node.querySelector("small").textContent = tagBreakNote(id, row);
  });
}

async function lockDesktopViewport() {
  const tab = await resolveSourceTab();
  await ensureInjected(tab.id);
  const result = await chrome.runtime.sendMessage({ type: "HC_LOCK_DESKTOP_VIEWPORT", tabId: tab.id });
  desktopViewport = result;
  if (!result?.ok) {
    throw new Error(result?.error || "Could not lock the page to the 1600 desktop lander");
  }
  return result;
}

function hasAllNavbarReceipts() {
  const confirmed = new Set(takes
    .filter((take) => take.kind === "navbar" && take.status === "success")
    .map((take) => take.breakpoint));
  return ["desktop", "tablet", "mobile"].every((name) => confirmed.has(name));
}

function setActivity(text, sending = false) {
  ui.activity.textContent = text;
  ui.activity.classList.toggle("sending", sending);
}

function setRecording(value) {
  recording = value;
  document.querySelector(".record-card").classList.toggle("recording", recording);
  ui.recordTitle.textContent = recording ? "Recording is on" : pairDraft ? "State 1 is ready" : "Ready to record";
  ui.recordHelp.textContent = recording ? "Click the outlined element." : pairDraft
    ? "Open or change it, then capture state 2." : "Choose an element. Use ↑/↓ to select its parent.";
  ui.recordButton.textContent = recording ? "Cancel" : ui.autoMode.checked ? "Auto" : "Record";
}

async function startCapture() {
  ui.setupError.textContent = "";
  ui.startButton.disabled = true;
  ui.startButton.textContent = "Connecting…";
  try {
    const paperFileId = ui.paperFileId.value.trim();
    const projectRoot = ui.projectRoot.value.trim();
    const paperEndpoint = ui.paperEndpoint.value.trim();
    if (!paperFileId) throw new Error("Paper file ID is required so writes cannot drift to another file");
    if (!projectRoot.startsWith("/")) throw new Error("Project folder must be an absolute path");
    activeTab = rememberSourceTab(await currentTab());
    await connectHost();
    const started = await nativeRequest("START_SESSION", {
      config: { paperFileId, projectRoot, paperEndpoint, sourceUrl: cleanSourceUrl(activeTab.url) },
    });
    await ensureInjected(activeTab.id);
    try {
      await lockDesktopViewport();
    } catch (error) {
      ui.captureError.textContent = `${error.message}. Tags may miss Paper layers if this window stays off 1600.`;
    }
    if (started?.paperSections?.length) {
      await pageMessage({ type: "HC_SET_PAPER_SECTIONS", sections: started.paperSections });
    }
    await chrome.storage.local.set({ paperFileId, projectRoot, paperEndpoint });
    ui.setup.hidden = true;
    ui.workspace.hidden = false;
    setConnection(true, "Paper ready");
    setActivity("Paper destinations are ready. Capture Navbar first.");
    renderStage();
  } catch (error) {
    ui.setupError.textContent = error.message;
    setConnection(false);
  } finally {
    ui.startButton.disabled = false;
    ui.startButton.textContent = "Start capture";
  }
}

async function commitTake(payload) {
  const local = {
    id: payload.id || `take-${Date.now()}-${++requestSequence}`,
    label: payload.label || currentKind(),
    stage: stage().id,
    kind: payload.kind || currentKind(),
    breakpoint: payload.breakpoint,
    status: "sending",
  };
  takes.push(local);
  retryPayloads.set(local.id, { ...payload, id: local.id });
  pending += 1;
  setActivity("Sending to Paper…", true);
  renderStage();
  try {
    const receipt = await nativeRequest("COMMIT_TAKE", { take: retryPayloads.get(local.id) });
    local.status = "success";
    local.board = receipt.receipt.board;
    local.paperNodeId = receipt.receipt.paperNodeId;
    local.error = "";
    setActivity(`✓ ${local.label} added to Paper`);
  } catch (error) {
    local.status = "failed";
    local.error = error.message;
    setActivity("Paper did not accept this take. Retry it before continuing.");
  } finally {
    pending -= 1;
    renderStage();
  }
  return local;
}

async function retryTake(id) {
  const local = takes.find((take) => take.id === id);
  const payload = retryPayloads.get(id);
  if (!local || !payload) return;
  local.status = "sending";
  pending += 1;
  renderStage();
  try {
    const receipt = await nativeRequest("COMMIT_TAKE", { take: payload, retry: true });
    local.status = "success";
    local.board = receipt.receipt.board;
    local.paperNodeId = receipt.receipt.paperNodeId;
    local.error = "";
    setActivity(`✓ ${local.label} added to Paper`);
  } catch (error) {
    local.status = "failed";
    local.error = error.message;
  } finally {
    pending -= 1;
    renderStage();
  }
}

async function handleCapture(capture) {
  setRecording(false);
  ui.captureError.textContent = "";
  const item = stage();
  if (item.id === "multi") {
    if (!pairDraft) {
      pairDraft = capture;
      setActivity("State 1 captured locally. Change/open it on the page, then record state 2.");
      renderStage();
      return;
    }
    const first = pairDraft;
    pairDraft = null;
    await commitTake({
      ...first,
      id: `pair-${Date.now()}-${++requestSequence}`,
      mode: item.id,
      kind: "multi-state",
      label: first.label,
      defaultHtml: first.html,
      hoverHtml: capture.html,
      html: undefined,
    });
    return;
  }
  if (item.id === "nav" && navKind === "navbar") {
    const desktop = {
      ...capture,
      breakpoint: "desktop",
      contractWidth: 1600,
    };
    navCapturePhases.set("desktop", "captured");
    const committed = await commitTake(desktop);
    if (committed.status === "success") await captureNavbarBreakpoints(desktop);
    return;
  }
  await commitTake(capture);
}

async function captureNavbarBreakpoints(capture) {
  pending += 1;
  ui.captureError.textContent = "";
  setActivity("Capturing Tablet 768 and Mobile 390 Navbar…", true);
  renderStage();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "HC_CAPTURE_NAV_BREAKPOINTS",
      url: capture.url,
      fingerprint: capture.navFingerprint,
    });
    const responsiveCommits = [];
    for (const responsive of result.captures || []) responsiveCommits.push(await commitTake(responsive));
    const paperFailures = responsiveCommits.filter((take) => take.status !== "success");
    if (!result.ok || paperFailures.length) {
      const details = [
        ...(result.errors || []),
        ...paperFailures.map((take) => `${take.label}: ${take.error || "Paper rejected the take"}`),
      ];
      throw new Error(`Responsive Navbar failed: ${details.join("; ")}`);
    }
    setActivity("✓ Desktop, Tablet, and Mobile Navbar added to Paper");
  } catch (error) {
    ui.captureError.textContent = `${error.message}. Record the desktop Navbar again to retry its background captures.`;
    setActivity("Responsive Navbar capture is incomplete.");
  } finally {
    pending -= 1;
    renderStage();
    if (sourceTabId) ensureInjected(sourceTabId).catch(() => {});
  }
}

async function toggleRecord() {
  ui.captureError.textContent = "";
  try {
    if (stage().id === "tags") {
      await runAuto();
      return;
    }
    if (ui.autoMode.checked) {
      await runAuto();
      return;
    }
    if (recording) {
      setRecording(false);
      await pageMessage({
        type: "HC_SET_RECORDING", recording: false, mode: stage().id, captureKind: currentKind(),
      });
      return;
    }
    setRecording(true);
    await pageMessage({
      type: "HC_SET_RECORDING", recording: true, mode: stage().id, captureKind: currentKind(),
    });
  } catch (error) {
    setRecording(false);
    ui.captureError.textContent = error.message;
    setActivity("");
  }
}

async function runAuto() {
  ui.recordButton.disabled = true;
  ui.captureError.textContent = "";
  setActivity("Auto is scanning visible candidates…", true);
  try {
    if (stage().id === "hover") {
      const tab = await resolveSourceTab();
      await ensureInjected(tab.id);
      const result = await chrome.runtime.sendMessage({ type: "HC_AUTO_HOVER", tabId: tab.id });
      if (!result?.ok) throw new Error(result?.error || "Auto Hover failed");
      for (const capture of result.captures || []) await commitTake(capture);
      if (!result.captures?.length) throw new Error("Auto did not find a safe hover candidate");
      return;
    }
    if (stage().id === "tags") {
      resetTagBreaks();
      try {
        setScanPhase("locking");
        await lockDesktopViewport();
      } catch (error) {
        throw new Error(`${error.message}. Resize will drift tags; lock the tab to 1600 and Scan again.`);
      }
      setScanPhase("scanning");
      setActivity("Scanning the 1600 desktop census…", true);
      const result = await pageMessage({ type: "HC_AUTO_TAGS" });
      if (!result?.ok) throw new Error(result?.error || "Tag scan failed");
      pending += 1;
      try {
        setTagBreak("desktop", "capturing");
        setScanPhase("desktop");
        let applied;
        try {
          applied = await nativeRequest("APPLY_SEMANTICS", { take: result.capture });
        } catch (error) {
          setTagBreak("desktop", "failed", { error: error.message });
          throw error;
        }
        const receipt = applied.receipt || {};
        setTagBreak("desktop", "confirmed", {
          matched: Number(receipt.matched || receipt.layerIds?.matched || 0),
          renamed: Number(receipt.renamed || 0),
        });
        const queued = pendingTagBreaks(receipt.pendingBreakpoints);
        const used = new Set(queued.map((row) => row.id));
        for (const id of TAG_BREAKS) {
          if (id !== "desktop" && !used.has(id)) setTagBreak(id, "skipped");
        }
        receipt.breakpoints = [];
        for (const row of queued) {
          setTagBreak(row.id, "capturing");
          setScanPhase(row.id);
          try {
            const next = await nativeRequest("APPLY_TAG_BREAKPOINT", { artboard: row.artboard });
            const named = next.receipt || next;
            receipt.breakpoints.push({ ...named, artboard: named.artboard || row.artboard });
            setTagBreak(row.id, "confirmed", { renamed: Number(named.renamed || 0) });
          } catch (error) {
            setTagBreak(row.id, "failed", { error: error.message });
          }
        }
        for (let index = takes.length - 1; index >= 0; index -= 1) {
          if (takes[index].stage === "tags") takes.splice(index, 1);
        }
        takes.push(...tagReport(result.capture, receipt));
        const failed = TAG_BREAKS
          .map((id) => tagBreakPhases.get(id))
          .filter((row) => row?.status === "failed");
        if (failed.length) {
          ui.captureError.textContent = failed.map((row) => row.error).filter(Boolean).join(" · ")
            || "One breakpoint failed";
        }
        const missing = receipt.missingSections?.length
          ? ` · missing Paper sections ${receipt.missingSections.join(", ")}` : "";
        const layer = receipt.layerIds
          ? ` · ${receipt.layerIds.tagged} layer-ids · ${receipt.layerIds.matched} pc-id hits`
          : "";
        setActivity(`✓ ${receipt.scanned} candidates across ${receipt.sourceSections} sections · ${receipt.matched} matched · ${receipt.renamed} renamed${layer}${missing}`);
      } finally {
        pending -= 1;
        setScanPhase("");
      }
      return;
    }
    if (stage().id === "multi") {
      throw new Error("Multi-state uses two manual takes so Capture Tool never invents a second state");
    }
    if (stage().id === "nav" && navKind === "dropdown") {
      throw new Error("Hover the dropdown open, then click it once");
    }
    const result = await pageMessage({
      type: "HC_AUTO_SINGLE", mode: stage().id, captureKind: currentKind(),
    });
    if (!result?.ok) throw new Error(result?.error || "Auto did not find a safe candidate");
    await handleCapture(result.capture);
  } catch (error) {
    ui.captureError.textContent = error.message;
    setActivity("");
    setScanPhase("");
  } finally {
    ui.recordButton.disabled = false;
  }
}

function tagKey(value) {
  return String(value || "").split("·")[0].trim().toLowerCase();
}

function taggedByTag(capture, receipt) {
  const tagged = new Map();
  const fromReceipt = receipt.byTag && typeof receipt.byTag === "object" ? Object.entries(receipt.byTag) : [];
  if (fromReceipt.length) {
    for (const [tag, count] of fromReceipt) tagged.set(tagKey(tag), Number(count) || 0);
    return tagged;
  }
  for (const update of receipt.updates || []) {
    const tag = tagKey(update.name);
    if (!tag) continue;
    tagged.set(tag, (tagged.get(tag) || 0) + 1);
  }
  if (tagged.size) return tagged;
  for (const node of capture.semanticNodes || []) {
    if (!node.pcId) continue;
    const tag = tagKey(node.tag);
    if (!tag) continue;
    tagged.set(tag, (tagged.get(tag) || 0) + 1);
  }
  return tagged;
}

// One row per tag so the census reads as a report, not a single truncated label.
function tagReport(capture, receipt) {
  const found = new Map();
  for (const node of capture.semanticNodes || []) {
    const tag = tagKey(node.tag);
    if (!tag) continue;
    found.set(tag, (found.get(tag) || 0) + 1);
  }
  const tagged = taggedByTag(capture, receipt);
  const total = [...found.values()].reduce((sum, count) => sum + count, 0);
  const rows = [{
    id: capture.id,
    label: "Semantic census",
    stage: "tags",
    kind: "tags-scan",
    status: "success",
    board: "home-desktop",
    meta: `${total} tags`,
    note: `${Number(receipt.renamed || 0)} tagged in Paper`,
    semanticReceipt: receipt,
    layerIds: receipt.layerIds || capture.layerIds,
  }];
  if (receipt.missingSections?.length) {
    rows.push({
      id: `${capture.id}-missing`,
      label: "No Paper section",
      stage: "tags",
      kind: "tag-tally",
      status: "failed",
      meta: `${receipt.missingSections.length} skipped`,
      note: receipt.missingSections.join(", "),
    });
  }
  const ranked = [...found.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [tag, count] of ranked) {
    const hits = tagged.get(tag) || 0;
    rows.push({
      id: `${capture.id}-${tag}`,
      label: `<${tag}>`,
      stage: "tags",
      kind: "tag-tally",
      status: hits ? "success" : "idle",
      meta: `${count} found`,
      note: hits ? `${hits} tagged` : "no Paper match",
    });
  }
  return rows;
}

function changeStage(index) {
  if (pending > 0 || scanPhase || index < 0 || index >= STAGES.length) return;
  pairDraft = null;
  stageIndex = index;
  setRecording(false);
  setActivity("");
  ui.captureError.textContent = "";
  renderStage();
  if (STAGES[index]?.id === "tags") {
    lockDesktopViewport().then(() => renderTagProgress()).catch((error) => {
      ui.captureError.textContent = error.message;
      renderTagProgress();
    });
  }
}

async function finishSession() {
  if (pending > 0) return;
  ui.doneButton.disabled = true;
  setActivity("Closing capture session…", true);
  try {
    await chrome.runtime.sendMessage({ type: "HC_RELEASE_VIEWPORT" }).catch(() => {});
    await nativeRequest("COMPLETE_SESSION", {
      summary: {
        sourceUrl: activeTab.url,
        takeCount: takes.filter((take) => take.status === "success" && take.kind !== "tag-tally").length,
        boards: [...new Set(takes.filter((take) => take.board).map((take) => take.board))],
      },
    });
    await pageMessage({ type: "HC_DEACTIVATE" }).catch(() => {});
    ui.workspace.hidden = true;
    ui.complete.hidden = false;
    setConnection(true, "Complete");
  } catch (error) {
    ui.captureError.textContent = error.message;
    ui.doneButton.disabled = false;
    setActivity("Session remains open because the completion receipt failed.");
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "HC_CAPTURED") {
    if (message.ok) handleCapture(message.capture);
    else ui.captureError.textContent = message.error || "Capture failed";
  }
  if (message.type === "HC_TAKE_READY") {
    setRecording(false);
    if (message.ok) commitTake(message.capture);
    else ui.captureError.textContent = message.error || "Hover capture failed";
  }
  if (message.type === "HC_RECORDING_CHANGED") {
    setRecording(Boolean(message.recording));
  }
  if (message.type === "HC_NAV_BREAKPOINT_PROGRESS") {
    navCapturePhases.set(message.breakpoint, message.phase);
    renderStage();
  }
});

ui.startButton.addEventListener("click", startCapture);
ui.recordButton.addEventListener("click", toggleRecord);
ui.continueButton.addEventListener("click", () => changeStage(stageIndex + 1));
ui.backButton.addEventListener("click", () => changeStage(stageIndex - 1));
ui.doneButton.addEventListener("click", finishSession);
ui.autoMode.addEventListener("change", renderStage);

for (const button of ui.navKindPicker.querySelectorAll(".kind")) {
  button.addEventListener("click", () => {
    navKind = button.dataset.kind;
    pairDraft = null;
    for (const item of ui.navKindPicker.querySelectorAll(".kind")) item.classList.toggle("active", item === button);
    renderStage();
  });
}

async function hydrateFromOpenTab() {
  const session = await sessionFromOpenTab();
  if (!session) return;
  applySession(session, { overwrite: true });
  await chrome.storage.local.set({
    paperFileId: session.paperFileId,
    projectRoot: session.projectRoot,
    captureAutostart: true,
    ...(session.paperEndpoint ? { paperEndpoint: session.paperEndpoint } : {}),
  });
}

let autoStarted = false;

async function maybeAutoStart() {
  if (autoStarted || ui.setup.hidden) return;
  const fromTab = await sessionFromOpenTab();
  const stored = await chrome.storage.local.get(["paperFileId", "projectRoot", "captureAutostart"]);
  if (!fromTab && !stored.captureAutostart) return;
  if (fromTab) applySession(fromTab, { overwrite: true });
  const paperFileId = ui.paperFileId.value.trim();
  const projectRoot = ui.projectRoot.value.trim();
  if (!paperFileId || !projectRoot.startsWith("/")) return;
  autoStarted = true;
  await chrome.storage.local.remove("captureAutostart");
  await startCapture();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  applySession({
    paperFileId: changes.paperFileId?.newValue,
    projectRoot: changes.projectRoot?.newValue,
    paperEndpoint: changes.paperEndpoint?.newValue,
  }, { overwrite: true });
  maybeAutoStart();
});

chrome.tabs.onUpdated.addListener(() => {
  hydrateFromOpenTab().then(maybeAutoStart);
});
chrome.tabs.onActivated.addListener(() => {
  hydrateFromOpenTab().then(maybeAutoStart);
});

chrome.storage.local.get(["paperFileId", "projectRoot", "paperEndpoint"]).then(async (saved) => {
  ui.paperEndpoint.value = saved.paperEndpoint || "http://127.0.0.1:29979/mcp";
  applySession(saved);
  await hydrateFromOpenTab();
  try {
    const ping = await connectHost();
    applySession(ping?.session);
  } catch (error) {
    ui.setupError.textContent = error.message;
  }
  await maybeAutoStart();
});
